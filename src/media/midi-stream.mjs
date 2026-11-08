import {applyMidiOutputModifiers} from './midi-modifiers.mjs';
import { integer, requireValue } from './common.mjs';
import { materializeMidiCurves, MAX_CURVE_EVALUATIONS } from './midi-curves.mjs';

const MAX_NOTES = 200000;
const MAX_RETAINED_EVENTS = 200000;
const MAX_PAYLOAD = 1024 * 1024;
const MAX_PAYLOAD_TOTAL = 4 * 1024 * 1024;
const MANAGED_META = new Set([0x03, 0x2f, 0x51, 0x58]);

function validateRawEvent(event) {
  requireValue(event && Array.isArray(event.data), 'INVALID_MIDI_PROJECT', 'Retained MIDI events require a data byte array.');
  requireValue(event.data.length <= MAX_PAYLOAD, 'MIDI_TOO_LARGE', 'Retained MIDI event payload exceeds 1 MiB.');
  integer(event.status, 0, 255, 'MIDI event status');
  for (const byte of event.data) integer(byte, 0, 255, 'MIDI data byte');
  if (event.kind === 'channel') {
    const type = event.status >> 4;
    requireValue(event.status >= 0x80 && event.status <= 0xef && event.data.length === (type === 0xc || type === 0xd ? 1 : 2),
      'INVALID_MIDI_PROJECT', 'Channel MIDI events require a channel status and its exact data length.');
    requireValue(event.data.every(byte => byte < 128), 'INVALID_MIDI_PROJECT', 'Channel MIDI data must fit seven bits.');
    requireValue(type !== 9 || event.data[1] === 0, 'INVALID_MIDI_PROJECT', 'Positive-velocity note-ons must be stored as notes.');
    requireValue(event.metaType === undefined, 'INVALID_MIDI_PROJECT', 'Channel MIDI events cannot have a meta type.');
    return;
  }
  if (event.kind === 'sysex') {
    requireValue((event.status === 0xf0 || event.status === 0xf7) && event.metaType === undefined,
      'INVALID_MIDI_PROJECT', 'System-exclusive events require F0 or F7 framing without a meta type.');
    return;
  }
  requireValue(event.kind === 'meta' && event.status === 0xff, 'INVALID_MIDI_PROJECT', 'Unknown retained MIDI event kind or status.');
  integer(event.metaType, 0, 127, 'MIDI meta type');
  requireValue(!MANAGED_META.has(event.metaType), 'INVALID_MIDI_PROJECT', 'Track names, end-of-track, tempo and time signature are managed metadata, not raw events.');
  return;
}

/** Compile detached, ordered per-track MIDI streams shared by playback and SMF export.
 * Only selected MIDI tracks count toward the work budget. Track/clip indices retain
 * their original project positions. A final modifier stage uses the tempo map only for
 * millisecond delay; audio mixer and instrument interpretation remains downstream.
 * Paired note endpoints share a compile-local noteKey; raw note-offs have no noteKey.
 */
