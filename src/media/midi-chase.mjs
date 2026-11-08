import { integer, requireValue } from './common.mjs';

export const MAX_CHASE_OPERATIONS = 2_000_000;
export const defaultChaseOptions = () => ({
  notes: true, polyPressure: true, controllers: true, program: true,
  aftertouch: true, pitchbend: true, sysex: false, controllersOutsideParts: true,
});
export const chaseOptionsSchema = {
  type: 'object', additionalProperties: false,
  properties: Object.fromEntries(Object.keys(defaultChaseOptions()).map(key => [key, {type: 'boolean'}])),
};
export function resolveChaseOptions(options = {}) {
  requireValue(options && typeof options === 'object' && !Array.isArray(options) &&
    Object.entries(options).every(([key, value]) => Object.hasOwn(chaseOptionsSchema.properties, key) && typeof value === 'boolean'),
  'INVALID_MIDI_CHASE_OPTIONS', 'Chase options must be known boolean fields.');
  return {...defaultChaseOptions(), ...options};
}

// Bank/program and parameter selection/data entry are ordered protocols. A last
// value per CC would change their meaning. Resets must keep their original order.
const protocolCC = new Set([0, 32, 6, 38, 96, 97, 98, 99, 100, 101, 120, 121, 122, 123, 124, 125, 126, 127]);
const cloneEvent = (event, tick, phase) => ({...event, data: event.data.slice(), tick, chased: true, chasePhase: phase});
const channelState = () => ({sustain: false, sostenuto: false, active: new Set(), keys: new Set(), captured: new Set(), queues: new Map()});

/** A detached MIDI locate prefix, immediately BEFORE the original events at tick.
 * Input is the ordered output of compileMidiStreams (curves/modifiers included).
 * The caller appends original events with tick >= locate; source noteKeys connect
 * chased note-ons to their future paired offs. Released-but-pedal-held voices need
 * a same-tick note-on/off pair, so this is a wire/scheduler result, NOT a MIDI clip.
 * It does not claim oscillator phase/envelope continuity or interpret opaque SysEx.
 */
