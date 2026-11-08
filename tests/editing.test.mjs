import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine, createProject, getCommandCatalog, validateProject } from '../src/core/engine.mjs';

const run = (engine, command, args, extra = {}) => engine.execute({ command, arguments: args, ...extra });
const ok = result => { assert.equal(result.status, 'applied', JSON.stringify(result.errors)); return result; };
const error = (result, code) => { assert.equal(result.status, 'error'); if (code) assert.equal(result.errors[0].code, code, JSON.stringify(result)); return result; };
const note = (id, startTick, durationTicks, pitch = 60, channel = 0, velocity = 90) => ({ id, startTick, durationTicks, pitch, channel, velocity });
function midi(notes = [note('note-1', 10, 30)], { startTick = 100, lengthTicks = 1000 } = {}) {
  const engine = new Engine();
  ok(run(engine, 'batch', { commands: [
    { command: 'track.add', arguments: { id: 'track-1', type: 'midi', name: 'Keys', instrument: 'triangle' } },
    { command: 'track.add', arguments: { id: 'track-2', type: 'midi', name: 'Other' } },
    { command: 'track.add', arguments: { id: 'track-audio', type: 'audio' } },
    { command: 'clip.add', arguments: { id: 'clip-1', type: 'midi', trackId: 'track-1', startTick, lengthTicks, notes } },
  ] }));
  return engine;
}
function audio({ sourceRate = 44100, projectRate = 48000, lengthFrames = 44100, offsetFrames = 25, startSample = 120 } = {}) {
  const engine = new Engine(createProject({ sampleRate: projectRate }));
  const asset = { id: 'asset-1', name: 'Source.wav', path: `assets/${'b'.repeat(64)}.wav`, sha256: 'b'.repeat(64), sampleRate: sourceRate, channels: 1, frames: offsetFrames + lengthFrames + 10 };
  ok(run(engine, 'batch', { commands: [
    { command: 'asset.add', arguments: { asset } },
    { command: 'track.add', arguments: { id: 'audio-1', type: 'audio' } },
    { command: 'track.add', arguments: { id: 'audio-2', type: 'audio' } },
    { command: 'clip.add', arguments: { id: 'clip-audio', trackId: 'audio-1', type: 'audio', assetId: asset.id, startSample, offsetFrames, lengthFrames, gainDb: -3 } },
  ] }));
  return engine;
}
const clip = (engine, id = 'clip-1') => engine.project.clips.find(item => item.id === id);

test('editing commands expose strict discoverable schemas while project schema remains v1', () => {
  const names = getCommandCatalog().map(item => item.command);
  for (const name of ['track.duplicate', 'track.reorder', 'clip.duplicate', 'clip.split', 'clip.move', 'midi.notes.quantize', 'midi.notes.transpose', 'midi.notes.velocity', 'midi.notes.removeDoubles', 'midi.notes.legato']) assert.ok(names.includes(name));
  assert.equal(new Set(names).size, names.length);
  const engine = midi();
  for (const [command, args] of [
    ['track.reorder', { trackId: 'track-1', index: -1 }],
    ['track.duplicate', { trackId: 'track-1', includeClips: 1 }],
    ['clip.duplicate', { clipId: 'clip-1', count: 65 }],
    ['clip.duplicate', { clipId: 'clip-1', count: 0 }],
    ['midi.notes.quantize', { clipId: 'clip-1', gridTicks: 0 }],
    ['midi.notes.quantize', { clipId: 'clip-1', gridTicks: 10, swing: 0.751 }],
    ['midi.notes.transpose', { clipId: 'clip-1', semitones: 1.5 }],
    ['midi.notes.velocity', { clipId: 'clip-1', mode: 'set', value: Infinity }],
    ['midi.notes.legato', { clipId: 'clip-1', gapTicks: 0.5 }],
  ]) error(run(engine, command, args), 'VALIDATION_ERROR');
  assert.equal(engine.project.schemaVersion, 1); assert.equal(validateProject(engine.project), true);
});

