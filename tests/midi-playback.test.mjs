import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { renderProject, projectDurationSeconds } from '../src/media/render.mjs';
import { encodeWav } from '../src/media/wav.mjs';
import { compileTempoMap } from '../src/media/time.mjs';
import { compileMidiStreams } from '../src/media/midi-stream.mjs';
import { compileMidiPlayback, renderMidiPlayback, MAX_MIDI_STATE_OPERATIONS, MAX_MIDI_SEGMENT_VISITS } from '../src/media/midi-playback.mjs';

const note = (id = 'n', startTick = 0, durationTicks = 1000, extra = {}) => ({ id, startTick, durationTicks, pitch: 69, velocity: 100, channel: 0, ...extra });
const cc = (tick, controller, value, order = 0, channel = 0) => ({ kind: 'channel', tick, order, status: 0xb0 | channel, data: [controller, value] });
const bend = (tick, value, order = 0, channel = 0) => ({ kind: 'channel', tick, order, status: 0xe0 | channel, data: [value & 127, value >> 7] });
const off = (tick, order = 0, channel = 0) => ({ kind: 'channel', tick, order, status: 0x80 | channel, data: [69, 67] });
function project(events = [], { notes = [note()], ppq = 1000, lengthTicks = 2000, sampleRate = 8000, pan = 0, tempoMap = [{ tick: 0, bpm: 120 }] } = {}) {
  return { ppq, sampleRate, tempoMap, masterGainDb: 0, assets: [], tracks: [{ id: 't', type: 'midi', instrument: 'sine', gainDb: 0, pan }],
    clips: [{ id: 'c', trackId: 't', type: 'midi', startTick: 0, lengthTicks, notes, ...(events.length ? { events } : {}) }] };
}
const render = (p, options = {}) => renderProject(p, new Map(), options);
function plan(p, options = {}) { const warnings = new Set(); return { ...compileMidiPlayback(compileMidiStreams(p), { timeline: compileTempoMap(p.tempoMap, p.ppq), contentDuration: projectDurationSeconds(p), warnings, ...options }), warnings }; }
const energy = (output, start, end, channel = 0) => output.channels[channel].subarray(Math.ceil(start * output.sampleRate), Math.ceil(end * output.sampleRate)).reduce((sum, value) => sum + value * value, 0);
const close = (actual, expected, epsilon = 1e-7) => assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

test('legacy oscillator Float32 and PCM16 hashes remain unchanged for all three instruments and tempo boundaries', () => {
  const expected = {
    sine: ['892475829a5ae1ab8247b55e0f6379d6ec375a3f14cdd0de8dffc3f7ecbd0bc1', '09c119f8c6b5ff7741943e0a813a27044253723728845f7de13d4286ddba3d0e'],
    triangle: ['fdee6cf2e474f1934519cd7ad3b3993dcc15a4ef4814d1027af81b5bbf356809', '68287430c69eba1324d292dad306988387bebc7708a7e52e8e2dd9dcc360788c'],
    sawtooth: ['51aeb73a4afdb0498beada9cc5bdcdbe84debe79ed93e74fb5b2da81d1d4e274', '3141f7a2a7fc91c5d6efe39256258f42500008f2a57e390c8dcf48ec7d4a9c35'],
  };
  for (const [instrument, [wav, floats]] of Object.entries(expected)) {
    const p = { sampleRate: 8000, ppq: 960, tempoMap: [{ tick: 0, bpm: 123 }, { tick: 470, bpm: 87 }], masterGainDb: -4,
      tracks: [{ id: 'track', type: 'midi', instrument, gainDb: -2, pan: .27 }], assets: [], clips: [{ id: 'clip', trackId: 'track', type: 'midi', startTick: 17, lengthTicks: 1600,
        notes: [note('a', 7, 777, { velocity: 99 }), note('b', 451, 329, { channel: 2, pitch: 57, velocity: 73 }), note('c', 611, 817, { velocity: 112 })] }] };
    const output = render(p); assert.equal(output.frames, 10103); assert.equal(hash(encodeWav(output)), wav);
    assert.equal(createHash('sha256').update(new Uint8Array(output.channels[0].buffer)).update(new Uint8Array(output.channels[1].buffer)).digest('hex'), floats);
  }
});

