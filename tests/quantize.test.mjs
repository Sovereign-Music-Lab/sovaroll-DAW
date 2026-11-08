import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine, EngineError, createProject, validateProject, getCommandCatalog } from '../src/core/engine.mjs';

const run = (engine, command, args, options = {}) => engine.execute({ command, arguments: args, ...options });
const ok = result => { assert.equal(result.status, 'applied', JSON.stringify(result.errors)); return result; };
const rejected = (result, code) => { assert.equal(result.status, 'error'); assert.equal(result.errors[0].code, code, JSON.stringify(result)); return result; };
const note = (id = 'n', startTick = 40, durationTicks = 30, extras = {}) => ({ id, startTick, durationTicks, pitch: 60, velocity: 80, channel: 0, ...extras });
function fixture(notes = [note()], lengthTicks = 1000) {
  const engine = new Engine(createProject());
  ok(run(engine, 'batch', { commands: [
    { command: 'track.add', arguments: { id: 'track', type: 'midi' } },
    { command: 'track.add', arguments: { id: 'target', type: 'midi' } },
    { command: 'clip.add', arguments: { id: 'clip', trackId: 'track', type: 'midi', startTick: 200, lengthTicks, notes } },
  ] }));
  return engine;
}
const getNote = (engine, id = 'n', clipId = 'clip') => engine.project.clips.find(clip => clip.id === clipId)?.notes.find(note => note.id === id);
const timing = note => ({ startTick: note.startTick, durationTicks: note.durationTicks });
const quantize = (engine, args = {}, options) => run(engine, 'midi.notes.quantize', { clipId: 'clip', gridTicks: 100, ...args }, options);
const reset = (engine, args = {}, options) => run(engine, 'midi.notes.resetQuantize', { clipId: 'clip', ...args }, options);
const freeze = (engine, args = {}, options) => run(engine, 'midi.notes.freezeQuantize', { clipId: 'clip', ...args }, options);

test('saved v1 notes without references remain valid and catalog distinguishes original/current/reset/freeze', () => {
  const engine = fixture();
  const project = JSON.parse(JSON.stringify(engine.project));
  assert.equal(project.schemaVersion, 1); assert.equal(getNote(engine).quantizeReference, undefined);
  assert.equal(validateProject(project), true); assert.doesNotThrow(() => new Engine(project));
  const catalog = getCommandCatalog();
  assert.deepEqual(catalog.find(c => c.command === 'midi.notes.quantize').schema.properties.basis.enum, ['current', 'original']);
  assert.equal(catalog.find(c => c.command === 'midi.notes.quantize').schema.properties.basis.default, 'current');
  assert.ok(catalog.some(c => c.command === 'midi.notes.resetQuantize')); assert.ok(catalog.some(c => c.command === 'midi.notes.freezeQuantize'));
});

test('original-basis quantize recomputes from the first reference across repeated calls and two grids', () => {
  const engine = fixture();
  ok(quantize(engine, { basis: 'original' })); assert.equal(getNote(engine).startTick, 0);
  assert.deepEqual(getNote(engine).quantizeReference, { startTick: 40, durationTicks: 30 });
  ok(quantize(engine, { gridTicks: 60, basis: 'original' })); assert.equal(getNote(engine).startTick, 60);
  ok(quantize(engine, { gridTicks: 60, basis: 'original' })); assert.equal(getNote(engine).startTick, 60);
  assert.deepEqual(getNote(engine).quantizeReference, { startTick: 40, durationTicks: 30 });
  ok(reset(engine)); assert.deepEqual(timing(getNote(engine)), { startTick: 40, durationTicks: 30 });
});