export function chaseMidiStreams(compiled, project, {tick, options = {}, maxOperations = MAX_CHASE_OPERATIONS} = {}) {
  integer(tick, 0, Number.MAX_SAFE_INTEGER, 'MIDI chase tick');
  integer(maxOperations, 1, MAX_CHASE_OPERATIONS, 'MIDI chase operation limit');
  const settings = resolveChaseOptions(options);
  requireValue(Array.isArray(compiled?.tracks) && Array.isArray(project?.clips), 'INVALID_MIDI_CHASE_SOURCE', 'Chase requires compiled tracks and source clip boundaries.');
  let operations = 0;
  const charge = (count = 1) => requireValue((operations += count) <= maxOperations, 'MIDI_CHASE_TOO_COMPLEX', 'MIDI chase exceeded its state operation budget.');
  const activeParts = new Set(), warnings = [], tracks = [];
  for (const [index, clip] of project.clips.entries()) {
    charge();
    if (clip.type === 'midi' && clip.startTick <= tick && tick < clip.startTick + clip.lengthTicks) activeParts.add(index);
  }
  let totalEvents = 0, totalPayload = 0;
  for (const stream of compiled.tracks) {
    charge();
    requireValue(Array.isArray(stream.events), 'INVALID_MIDI_CHASE_SOURCE', 'Chase track has no event stream.');
    const channels = Array.from({length: 16}, channelState), voices = new Map(), last = new Map(), protocol = [];
    const polyValues = Array.from({length: 16}, () => new Map());
    let priorTick = -1;
    const remove = voice => {
      charge(); const state = channels[voice.on.channel];
      state.active.delete(voice); state.keys.delete(voice); state.captured.delete(voice); voices.delete(voice.on.noteKey);
    };
    const held = (state, voice) => state.sustain || state.sostenuto && state.captured.has(voice);
    const releaseUnheld = state => { for (const voice of state.active) { charge(); if (!voice.keyDown && !held(state, voice)) remove(voice); } };
    const keyUp = (voice, event) => {
      if (!voice?.keyDown) return;
      charge(); const state = channels[voice.on.channel]; voice.keyDown = false; voice.off = event; state.keys.delete(voice);
      if (!held(state, voice)) remove(voice);
    };
    const allNotesOff = (state, event) => {
      for (const voice of state.keys) keyUp(voice, {...event, status: 0x80 | voice.on.channel, data: [voice.on.pitch, 0]});
    };
    for (const [index, event] of stream.events.entries()) {
      charge();
      integer(event.tick, 0, Number.MAX_SAFE_INTEGER, 'Compiled chase event tick');
      requireValue(event.tick >= priorTick, 'INVALID_MIDI_CHASE_SOURCE', 'Chase events must be in nondecreasing tick order.');
      priorTick = event.tick;
      if (event.tick >= tick) break;
      const type = event.status >> 4;
      if (event.kind === 'noteOn') {
        requireValue(!voices.has(event.noteKey), 'INVALID_MIDI_CHASE_SOURCE', 'Duplicate active note identity.');
        const state = channels[event.channel], voice = {on: event, keyDown: true, off: null, index};
        voices.set(event.noteKey, voice); state.active.add(voice); state.keys.add(voice);
        let queue = state.queues.get(event.pitch);
        if (!queue) state.queues.set(event.pitch, queue = {values: [], head: 0});
        queue.values.push(voice);
      } else if (event.kind === 'noteOff') keyUp(voices.get(event.noteKey), event);
      else if (event.kind === 'raw' && event.rawKind === 'channel') {
        const state = channels[event.status & 15], [first, value] = event.data;
        if (type === 8 || type === 9 && value === 0) {
          const queue = state.queues.get(first);
          if (queue) {
            while (queue.head < queue.values.length && !queue.values[queue.head].keyDown) { charge(); queue.head++; }
            if (queue.head < queue.values.length) keyUp(queue.values[queue.head++], event);
          }
        } else if (type === 11) {
          // Match the existing renderer's policy for malformed channel-mode values.
          const validMode = ![120, 121, 123, 124, 125, 127].includes(first) || value === 0;
          if (validMode) switch (first) {
            case 64: state.sustain = value >= 64; if (!state.sustain) releaseUnheld(state); break;
            case 66:
              if (value >= 64 && !state.sostenuto) for (const voice of state.keys) { charge(); state.captured.add(voice); }
              state.sostenuto = value >= 64;
              if (!state.sostenuto) { state.captured.clear(); releaseUnheld(state); }
              break;
            case 120:
              for (const voice of state.active) { voice.keyDown = false; remove(voice); }
              break;
            case 121:
              state.sustain = state.sostenuto = false; state.captured.clear(); releaseUnheld(state);
              // Type selection must not resurrect a pre-reset bend/pressure value
              // when CC chase itself is disabled or the reset is outside a part.
              for (const [key, entry] of polyValues[event.status & 15]) {
                charge();
                const reset = {
                  index, event: {...entry.event, data: [entry.event.data[0], 0], chaseResetValue: true},
                };
                last.set(key, reset); polyValues[event.status & 15].set(key, reset);
              }
              for (const [enabled, status, data] of [[settings.aftertouch, 0xd0, [0]], [settings.pitchbend, 0xe0, [0, 64]]]) {
                if (enabled) last.set(`${status | (event.status & 15)}:`, {index,
                  event: {...event, status: status | (event.status & 15), data, chaseResetValue: true}});
              }
              break;
            case 123: case 124: case 125: case 126: case 127: allNotesOff(state, event); break;
          }
        }
        const enabled = type === 10 ? settings.polyPressure : type === 11 ? settings.controllers &&
          (settings.controllersOutsideParts || event.setupParameter || activeParts.has(event.clipIndex)) :
          type === 12 ? settings.program : type === 13 ? settings.aftertouch : type === 14 ? settings.pitchbend : false;
        if (!enabled) continue;
        const entry = {event, index};
        if (type === 12 || type === 11 && protocolCC.has(first)) protocol.push(entry);
        else {
          const key = `${event.status}:${type === 10 || type === 11 ? first : ''}`;
          last.set(key, entry);
          if (type === 10) polyValues[event.status & 15].set(key, entry);
        }
      } else if (event.kind === 'raw' && event.rawKind === 'sysex' && settings.sysex) {
        // F0, split F7 continuations and standalone F7 escape packets retain framing
        // and order. An open prefix is completed only by the future source packets.
        charge(event.data.length); protocol.push({event, index});
      }
    }
    const selected = [...protocol, ...last.values()].sort((a, b) => a.index - b.index);
    const events = selected.map(({event}) => cloneEvent(event, tick, 'state'));
    // The effective replayed pedal state may differ from source when controllers
    // or part-boundary history is disabled. Never secretly override those choices.
    const replay = Array.from({length: 16}, () => ({sustain: false, sostenuto: false, sostenutoValue: 0}));
    for (const event of events) {
      charge();
      if (event.rawKind !== 'channel' || event.status >> 4 !== 11) continue;
      const state = replay[event.status & 15], [cc, value] = event.data;
      if (cc === 64) state.sustain = value >= 64;
      if (cc === 66) { state.sostenuto = value >= 64; state.sostenutoValue = value; }
      if (cc === 121 && value === 0) state.sustain = state.sostenuto = false;
    }
    let chasedNotes = 0, pedalHeldNotes = 0, omittedHeldNotes = 0;
    if (settings.notes) for (const [channel, state] of channels.entries()) {
      const pedals = replay[channel], included = [];
      for (const voice of state.active) {
        charge();
        if (voice.keyDown || pedals.sustain && state.sustain || pedals.sostenuto && state.sostenuto && state.captured.has(voice)) included.push(voice);
        else omittedHeldNotes++;
      }
      const captured = included.filter(voice => pedals.sostenuto && state.captured.has(voice));
      const capturedSet = new Set(captured);
      const sendPedal = value => events.push({kind: 'raw', rawKind: 'channel', tick, status: 0xb0 | channel, channel, data: [66, value], sourceTrack: stream.sourceTrack, chased: true, chasePhase: 'sostenuto-capture'});
      const sendOn = voice => {
        charge(); chasedNotes++;
        events.push({...cloneEvent(voice.on, tick, 'note'), nominalStartTick: tick, nominalEndTick: Math.max(tick, voice.on.nominalEndTick),
          durationTicks: Math.max(0, voice.on.nominalEndTick - tick)});
      };
      if (captured.length) {
        sendPedal(0); for (const voice of captured) sendOn(voice); sendPedal(pedals.sostenutoValue);
      }
      for (const voice of included) if (!capturedSet.has(voice)) sendOn(voice);
      // Some receivers apply per-key pressure only to voices that already exist.
      // Restore it after the chased note-ons as well as in the ordered state prefix.
      const pitches = new Set(included.map(voice => voice.on.pitch));
      for (const {event} of polyValues[channel].values()) {
        charge();
        if (event.status === (0xa0 | channel) && pitches.has(event.data[0])) events.push(cloneEvent(event, tick, 'note-pressure'));
      }
      for (const voice of included) if (!voice.keyDown) {
        charge(); pedalHeldNotes++;
        const off = voice.off;
        events.push({...cloneEvent(voice.on, tick, 'held-note-off'), kind: 'noteOff',
          status: off.status, data: off.data.slice(), nominalStartTick: tick, durationTicks: 0,
          releaseVelocity: off.data[1], noteOffEncoding: off.status >> 4 === 9 ? 'zeroVelocityNoteOn' : 'noteOff'});
      }
    }
    if (omittedHeldNotes) warnings.push({code: 'MIDI_CHASE_PEDAL_SCOPE', trackId: stream.trackId, count: omittedHeldNotes,
      message: 'Released pedal-held notes were omitted because the selected controller scope does not restore their holding pedal.'});
    if (settings.sysex && events.some(e => e.rawKind === 'sysex')) warnings.push({code: 'MIDI_CHASE_OPAQUE_SYSEX', trackId: stream.trackId,
      message: 'SysEx history is replayed in exact packet order. Device-specific resets and patches are not interpreted by the built-in synth or note-state tracker.'});
    totalEvents += events.length; totalPayload += events.reduce((sum, e) => sum + e.data.length, 0);
    requireValue(totalEvents <= 600000 && totalPayload <= 8 * 1024 * 1024, 'MIDI_CHASE_TOO_LARGE', 'MIDI chase prefix exceeds its event/payload limit.');
    tracks.push({trackId: stream.trackId, sourceTrack: stream.sourceTrack, events, chasedNotes, pedalHeldNotes, omittedHeldNotes});
  }
  return {tick, options: settings, tracks, warnings, stats: {operations, eventCount: totalEvents, payloadBytes: totalPayload}};
}
