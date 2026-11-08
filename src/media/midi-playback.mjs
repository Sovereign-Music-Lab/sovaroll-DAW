import {panGains} from './pan-law.mjs';
import { requireValue } from './common.mjs';

export const MIDI_RELEASE_SECONDS = 0.05;
export const MAX_MIDI_STATE_OPERATIONS = 2_000_000;
export const MAX_MIDI_SEGMENT_VISITS = 2_000_000;
const supportedCC = new Set([6, 7, 10, 11, 38, 64, 66, 98, 99, 100, 101, 120, 121, 123, 124, 125, 126, 127]);
const panValue = value => value <= 64 ? (value - 64) / 64 : (value - 64) / 63;
const clamp = value => Math.max(-1, Math.min(1, value));

/** Opaque messages remain stored; this predicate selects only tracks needing
 * the voice/state path. Other tracks keep the original oscillator arithmetic. */
export function needsMidiPlayback(clip) {
  return clip.type === 'midi' && (clip.events ?? []).some(event => event.kind === 'channel' &&
    ([8, 9, 14].includes(event.status >> 4) || (event.status >> 4) === 11 && supportedCC.has(event.data[0])));
}

export function midiPlaybackWarnings(clips, warnings) {
  for (const clip of clips) if (clip.type === 'midi') {
    if (Array.isArray(clip.notes) && clip.notes.some(note => (note.releaseVelocity ?? 0) !== 0)) warnings.add('Note release velocity is preserved for MIDI export but does not change the built-in oscillator envelope or timbre.');
    for (const event of clip.events ?? []) {
      if (event.kind === 'sysex') warnings.add('SysEx F0/F7 packets are preserved for MIDI export but are not interpreted by the built-in synth.');
      else if (event.kind === 'meta') warnings.add('Opaque MIDI metadata is preserved for export but is not interpreted as playback or project markers.');
      else {
        const type = event.status >> 4;
        if (type === 12) warnings.add('Program changes are preserved for MIDI export but do not select patches in the built-in oscillator synth.');
        else if (type === 10 || type === 13) warnings.add('Polyphonic and channel pressure are preserved for MIDI export but do not affect the built-in oscillator.');
        else if (type === 11) {
          const cc = event.data[0];
          if (cc === 0 || cc === 32) warnings.add('MIDI bank-select CC0/32 is preserved for export but does not select built-in synth banks.');
          else if ([39, 42, 43].includes(cc)) warnings.add('LSB volume/pan/expression CC39/42/43 is preserved but not combined with the supported 7-bit controls.');
          else if (cc === 96 || cc === 97) warnings.add('RPN/NRPN data increment/decrement CC96/97 is preserved but not interpreted.');
          else if (!supportedCC.has(cc)) warnings.add(`MIDI controller CC${cc} is preserved for export but is not interpreted by the built-in synth.`);
        }
      }
    }
  }
}

function channelState() {
  return { volume: 127, expression: 127, pan: 64, bend: 8192, semitones: 2, cents: 0, sustain: false, sostenuto: false, captured: new Set(),
    selector: null, rpnMSB: 127, rpnLSB: 127, nrpnMSB: 127, nrpnLSB: 127,
    keyDown: new Set(), held: new Set(), sounding: new Set(), queues: new Map(),
    controls: [{ time: 0, gain: 1, pan: 0, bendFactor: 1, integral: 0 }] };
}
function recordControl(state, time) {
  const prior = state.controls.at(-1), gain = state.volume / 127 * (state.expression / 127), pan = panValue(state.pan);
  const bendFactor = 2 ** (((state.bend - 8192) / 8192) * (state.semitones + state.cents / 100) / 12);
  if (gain === prior.gain && pan === prior.pan && bendFactor === prior.bendFactor) return;
  const next = { time, gain, pan, bendFactor, integral: prior.integral + (time - prior.time) * prior.bendFactor };
  if (prior.time === time) state.controls[state.controls.length - 1] = next;
  else state.controls.push(next);
}
function locate(items, value, key) {
  let low = 0, high = items.length;
  while (low + 1 < high) { const middle = Math.floor((low + high) / 2); if (items[middle][key] <= value) low = middle; else high = middle; }
  return low;
}
function integralAt(controls, time) {
  const control = controls[locate(controls, time, 'time')];
  return control.integral + (time - control.time) * control.bendFactor;
}

