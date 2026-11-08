import test from 'node:test';
import assert from 'node:assert/strict';
import {chaseMidiStreams, defaultChaseOptions, resolveChaseOptions} from '../src/media/midi-chase.mjs';
import {compileMidiStreams} from '../src/media/midi-stream.mjs';
import {compileMidiPlayback} from '../src/media/midi-playback.mjs';
import {compileTempoMap} from '../src/media/time.mjs';

const note = (id, startTick = 0, durationTicks = 1000, extra = {}) => ({id, startTick, durationTicks, pitch: 60, velocity: 90, channel: 0, ...extra});
const raw = (tick, status, data, extra = {}) => ({id: `event-${tick}-${status}-${data.join('-')}`, tick, kind: 'channel', order: 0, status, data, ...extra});
const cc = (tick, number, value, extra = {}) => raw(tick, 176, [number, value], extra);
function project(notes = [], events = []) {
  return {ppq: 1000, sampleRate: 8000, tempoMap: [{tick: 0, bpm: 120}], masterGainDb: 0, assets: [],
    tracks: [{id: 't', type: 'midi', instrument: 'sine', gainDb: 0, pan: 0}],
    clips: [{id: 'c', trackId: 't', type: 'midi', startTick: 0, lengthTicks: 2000, notes, events}]};
}
const chase = (p, tick = 500, options = {}, extra = {}) => chaseMidiStreams(compileMidiStreams(p), p, {tick, options, ...extra});
const wire = result => result.tracks.flatMap(t => t.events.map(e => [e.tick, e.status, ...e.data]));
const ons = result => result.tracks.flatMap(t => t.events.filter(e => e.kind === 'noteOn'));
const eventOptionsOff = () => Object.fromEntries(Object.keys(defaultChaseOptions()).map(k => [k, false]));

test('MIDI Chase: strict independent type options default to notes and channel state with SysEx opt-in', () => {
  assert.deepEqual(resolveChaseOptions(), {notes: true, polyPressure: true, controllers: true, program: true, aftertouch: true, pitchbend: true, sysex: false, controllersOutsideParts: true});
  for (const invalid of [null, [], {note: true}, {notes: 1}, {sysex: 'true'}]) assert.throws(() => resolveChaseOptions(invalid), {code: 'INVALID_MIDI_CHASE_OPTIONS'});
  const first = defaultChaseOptions(); first.notes = false; assert.equal(defaultChaseOptions().notes, true);
  assert.deepEqual(wire(chase(project([note('n')], [cc(0, 7, 10)]), 500, eventOptionsOff())), []);
});

test('MIDI Chase: scalar lane identities and independently selected message types preserve source order before cursor', () => {
  const p = project([], [cc(0, 11, 10), cc(10, 11, 80), raw(20, 177, [11, 40]), raw(30, 160, [60, 7]), raw(40, 160, [61, 8]),
    raw(50, 208, [32]), raw(60, 224, [1, 65]), raw(70, 192, [9]), cc(500, 11, 100)]);
  assert.deepEqual(wire(chase(p)), [[500, 176, 11, 80], [500, 177, 11, 40], [500, 160, 60, 7], [500, 160, 61, 8], [500, 208, 32], [500, 224, 1, 65], [500, 192, 9]]);
  for (const [option, type, count] of [['polyPressure', 10, 2], ['controllers', 11, 2], ['program', 12, 1], ['aftertouch', 13, 1], ['pitchbend', 14, 1]]) {
    const result = wire(chase(p, 500, {...eventOptionsOff(), [option]: true, controllersOutsideParts: true}));
    assert.equal(result.length, count); assert.ok(result.every(e => e[1] >> 4 === type));
  }
});