test('track duplication copies settings and independent note IDs immediately below source', () => {
  const engine = midi();
  ok(run(engine, 'track.update', { trackId: 'track-1', gainDb: -8, pan: 0.3, mute: true, solo: true, color: '#112233' }));
  const original = engine.project;
  const result = ok(run(engine, 'track.duplicate', { trackId: 'track-1', newTrackId: 'copied-track' }));
  assert.deepEqual(engine.project.tracks.map(t => t.id), ['track-1', 'copied-track', 'track-2', 'track-audio']);
  const copiedTrack = engine.project.tracks[1];
  for (const key of ['type', 'instrument', 'gainDb', 'pan', 'mute', 'solo', 'color']) assert.equal(copiedTrack[key], original.tracks[0][key]);
  const copied = engine.project.clips.find(c => c.trackId === copiedTrack.id);
  assert.notEqual(copied.id, 'clip-1'); assert.notEqual(copied.notes[0].id, 'note-1');
  assert.equal(copied.startTick, clip(engine).startTick); assert.ok(result.changes.created.includes(copied.notes[0].id));
  ok(run(engine, 'midi.notes.update', { clipId: copied.id, noteId: copied.notes[0].id, pitch: 80 }));
  assert.equal(clip(engine).notes[0].pitch, 60);
  ok(run(engine, 'track.duplicate', { trackId: 'track-1', newTrackId: 'empty-copy', includeClips: false }));
  assert.equal(engine.project.clips.filter(c => c.trackId === 'empty-copy').length, 0);
});

test('audio track copy shares source asset while trim edits remain independent', () => {
  const engine = audio();
  ok(run(engine, 'track.duplicate', { trackId: 'audio-1', newTrackId: 'copy' }));
  const copied = engine.project.clips.find(c => c.trackId === 'copy');
  assert.equal(copied.assetId, 'asset-1'); assert.equal(engine.project.assets.length, 1);
  ok(run(engine, 'clip.update', { clipId: copied.id, offsetFrames: 30, lengthFrames: 100 }));
  assert.equal(clip(engine, 'clip-audio').offsetFrames, 25); assert.equal(clip(engine, 'clip-audio').lengthFrames, 44100);
});

test('track reordering uses final index, stable IDs, undo and dry-run atomicity', () => {
  const engine = midi(); const before = engine.checkpoint();
  const dry = run(engine, 'track.reorder', { trackId: 'track-1', index: 2 }, { dryRun: true });
  assert.equal(dry.status, 'validated'); assert.deepEqual(engine.checkpoint(), before);
  ok(run(engine, 'track.reorder', { trackId: 'track-1', index: 2 }));
  assert.deepEqual(engine.project.tracks.map(t => t.id), ['track-2', 'track-audio', 'track-1']); assert.equal(clip(engine).trackId, 'track-1');
  error(run(engine, 'track.reorder', { trackId: 'track-1', index: 3 }), 'INDEX_OUT_OF_BOUNDS');
  ok(run(engine, 'history.undo', {})); assert.deepEqual(engine.project.tracks, before.project.tracks);
});

test('MIDI clip repeat defaults to consecutive independent copies, explicit spacing and compatible target', () => {
  const engine = midi();
  const result = ok(run(engine, 'clip.duplicate', { clipId: 'clip-1', count: 2, targetTrackId: 'track-2' }));
  const copies = engine.project.clips.filter(c => c.id !== 'clip-1');
  assert.deepEqual(copies.map(c => c.startTick), [1100, 2100]);
  assert.ok(copies.every(c => c.trackId === 'track-2')); assert.equal(new Set(copies.map(c => c.notes[0].id)).size, 2);
  assert.ok(copies.every(c => c.notes[0].id !== 'note-1'));
  assert.equal(result.changes.duplication.unit, 'ticks');
  ok(run(engine, 'midi.notes.transpose', { clipId: copies[0].id, semitones: 12 }));
  assert.equal(clip(engine).notes[0].pitch, 60); assert.equal(clip(engine, copies[1].id).notes[0].pitch, 60);
  ok(run(engine, 'clip.duplicate', { clipId: 'clip-1', spacingTicks: 75 }));
  assert.equal(engine.project.clips.at(-1).startTick, 175);
  const before = engine.checkpoint();
  error(run(engine, 'clip.duplicate', { clipId: 'clip-1', targetTrackId: 'track-audio' }), 'TYPE_MISMATCH');
  error(run(engine, 'clip.duplicate', { clipId: 'clip-1', spacingSamples: 100 }), 'TYPE_MISMATCH');
  assert.deepEqual(engine.checkpoint(), before);
});