/** Simulate ordered MIDI state without writing project data or samples. Channel
 * state is local to each track. Paired note-offs target their own voice; raw
 * note-offs consume the oldest still-key-down same-channel/pitch voice (FIFO).
 * maxStateOperations is a direct helper test limit, not an HTTP render option. */
export function compileMidiPlayback(compiled, { timeline, contentDuration, warnings = new Set(), maxStateOperations = MAX_MIDI_STATE_OPERATIONS }) {
  let operations = 0;
  const charge = () => requireValue(++operations <= maxStateOperations, 'RENDER_TOO_COMPLEX', 'MIDI playback exceeds the 2 million event/state operation limit.');
  const tracks = [];
  for (const stream of compiled.tracks) {
    const channels = Array.from({ length: 16 }, channelState), voices = [], active = new Map(), releasing = [];
    let releaseHead = 0;
    const expire = time => {
      while (releaseHead < releasing.length && releasing[releaseHead].releaseTime + MIDI_RELEASE_SECONDS <= time) {
        charge(); const voice = releasing[releaseHead++]; channels[voice.channel].sounding.delete(voice); active.delete(voice.noteKey);
      }
    };
    const release = (voice, time) => {
      if (voice.releaseTime !== null || voice.killTime !== Infinity) return;
      charge(); channels[voice.channel].held.delete(voice); voice.releaseTime = time;
      voice.releaseLevel = Math.min(1, Math.max(0, (time - voice.start) / voice.attack)); releasing.push(voice);
    };
    const keyUp = (voice, time) => {
      if (!voice?.keyDown || voice.killTime !== Infinity) return;
      charge(); const channel = channels[voice.channel]; voice.keyDown = false; channel.keyDown.delete(voice);
      if (channel.sustain || channel.sostenuto && channel.captured.has(voice)) channel.held.add(voice); else release(voice, time);
    };
    const allNotesOff = (channel, time) => { for (const voice of channel.keyDown) keyUp(voice, time); };
    for (const event of stream.events) {
      charge(); const time = timeline.tickToSeconds(event.tick); expire(time);
      if (event.kind === 'noteOn') {
        const channel = channels[event.channel], nominalEnd = timeline.tickToSeconds(event.nominalEndTick);
        const voice = { noteKey: event.noteKey, noteId: event.noteId, channel: event.channel, pitch: event.pitch, velocity: event.velocity,
          start: time, nominalEnd, attack: Math.max(Number.MIN_VALUE, Math.min(0.005, (nominalEnd - time) / 4)), releaseTime: null, releaseLevel: 1, killTime: Infinity, keyDown: true };
        voices.push(voice); active.set(event.noteKey, voice); channel.keyDown.add(voice); channel.sounding.add(voice);
        let queue = channel.queues.get(event.pitch); if (!queue) { queue = { values: [], head: 0 }; channel.queues.set(event.pitch, queue); } queue.values.push(voice);
      } else if (event.kind === 'noteOff') keyUp(active.get(event.noteKey), time);
      else if (event.rawKind === 'channel') {
        const channel = channels[event.channel], type = event.status >> 4, [first, value] = event.data;
        if (type === 8 || type === 9) {
          const queue = channel.queues.get(first);
          if (queue) {
            while (queue.head < queue.values.length && !queue.values[queue.head].keyDown) { charge(); queue.head++; }
            if (queue.head < queue.values.length) keyUp(queue.values[queue.head++], time);
          }
        } else if (type === 14) { channel.bend = first + value * 128; recordControl(channel, time); }
        else if (type === 11) {
          if ([120, 121, 123, 124, 125, 127].includes(first) && value !== 0) { warnings.add(`Channel-mode CC${first} with nonzero value was preserved but ignored; this renderer requires value 0.`); continue; }
          switch (first) {
            case 7: channel.volume = value; recordControl(channel, time); break;
            case 11: channel.expression = value; recordControl(channel, time); break;
            case 10: channel.pan = value; recordControl(channel, time); break;
            case 64: {
              channel.sustain = value >= 64;
              if (!channel.sustain) for (const voice of channel.held) if (!channel.sostenuto || !channel.captured.has(voice)) release(voice, time);
              break;
            }
            case 66: {
              if (value >= 64 && !channel.sostenuto) for (const voice of channel.keyDown) { charge(); channel.captured.add(voice); }
              channel.sostenuto = value >= 64;
              if (!channel.sostenuto) { channel.captured.clear(); if (!channel.sustain) for (const voice of channel.held) release(voice, time); }
              break;
            }
            case 101: channel.rpnMSB = value; channel.selector = channel.rpnMSB === 127 && channel.rpnLSB === 127 ? null : 'rpn'; break;
            case 100: channel.rpnLSB = value; channel.selector = channel.rpnMSB === 127 && channel.rpnLSB === 127 ? null : 'rpn'; break;
            case 99: channel.nrpnMSB = value; channel.selector = 'nrpn'; warnings.add('NRPN selection is retained and disables RPN data entry; NRPN parameters are not synthesized.'); break;
            case 98: channel.nrpnLSB = value; channel.selector = 'nrpn'; warnings.add('NRPN selection is retained and disables RPN data entry; NRPN parameters are not synthesized.'); break;
            case 6: case 38:
              if (channel.selector === 'rpn' && channel.rpnMSB === 0 && channel.rpnLSB === 0) {
                if (first === 6) channel.semitones = value; else channel.cents = value;
                recordControl(channel, time);
              } else warnings.add('Data Entry CC6/38 outside selected RPN 0 is preserved but not applied to a synth parameter.');
              break;
            case 120:
              for (const voice of channel.sounding) { charge(); voice.killTime = time; voice.keyDown = false; active.delete(voice.noteKey); }
              channel.sounding.clear(); channel.keyDown.clear(); channel.held.clear(); channel.captured.clear(); break;
            case 121:
              channel.bend = 8192; channel.expression = 127; channel.sustain = channel.sostenuto = false; channel.captured.clear();
              for (const voice of channel.held) release(voice, time);
              channel.selector = null; channel.rpnMSB = channel.rpnLSB = channel.nrpnMSB = channel.nrpnLSB = 127;
              recordControl(channel, time); break;
            case 123: allNotesOff(channel, time); break;
            case 124: case 125: case 126: case 127:
              allNotesOff(channel, time);
              warnings.add('Channel-mode CC124–127 applies only All Notes Off behavior; Omni/Mono/Poly mode changes are not synthesized.'); break;
          }
        }
      }
    }
    expire(contentDuration);
    for (const channel of channels) {
      if (channel.held.size) {
        warnings.add(channel.sostenuto?'Sostenuto remained down at the global project content end; held voices were forced into a 50 ms release.':'Sustain remained down at the global project content end; held voices were forced into a 50 ms release.');
        for (const voice of channel.held) release(voice, contentDuration);
      }
    }
    tracks.push({ trackId: stream.trackId, voices, channels });
  }
  return { tracks, operations };
}