test('MIDI Chase: banks programs parameter increments and resets retain protocol history and scalar reset ordering', () => {
  const events = [cc(0, 0, 3), raw(1, 192, [9]), cc(2, 32, 4), raw(3, 192, [10]), cc(4, 101, 0), cc(5, 100, 0), cc(6, 6, 12), cc(7, 96, 0), cc(8, 97, 0), cc(9, 11, 50), cc(10, 121, 0)];
  const p = project([], events);
  assert.deepEqual(wire(chase(p)).map(e => e.slice(1)), [...events.map(e => [e.status, ...e.data]), [208, 0], [224, 0, 64]]);
  const result = chase(p, 500, {controllers: false}); assert.deepEqual(wire(result), [[500, 192, 9], [500, 192, 10], [500, 208, 0], [500, 224, 0, 64]]);
});

test('MIDI Chase: CC121 resets selected pitch and pressure even with controller chase disabled and pressure follows chased onset', () => {
  const p = project([note('n')], [raw(10, 160, [60, 47]), raw(20, 208, [90]), raw(30, 224, [0, 100]), cc(40, 121, 0)]);
  const result = chase(p, 500, {controllers: false});
  assert.deepEqual(wire(result), [[500, 160, 60, 0], [500, 208, 0], [500, 224, 0, 64], [500, 144, 60, 90], [500, 160, 60, 0]]);
  p.clips[0].events.push(raw(100, 160, [60, 71]));
  assert.deepEqual(wire(chase(p)).at(-1), [500, 160, 60, 71]);
  assert.equal(wire(chase(p, 500, {polyPressure: false})).some(e => e[1] === 160), false);
});

test('MIDI Chase: controller part scope is half-open includes overlapping cursor parts and leaves program scope independent', () => {
  const p = project([], [cc(0, 7, 12), raw(5, 192, [4])]); p.clips[0].lengthTicks = 100;
  p.clips.push({id: 'b', trackId: 't', type: 'midi', startTick: 200, lengthTicks: 600, notes: [], events: [cc(0, 11, 80)]});
  p.clips.push({id: 'overlap', trackId: 't', type: 'midi', startTick: 300, lengthTicks: 500, notes: [], events: [cc(0, 10, 40)]});
  assert.deepEqual(wire(chase(p, 500, {controllersOutsideParts: false})), [[500, 192, 4], [500, 176, 11, 80], [500, 176, 10, 40]]);
  assert.deepEqual(wire(chase(p, 800, {controllersOutsideParts: false})), [[800, 192, 4]]);
  assert.equal(wire(chase(p, 800)).length, 4);
  p.tracks[0].midiParameters = {delayMs: 0, setupChannel: 0, program: null, bankMsb: null, bankLsb: null, volume: 99, pan: null};
  assert.deepEqual(wire(chase(p, 800, {controllersOutsideParts: false})), [[800, 176, 7, 99], [800, 192, 4]]);
});

test('MIDI Chase: held keys reconnect to original paired offs and cursor events remain unchased', () => {
  const p = project([note('past', 0, 100), note('held', 200, 600, {channel: 3, releaseVelocity: 47}), note('at', 500, 200)]);
  const compiled = compileMidiStreams(p), result = chaseMidiStreams(compiled, p, {tick: 500});
  assert.deepEqual(wire(result), [[500, 147, 60, 90]]);
  const on = ons(result)[0], futureOff = compiled.tracks[0].events.find(e => e.kind === 'noteOff' && e.noteId === 'held');
  assert.equal(on.noteKey, futureOff.noteKey); assert.equal(on.durationTicks, 300); assert.equal(on.nominalStartTick, 500); assert.equal(on.nominalEndTick, 800);
  assert.equal(on.releaseVelocity, 47); assert.equal(ons(chase(p, 500, {notes: false})).length, 0);
});

test('MIDI Chase: same-tick source ordering controls pedal-held notes without adding zero-length project notes', () => {
  const make = pedalOrder => project([note('n', 0, 100, {offOrder: 1})], [cc(100, 64, 127, {order: pedalOrder})]);
  assert.equal(ons(chase(make(0))).length, 1);
  assert.equal(ons(chase(make(2))).length, 0);
  const result = chase(make(0)); assert.deepEqual(wire(result), [[500, 176, 64, 127], [500, 144, 60, 90], [500, 128, 60, 0]]);
  assert.equal(result.tracks[0].pedalHeldNotes, 1);
});