test('volume and expression are independent linear gains applied to sounding and release-phase samples', () => {
  const p = project([cc(500, 7, 64), cc(500, 11, 32, 1), cc(1020, 11, 127)]), actual = render(p), baseline = render(project());
  const factor = 64 / 127 * (32 / 127);
  for (const frame of [2101, 2503, 3999, 4013]) close(actual.channels[0][frame], baseline.channels[0][frame] * factor);
  for (const frame of [4101, 4207, 4301]) close(actual.channels[0][frame], baseline.channels[0][frame] * (64 / 127));
  close(energy(actual, .3, .4) / energy(baseline, .3, .4), factor * factor, 1e-8);
});

test('controller gain does not alter stored notes and zero values actually mute the affected samples', () => {
  const p = project([cc(500, 11, 0)]), before = structuredClone(p), result = render(p);
  assert.ok(energy(result, .1, .2) > 1); assert.equal(energy(result, .25, 1), 0); assert.deepEqual(p, before);
});

test('CC10 uses exact center/endpoints and combines with track pan by clamped equal-power positioning', () => {
  for (const [value, pan, expected] of [[0, 0, -1], [64, 0, 0], [127, 0, 1], [32, .75, .25], [127, .75, 1]]) {
    const result = render(project([cc(0, 10, value)], { pan })), l = energy(result, .1, .3, 0), r = energy(result, .1, .3, 1);
    if (expected === -1) { assert.ok(l > 0); assert.equal(r, 0); }
    else if (expected === 1) { assert.equal(l, 0); assert.ok(r > 0); }
    else close(Math.sqrt(r / l), Math.tan((expected + 1) * Math.PI / 4), 1e-7);
  }
});

test('sustain threshold holds key-up voices until pedal release and pedal changes do not restart release', () => {
  const held = plan(project([cc(0, 64, 64), cc(1400, 64, 63), cc(1420, 64, 127), cc(1440, 64, 0)]));
  close(held.tracks[0].voices[0].releaseTime, .7, 1e-14); assert.equal(held.tracks[0].voices[0].keyDown, false);
  const audible = render(project([cc(0, 64, 127), cc(1400, 64, 0)])); assert.ok(energy(audible, .6, .65) > 1); assert.equal(energy(audible, .751, .9), 0);
  assert.equal(plan(project([cc(0, 64, 63)])).tracks[0].voices[0].releaseTime, .5);
});

test('same-tick sustain and note-off order determines whether release starts before pedal-down', () => {
  const notes = [note('n', 0, 500, { onOrder: 0, offOrder: 3 })];
  assert.equal(plan(project([cc(500, 64, 127, 2), cc(800, 64, 0, 4)], { notes })).tracks[0].voices[0].releaseTime, .4);
  assert.equal(plan(project([cc(500, 64, 127, 4), cc(800, 64, 0, 5)], { notes })).tracks[0].voices[0].releaseTime, .25);
});

test('overlapping same-pitch paired note-offs release their exact voices instead of a different FIFO voice', () => {
  const result = plan(project([cc(0, 7, 127)], { notes: [note('long', 0, 1200), note('short', 200, 200)] }));
  assert.deepEqual(result.tracks[0].voices.map(v => [v.noteId, v.releaseTime]), [['long', .6], ['short', .2]]);
});

test('raw note-off uses key-down FIFO and a later paired off cannot release a newer voice', () => {
  const result = plan(project([off(400)], { notes: [note('a', 0, 1000), note('b', 200, 1200)] }));
  assert.deepEqual(result.tracks[0].voices.map(v => v.noteId), ['a', 'b']); close(result.tracks[0].voices[0].releaseTime, .2, 1e-14); close(result.tracks[0].voices[1].releaseTime, .7, 1e-14);
  const held = plan(project([cc(0, 64, 127), off(500, 1), cc(600, 64, 0, 2)], { notes: [note('a', 0, 300), note('b', 100, 700)] }));
  assert.deepEqual(held.tracks[0].voices.map(v => v.releaseTime), [.3, .3]);
});

