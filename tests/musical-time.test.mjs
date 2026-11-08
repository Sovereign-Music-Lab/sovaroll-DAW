import test from 'node:test';
import assert from 'node:assert/strict';
import { compileMusicalTime } from '../src/media/musical-time.mjs';
import { compileTempoMap } from '../src/media/time.mjs';
import { writeMidi, parseMidi } from '../src/media/midi.mjs';
import { createProject } from '../src/core/engine.mjs';

const signature = (numerator, denominator, options = {}) => compileMusicalTime({
  ...options, timeSignature: { numerator, denominator }
});
const code = value => error => error.code === value;
const tick = (numerator, denominator = 1) => ({ numerator: String(numerator), denominator });

test('Musical time: default positions use bars beats sixteenths and120 ticks per sixteenth', () => {
  const time = compileMusicalTime();
  assert.equal(time.formatPosition(0), '001.1.1.000');
  assert.equal(time.formatPosition(238), '001.1.1.119');
  assert.equal(time.formatPosition(240), '001.1.2.000');
  assert.equal(time.formatPosition(960), '001.2.1.000');
  assert.equal(time.formatPosition(3839), '001.4.4.239/2');
  assert.equal(time.formatPosition(3840), '002.1.1.000');
  assert.equal(time.parsePosition('002.1.1.000'), 3840);
});

test('Musical time: durations are zero based and never confused with1-based positions', () => {
  const time = compileMusicalTime();
  assert.equal(time.formatDuration(0), '000.0.0.000');
  assert.equal(time.formatDuration(960), '000.1.0.000');
  assert.equal(time.formatDuration(4080), '001.0.1.000');
  assert.equal(time.parseDuration('001.0.1.000'), 4080);
  assert.throws(() => time.parsePosition('000.0.0.000'), code('INVALID_MUSICAL_TIME'));
  assert.equal(time.parseDuration('001.1.1.000'), 5040);
});

test('Musical time:6/8 counts six eighth-note beats rather than three quarters', () => {
  const time = signature(6, 8);
  assert.equal(time.formatPosition(480), '001.2.1.000');
  assert.equal(time.formatPosition(960), '001.3.1.000');
  assert.equal(time.formatPosition(2640), '001.6.2.000');
  assert.equal(time.formatPosition(2880), '002.1.1.000');
  assert.throws(() => time.parsePosition('001.1.3.000'), code('INVALID_MUSICAL_TIME'));
});

test('Musical time: asymmetric and long beats preserve exact meter boundaries', () => {
  assert.equal(signature(7, 8).formatPosition(3360), '002.1.1.000');
  assert.equal(signature(5, 4).formatPosition(3840), '001.5.1.000');
  assert.equal(signature(3, 2).formatPosition(1680), '001.1.8.000');
  assert.equal(signature(3, 2).formatPosition(1920), '001.2.1.000');
  assert.equal(signature(2, 1).formatPosition(3600), '001.1.16.000');
});

test('Musical time:32nd and64th denominator beats reset ticks without fictitious sixteenths', () => {
  const a = signature(3, 32), b = signature(5, 64);
  assert.equal(a.formatPosition(119), '001.1.1.119/2');
  assert.equal(a.formatPosition(120), '001.2.1.000');
  assert.equal(a.formatPosition(360), '002.1.1.000');
  assert.equal(b.formatPosition(60), '001.2.1.000');
  assert.equal(b.parsePosition('001.1.1.029'), 58);
  for (const s of ['001.1.1.030', '001.1.2.000']) assert.throws(() => b.parsePosition(s), code('INVALID_MUSICAL_TIME'));
});

test('Musical time: changed display PPQ changes only tick remainder and exact edit unit', () => {
  const a = compileMusicalTime(), b = compileMusicalTime({ displayPpq: 1000 });
  assert.deepEqual(a.positionAt(961), { bars: '1', beats: 2, sixteenths: 1, ticks: tick(1, 2) });
  assert.deepEqual(b.positionAt(961), { bars: '1', beats: 2, sixteenths: 1, ticks: tick(25, 24) });
  assert.equal(b.parsePosition('001.2.1.25/24'), 961);
  assert.equal(b.parsePosition('001.2.1.025'), 984);
  assert.throws(() => b.parsePosition('001.2.1.001'), code('MIDI_TICK_NOT_REPRESENTABLE'));
});