test('MIDI Chase: raw note-offs use FIFO while paired offs retain their identity across overlapping pitches', () => {
  const p = project([note('first', 0, 900), note('second', 20, 600), note('third', 30, 150)], [raw(100, 128, [60, 52])]);
  assert.deepEqual(ons(chase(p)).map(e => e.noteId), ['second']);
  p.clips[0].events.push(cc(50, 64, 127));
  const result = chase(p); assert.equal(result.tracks[0].chasedNotes, 3); assert.equal(result.tracks[0].pedalHeldNotes, 2);
  assert.deepEqual(result.tracks[0].events.filter(e => e.chasePhase === 'held-note-off').map(e => [e.noteId, e.status, ...e.data]), [['first', 128, 60, 52], ['third', 128, 60, 0]]);
});

test('MIDI Chase: all sound off reset controllers and all notes off do not resurrect terminated voices', () => {
  for (const controller of [120, 121]) {
    const p = project([note('n', 0, 100)], [cc(10, 64, 127), cc(200, controller, 0)]); assert.equal(ons(chase(p)).length, 0);
  }
  for (const controller of [123, 124, 125, 126, 127]) {
    const p = project([note('n')], [cc(200, controller, 0)]); assert.equal(ons(chase(p)).length, 0);
    p.clips[0].events.push(cc(100, 64, 127)); assert.equal(chase(p).tracks[0].pedalHeldNotes, 1);
  }
  const p = project([note('n')], [cc(10, 64, 127), cc(200, 121, 0)]); assert.equal(ons(chase(p)).length, 1);
  p.clips[0].events.push(cc(300, 120, 0)); assert.equal(ons(chase(p)).length, 0);
});

test('MIDI Chase: pedal scopes never silently enable a disabled controller type or history outside the cursor part', () => {
  const p = project([note('held', 0, 100), note('down', 0, 1000)], [cc(10, 64, 127)]);
  const result = chase(p, 500, {controllers: false}); assert.deepEqual(ons(result).map(e => e.noteId), ['down']);
  assert.equal(result.warnings[0].code, 'MIDI_CHASE_PEDAL_SCOPE'); assert.equal(result.warnings[0].count, 1);
  p.clips[0].lengthTicks = 300; p.clips[0].allowNoteTails = true;
  assert.deepEqual(ons(chase(p, 500, {controllersOutsideParts: false})).map(e => e.noteId), ['down']);
  assert.equal(chase(p).tracks[0].pedalHeldNotes, 1);
});

test('MIDI Chase: sostenuto captures only keys down at its rising edge and reconstructs capture before later keys', () => {
  const p = project([note('captured', 0, 200), note('uncaptured', 100, 200), note('new-key', 300, 500, {pitch: 67})], [cc(50, 66, 100)]);
  const result = chase(p); assert.deepEqual(ons(result).map(e => e.noteId), ['captured', 'new-key']);
  assert.deepEqual(wire(result), [[500, 176, 66, 100], [500, 176, 66, 0], [500, 144, 60, 90], [500, 176, 66, 100], [500, 144, 67, 90], [500, 128, 60, 0]]);
  p.clips[0].events.push(cc(400, 66, 0)); assert.deepEqual(ons(chase(p)).map(e => e.noteId), ['new-key']);
});

test('MIDI Chase: sustain and sostenuto release independently and repeated high sostenuto does not capture new notes', () => {
  const p = project([note('captured', 0, 100), note('later', 60, 100, {pitch: 64})], [cc(10, 66, 127), cc(70, 66, 100), cc(80, 64, 127), cc(200, 64, 0)]);
  assert.deepEqual(ons(chase(p)).map(e => e.noteId), ['captured']);
  p.clips[0].events.push(cc(400, 121, 0)); assert.deepEqual(ons(chase(p)), []);
});