test('audio repeat converts source-frame duration to project samples and reports spacing', () => {
  const engine = audio({ sourceRate: 3, projectRate: 5, lengthFrames: 2, offsetFrames: 0, startSample: 10 });
  const result = ok(run(engine, 'clip.duplicate', { clipId: 'clip-audio', count: 2 }));
  assert.deepEqual(engine.project.clips.map(c => c.startSample), [10, 14, 18]);
  assert.deepEqual(result.changes.duplication, { count: 2, spacing: 4, unit: 'projectSamples', targetTrackId: 'audio-1' });
  assert.equal(engine.project.assets.length, 1);
  ok(run(engine, 'clip.duplicate', { clipId: 'clip-audio', spacingSamples: 0 })); assert.equal(engine.project.clips.at(-1).startSample, 10);
});

test('MIDI split preserves IDs on each side and creates fresh crossing fragments, one undo restores exact notes', () => {
  const engine = midi([note('left', 10, 40), note('cross', 40, 80, 64), note('edge', 100, 20, 67), note('right', 150, 30, 72)], { startTick: 500, lengthTicks: 300 });
  const before = engine.checkpoint();
  const result = ok(run(engine, 'clip.split', { clipId: 'clip-1', atTick: 600 }));
  const left = clip(engine), right = clip(engine, result.changes.split.rightClipId);
  assert.equal(left.id, 'clip-1'); assert.equal(left.lengthTicks, 100); assert.equal(right.startTick, 600); assert.equal(right.lengthTicks, 200);
  assert.deepEqual(left.notes.map(n => [n.id, n.startTick, n.durationTicks]), [['left', 10, 40], ['cross', 40, 60]]);
  assert.equal(right.notes[0].startTick, 0); assert.equal(right.notes[0].durationTicks, 20); assert.notEqual(right.notes[0].id, 'cross');
  assert.deepEqual(right.notes.slice(1).map(n => [n.id, n.startTick, n.durationTicks]), [['edge', 0, 20], ['right', 50, 30]]);
  assert.equal(new Set(engine.project.clips.flatMap(c => c.notes.map(n => n.id))).size, 5);
  ok(run(engine, 'history.undo', {})); assert.deepEqual(engine.project.clips, before.project.clips);
  ok(run(engine, 'history.redo', {})); assert.equal(engine.project.clips[1].id, right.id);
  const afterRedo = engine.checkpoint();
  for (const atTick of [500, 600, 499]) error(run(engine, 'clip.split', { clipId: 'clip-1', atTick }), 'SPLIT_OUT_OF_BOUNDS');
  assert.deepEqual(engine.checkpoint(), afterRedo);
});

test('MIDI split and move are musical-tick operations independent of tempo step changes', () => {
  const engine = midi([note('cross', 100, 500)], { startTick: 960, lengthTicks: 1920 });
  ok(run(engine, 'tempo.set', { tempoMap: [{ tick: 0, bpm: 80 }, { tick: 1100, bpm: 240 }, { tick: 1500, bpm: 60 }] }));
  const tempo = engine.project.tempoMap;
  const result = ok(run(engine, 'clip.split', { clipId: 'clip-1', atTick: 1440 }));
  assert.equal(clip(engine).lengthTicks, 480); assert.equal(clip(engine).notes[0].durationTicks, 380);
  const right = clip(engine, result.changes.split.rightClipId); assert.equal(right.notes[0].durationTicks, 120);
  ok(run(engine, 'clip.move', { clipId: right.id, trackId: 'track-2', startTick: 3000 }));
  assert.equal(clip(engine, right.id).startTick, 3000); assert.deepEqual(engine.project.tempoMap, tempo);
  assert.equal(clip(engine, right.id).notes[0].startTick, 0);
});

