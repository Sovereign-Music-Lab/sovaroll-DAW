import test from 'node:test';
import assert from 'node:assert/strict';
import { tickToSeconds, secondsToTick } from '../src/media/time.mjs';
import { decodeWav, encodeWav } from '../src/media/wav.mjs';
import { parseMidi, writeMidi } from '../src/media/midi.mjs';
import { renderProject, projectDurationSeconds } from '../src/media/render.mjs';

const near = (actual, expected, epsilon = 1e-6) => assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} differs from ${expected}`);
const sumSquares = channel => channel.reduce((sum, value) => sum + value * value, 0);
function project(overrides = {}) {
  return {
    schemaVersion: 1, id: 'project-test', name: 'Test', revision: 0, ppq: 960, sampleRate: 8000,
    tempoMap: [{ tick: 0, bpm: 120 }], timeSignature: { numerator: 4, denominator: 4 }, masterGainDb: 0,
    tracks: [{ id: 't1', name: 'Keys', type: 'midi', instrument: 'sine', gainDb: 0, pan: 0, mute: false, solo: false }],
    clips: [{ id: 'c1', trackId: 't1', type: 'midi', name: 'Phrase', startTick: 0, lengthTicks: 1920,
      notes: [{ id: 'n1', pitch: 69, startTick: 0, durationTicks: 960, velocity: 100, channel: 0 }] }],
    assets: [], ...overrides
  };
}
function smf(events, division = 480, format = 0) {
  const length = events.length;
  return Uint8Array.from([77, 84, 104, 100, 0, 0, 0, 6, 0, format, 0, 1, division >> 8, division & 255,
    77, 84, 114, 107, (length >>> 24) & 255, (length >>> 16) & 255, (length >>> 8) & 255, length & 255, ...events]);
}
function rawWav({ format = 1, bits = 24, channels = 1, data }) {
  const length = data.length, padded = length + (length % 2);
  const bytes = new Uint8Array(44 + padded), view = new DataView(bytes.buffer);
  const label = (at, value) => bytes.set(new TextEncoder().encode(value), at);
  label(0, 'RIFF'); view.setUint32(4, 36 + padded, true); label(8, 'WAVE'); label(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, format, true); view.setUint16(22, channels, true);
  view.setUint32(24, 8000, true); view.setUint32(28, 8000 * channels * bits / 8, true);
  view.setUint16(32, channels * bits / 8, true); view.setUint16(34, bits, true);
  label(36, 'data'); view.setUint32(40, length, true); bytes.set(data, 44);
  return bytes;
}
function audioProject(source, overrides = {}) {
  const p = project({
    tracks: [{ id: 'a1', name: 'Audio', type: 'audio', gainDb: 0, pan: 0, mute: false, solo: false }],
    assets: [{ id: 'asset1', name: 'source.wav', path: 'assets/test.wav', sampleRate: source.sampleRate, channels: source.channels.length, frames: source.frames }],
    clips: [{ id: 'ac1', trackId: 'a1', type: 'audio', name: 'Clip', assetId: 'asset1', startSample: 0, offsetFrames: 0, lengthFrames: source.frames, gainDb: 0 }],
    ...overrides
  });
  return { p, assets: new Map([['asset1', source]]) };
}

test('tempo conversion integrates step segments and round-trips boundary/fractional ticks', () => {
  const map = [{ tick: 0, bpm: 120 }, { tick: 960, bpm: 60 }, { tick: 2880, bpm: 240 }];
  near(tickToSeconds(960, map), 0.5);
  near(tickToSeconds(2880, map), 2.5);
  near(tickToSeconds(3840, map), 2.75);
  for (const tick of [0, 0.125, 959.5, 960, 961, 2880, 40000]) near(secondsToTick(tickToSeconds(tick, map), map), tick, 1e-8);
  assert.throws(() => tickToSeconds(0, [{ tick: 2, bpm: 120 }]), /start at 0/);
  assert.throws(() => tickToSeconds(100, [{ tick: 0, bpm: 120 }, { tick: 0, bpm: 90 }]), /strictly increase/);
  assert.throws(() => secondsToTick(NaN, map), /finite/);
});

test('PCM16 WAV roundtrip preserves stereo order, duration and signed samples in an offset view', () => {
  const original = [Float32Array.from([-1, -0.5, 0, 0.5, 1]), Float32Array.from([0.75, 0.25, -0.25, -0.75, 0])];
  const encoded = encodeWav({ sampleRate: 44100, channels: original });
  const padded = new Uint8Array(encoded.length + 13); padded.set(encoded, 7);
  const result = decodeWav(padded.subarray(7, 7 + encoded.length));
  assert.equal(result.frames, 5); assert.equal(result.sampleRate, 44100); assert.equal(result.channels.length, 2);
  for (let ch = 0; ch < 2; ch++) for (let frame = 0; frame < 5; frame++) near(result.channels[ch][frame], original[ch][frame], 1 / 32767);
});

test('WAV supports PCM24 signed limits, PCM32 and IEEE32 headroom', () => {
  const pcm24 = decodeWav(rawWav({ data: Uint8Array.from([0, 0, 128, 255, 255, 127, 0, 0, 64]) }));
  assert.equal(pcm24.channels[0][0], -1); near(pcm24.channels[0][1], 1, 2e-7); near(pcm24.channels[0][2], 0.5);
  const pcm32 = decodeWav(rawWav({ bits: 32, data: Uint8Array.from([0, 0, 0, 128, 0, 0, 0, 64]) }));
  assert.equal(pcm32.channels[0][0], -1); assert.equal(pcm32.channels[0][1], 0.5);
  const floats = new Uint8Array(8), view = new DataView(floats.buffer);
  view.setFloat32(0, 1.5, true); view.setFloat32(4, -0.125, true);
  const ieee = decodeWav(rawWav({ format: 3, bits: 32, data: floats }));
  assert.equal(ieee.channels[0][0], 1.5); assert.equal(ieee.channels[0][1], -0.125);
});

test('malformed WAV chunk sizes, partial frames, encodings and nonfinite samples fail explicitly', () => {
  const valid = encodeWav({ sampleRate: 8000, channels: [Float32Array.of(0, 0.5)] });
  assert.throws(() => decodeWav(valid.subarray(0, valid.length - 1)), /RIFF length/);
  const badAlign = valid.slice(); new DataView(badAlign.buffer).setUint16(32, 8, true);
  assert.throws(() => decodeWav(badAlign), /alignment/);
  assert.throws(() => decodeWav(rawWav({ bits: 24, data: Uint8Array.of(0, 0) })), /partial sample/);
  assert.throws(() => decodeWav(rawWav({ format: 6, bits: 16, data: Uint8Array.of(0, 0) })), /unsupported/);
  const nan = new Uint8Array(4); new DataView(nan.buffer).setFloat32(0, NaN, true);
  assert.throws(() => decodeWav(rawWav({ format: 3, bits: 32, data: nan })), /non-finite/);
  assert.throws(() => encodeWav({ sampleRate: 8000, channels: [Float32Array.of(Infinity)] }), /finite/);
  assert.throws(() => encodeWav({ sampleRate: 8000, channels: [Float32Array.of(0), Float32Array.of(0, 1)] }), /same number/);
});

test('WAV parser handles padded unknown chunks without treating chunk contents as audio', () => {
  const original = encodeWav({ sampleRate: 8000, channels: [Float32Array.of(0.25)] });
  const inserted = new Uint8Array(original.length + 10);
  inserted.set(original.subarray(0, 12)); inserted.set([74, 85, 78, 75, 1, 0, 0, 0, 255, 0], 12);
  inserted.set(original.subarray(12), 22); new DataView(inserted.buffer).setUint32(4, inserted.length - 8, true);
  near(decodeWav(inserted).channels[0][0], 0.25, 1 / 32767);
});

test('SMF format 1 roundtrip preserves absolute note timing, channels, names and step tempos', () => {
  const p = project({ tempoMap: [{ tick: 0, bpm: 120 }, { tick: 960, bpm: 90 }] });
  p.clips[0].startTick = 480;
  p.clips[0].notes.push({ id: 'n2', pitch: 72, startTick: 960, durationTicks: 480, velocity: 70, channel: 3 });
  p.tracks[0].name = '건반'; p.tracks[0].mute = true;
  p.tracks.push({ id: 't2', type: 'midi', name: 'Lead' });
  p.clips.push({ id: 'c2', trackId: 't2', type: 'midi', startTick: 1920, lengthTicks: 960,
    notes: [{ pitch: 60, startTick: 0, durationTicks: 960, velocity: 127, channel: 15 }] });
  const parsed = parseMidi(writeMidi(p));
  assert.equal(parsed.tracks.length, 2); assert.equal(parsed.tracks[0].name, '건반');
  assert.deepEqual(parsed.tracks[0].notes.map(({ pitch, startTick, durationTicks, velocity, channel }) => ({ pitch, startTick, durationTicks, velocity, channel })), [
    { pitch: 69, startTick: 480, durationTicks: 960, velocity: 100, channel: 0 },
    { pitch: 72, startTick: 1440, durationTicks: 480, velocity: 70, channel: 3 }
  ]);
  assert.equal(parsed.tracks[1].notes[0].startTick, 1920); assert.equal(parsed.tracks[1].notes[0].channel, 15);
  assert.equal(parsed.tempoMap[1].tick, 960); near(parsed.tempoMap[1].bpm, 90, 0.0001);
  assert.ok(parsed.warnings.some(message => message.includes('Time signature')));
});

test('MIDI running status, zero-velocity note-off and PPQ rescaling recover separate notes', () => {
  const events = [0, 0x90, 60, 100, 0x81, 0x70, 64, 80, 0x81, 0x70, 60, 0, 0, 64, 0, 0, 0xff, 0x2f, 0];
  const parsed = parseMidi(smf(events));
  assert.deepEqual(parsed.tracks[0].notes.map(n => [n.pitch, n.startTick, n.durationTicks]), [[60, 0, 960], [64, 480, 480]]);
});

test('MIDI controllers, patches, pitch bends, sysex and release velocities are retained', () => {
  const events = [0, 0xb0, 64, 127, 0, 0xc0, 4, 0, 0xe0, 0, 64, 0, 0xf0, 2, 1, 0xf7,
    0, 0x90, 60, 100, 10, 0x80, 60, 12, 0, 0xff, 0x2f, 0];
  const parsed = parseMidi(smf(events));
  assert.deepEqual(parsed.tracks[0].events.map(event => [event.kind, event.status, event.data]), [
    ['channel',0xb0,[64,127]], ['channel',0xc0,[4]], ['channel',0xe0,[0,64]], ['sysex',0xf0,[1,0xf7]],
  ]);
  assert.equal(parsed.tracks[0].notes[0].releaseVelocity,12);
  assert.equal(parsed.tracks[0].notes[0].noteOffEncoding,'noteOff');
  assert.equal(parsed.tracks[0].notes[0].durationTicks, 20);
});

test('dangling MIDI notes have explicit closure warnings; unsupported timing and corrupt binaries reject', () => {
  const dangling = parseMidi(smf([0, 0x90, 60, 90, 20, 0xff, 0x2f, 0]));
  assert.equal(dangling.tracks[0].notes[0].durationTicks, 40);
  assert.ok(dangling.warnings.some(message => message.includes('Unclosed')));
  assert.throws(() => parseMidi(smf([0, 0xff, 0x2f, 0], 0xe728)), /SMPTE/);
  assert.throws(() => parseMidi(smf([0, 0xff, 0x2f, 0], 480, 2)), /format 2/);
  assert.throws(() => parseMidi(smf([0, 60, 90])), /running status/);
  assert.throws(() => parseMidi(smf([0xff, 0xff, 0xff, 0xff, 0])), /four bytes/);
  assert.throws(() => parseMidi(smf([0, 0x90, 60])), /Truncated/);
  assert.throws(() => parseMidi(smf([0, 0xff, 0x51, 3, 0, 0, 0, 0, 0xff, 0x2f, 0])), /greater than zero/);
  assert.throws(() => parseMidi(smf([0, 0xff, 0x2f, 0, 0])), /terminate/);
  const truncated = smf([0, 0xff, 0x2f, 0]);
  assert.throws(() => parseMidi(truncated.subarray(0, truncated.length - 1)), /Truncated/);
  assert.throws(() => parseMidi(smf([0, 0x90, 60, 90, 0, 0xff, 1, 0, 10, 60, 0, 0, 0xff, 0x2f, 0])), /running status/);
});

test('low-PPQ MIDI import expands sub-tick notes with a loss warning and resolves simultaneous tempos', () => {
  const parsed = parseMidi(smf([0, 0xff, 0x51, 3, 7, 161, 32, 0, 0xff, 0x51, 3, 15, 66, 64,
    0, 0x90, 60, 100, 1, 0x80, 60, 0, 0, 0xff, 0x2f, 0]), { ppq: 1 });
  assert.equal(parsed.tempoMap[0].bpm, 60); assert.equal(parsed.tracks[0].notes[0].durationTicks, 1);
  assert.ok(parsed.warnings.some(message => message.includes('rounded')));
  assert.ok(parsed.warnings.some(message => message.includes('expanded to one tick')));
  assert.ok(parsed.warnings.some(message => message.includes('last event')));
});

test('offline synth is deterministic, nonzero, stereo and honors note onset across tempo changes', () => {
  const p = project({ tempoMap: [{ tick: 0, bpm: 120 }, { tick: 960, bpm: 60 }] });
  p.clips[0].notes[0].startTick = 960; p.clips[0].notes[0].durationTicks = 480;
  near(projectDurationSeconds(p), 1.5);
  const first = renderProject(p, new Map(), { tailSeconds: 0 });
  const second = renderProject(p, new Map(), { tailSeconds: 0 });
  assert.equal(first.frames, 12000); assert.ok(first.peak > 0.1);
  assert.deepEqual(first.channels, second.channels);
  assert.equal(sumSquares(first.channels[0].subarray(0, 4000)), 0);
  assert.ok(sumSquares(first.channels[0].subarray(4001, 8000)) > 1);
  assert.equal(sumSquares(first.channels[0].subarray(8401)), 0);
  assert.equal(first.clippedSamples, 0);
  assert.ok(first.warnings.some(message => message.includes('basic oscillator')));
});

test('track mute, solo, pan and gains affect actual rendered samples', () => {
  const p = project(), base = renderProject(p);
  p.tracks[0].gainDb = -6;
  near(renderProject(p).peak / base.peak, 10 ** (-6 / 20), 1e-6);
  p.tracks[0].gainDb = 0; p.masterGainDb = -6;
  near(renderProject(p).peak / base.peak, 10 ** (-6 / 20), 1e-6);
  p.masterGainDb = 0; p.tracks[0].pan = -1;
  const left = renderProject(p); assert.ok(sumSquares(left.channels[0]) > 0); assert.equal(sumSquares(left.channels[1]), 0);
  p.tracks[0].mute = true; assert.equal(renderProject(p).peak, 0);
  p.tracks[0].mute = false;
  p.tracks.push({ id: 'empty-solo', type: 'midi', name: 'Solo', instrument: 'sine', solo: true });
  assert.equal(renderProject(p).peak, 0);
  p.tracks[0].solo = true; assert.ok(renderProject(p).peak > 0);
});

test('audio source trim, source sample rate and project startSample have distinct units', () => {
  const source = { sampleRate: 8000, frames: 6, channels: [Float32Array.from([99, 0, 0.25, 0.5, 0.75, 99])] };
  const { p, assets } = audioProject(source, { sampleRate: 16000 });
  p.clips[0].startSample = 4; p.clips[0].offsetFrames = 1; p.clips[0].lengthFrames = 4;
  p.tracks[0].pan = -1;
  near(projectDurationSeconds(p), 12 / 16000);
  const result = renderProject(p, assets, { tailSeconds: 0 });
  assert.equal(result.frames, 12);
  assert.deepEqual([...result.channels[0]], [0, 0, 0, 0, 0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.75]);
  assert.equal(sumSquares(result.channels[1]), 0);
  assert.ok(result.warnings.some(message => message.includes('linear interpolation')));
});

test('stereo assets retain independent channels at center and use balance panning', () => {
  const source = { sampleRate: 8000, frames: 4, channels: [Float32Array.from([0.2, 0.4, 0.6, 0.8]), Float32Array.from([-0.8, -0.6, -0.4, -0.2])] };
  const { p, assets } = audioProject(source);
  const result = renderProject(p, assets, { tailSeconds: 0 });
  assert.deepEqual(result.channels, source.channels);
  p.tracks[0].pan = 1;
  const panned = renderProject(p, assets, { tailSeconds: 0 });
  assert.equal(sumSquares(panned.channels[0]), 0); assert.deepEqual(panned.channels[1], source.channels[1]);
});

test('mix combines overlapping clips, reports clipping and encodes bounded PCM16', () => {
  const source = { sampleRate: 8000, frames: 4, channels: [Float32Array.from([0.8, 0.8, 0.8, 0.8])] };
  const { p, assets } = audioProject(source);
  p.tracks[0].pan = -1; p.clips.push({ ...p.clips[0], id: 'ac2' });
  const result = renderProject(p, assets, { tailSeconds: 0 });
  near(result.peak, 1.6); assert.equal(result.clippedSamples, 4);
  assert.ok(result.warnings.some(message => message.includes('clipped by integer PCM export')));
  const encoded = decodeWav(encodeWav(result));
  near(encoded.channels[0][0], 1, 1 / 32768);
});

test('explicit duration is final length while automatic duration adds its tail', () => {
  const p = project();
  near(renderProject(p).durationSeconds, 1.2);
  near(renderProject(p, new Map(), { durationSeconds: 0.25, tailSeconds: 0.5 }).durationSeconds, 0.25);
  assert.ok(renderProject(p, new Map(), { durationSeconds: 0.25 }).warnings.some(message => message.includes('truncates')));
});

test('offline render rejects unsafe duration, rates, missing audio and invalid trims before claiming success', () => {
  const p = project();
  assert.throws(() => renderProject(p, new Map(), { durationSeconds: 601 }), /600/);
  assert.throws(() => renderProject(p, new Map(), { tailSeconds: -1 }), /tail/);
  assert.throws(() => renderProject(project({ sampleRate: 192000 })), /96000/);
  const source = { sampleRate: 8000, frames: 4, channels: [Float32Array.of(0, 0, 0, 0)] };
  const { p: audio, assets } = audioProject(source);
  assert.throws(() => renderProject(audio), /missing/);
  audio.clips[0].offsetFrames = 1;
  assert.throws(() => renderProject(audio, assets), /beyond the source/);
  assert.throws(() => renderProject(project({ clips: [] }), new Map(), { tailSeconds: 0 }), /positive/);
});

test('render work limit rejects pathological polyphony before allocating the output buffers', () => {
  const p = project({ sampleRate: 96000 });
  p.clips[0].lengthTicks = 230400;
  p.clips[0].notes = Array.from({ length: 14 }, (_, index) => ({ pitch: 60 + index, startTick: 0, durationTicks: 230400, velocity: 100, channel: 0 }));
  assert.throws(() => renderProject(p, new Map(), { tailSeconds: 0 }), /150 million/);
});