test('legacy strength-only quantize stays current-based and iterates without replacing the reset reference', () => {
  const engine = fixture();
  ok(quantize(engine, { strength: 0.5 })); assert.equal(getNote(engine).startTick, 20);
  ok(quantize(engine, { strength: 0.5 })); assert.equal(getNote(engine).startTick, 10);
  ok(quantize(engine, { strength: 0.5 })); assert.equal(getNote(engine).startTick, 5);
  assert.equal(getNote(engine).quantizeReference.startTick, 40);
  ok(reset(engine)); assert.equal(getNote(engine).startTick, 40);
  ok(quantize(engine, { strength: 0.5, basis: 'original' })); assert.equal(getNote(engine).startTick, 20);
  ok(quantize(engine, { strength: 0.5, basis: 'original' })); assert.equal(getNote(engine).startTick, 20);
  ok(quantize(engine, { strength: 0, basis: 'original' })); assert.equal(getNote(engine).startTick, 40);
});

test('first strength-zero quantize captures an undoable reference, while dry run does not store it', () => {
  const engine = fixture(); const before = engine.checkpoint();
  const dry = quantize(engine, { strength: 0 }, { dryRun: true });
  assert.equal(dry.status, 'validated'); assert.deepEqual(dry.changes.quantize.capturedReferenceNoteIds, ['n']);
  assert.deepEqual(engine.checkpoint(), before);
  ok(quantize(engine, { strength: 0 }));
  assert.deepEqual(timing(getNote(engine)), timing(before.project.clips[0].notes[0]));
  assert.deepEqual(getNote(engine).quantizeReference, { startTick: 40, durationTicks: 30 });
  assert.equal(engine.project.revision, before.project.revision + 1);
  ok(run(engine, 'history.undo', {})); assert.equal(getNote(engine).quantizeReference, undefined);
  ok(run(engine, 'history.redo', {})); assert.deepEqual(getNote(engine).quantizeReference, { startTick: 40, durationTicks: 30 });
});

test('Reset restores start and duration but preserves unrelated pitch, velocity and channel edits', () => {
  const engine = fixture([note('n', 60, 90)]);
  ok(quantize(engine, { basis: 'original' })); assert.equal(getNote(engine).startTick, 100);
  ok(quantize(engine, { target: 'end', basis: 'original' })); assert.equal(getNote(engine).durationTicks, 100);
  ok(quantize(engine, { target: 'length', gridTicks: 64, basis: 'original' })); assert.equal(getNote(engine).durationTicks, 64);
  ok(run(engine, 'midi.notes.update', { clipId: 'clip', noteId: 'n', pitch: 72, velocity: 110, channel: 2 }));
  ok(reset(engine));
  assert.deepEqual(timing(getNote(engine)), { startTick: 60, durationTicks: 90 });
  assert.equal(getNote(engine).pitch, 72); assert.equal(getNote(engine).velocity, 110); assert.equal(getNote(engine).channel, 2);
  ok(run(engine, 'history.undo', {})); assert.equal(getNote(engine).durationTicks, 64); assert.equal(getNote(engine).pitch, 72);
});

test('Freeze adopts current start/end as the next original baseline and is itself undoable', () => {
  const engine = fixture();
  ok(quantize(engine, { basis: 'original' })); assert.equal(getNote(engine).startTick, 0);
  const beforeFreeze = engine.checkpoint();
  ok(freeze(engine)); assert.deepEqual(getNote(engine).quantizeReference, { startTick: 0, durationTicks: 30 });
  ok(run(engine, 'history.undo', {})); assert.deepEqual(getNote(engine), beforeFreeze.project.clips[0].notes[0]);
  ok(run(engine, 'history.redo', {})); assert.equal(getNote(engine).quantizeReference.startTick, 0);
  ok(quantize(engine, { gridTicks: 60, basis: 'original' })); assert.equal(getNote(engine).startTick, 0);
  ok(quantize(engine, { target: 'length', gridTicks: 100, basis: 'original' })); assert.equal(getNote(engine).durationTicks, 1);
  ok(reset(engine)); assert.deepEqual(timing(getNote(engine)), { startTick: 0, durationTicks: 30 });
});