test('44.1 to 48 kHz split snaps to exact shared sample grid and reports rounding without frame loss', () => {
  const engine = audio(); const original = clip(engine, 'clip-audio');
  const before = engine.checkpoint();
  const dry = run(engine, 'clip.split', { clipId: 'clip-audio', atSample: 1000 }, { dryRun: true });
  assert.equal(dry.status, 'validated'); assert.deepEqual(engine.checkpoint(), before);
  const result = ok(run(engine, 'clip.split', { clipId: 'clip-audio', atSample: 1000 }));
  const left = clip(engine, 'clip-audio'), right = clip(engine, result.changes.split.rightClipId), info = result.changes.split;
  assert.equal(info.projectSampleGrid, 160); assert.equal(info.sourceFrameGrid, 147);
  assert.equal(info.actualSample, 1080); assert.equal(info.roundingSamples, 80);
  assert.equal(left.lengthFrames, 882); assert.equal(right.offsetFrames, 25 + 882);
  assert.equal(left.lengthFrames + right.lengthFrames, original.lengthFrames);
  assert.equal((right.startSample - original.startSample) * 44100, left.lengthFrames * 48000);
  assert.equal(right.offsetFrames + right.lengthFrames, original.offsetFrames + original.lengthFrames);
  assert.equal(left.gainDb, -3); assert.equal(right.gainDb, -3); assert.equal(engine.project.assets.length, 1);
  ok(run(engine, 'history.undo', {})); assert.deepEqual(engine.project.clips, before.project.clips);
});

test('audio split handles equal/inverse rates, nearest interior boundary and unsplittable tiny clips', () => {
  for (const sourceRate of [24000, 48000, 96000]) {
    const engine = audio({ sourceRate, lengthFrames: sourceRate, offsetFrames: 0, startSample: 0 });
    const result = ok(run(engine, 'clip.split', { clipId: 'clip-audio', atSample: 12000 }));
    const right = clip(engine, result.changes.split.rightClipId);
    assert.equal(clip(engine, 'clip-audio').lengthFrames, sourceRate / 4); assert.equal(right.startSample, 12000);
  }
  const nearEdge = audio({ lengthFrames: 200, startSample: 0 });
  const firstInterior = ok(run(nearEdge, 'clip.split', { clipId: 'clip-audio', atSample: 1 }));
  assert.equal(firstInterior.changes.split.actualSample, 160);
  const tiny = audio({ lengthFrames: 147, startSample: 0 }); const before = tiny.checkpoint();
  error(run(tiny, 'clip.split', { clipId: 'clip-audio', atSample: 50 }), 'NO_EXACT_SPLIT');
  error(run(tiny, 'clip.split', { clipId: 'clip-audio', atSample: 0 }), 'SPLIT_OUT_OF_BOUNDS');
  error(run(tiny, 'clip.split', { clipId: 'clip-audio', atSample: 160 }), 'SPLIT_OUT_OF_BOUNDS');
  assert.deepEqual(tiny.checkpoint(), before);
});