test('CC123 turns off key-down voices through sustain while CC120 kills held and release voices immediately', () => {
  const notes = [note('a', 0, 1000), note('b', 100, 100)];
  const result = plan(project([cc(0, 64, 127), cc(300, 123, 0), cc(500, 120, 0)], { notes }));
  assert.deepEqual(result.tracks[0].voices.map(v => v.killTime), [.25, .25]);
  const output = render(project([cc(0, 64, 127), cc(300, 123, 0), cc(500, 120, 0)], { notes })); assert.ok(energy(output, .16, .23) > 0); assert.equal(energy(output, .25, .9), 0);
  assert.equal(plan(project([cc(300, 123, 0)])).tracks[0].voices[0].releaseTime, .15);
  const releasing = plan(project([cc(1040, 120, 0)])); assert.equal(releasing.tracks[0].voices[0].releaseTime, .5); assert.equal(releasing.tracks[0].voices[0].killTime, .52);
});

test('CC120 preserves controllers for later voices and obsolete paired offs remain harmless', () => {
  const result = plan(project([cc(0, 7, 43), cc(0, 10, 127, 1), cc(400, 120, 0)], { notes: [note('old', 0, 1200), note('new', 600, 1000)] }));
  assert.equal(result.tracks[0].voices[0].killTime, .2); assert.equal(result.tracks[0].voices[1].releaseTime, .8);
  assert.equal(result.tracks[0].channels[0].volume, 43); assert.equal(result.tracks[0].channels[0].pan, 127);
});

test('CC121 resets bend/expression/pedal/selectors but retains volume, pan and configured bend sensitivity', () => {
  const events = [cc(0, 7, 60, 0), cc(0, 11, 20, 1), cc(0, 10, 0, 2), cc(0, 64, 127, 3), cc(0, 101, 0, 4), cc(0, 100, 0, 5), cc(0, 6, 12, 6), cc(0, 38, 50, 7), bend(0, 16383, 8), cc(600, 121, 0), cc(700, 6, 1), bend(800, 16383)];
  const result = plan(project(events, { notes: [note('held', 0, 200), note('key', 100, 1500)] })), channel = result.tracks[0].channels[0];
  assert.deepEqual(result.tracks[0].voices.map(v => v.releaseTime), [.3, .8]);
  assert.equal(channel.volume, 60); assert.equal(channel.pan, 0); assert.equal(channel.expression, 127); assert.equal(channel.semitones, 12); assert.equal(channel.cents, 50); assert.equal(channel.selector, null);
  const reset = channel.controls.find(value => value.time === .3); assert.equal(reset.bendFactor, 1); assert.equal(reset.gain, 60 / 127); assert.equal(reset.pan, -1);
  close(channel.controls.at(-1).bendFactor, 2 ** ((8191 / 8192) * 12.5 / 12)); assert.ok([...result.warnings].some(message => message.includes('outside selected RPN 0')));
});

test('RPN 0 accepts full semitone/cents bytes, NRPN selection blocks it and RPN null disables Data Entry', () => {
  const result = plan(project([cc(0, 101, 0, 0), cc(0, 100, 0, 1), cc(0, 6, 127, 2), cc(0, 38, 127, 3), cc(1, 99, 0), cc(2, 6, 1), cc(3, 101, 127), cc(4, 100, 127), cc(5, 38, 0), bend(6, 0)])), channel = result.tracks[0].channels[0];
  assert.equal(channel.semitones, 127); assert.equal(channel.cents, 127); assert.equal(channel.selector, null); close(channel.controls.at(-1).bendFactor, 2 ** (-128.27 / 12));
  assert.ok([...result.warnings].some(message => message.includes('NRPN selection')));
});