test('Musical time: low and odd PPQ preserve fractional beat boundaries with no implicit quantization', () => {
  const a = signature(3, 8, { ppq: 1, displayPpq: 480 });
  assert.equal(a.formatPosition(1), '001.3.1.000');
  assert.equal(a.formatPosition(2), '002.2.1.000');
  assert.throws(() => a.parsePosition('002.1.1.000'), code('MIDI_TICK_NOT_REPRESENTABLE'));
  const b = signature(7, 8, { ppq: 7, displayPpq: 13 });
  assert.equal(b.parsePosition(b.formatPosition(25)), 25);
  assert.equal(b.parsePosition('002.1.1.000', 'floor'), 24);
  assert.equal(b.parsePosition('002.1.1.000', 'ceil'), 25);
});

test('Musical time: rounding at explicit edits supports exact floor ceil and half-up nearest', () => {
  const time = compileMusicalTime({ ppq: 1, displayPpq: 480 });
  const text = '001.1.3.000';
  assert.throws(() => time.parsePosition(text), code('MIDI_TICK_NOT_REPRESENTABLE'));
  assert.equal(time.parsePosition(text, 'floor'), 0);
  assert.equal(time.parsePosition(text, 'ceil'), 1);
  assert.equal(time.parsePosition(text, 'nearest'), 1);
  assert.equal(time.parseDuration('000.0.1.000', 'nearest'), 0);
  assert.throws(() => time.parsePosition(text, 'truncate'), code('INVALID_MIDI_TICK_ROUNDING'));
});

test('Musical time: maximum source tick and bar numbers above safe integer remain reversible', () => {
  const time = signature(1, 64, { ppq: 1, displayPpq: 32767 });
  const value = Number.MAX_SAFE_INTEGER, p = time.positionAt(value);
  assert.equal(p.bars, (BigInt(value) * 16n + 1n).toString());
  assert.equal(time.tickAt(p), value);
  assert.equal(time.parsePosition(time.formatPosition(value)), value);
  assert.equal(time.parseDuration(time.formatDuration(value)), value);
  const odd = signature(7, 8, { ppq: 32767, displayPpq: 32749 });
  assert.equal(odd.parsePosition(odd.formatPosition(value)), value);
});

test('Musical time: huge meter numerators use BigInt intermediates and JSON safe outputs', () => {
  const time = signature(Number.MAX_SAFE_INTEGER, 1, { ppq: 32767, displayPpq: 1 });
  const value = Number.MAX_SAFE_INTEGER, p = JSON.parse(JSON.stringify(time.positionAt(value)));
  assert.equal(p.bars, '1');
  assert.equal(time.tickAt(p), value);
  assert.equal(time.parsePosition(time.formatPosition(value)), value);
});

test('Musical time: invalid configuration and unknown fields reject before conversion', () => {
  for (const options of [null, [], { typo: true }, { ppq: null }, { ppq: 0 }, { ppq: 32768 }, { ppq: 1.5 },
    { displayPpq: '480' }, { displayPpq: 0 }, { displayPpq: null }, { timeSignature: null },
    { timeSignature: { numerator: 0, denominator: 4 } }, { timeSignature: { numerator: 4, denominator: 3 } },
    { timeSignature: { numerator: 4, denominator: 4, map: [] } }, { timeSignature: { denominator: 4 } }]) {
    assert.throws(() => compileMusicalTime(options), code('INVALID_MUSICAL_TIME'));
  }
});

test('Musical time: canonical field validation rejects carry aliases and malformed fractions', () => {
  const time = compileMusicalTime(), base = time.positionAt(0);
  for (const value of [null, [], {}, { ...base, typo: 1 }, { ...base, bars: '0' }, { ...base, bars: -1 },
    { ...base, bars: '1e5' }, { ...base, beats: 5 }, { ...base, sixteenths: 5 }, { ...base, beats: 1.1 },
    { ...base, ticks: tick(120) }, { ...base, ticks: tick(-1) }, { ...base, ticks: tick(1, 0) },
    { ...base, ticks: { ...tick(0), typo: 1 } }, { ...base, ticks: tick('0'.repeat(65)) }]) {
    assert.throws(() => time.tickAt(value), code('INVALID_MUSICAL_TIME'));
  }
  assert.equal(time.tickAt({ ...base, ticks: tick(2, 4) }), 1);
});

test('Musical time: parser is bounded strict and never silently normalizes malformed input', () => {
  const time = compileMusicalTime();
  for (const value of ['', null, 1, '1.1.1', '1.1.1.0.0', ' 1.1.1.0', '1.1.1.0\n', '-1.1.1.0',
    '1.1.1.1e2', '1.1.1.1/0', '1.1.1.1/2/3', '1.9007199254740992.1.0', '1'.repeat(257)]) {
    assert.throws(() => time.parsePosition(value), code('INVALID_MUSICAL_TIME'));
  }
  assert.equal(time.parsePosition('0001.01.01.0002/0004'), 1);
});