test('MIDI Chase: SysEx packets including split continuations retain exact framing and opaque payload order', () => {
  const sx = (tick, status, data) => ({tick, order: 0, kind: 'sysex', status, data});
  const p = project([], [sx(0, 240, [67, 1]), sx(100, 247, [2, 247]), sx(150, 247, [248]), sx(300, 240, [65, 3]), sx(600, 247, [4, 247]),
    {tick: 50, order: 0, kind: 'meta', status: 255, metaType: 1, data: [65]}]);
  assert.deepEqual(wire(chase(p)), []);
  const result = chase(p, 500, {sysex: true});
  assert.deepEqual(wire(result), [[500, 240, 67, 1], [500, 247, 2, 247], [500, 247, 248], [500, 240, 65, 3]]);
  assert.equal(result.warnings[0].code, 'MIDI_CHASE_OPAQUE_SYSEX');
  const all = [...result.tracks[0].events, ...compileMidiStreams(p).tracks[0].events.filter(e => e.tick >= 500)];
  assert.deepEqual(all.map(e => [e.status, ...e.data]), p.clips[0].events.filter(e => e.kind === 'sysex').map(e => [e.status, ...e.data]));
});

test('MIDI Chase: sampled curves and output modifiers are resolved before locating without mutating source or compiled events', () => {
  const p = project([note('n', 0, 800)], [cc(0, 11, 0, {curve: {type: 'ramp'}}), cc(1000, 11, 100)]);
  p.clips[0].midiModifiers = {transpose: 12, velocityShift: 5};
  const compiled = compileMidiStreams(p), before = structuredClone({p, compiled});
  const result = chaseMidiStreams(compiled, p, {tick: 500}); assert.equal(ons(result)[0].pitch, 72); assert.equal(ons(result)[0].velocity, 95);
  assert.deepEqual(wire(result)[0], [500, 176, 11, 50]);
  result.tracks[0].events[0].data[1] = 0;
  assert.deepEqual({p, compiled}, before);
});

test('MIDI Chase: the shared playback state releases chased pedal voices at the future source release instead of getting stuck', () => {
  const p = project([note('pedal', 0, 100), note('down', 200, 600, {pitch: 67})], [cc(20, 64, 127), cc(700, 64, 0)]);
  const compiled = compileMidiStreams(p), result = chaseMidiStreams(compiled, p, {tick: 500});
  const resumed = {...compiled, tracks: compiled.tracks.map((stream, i) => ({...stream, events: [...result.tracks[i].events, ...stream.events.filter(e => e.tick >= 500)]}))};
  const timeline = compileTempoMap(p.tempoMap, p.ppq), plan = x => compileMidiPlayback(x, {timeline, contentDuration: 1});
  const source = plan(compiled).tracks[0].voices, located = plan(resumed).tracks[0].voices;
  assert.deepEqual(located.map(v => [v.noteId, v.releaseTime, v.killTime]), source.map(v => [v.noteId, v.releaseTime, v.killTime]));
  assert.deepEqual(located.map(v => v.start), [.25, .25]);
  for (const [i, expected] of [.35, .4].entries()) assert.ok(Math.abs(located[i].releaseTime - expected) < 1e-12);
});

test('MIDI Chase: track and channel voices and controllers stay independent', () => {
  const p = project([note('t0')], [cc(0, 7, 12), cc(400, 120, 0, {status: 177})]);
  p.tracks.push({...p.tracks[0], id: 't1'});
  p.clips.push({...p.clips[0], id: 'c1', trackId: 't1', notes: [note('t1', 0, 1000, {channel: 1})], events: [cc(0, 7, 99, {status: 177})]});
  const result = chase(p); assert.deepEqual(result.tracks.map(t => t.events.filter(e => e.kind === 'noteOn').map(e => [e.noteId, e.channel])), [[['t0', 0]], [['t1', 1]]]);
  assert.deepEqual(result.tracks.map(t => t.events.find(e => e.data[0] === 7).data), [[7, 12], [7, 99]]);
});