test('clip move and split reject wrong units, missing destinations and incompatible tracks atomically', () => {
  const engine = midi(); const before = engine.checkpoint();
  error(run(engine, 'clip.move', { clipId: 'clip-1' }), 'EMPTY_UPDATE');
  error(run(engine, 'clip.move', { clipId: 'clip-1', trackId: 'track-audio', startTick: 1000 }), 'TYPE_MISMATCH');
  error(run(engine, 'clip.move', { clipId: 'clip-1', startSample: 1000 }), 'TYPE_MISMATCH');
  error(run(engine, 'clip.split', { clipId: 'clip-1' }), 'VALIDATION_ERROR');
  error(run(engine, 'clip.split', { clipId: 'clip-1', atTick: 120, atSample: 120 }), 'TYPE_MISMATCH');
  assert.deepEqual(engine.checkpoint(), before);
  const a = audio(); ok(run(a, 'clip.move', { clipId: 'clip-audio', trackId: 'audio-2', startSample: 48000 }));
  assert.equal(clip(a, 'clip-audio').startSample, 48000); assert.equal(clip(a, 'clip-audio').offsetFrames, 25);
});

test('start quantize preserves durations, clamps at clip end, and supports strength, swing and undo', () => {
  const engine = midi([note('first', 20, 10), note('swing', 92, 40), note('edge', 195, 105)], { lengthTicks: 300 });
  const before = engine.checkpoint();
  ok(run(engine, 'midi.notes.quantize', { clipId: 'clip-1', gridTicks: 100, swing: 0.5 }));
  assert.deepEqual(clip(engine).notes.map(n => [n.startTick, n.durationTicks]), [[0, 10], [150, 40], [195, 105]]);
  ok(run(engine, 'history.undo', {})); assert.deepEqual(clip(engine).notes, before.project.clips[0].notes);
  ok(run(engine, 'midi.notes.quantize', { clipId: 'clip-1', noteIds: ['first'], gridTicks: 100, strength: 0.5 }));
  assert.equal(clip(engine).notes[0].startTick, 10); assert.equal(clip(engine).notes[1].startTick, 92);
  const unchanged = clip(engine).notes.map(({ quantizeReference, ...values }) => values);
  ok(run(engine, 'midi.notes.quantize', { clipId: 'clip-1', gridTicks: 100, strength: 0 }));
  assert.deepEqual(clip(engine).notes.map(({ quantizeReference, ...values }) => values), unchanged);
});

test('end and length quantize preserve starts, round ties later and never create zero-length or overflow notes', () => {
  const engine = midi([note('a', 49, 1), note('b', 80, 6), note('c', 220, 80)], { lengthTicks: 300 });
  ok(run(engine, 'midi.notes.quantize', { clipId: 'clip-1', gridTicks: 100, target: 'end' }));
  assert.deepEqual(clip(engine).notes.map(n => [n.startTick, n.durationTicks]), [[49, 51], [80, 20], [220, 80]]);
  ok(run(engine, 'history.undo', {}));
  ok(run(engine, 'midi.notes.quantize', { clipId: 'clip-1', gridTicks: 100, target: 'length' }));
  assert.deepEqual(clip(engine).notes.map(n => [n.startTick, n.durationTicks]), [[49, 1], [80, 1], [220, 80]]);
  const huge = midi([note('near-max', Number.MAX_SAFE_INTEGER - 2, 1)], { startTick: 0, lengthTicks: Number.MAX_SAFE_INTEGER });
  ok(run(huge, 'midi.notes.quantize', { clipId: 'clip-1', gridTicks: 1 }));
  assert.equal(clip(huge).notes[0].startTick, Number.MAX_SAFE_INTEGER - 2);
});

test('selected note IDs validate fully; [] never means all; transpose fails as one unit', () => {
  const engine = midi([note('low', 0, 10, 0), note('high', 20, 10, 127)]);
  const before = engine.checkpoint();
  error(run(engine, 'midi.notes.transpose', { clipId: 'clip-1', semitones: 1 }), 'PITCH_OUT_OF_RANGE');
  error(run(engine, 'midi.notes.transpose', { clipId: 'clip-1', noteIds: ['low', 'missing'], semitones: 1 }), 'NOT_FOUND');
  error(run(engine, 'midi.notes.quantize', { clipId: 'clip-1', noteIds: ['low', 'low'], gridTicks: 100 }), 'VALIDATION_ERROR');
  assert.deepEqual(engine.checkpoint(), before);
  ok(run(engine, 'midi.notes.transpose', { clipId: 'clip-1', noteIds: [], semitones: 127 })); assert.deepEqual(clip(engine).notes, before.project.clips[0].notes);
  ok(run(engine, 'midi.notes.transpose', { clipId: 'clip-1', noteIds: ['low'], semitones: 12 })); assert.deepEqual(clip(engine).notes.map(n => n.pitch), [12, 127]);
});