test('pitch bend uses all 14 bits and continuous exact-time frequency integration at fractional sample boundaries', () => {
  const p = project([bend(127, 16383)], { ppq: 960, lengthTicks: 1920, notes: [note('n', 0, 960)] }), output = render(p), time = 127 / 1920;
  const ratio = 2 ** ((8191 / 8192) * 2 / 12), amplitude = 100 / 127 * .2 * Math.cos(Math.PI / 4);
  for (const frame of [529, 530, 531, 700]) {
    const seconds = frame / 8000, phase = 440 * (Math.min(time, seconds) + Math.max(0, seconds - time) * ratio);
    close(output.channels[0][frame], Math.fround(Math.sin(2 * Math.PI * phase) * amplitude));
  }
  const minimum = plan(project([bend(0, 0)])); close(minimum.tracks[0].channels[0].controls[0].bendFactor, 2 ** (-2 / 12));
  assert.equal(plan(project([bend(0, 8192)])).tracks[0].channels[0].controls[0].bendFactor, 1);
});

test('bend and gain changes affect an already releasing voice without resetting its envelope or oscillator phase', () => {
  const p = project([bend(1020, 16383), cc(1040, 7, 40)]), output = render(p), ratio = 2 ** ((8191 / 8192) * 2 / 12);
  for (const frame of [4107, 4201]) {
    const seconds = frame / 8000, phase = 440 * (.51 + (seconds - .51) * ratio), envelope = 1 - (seconds - .5) / .05;
    const gain = seconds >= .52 ? 40 / 127 : 1;
    close(output.channels[0][frame], Math.fround(Math.sin(2 * Math.PI * phase) * (100 / 127 * .2) * envelope * Math.cos(Math.PI / 4) * gain));
  }
});

test('initially inaudible above-Nyquist voices become audible after bend lowers their frequency', () => {
  const p = project([cc(0, 101, 0, 0), cc(0, 100, 0, 1), cc(0, 6, 24, 2), bend(200, 0)], { notes: [note('high', 0, 1000, { pitch: 120 })] }), output = render(p);
  assert.equal(energy(output, 0, .1), 0); assert.ok(energy(output, .11, .2) > 1); assert.ok(output.warnings.some(message => message.includes('Nyquist')));
});

test('channel and track isolation keeps identical MIDI channels independent between synth tracks', () => {
  const p = project([cc(0, 7, 0)], { notes: [note('ch0'), note('ch1', 0, 1000, { channel: 1 })] });
  const expected = render(project([], { notes: [note('ch1', 0, 1000, { channel: 1 })] })), actual = render(p);
  for (const frame of [100, 1200, 2501]) close(actual.channels[0][frame], expected.channels[0][frame]);
  p.tracks.push({ id: 'other', type: 'midi', instrument: 'sine', gainDb: 0, pan: 0 }); p.clips.push({ id: 'other-clip', trackId: 'other', type: 'midi', startTick: 0, lengthTicks: 2000, notes: [note('other-note')] });
  const together = render(p); for (const frame of [100, 1200, 2501]) close(together.channels[0][frame], expected.channels[0][frame] * 2);
});

test('unsupported controllers and pressure/patch/SysEx/meta messages are preserved with specific playback limitations', () => {
  const p = project([cc(0, 39, 100), cc(0, 42, 100, 1), cc(0, 43, 100, 2), cc(0, 0, 5, 3), cc(0, 96, 0, 4), cc(0, 97, 0, 5), cc(0, 1, 80, 6), { kind: 'channel', tick: 0, order: 7, status: 0xd0, data: [100] }]);
  const baseline = render(project()), output = render(p); assert.deepEqual(output.channels, baseline.channels);
  for (const term of ['LSB', 'bank-select', 'increment/decrement', 'CC1 ', 'pressure']) assert.ok(output.warnings.some(message => message.includes(term)), term);
});

test('CC124–127 applies only All Notes Off and invalid nonzero zero-required mode values are ignored', () => {
  for (const [controller, value] of [[124, 0], [125, 0], [126, 16], [127, 0]]) {
    const result = plan(project([cc(200, controller, value)])); assert.equal(result.tracks[0].voices[0].releaseTime, .1); assert.ok([...result.warnings].some(message => message.includes('Omni/Mono/Poly')));
  }
  for (const controller of [120, 121, 123, 124, 125, 127]) {
    const result = plan(project([cc(200, controller, 1)])); assert.equal(result.tracks[0].voices[0].releaseTime, .5); assert.equal(result.tracks[0].voices[0].killTime, Infinity); assert.ok([...result.warnings].some(message => message.includes('nonzero value')));
  }
});