test('selection scopes, missing references and empty lists are explicit and invalid IDs reject atomically', () => {
  const engine = fixture([note('a'), note('b', 70, 20)]);
  const initialReset = ok(reset(engine)); assert.deepEqual(initialReset.changes.resetQuantize.skippedNoteIds, ['a', 'b']);
  ok(quantize(engine, { noteIds: ['a'], basis: 'original' })); assert.equal(getNote(engine, 'a').startTick, 0); assert.equal(getNote(engine, 'b').quantizeReference, undefined);
  const before = engine.checkpoint();
  for (const command of ['midi.notes.resetQuantize', 'midi.notes.freezeQuantize']) {
    rejected(run(engine, command, { clipId: 'clip', noteIds: ['a', 'missing'] }), 'NOT_FOUND');
    rejected(run(engine, command, { clipId: 'clip', noteIds: ['a', 'a'] }), 'VALIDATION_ERROR');
  }
  assert.deepEqual(engine.checkpoint(), before);
  ok(freeze(engine, { noteIds: [] })); assert.equal(getNote(engine, 'a').quantizeReference.startTick, 40); assert.equal(getNote(engine, 'b').quantizeReference, undefined);
  ok(reset(engine, { noteIds: [] })); assert.equal(getNote(engine, 'a').startTick, 0);
  const result = ok(reset(engine)); assert.deepEqual(result.changes.resetQuantize.restoredNoteIds, ['a']); assert.deepEqual(result.changes.resetQuantize.skippedNoteIds, ['b']);
});

test('manual timing edits invalidate only changed notes; equal assignments and non-timing edits preserve reference', () => {
  const engine = fixture(); ok(quantize(engine));
  ok(run(engine, 'midi.notes.update', { clipId: 'clip', noteId: 'n', startTick: 0, durationTicks: 30, pitch: 61 }));
  assert.equal(getNote(engine).quantizeReference.startTick, 40);
  const result = ok(run(engine, 'midi.notes.update', { clipId: 'clip', noteId: 'n', startTick: 15 }));
  assert.deepEqual(result.changes.invalidatedQuantizeNoteIds, ['n']); assert.equal(getNote(engine).quantizeReference, undefined);
  const skipped = ok(reset(engine)); assert.equal(getNote(engine).startTick, 15); assert.deepEqual(skipped.changes.resetQuantize.skippedNoteIds, ['n']);
  ok(quantize(engine, { strength: 0 })); assert.equal(getNote(engine).quantizeReference.startTick, 15);
  ok(run(engine, 'midi.notes.update', { clipId: 'clip', noteId: 'n', durationTicks: 31 })); assert.equal(getNote(engine).quantizeReference, undefined);
  ok(run(engine, 'history.undo', {})); assert.deepEqual(getNote(engine).quantizeReference, { startTick: 15, durationTicks: 30 });
});

test('legato invalidates references only when note duration actually changes', () => {
  const engine = fixture([note('a', 0, 10), note('b', 50, 50)], 100);
  ok(freeze(engine));
  const result = ok(run(engine, 'midi.notes.legato', { clipId: 'clip' }));
  assert.deepEqual(result.changes.legato.invalidatedQuantizeNoteIds, ['a']);
  assert.equal(getNote(engine, 'a').quantizeReference, undefined); assert.equal(getNote(engine, 'b').quantizeReference.durationTicks, 50);
  ok(reset(engine)); assert.equal(getNote(engine, 'a').durationTicks, 50);
});

test('clip shortening explicitly invalidates out-of-range references, preserves fitting ones and undoes cleanly', () => {
  const engine = fixture([note('late', 250, 40), note('early', 20, 10)], 300);
  ok(freeze(engine)); ok(quantize(engine, { noteIds: ['late'], gridTicks: 200 })); assert.equal(getNote(engine, 'late').startTick, 200);
  const beforeTrim = engine.checkpoint();
  const result = ok(run(engine, 'clip.update', { clipId: 'clip', lengthTicks: 240 }));
  assert.deepEqual(result.changes.invalidatedQuantizeNoteIds, ['late']);
  assert.equal(getNote(engine, 'late').quantizeReference, undefined); assert.ok(getNote(engine, 'early').quantizeReference);
  ok(run(engine, 'history.undo', {})); assert.deepEqual(engine.project.clips, beforeTrim.project.clips);
  const beforeFailure = engine.checkpoint();
  rejected(run(engine, 'clip.update', { clipId: 'clip', lengthTicks: 210 }), 'NOTE_OUT_OF_BOUNDS'); assert.deepEqual(engine.checkpoint(), beforeFailure);
});