test('MIDI Chase: selected compilation excludes muted parts and unrelated tracks before any prefix is constructed', () => {
  const p = project([note('audible')], [cc(0, 11, 80)]);
  p.clips.push({...p.clips[0], id: 'muted', mute: true, notes: [note('muted')], events: [cc(100, 11, 0)]});
  p.tracks.push({...p.tracks[0], id: 'other'});
  p.clips.push({...p.clips[0], id: 'other', trackId: 'other', notes: [note('other')], events: []});
  const compiled = compileMidiStreams(p, {trackIds: ['t'], includeMutedClips: false});
  const result = chaseMidiStreams(compiled, p, {tick: 500});
  assert.deepEqual(ons(result).map(e => e.noteId), ['audible']);
  assert.deepEqual(wire(result), [[500, 176, 11, 80], [500, 144, 60, 90]]);
});

test('MIDI Chase: pedal-held zero velocity note-on releases retain exact MIDI release encoding at locate', () => {
  const p = project([note('n', 0, 100, {noteOffEncoding: 'zeroVelocityNoteOn', releaseVelocity: 0})], [cc(10, 64, 127)]);
  const result = chase(p), off = result.tracks[0].events.at(-1);
  assert.deepEqual(wire(result), [[500, 176, 64, 127], [500, 144, 60, 90], [500, 144, 60, 0]]);
  assert.equal(off.kind, 'noteOff'); assert.equal(off.noteOffEncoding, 'zeroVelocityNoteOn');
  assert.equal(ons(result)[0].nominalEndTick, 500); assert.equal(ons(result)[0].durationTicks, 0);
});

test('MIDI Chase: large SysEx work fails explicitly with untouched packets rather than truncating a device message', () => {
  const data = Array(1024 * 1024).fill(1); data[data.length - 1] = 247;
  const p = project([], [raw(0, 240, data, {kind: 'sysex'}), raw(100, 240, data.slice(), {kind: 'sysex'})]);
  const compiled = compileMidiStreams(p);
  assert.throws(() => chaseMidiStreams(compiled, p, {tick: 500, options: {sysex: true}}), {code: 'MIDI_CHASE_TOO_COMPLEX'});
  assert.equal(compiled.tracks[0].events[1].data.length, 1024 * 1024);
  assert.equal(compiled.tracks[0].events[1].data.at(-1), 247);
});

test('MIDI Chase: locate zero invalid positions and bounded work fail without mutating source', () => {
  const p = project([note('n')], [cc(0, 7, 12)]), before = structuredClone(p);
  assert.deepEqual(wire(chase(p, 0)), []);
  for (const tick of [-1, 1.1, Infinity, NaN]) assert.throws(() => chase(p, tick), {code: 'INVALID_MEDIA_VALUE'});
  assert.throws(() => chase(p, 500, {}, {maxOperations: 2}), {code: 'MIDI_CHASE_TOO_COMPLEX'});
  assert.deepEqual(p, before);
  const compiled = compileMidiStreams(p); compiled.tracks[0].events = [{tick: 20}, {tick: 10}];
  assert.throws(() => chaseMidiStreams(compiled, p, {tick: 500}), {code: 'INVALID_MIDI_CHASE_SOURCE'});
});

test('MIDI Chase: dense repeated channel kills and raw FIFO cleanup remain bounded with 100000 source voices', () => {
  const p = project(Array.from({length: 100000}, (_, i) => note(`n${i}`, 0, 1000, {pitch: i % 128})), [cc(100, 120, 0), raw(200, 128, [60, 0])]);
  const result = chase(p); assert.equal(ons(result).length, 0); assert.ok(result.stats.operations < 500000);
});