/** Collapse control updates by affected sample only after their exact-time bend
 * integrals have been calculated. Many ticks mapping to one sample therefore
 * retain phase history without multiplying every voice's work by zero-frame steps. */
function sampledControls(controls, sampleRate, frames, trackPan, gain,panLaw) {
  const result = [];
  for (const item of controls) {
    const frame = Math.ceil(item.time * sampleRate); if (frame >= frames) break;
    const pan = clamp(trackPan + item.pan),gains=panGains(pan,panLaw);
    const value = { frame, bendFactor: item.bendFactor, integral: item.integral + (frame / sampleRate - item.time) * item.bendFactor,
      left: gains.monoLeft * gain * item.gain,
      right: gains.monoRight * gain * item.gain };
    if (result.at(-1)?.frame === frame) result[result.length - 1] = value; else result.push(value);
  }
  return result;
}

/** Preflight voice-sample work before allocating output buffers or mixing. */
export function midiPlaybackSampleCount(playback, sampleRate, frames,startFrame=0) {
  let samples = 0;
  for (const track of playback.tracks) for (const voice of track.voices) {
    const first = Math.max(startFrame,Math.min(frames, Math.ceil(voice.start * sampleRate)));
    const end = Math.min(voice.killTime, voice.releaseTime === null ? Infinity : voice.releaseTime + MIDI_RELEASE_SECONDS);
    const last = Math.min(frames, Math.ceil(end * sampleRate));
    samples += Math.max(0, last - first);
  }
  return samples;
}