test('remaining sustain releases at global content end even when a longer muted audio clip defines that end', () => {
  const p = project([cc(0, 64, 127)]); p.tracks.push({ id: 'audio', type: 'audio', mute: true }); p.assets.push({ id: 'asset', sampleRate: 8000, frames: 16000, channels: 1 }); p.clips.push({ type: 'audio', trackId: 'audio', assetId: 'asset', startSample: 0, offsetFrames: 0, lengthFrames: 16000 });
  const result = plan(p); assert.equal(result.tracks[0].voices[0].releaseTime, 2); assert.ok([...result.warnings].some(message => message.includes('global project content end')));
  const output = render(p, { durationSeconds: 3 }); assert.ok(energy(output, 1.8, 1.9) > 1); assert.equal(energy(output, 2.051, 3), 0);
  const short = render(p, { durationSeconds: .7 }); assert.ok(energy(short, .6, .7) > 1); assert.ok(short.warnings.some(message => message.includes('truncates'))); assert.ok(short.warnings.some(message => message.includes('cuts a synth')));
});

test('tempo boundaries and distinct ticks sharing a sample preserve event chronology and affected-sample ceil', () => {
  const events = [cc(1, 64, 127), off(2, 1), cc(3, 64, 0, 2), cc(4, 11, 0, 3), cc(5, 11, 127, 4)];
  const p = project(events, { ppq: 32767, notes: [note('n', 0, 30)] }), result = plan(p);
  close(result.tracks[0].voices[0].releaseTime, 3 / (32767 * 2)); assert.equal(result.tracks[0].channels[0].expression, 127); assert.ok(render(p).channels[0].every(Number.isFinite));
  const changing = project([cc(1001, 11, 0)], { notes: [note('n', 0, 1800)], tempoMap: [{ tick: 0, bpm: 120 }, { tick: 1000, bpm: 60 }] });
  const out = render(changing), frame = Math.ceil(.501 * 8000); assert.ok(energy(out, .4, .5) > 1); assert.equal(out.channels[0][frame], 0); assert.equal(energy(out, .501, .8), 0);
});

test('source/end release is deterministic, input-pure, and mute/solo retains silence and routing rules', () => {
  const p = project([cc(0, 64, 127), bend(300, 12000), cc(1000, 64, 0)]), before = structuredClone(p), a = render(p), b = render(p);
  assert.deepEqual(a.channels, b.channels); assert.deepEqual(a.warnings, b.warnings); assert.deepEqual(p, before);
  p.tracks[0].mute = true; assert.equal(render(p).peak, 0);
  p.tracks[0].mute = false; p.tracks.push({ id: 'solo', type: 'midi', instrument: 'sine', solo: true }); assert.equal(render(p).peak, 0);
});

test('state and voice/control work budgets fail explicitly instead of unbounded event amplification', () => {
  const p = project([cc(0, 7, 100), cc(100, 11, 90), cc(200, 11, 80)]), compiled = compileMidiStreams(p), timeline = compileTempoMap(p.tempoMap, p.ppq);
  assert.equal(MAX_MIDI_STATE_OPERATIONS, 2_000_000); assert.equal(MAX_MIDI_SEGMENT_VISITS, 2_000_000);
  assert.throws(() => compileMidiPlayback(compiled, { timeline, contentDuration: 1, maxStateOperations: 2 }), { code: 'RENDER_TOO_COMPLEX' });
  const playback = compileMidiPlayback(compiled, { timeline, contentDuration: 1 });
  assert.throws(() => renderMidiPlayback(playback, { sampleRate: 8000, frames: 8000, channels: [new Float32Array(8000), new Float32Array(8000)], mixers: new Map([['t', { track: p.tracks[0], gain: 1 }]]), reserve() {}, warnings: new Set(), maxSegmentVisits: 1 }), { code: 'RENDER_TOO_COMPLEX' });
  const many = project([cc(0, 64, 127)], { lengthTicks: 240000, notes: Array.from({ length: 160 }, (_, i) => note(`n${i}`, 0, 200000)) });
  assert.throws(() => render(many, { durationSeconds: 120 }), { code: 'RENDER_TOO_COMPLEX' });
});