test('velocity set/add/scale round and clamp consistently without touching unselected notes', () => {
  const engine = midi([note('a', 0, 10, 60, 0, 63), note('b', 20, 10, 62, 0, 100)]);
  ok(run(engine, 'midi.notes.velocity', { clipId: 'clip-1', noteIds: ['a'], mode: 'scale', value: 0.5 })); assert.equal(clip(engine).notes[0].velocity, 32); assert.equal(clip(engine).notes[1].velocity, 100);
  ok(run(engine, 'midi.notes.velocity', { clipId: 'clip-1', mode: 'add', value: -200 })); assert.deepEqual(clip(engine).notes.map(n => n.velocity), [1, 1]);
  ok(run(engine, 'midi.notes.velocity', { clipId: 'clip-1', mode: 'set', value: 126.5 })); assert.deepEqual(clip(engine).notes.map(n => n.velocity), [127, 127]);
  ok(run(engine, 'midi.notes.velocity', { clipId: 'clip-1', mode: 'scale', value: Number.MAX_VALUE })); assert.deepEqual(clip(engine).notes.map(n => n.velocity), [127, 127]);
  const before = engine.checkpoint(); error(run(engine, 'midi.notes.velocity', { clipId: 'clip-1', mode: 'scale', value: -1 }), 'VALIDATION_ERROR'); assert.deepEqual(engine.checkpoint(), before);
});

test('remove doubles retains first attributes and separate MIDI channels with undo recovery', () => {
  const engine = midi([note('keep', 10, 20, 60, 0, 70), note('remove', 10, 90, 60, 0, 100), note('channel', 10, 20, 60, 1), note('pitch', 10, 20, 61), note('time', 11, 20)]);
  const original = clip(engine).notes;
  const result = ok(run(engine, 'midi.notes.removeDoubles', { clipId: 'clip-1' }));
  assert.deepEqual(result.changes.removed, ['remove']); assert.deepEqual(clip(engine).notes[0], original[0]); assert.equal(clip(engine).notes.length, 4);
  ok(run(engine, 'history.undo', {})); assert.deepEqual(clip(engine).notes, original);
});

test('legato uses strictly later selected onsets per channel, handles chords/gaps/overlaps and final boundary', () => {
  const engine = midi([note('a', 0, 10, 60), note('chord', 0, 20, 64), note('other-channel', 20, 10, 55, 1), note('middle', 50, 10), note('last', 95, 5)], { lengthTicks: 100 });
  ok(run(engine, 'midi.notes.legato', { clipId: 'clip-1', gapTicks: 5 }));
  assert.deepEqual(clip(engine).notes.map(n => n.durationTicks), [45, 45, 75, 40, 1]);
  ok(run(engine, 'history.undo', {}));
  ok(run(engine, 'midi.notes.legato', { clipId: 'clip-1', noteIds: ['a', 'last'], gapTicks: -10 }));
  assert.deepEqual(clip(engine).notes.map(n => n.durationTicks), [100, 20, 10, 10, 5]);
  ok(run(engine, 'midi.notes.legato', { clipId: 'clip-1', gapTicks: Number.MAX_SAFE_INTEGER }));
  assert.ok(clip(engine).notes.every(n => n.durationTicks === 1));
});