/** Add stateful voices to existing Float32 mix buffers. Work accounting is shared
 * with WAV and legacy-note tasks through reserve(). Controller gains affect attack,
 * held and release samples; bend integrals preserve oscillator phase continuity. */
export function renderMidiPlayback(playback, { sampleRate, frames,startFrame=0, channels, mixers, reserve, warnings, maxSegmentVisits = MAX_MIDI_SEGMENT_VISITS }) {
  if (reserve) reserve(midiPlaybackSampleCount(playback, sampleRate, frames,startFrame));
  let segmentVisits = 0, renderedVoices = 0, nonSine = false;
  for (const track of playback.tracks) {
    const mixer = mixers.get(track.trackId), instrument = mixer.track.instrument ?? 'sine';
    requireValue(['sine', 'triangle', 'sawtooth'].includes(instrument), 'UNSUPPORTED_INSTRUMENT', 'Offline synth supports only sine, triangle and sawtooth.');
    const outputChannels=mixer.effectChannels??channels;
    const controls = track.channels.map(channel => sampledControls(channel.controls, sampleRate, frames, mixer.track.pan ?? 0, mixer.gain,mixer.panLaw));
    for (const voice of track.voices) {
      const first = Math.max(startFrame,Math.min(frames, Math.ceil(voice.start * sampleRate)));
      const end = Math.min(voice.killTime, voice.releaseTime === null ? Infinity : voice.releaseTime + MIDI_RELEASE_SECONDS);
      const last = Math.min(frames, Math.ceil(end * sampleRate));
      if (last <= first) continue;
      if (end > frames / sampleRate) warnings.add('The render end cuts a synth voice or release; increase the automatic tail or explicit render duration.');
      renderedVoices++; nonSine ||= instrument !== 'sine';
      const frequency = 440 * 2 ** ((voice.pitch - 69) / 12), amplitude = voice.velocity / 127 * 0.2;
      const originalControls = track.channels[voice.channel].controls, integralStart = integralAt(originalControls, voice.start), samples = controls[voice.channel];
      let index = locate(samples, first, 'frame'), frame = first;
      while (frame < last) {
        requireValue(++segmentVisits <= maxSegmentVisits, 'RENDER_TOO_COMPLEX', 'MIDI playback exceeds the 2 million voice/control segment limit.');
        const control = samples[index], stop = Math.min(last, samples[index + 1]?.frame ?? last), audible = frequency * control.bendFactor < sampleRate / 2;
        if (!audible) warnings.add('Synth frequencies at or above Nyquist were omitted for those samples; later pitch bends can make the voice audible again.');
        for (; frame < stop; frame++) {
          if (!audible) continue;
          const time = frame / sampleRate, relative = time - voice.start;
          const envelope = voice.releaseTime !== null && time >= voice.releaseTime
            ? voice.releaseLevel * Math.max(0, 1 - (time - voice.releaseTime) / MIDI_RELEASE_SECONDS)
            : Math.min(1, relative / voice.attack);
          const phase = frequency * (control.integral + (frame - control.frame) / sampleRate * control.bendFactor - integralStart);
          const signal = instrument === 'triangle' ? (2 / Math.PI) * Math.asin(Math.sin(2 * Math.PI * phase))
            : instrument === 'sawtooth' ? 2 * (phase - Math.floor(phase + 0.5)) : Math.sin(2 * Math.PI * phase);
          const value = signal * amplitude * envelope;
          outputChannels[0][frame-startFrame] += value * control.left; outputChannels[1][frame-startFrame] += value * control.right;
        }
        index++;
      }
    }
  }
  return { renderedVoices, nonSine, segmentVisits };
}