export function compileMidiStreams(project, { trackIds, includeMutedClips = true, applyModifiers = true } = {}) {
  requireValue(project && Array.isArray(project.tracks) && Array.isArray(project.clips), 'INVALID_MIDI_PROJECT', 'Expected a project with tracks and clips.');
  const midiTracks = new Map();
  for (const [sourceTrack, track] of project.tracks.entries()) if (track.type === 'midi') {
    requireValue(!midiTracks.has(track.id), 'INVALID_MIDI_PROJECT', 'MIDI track IDs must be unique.');
    midiTracks.set(track.id, { track, sourceTrack });
  }
  if (trackIds !== undefined) {
    requireValue(Array.isArray(trackIds) && trackIds.every(id => typeof id === 'string') && new Set(trackIds).size === trackIds.length,
      'INVALID_MIDI_PROJECT', 'Selected MIDI track IDs must be a unique string array.');
    for (const id of trackIds) requireValue(midiTracks.has(id), 'INVALID_MIDI_PROJECT', `Selected MIDI track does not exist: ${id}.`);
  }
  const selected = trackIds === undefined ? null : new Set(trackIds);
  const trackEvents = new Map([...midiTracks].filter(([id]) => !selected || selected.has(id)).map(([id, {sourceTrack}]) => [id, { trackId: id, sourceTrack, endTick: 0, events: [], groups: new Map() }]));
  const orderedTracks = new Set();
  let noteCount = 0, retainedCount = 0, sourceRetainedCount = 0, sourcePayloadBytes = 0, payloadBytes = 0, lastTick = 0, sequence = 0;
  let hasCurves = false;
  const curveWarnings = [], curveStats = { segments: 0, evaluations: 0, generatedEvents: 0, sourceEvents: 0, materializedEvents: 0, gridTicks: 1 };
  const push = (list, event) => list.push({ rank: 0, ...event, sequence: sequence++ });
  for (const [clipIndex, clip] of project.clips.entries()) {
    if (clip.type !== 'midi' || (!includeMutedClips && clip.mute)) continue;
    if (!midiTracks.has(clip.trackId)) requireValue(false, 'INVALID_MIDI_PROJECT', 'A MIDI clip references a missing MIDI track.');
    const target = trackEvents.get(clip.trackId);
    if (!target) continue;
    requireValue(target && Array.isArray(clip.notes) && (clip.events === undefined || Array.isArray(clip.events)), 'INVALID_MIDI_PROJECT', 'A MIDI clip references a missing MIDI track or invalid notes/events.');
    integer(clip.startTick, 0, Number.MAX_SAFE_INTEGER, 'MIDI clip start');
    integer(clip.lengthTicks, 1, Number.MAX_SAFE_INTEGER, 'MIDI clip length');
    if (clip.midiOrderGroup !== undefined) requireValue(typeof clip.midiOrderGroup === 'string' && clip.midiOrderGroup.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(clip.midiOrderGroup),
      'INVALID_MIDI_PROJECT', 'MIDI order groups must be nonempty stable identifier strings.');
    // Explicit lineage joins split fragments. An ungrouped clip is independent,
    // including pure-writer fixtures without IDs, and cannot collide with a group ID.
    const groupKey = clip.midiOrderGroup === undefined ? `clip:${clipIndex}` : `group:${clip.midiOrderGroup}`;
    let group = target.groups.get(groupKey);
    if (!group) { group = { startTick: clip.startTick, firstIndex: clipIndex }; target.groups.set(groupKey, group); }
    else group.startTick = Math.min(group.startTick, clip.startTick);
    if ((clip.events?.length ?? 0) || clip.notes.some(note => note.onOrder !== undefined || note.offOrder !== undefined)) orderedTracks.add(target.sourceTrack);
    const clipEnd = clip.startTick + clip.lengthTicks;
    integer(clipEnd, 1, Number.MAX_SAFE_INTEGER, 'Absolute MIDI clip end');
    target.endTick = Math.max(target.endTick, clipEnd); lastTick = Math.max(lastTick, clipEnd);
    const orderKeys = new Set();
    const checkOrder = (tick, order) => {
      if (order === undefined) return;
      integer(order, 0, Number.MAX_SAFE_INTEGER, 'MIDI event order');
      const key = `${tick}:${order}`;
      requireValue(!orderKeys.has(key), 'MIDI_ORDER_CONFLICT', 'Explicit note and event orders must be unique at each tick within a clip.');
      orderKeys.add(key);
    };
    for (const [noteIndex, note] of clip.notes.entries()) {
      requireValue(++noteCount <= MAX_NOTES, 'MIDI_TOO_LARGE', 'MIDI stream exceeds 200000 notes.');
      integer(note.pitch, 0, 127, 'MIDI pitch'); integer(note.velocity, 1, 127, 'MIDI velocity');
      integer(note.channel ?? 0, 0, 15, 'MIDI channel');
      integer(note.startTick, 0, Number.MAX_SAFE_INTEGER, 'Note start');
      integer(note.durationTicks, 0, Number.MAX_SAFE_INTEGER, 'Note duration');
      integer(note.releaseVelocity ?? 0, 0, 127, 'Note release velocity');
      const encoding = note.noteOffEncoding ?? 'noteOff';
      requireValue(encoding === 'noteOff' || encoding === 'zeroVelocityNoteOn', 'INVALID_MIDI_PROJECT', 'Unknown MIDI note-off encoding.');
      requireValue(encoding !== 'zeroVelocityNoteOn' || (note.releaseVelocity ?? 0) === 0,
        'INVALID_MIDI_PROJECT', 'Zero-velocity note-on encoding cannot carry nonzero release velocity.');
      requireValue(Number.isSafeInteger(note.startTick + note.durationTicks) && note.startTick < clip.lengthTicks && (clip.allowNoteTails || note.startTick + note.durationTicks <= clip.lengthTicks),
        'INVALID_MIDI_PROJECT', 'MIDI note extends beyond its clip.');
      const start = clip.startTick + note.startTick, end = start + note.durationTicks;
      integer(end, 0, Number.MAX_SAFE_INTEGER, 'Absolute MIDI note end');
      target.endTick=Math.max(target.endTick,end);lastTick=Math.max(lastTick,end);
      requireValue(note.durationTicks !== 0 || note.offOrder === undefined || note.onOrder !== undefined && note.onOrder < note.offOrder, 'MIDI_ZERO_NOTE_ORDER', 'An instantaneous note must order note-on before its same-tick note-off.');
      checkOrder(note.startTick, note.onOrder); checkOrder(note.startTick + note.durationTicks, note.offOrder);
      const common = { clipId: clip.id, clipIndex, noteId: note.id, noteKey: `note:${clipIndex}:${noteIndex}`, channel: note.channel ?? 0, pitch: note.pitch, velocity: note.velocity, releaseVelocity: note.releaseVelocity ?? 0, noteOffEncoding: encoding, nominalStartTick: start, nominalEndTick: end, durationTicks: note.durationTicks, sourceTrack: target.sourceTrack, group };
      push(target.events, { ...common, kind: 'noteOn', tick: start, rank: 2, order: note.onOrder, status: 0x90 | common.channel, data: [note.pitch, note.velocity] });
      push(target.events, { ...common, kind: 'noteOff', tick: end, rank: note.durationTicks === 0 ? 2 : 1, order: note.offOrder, status: (encoding === 'zeroVelocityNoteOn' ? 0x90 : 0x80) | common.channel, data: [note.pitch, common.releaseVelocity] });
    }
    for (const event of clip.events ?? []) {
      requireValue(++sourceRetainedCount <= MAX_RETAINED_EVENTS, 'MIDI_TOO_LARGE', 'MIDI stream exceeds 200000 retained events.');
      integer(event.tick, 0, clip.lengthTicks, 'MIDI event tick'); integer(event.order, 0, Number.MAX_SAFE_INTEGER, 'MIDI event order');
      checkOrder(event.tick, event.order);
      validateRawEvent(event);
      requireValue((sourcePayloadBytes += event.data.length) <= MAX_PAYLOAD_TOTAL, 'MIDI_TOO_LARGE', 'Stored MIDI event data exceeds the 4 MiB total payload limit.');
    }
    let events = clip.events ?? [];
    if (events.some(event => event.curve !== undefined)) {
      hasCurves = true;
      const expanded = materializeMidiCurves(clip, { maxEvents: MAX_RETAINED_EVENTS - retainedCount, maxEvaluations: MAX_CURVE_EVALUATIONS - curveStats.evaluations });
      events = expanded.events;
      for (const item of expanded.diagnostics) curveWarnings.push({ ...item, clipId: clip.id });
      for (const key of ['segments', 'evaluations', 'generatedEvents', 'sourceEvents', 'materializedEvents']) curveStats[key] += expanded.stats[key];
    }
    for (const event of events) {
      requireValue(++retainedCount <= MAX_RETAINED_EVENTS, 'MIDI_TOO_LARGE', 'MIDI stream exceeds 200000 retained or sampled events.');
      requireValue((payloadBytes += event.data.length) <= MAX_PAYLOAD_TOTAL, 'MIDI_TOO_LARGE', 'Retained MIDI event data exceeds the 4 MiB total payload limit.');
      push(target.events, { kind: 'raw', rawKind: event.kind, tick: clip.startTick + event.tick, order: event.order, sourceTrack: target.sourceTrack, group, clipId: clip.id, clipIndex, eventId: event.id, status: event.status, data: event.data.slice(), ...(event.kind === 'channel' ? { channel: event.status & 15 } : {}), ...(event.kind === 'meta' ? { metaType: event.metaType } : {}), ...(event.curveGenerated ? { curveGenerated: true, curveSourceId: event.curveSourceId, curveLane: event.curveLane } : {}) });
    }
  }
  const tracks = [...trackEvents.values()].map(target => {
    target.events.sort((a, b) => a.tick - b.tick ||
      (orderedTracks.has(target.sourceTrack) ? a.group.startTick - b.group.startTick || a.group.firstIndex - b.group.firstIndex : 0) ||
      Number(!a.curveGenerated) - Number(!b.curveGenerated) ||
      (a.curveGenerated && b.curveGenerated ? (a.curveLane < b.curveLane ? -1 : a.curveLane > b.curveLane ? 1 : 0) : 0) ||
      (a.order === undefined ? 1 : 0) - (b.order === undefined ? 1 : 0) ||
      (a.order ?? 0) - (b.order ?? 0) || a.rank - b.rank || a.sequence - b.sequence);
    for (const event of target.events) { delete event.group; delete event.rank; delete event.sequence; }
    return { trackId: target.trackId, sourceTrack: target.sourceTrack, endTick: target.endTick, events: target.events };
  });
  const result={ tracks, endTick: lastTick, noteCount, rawEventCount: retainedCount, eventCount: noteCount * 2 + retainedCount, payloadBytes, ...(hasCurves ? { curveWarnings, curveStats } : {}) };
  return applyModifiers?applyMidiOutputModifiers(result,project):result;
}

/** Merge already ordered streams for SMF 0; independent tracks use project track order. */
export function mergeMidiStreams(compiled) {
  return compiled.tracks.flatMap(track => track.events.map((event, index) => ({event, index})))
    .sort((a, b) => a.event.tick - b.event.tick || a.event.sourceTrack - b.event.sourceTrack || a.index - b.index)
    .map(item => item.event);
}