test('new editing commands compose in atomic batches, dry-run history and revision guards remain intact', () => {
  const engine = midi([note('n1', 30, 40, 120)]); const before = engine.checkpoint();
  const commands = [
    { command: 'track.duplicate', arguments: { trackId: 'track-1', newTrackId: 'copy' } },
    { command: 'clip.split', arguments: { clipId: 'clip-1', atTick: 150 } },
    { command: 'midi.notes.transpose', arguments: { clipId: 'clip-1', semitones: 12 } },
  ];
  const result = error(run(engine, 'batch', { commands }), 'PITCH_OUT_OF_RANGE'); assert.equal(result.errors[0].details.batchIndex, 2); assert.deepEqual(engine.checkpoint(), before);
  commands[2].arguments.semitones = -12;
  const dry = run(engine, 'batch', { commands }, { dryRun: true, expectedRevision: before.project.revision }); assert.equal(dry.status, 'validated'); assert.deepEqual(engine.checkpoint(), before);
  ok(run(engine, 'batch', { commands }, { expectedRevision: before.project.revision })); assert.equal(engine.project.revision, before.project.revision + 1);
  error(run(engine, 'midi.notes.transpose', { clipId: 'clip-1', semitones: 1 }, { expectedRevision: before.project.revision }), 'REVISION_CONFLICT');
  ok(run(engine, 'history.undo', {})); assert.deepEqual(engine.project.clips, before.project.clips); assert.deepEqual(engine.project.tracks, before.project.tracks);
});

test('duplicate collision and timeline overflow leave full engine checkpoint unchanged', () => {
  const engine = midi([note('n', 0, 1)], { startTick: Number.MAX_SAFE_INTEGER - 10, lengthTicks: 10 });
  const before = engine.checkpoint();
  error(run(engine, 'clip.duplicate', { clipId: 'clip-1' }), 'TIME_OVERFLOW');
  // Explicit collision with an existing project object must reject all copied children as well.
  error(run(engine, 'track.duplicate', { trackId: 'track-1', newTrackId: 'n' }), 'DUPLICATE_ID');
  assert.deepEqual(engine.checkpoint(), before);
});

test('copy note limit rejects amplification before copying and applies per command, not per project or batch', () => {
  const project = createProject();
  project.tracks = [{ id: 'large-track', name: 'Large', type: 'midi', color: '#a3f0bf', gainDb: 0, pan: 0, mute: false, solo: false, instrument: 'sine' }];
  project.clips = [
    { id: 'small', trackId: 'large-track', type: 'midi', name: 'Small', startTick: 0, lengthTicks: 1, notes: [note('small-1', 0, 1), note('small-2', 0, 1)] },
    { id: 'large', trackId: 'large-track', type: 'midi', name: 'Large', startTick: 0, lengthTicks: 1,
      notes: Array.from({ length: 199999 }, (_, index) => note(`large-${index}`, 0, 1)) },
  ];
  const engine = new Engine(project); const before = engine.checkpoint();
  const repeated = error(run(engine, 'clip.duplicate', { clipId: 'large', count: 64 }), 'COPY_LIMIT');
  assert.equal(repeated.errors[0].details.requestedNotes, 199999 * 64);
  assert.equal(repeated.errors[0].details.limit, 200000);
  error(run(engine, 'clip.duplicate', { clipId: 'large', count: 2 }, { dryRun: true }), 'COPY_LIMIT');
  const trackCopy = error(run(engine, 'track.duplicate', { trackId: 'large-track' }), 'COPY_LIMIT');
  assert.equal(trackCopy.errors[0].details.requestedNotes, 200001);
  assert.deepEqual(engine.checkpoint(), before);
  // A project already above the copy limit remains valid; a batch of smaller commands still works.
  ok(run(engine, 'batch', { commands: [
    { command: 'clip.duplicate', arguments: { clipId: 'small', count: 64 } },
    { command: 'track.duplicate', arguments: { trackId: 'large-track', newTrackId: 'empty-copy', includeClips: false } },
  ] }));
  assert.equal(engine.project.clips.length, 66);
  assert.equal(engine.project.tracks.length, 2);
  assert.equal(engine.project.revision, 1);
});