test('split translates contained right references and invalidates crossing or wrong-part baselines', () => {
  const ref = (startTick, durationTicks) => ({ quantizeReference: { startTick, durationTicks } });
  const engine = fixture([
    note('left', 50, 20, ref(60, 20)), note('right', 250, 30, ref(270, 20)),
    note('wrong-side', 230, 20, ref(180, 20)), note('crossing', 180, 40, ref(170, 60)),
    note('outside-left', 150, 20, ref(190, 30)),
  ], 400);
  const before = engine.checkpoint();
  const split = ok(run(engine, 'clip.split', { clipId: 'clip', atTick: 400 }));
  const rightId = split.changes.split.rightClipId;
  assert.deepEqual(getNote(engine, 'left').quantizeReference, { startTick: 60, durationTicks: 20 });
  assert.deepEqual(getNote(engine, 'right', rightId).quantizeReference, { startTick: 70, durationTicks: 20 });
  assert.equal(getNote(engine, 'wrong-side', rightId).quantizeReference, undefined);
  assert.equal(getNote(engine, 'crossing').quantizeReference, undefined); assert.equal(getNote(engine, 'outside-left').quantizeReference, undefined);
  assert.ok(engine.project.clips.find(c => c.id === rightId).notes.filter(n => n.id !== 'right').every(n => !n.quantizeReference));
  assert.deepEqual(split.changes.split.translatedQuantizeNoteIds, ['right']); assert.equal(split.changes.split.invalidatedQuantizeNoteIds.length, 4);
  ok(run(engine, 'midi.notes.resetQuantize', { clipId: rightId })); assert.equal(getNote(engine, 'right', rightId).startTick, 70);
  ok(run(engine, 'history.undo', {})); ok(run(engine, 'history.undo', {})); assert.deepEqual(engine.project.clips, before.project.clips);
});

test('clip movement and independent clip/track duplication preserve local references without aliasing', () => {
  const engine = fixture(); ok(quantize(engine, { basis: 'original' }));
  ok(run(engine, 'clip.move', { clipId: 'clip', trackId: 'target', startTick: 5000 })); assert.equal(getNote(engine).quantizeReference.startTick, 40);
  ok(run(engine, 'clip.update', { clipId: 'clip', startTick: 6000 })); assert.equal(getNote(engine).quantizeReference.startTick, 40);
  const duplicated = ok(run(engine, 'clip.duplicate', { clipId: 'clip' }));
  const copy = engine.project.clips.find(c => c.id === duplicated.changes.created[0]);
  assert.deepEqual(copy.notes[0].quantizeReference, { startTick: 40, durationTicks: 30 });
  ok(run(engine, 'midi.notes.freezeQuantize', { clipId: copy.id })); assert.equal(getNote(engine, copy.notes[0].id, copy.id).quantizeReference.startTick, 0); assert.equal(getNote(engine).quantizeReference.startTick, 40);
  ok(run(engine, 'track.duplicate', { trackId: 'target', newTrackId: 'track-copy' }));
  const copiedOriginal = engine.project.clips.find(c => c.trackId === 'track-copy' && c.startTick === 6000);
  assert.deepEqual(copiedOriginal.notes[0].quantizeReference, { startTick: 40, durationTicks: 30 });
  ok(run(engine, 'midi.notes.resetQuantize', { clipId: copiedOriginal.id })); assert.equal(getNote(engine).startTick, 0);
});

test('reference data persists through project and history JSON round trips', () => {
  const engine = fixture(); ok(quantize(engine, { basis: 'original' })); ok(freeze(engine)); ok(run(engine, 'history.undo', {}));
  const checkpoint = JSON.parse(JSON.stringify(engine.checkpoint()));
  const restored = new Engine(checkpoint.project); restored.restoreHistory(checkpoint.history);
  assert.deepEqual(restored.checkpoint(), checkpoint);
  ok(reset(restored)); assert.equal(getNote(restored).startTick, 40);
  const referenceCopy = restored.project; referenceCopy.clips[0].notes[0].quantizeReference.startTick = 999;
  assert.equal(getNote(restored).quantizeReference.startTick, 40);
});