test('Musical time: overflow and invalid source positions reject without coercion', () => {
  const time = compileMusicalTime();
  for (const value of [-1, .5, NaN, Infinity, '1', Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => time.positionAt(value), code('INVALID_MUSICAL_TIME'));
    assert.throws(() => time.durationAt(value), code('INVALID_MUSICAL_TIME'));
  }
  assert.throws(() => time.parsePosition('999999999999999999.1.1.000'), code('MIDI_TICK_OVERFLOW'));
  assert.throws(() => time.parseDuration('999999999999999999.0.0.000'), code('MIDI_TICK_OVERFLOW'));
});

test('Musical time: compiled configuration is a detached immutable snapshot', () => {
  const input = { ppq: 960, displayPpq: 480, timeSignature: { numerator: 6, denominator: 8 } };
  const time = compileMusicalTime(input), value = time.positionAt(240);
  input.displayPpq = 1; input.timeSignature.denominator = 4; value.ticks.numerator = '99';
  assert.equal(time.formatPosition(240), '001.1.2.000');
  assert.equal(time.options.timeSignature.denominator, 8);
  assert.throws(() => { time.options.displayPpq = 1; }, TypeError);
  assert.throws(() => { time.options.timeSignature.denominator = 4; }, TypeError);
});

test('Musical time: independent rational oracle covers every supported denominator and odd resolutions', () => {
  for (const denominator of [1, 2, 4, 8, 16, 32, 64]) {
    for (const ppq of [1, 7, 96, 960, 32767]) for (const displayPpq of [1, 13, 480, 1000, 32767]) {
      const time = signature(7, denominator, { ppq, displayPpq });
      for (let source = 0; source < 997; source += 13) {
        // Small-number quotient oracle; reconstruct independently as a rational
        // sum of bars, denominator beats, sixteenths and display ticks.
        const p = time.positionAt(source);
        assert.equal(BigInt(p.bars), BigInt(Math.floor(source * denominator / (ppq * 28))) + 1n);
        const d = BigInt(denominator) * 4n * BigInt(displayPpq) * BigInt(p.ticks.denominator);
        const n = (BigInt(p.bars) - 1n) * 7n * 4n * BigInt(ppq) * (d / BigInt(denominator)) +
          BigInt(p.beats - 1) * 4n * BigInt(ppq) * (d / BigInt(denominator)) +
          BigInt(p.sixteenths - 1) * BigInt(ppq) * (d / 4n) +
          BigInt(p.ticks.numerator) * BigInt(ppq) * (d / (BigInt(displayPpq) * BigInt(p.ticks.denominator)));
        assert.equal(n, BigInt(source) * d);
        assert.equal(time.parsePosition(time.formatPosition(source)), source);
        assert.equal(time.parseDuration(time.formatDuration(source)), source);
      }
    }
  }
});

test('Musical time: tempo changes affect seconds but not meter position or stored tick edits', () => {
  const time = signature(6, 8), a = compileTempoMap([{ tick: 0, bpm: 120 }]);
  const b = compileTempoMap([{ tick: 0, bpm: 120 }, { tick: 960, bpm: 60 }]);
  const source = time.parsePosition('002.1.1.000');
  assert.equal(source, 2880);
  assert.equal(a.tickToSeconds(source), 1.5);
  assert.equal(b.tickToSeconds(source), 2.5);
  assert.equal(time.formatPosition(a.secondsToTick(1.5)), time.formatPosition(b.secondsToTick(2.5)));
});

test('Musical time: musical readouts preserve project source and exported MIDI bytes', () => {
  const project = createProject({ name: 'Musical position source' });
  project.timeSignature = { numerator: 7, denominator: 8 };
  project.tracks.push({ id: 't', name: 'Keys', type: 'midi', instrument: 'sine', gainDb: 0, pan: 0, mute: false, solo: false });
  project.clips.push({ id: 'c', trackId: 't', type: 'midi', name: 'Phrase', startTick: 1, lengthTicks: 3360,
    notes: [{ id: 'n', startTick: 1, durationTicks: 959, pitch: 60, velocity: 90, channel: 0 }] });
  const before = structuredClone(project), bytes = writeMidi(project);
  for (const displayPpq of [1, 480, 1000]) {
    const time = compileMusicalTime({ ppq: project.ppq, displayPpq, timeSignature: project.timeSignature });
    for (const source of [0, 1, 3359, 3360, Number.MAX_SAFE_INTEGER]) assert.equal(time.tickAt(time.positionAt(source)), source);
  }
  assert.deepEqual(project, before);
  assert.deepEqual(writeMidi(project), bytes);
  assert.equal(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(12), project.ppq);
  const note = parseMidi(bytes).tracks[0].notes[0];
  assert.equal(note.startTick, 2);
  assert.equal(note.durationTicks, 959);
});