test('invalid persisted or supplied reference shape and clip bounds are rejected without mutation', () => {
  const engine = fixture(); const before = engine.checkpoint();
  for (const quantizeReference of [{ startTick: -1, durationTicks: 1 }, { startTick: 0, durationTicks: -1 }, { startTick: 0.5, durationTicks: 1 }, { startTick: 0, durationTicks: Infinity }, { startTick: 0, durationTicks: 1, extra: 2 }]) {
    const project = engine.project; project.clips[0].notes[0].quantizeReference = quantizeReference;
    assert.throws(() => validateProject(project), error => error instanceof EngineError && error.code === 'VALIDATION_ERROR');
  }
  const outside = engine.project; outside.clips[0].notes[0].quantizeReference = { startTick: 990, durationTicks: 11 };
  assert.throws(() => new Engine(outside), error => error.code === 'QUANTIZE_REFERENCE_OUT_OF_BOUNDS');
  rejected(run(engine, 'midi.notes.add', { clipId: 'clip', notes: [note('invalid', 0, 1, { quantizeReference: { startTick: 1000, durationTicks: 1 } })] }), 'QUANTIZE_REFERENCE_OUT_OF_BOUNDS');
  rejected(quantize(engine, { basis: 'unknown' }), 'VALIDATION_ERROR');
  assert.deepEqual(engine.checkpoint(), before);
});

test('reference capture, Freeze and Reset participate in atomic batch rollback and revision conflicts', () => {
  const engine = fixture(); const before = engine.checkpoint();
  const commands = [
    { command: 'midi.notes.quantize', arguments: { clipId: 'clip', gridTicks: 100, basis: 'original' } },
    { command: 'midi.notes.freezeQuantize', arguments: { clipId: 'clip' } },
    { command: 'midi.notes.transpose', arguments: { clipId: 'clip', semitones: 127 } },
  ];
  rejected(run(engine, 'batch', { commands }), 'PITCH_OUT_OF_RANGE'); assert.deepEqual(engine.checkpoint(), before);
  commands[2] = { command: 'midi.notes.resetQuantize', arguments: { clipId: 'clip' } };
  assert.equal(run(engine, 'batch', { commands }, { dryRun: true }).status, 'validated'); assert.deepEqual(engine.checkpoint(), before);
  ok(run(engine, 'batch', { commands }, { expectedRevision: before.project.revision }));
  assert.equal(engine.project.revision, before.project.revision + 1); assert.equal(getNote(engine).quantizeReference.startTick, 0);
  rejected(reset(engine, {}, { expectedRevision: before.project.revision }), 'REVISION_CONFLICT');
  const beforeDryFreeze = engine.checkpoint(); assert.equal(freeze(engine, {}, { dryRun: true }).status, 'validated'); assert.deepEqual(engine.checkpoint(), beforeDryFreeze);
  ok(run(engine, 'history.undo', {})); assert.deepEqual(engine.project.clips, before.project.clips);
});

test('original timing references remain valid when quantize clamps against clip boundaries', () => {
  const engine = fixture([note('n', 70, 30)], 100);
  ok(quantize(engine, { gridTicks: 60, target: 'length', basis: 'original' })); assert.equal(getNote(engine).durationTicks, 30);
  ok(quantize(engine, { gridTicks: 100, target: 'start', basis: 'original' })); assert.equal(getNote(engine).startTick, 70);
  ok(quantize(engine, { gridTicks: 20, target: 'length', basis: 'original', strength: 0 })); assert.equal(getNote(engine).durationTicks, 30);
  assert.deepEqual(getNote(engine).quantizeReference, { startTick: 70, durationTicks: 30 });
  ok(reset(engine)); assert.deepEqual(timing(getNote(engine)), { startTick: 70, durationTicks: 30 });
  assert.equal(validateProject(engine.project), true);
});
