import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine, EngineError, createProject, validateProject, getCommandCatalog } from '../src/core/engine.mjs';

const note = (overrides = {}) => ({ id: 'note-one', pitch: 60, startTick: 0, durationTicks: 480, velocity: 96, ...overrides });
const command = (engine, name, args = {}, extra = {}) => engine.execute({ command: name, arguments: args, ...extra });
const applied = response => { assert.equal(response.status, 'applied', JSON.stringify(response.errors)); assert.equal(response.applied, true); assert.deepEqual(response.errors, []); return response; };
const rejected = (response, code) => { assert.equal(response.status, 'error'); assert.equal(response.applied, false); assert.equal(response.errors[0].code, code, JSON.stringify(response)); assert.deepEqual(response.changes, {}); return response; };
const seed = () => {
  const engine = new Engine(createProject({ name: 'Test Session' }));
  applied(command(engine, 'batch', { commands: [
    { command: 'track.add', arguments: { id: 'track-one', type: 'midi', name: 'Keys' } },
    { command: 'clip.add', arguments: { id: 'clip-one', trackId: 'track-one', type: 'midi', notes: [note()] } },
  ] }));
  return engine;
};
const asset = (overrides = {}) => ({ id: 'asset-one', name: 'audio.wav', path: `assets/${'a'.repeat(64)}.wav`, sha256: 'a'.repeat(64), sampleRate: 24000, channels: 2, frames: 24000, ...overrides });

test('project defaults, validation and copy boundaries', () => {
  const source = createProject();
  assert.equal(validateProject(source), true);
  assert.equal(source.ppq, 960); assert.equal(source.sampleRate, 48000); assert.equal(source.revision, 0);
  const engine = new Engine(source);
  source.name = 'mutated externally'; source.tempoMap[0].bpm = 99;
  const fetched = engine.project; fetched.name = 'also changed'; fetched.tempoMap[0].bpm = 42;
  assert.equal(engine.project.name, 'Untitled'); assert.equal(engine.project.tempoMap[0].bpm, 120);
  assert.notEqual(createProject().id, createProject().id);
  assert.throws(() => createProject({ sampleRate: NaN }), error => error instanceof EngineError && error.code === 'VALIDATION_ERROR');
  assert.throws(() => new Engine({}), EngineError);
});

test('command catalog is serializable, complete, detached and actually enforced', () => {
  const catalog = getCommandCatalog();
  assert.ok(catalog.length >= 16);
  assert.equal(new Set(catalog.map(entry => entry.command)).size, catalog.length);
  for(const required of ['project.rename','track.add','clip.add','midi.notes.add','batch','history.undo','history.redo'])assert.ok(catalog.some(entry=>entry.command===required));
  assert.doesNotThrow(() => JSON.stringify(catalog));
  const update = catalog.find(entry => entry.command === 'track.update');
  assert.equal(update.schema.properties.pan.maximum, 1);
  update.schema.properties.pan.maximum = 100;
  assert.equal(getCommandCatalog().find(entry => entry.command === 'track.update').schema.properties.pan.maximum, 1);
  const engine = seed();
  rejected(command(engine, 'track.update', { trackId: 'track-one', pan: 2 }), 'VALIDATION_ERROR');
});

test('invalid envelopes, unknown keys, nonfinite and untyped values leave state and history unchanged', () => {
  const engine = seed(); const before = engine.checkpoint();
  const invalid = [null, [], {}, { command: 'project.rename' }, { command: 'project.rename', arguments: { name: 'Fine', typo: 2 } },
    { command: 'project.rename', arguments: { name: '   ' } },
    { command: 'project.settings', arguments: { sampleRate: 44100 } },
    { command: 'track.update', arguments: { trackId: 'track-one', pan: Infinity } },
    { command: 'track.update', arguments: { trackId: 'track-one', mute: 1 } },
    { command: 'project.rename', arguments: { name: 'x' }, expectedRevision: '1' },
    { command: 'project.rename', arguments: { name: 'x' }, dryRun: 'true' },
    JSON.parse('{"command":"project.rename","arguments":{"name":"x","__proto__":{}}}'),
    JSON.parse('{"command":"project.rename","arguments":{"name":"x","constructor":1}}'),
  ];
  for (const input of invalid) { assert.doesNotThrow(() => engine.execute(input)); rejected(engine.execute(input), 'VALIDATION_ERROR'); assert.deepEqual(engine.checkpoint(), before); }
  rejected(command(engine, 'does.not.exist'), 'UNKNOWN_COMMAND');
  rejected(command(engine, 'project.settings'), 'EMPTY_UPDATE');
  rejected(command(engine, 'track.update', { trackId: 'track-one' }), 'EMPTY_UPDATE');
  assert.deepEqual(engine.checkpoint(), before);
});

test('expectedRevision rejects stale mutations and dry runs without altering state', () => {
  const engine = seed();
  const before = engine.checkpoint();
  for (const dryRun of [false, true]) {
    const result = rejected(command(engine, 'project.rename', { name: 'Conflict' }, { expectedRevision: 0, requestId: 'request-stale', dryRun }), 'REVISION_CONFLICT');
    assert.equal(result.requestId, 'request-stale'); assert.equal(result.projectRevision, 1);
    assert.deepEqual(result.errors[0].details, { expectedRevision: 0, actualRevision: 1 });
    assert.deepEqual(engine.checkpoint(), before);
  }
  const result = applied(command(engine, 'project.rename', { name: 'Current' }, { expectedRevision: 1, requestId: 'request-current' }));
  assert.equal(result.projectRevision, 2); assert.equal(result.requestId, 'request-current');
});

test('dry run reports resolved changes but never commits or clears redo history', () => {
  const engine = seed();
  applied(command(engine, 'project.rename', { name: 'Next' }));
  applied(command(engine, 'history.undo'));
  const before = engine.checkpoint();
  const result = command(engine, 'midi.notes.add', { clipId: 'clip-one', notes: [note({ id: 'note-dry', startTick: 480 })] }, { dryRun: true });
  assert.equal(result.status, 'validated'); assert.equal(result.applied, false); assert.equal(result.projectRevision, 3);
  assert.deepEqual(result.resolvedTargets, ['clip-one', 'note-dry']); assert.deepEqual(result.changes.created, ['note-dry']);
  assert.deepEqual(engine.checkpoint(), before); assert.equal(engine.canRedo, true);
  const redo = command(engine, 'history.redo', {}, { dryRun: true });
  assert.equal(redo.status, 'validated'); assert.deepEqual(engine.checkpoint(), before);
  rejected(command(engine, 'midi.notes.add', { clipId: 'clip-one', notes: [note({ id: 'bad', startTick: 3800 })] }, { dryRun: true }), 'NOTE_OUT_OF_BOUNDS');
  assert.deepEqual(engine.checkpoint(), before);
});

test('valid batch is one revision and one undo step, supports references created earlier in batch', () => {
  const engine = seed();
  assert.equal(engine.project.revision, 1); assert.equal(engine.project.tracks.length, 1); assert.equal(engine.project.clips.length, 1);
  assert.equal(engine.exportHistory().entries.length, 1);
  applied(command(engine, 'history.undo')); assert.equal(engine.project.revision, 2); assert.equal(engine.project.tracks.length, 0);
  applied(command(engine, 'history.redo')); assert.equal(engine.project.revision, 3);
  assert.equal(engine.project.clips[0].notes[0].id, 'note-one');
});

test('batch failures roll back earlier mutations, IDs and history, identifying failing index', () => {
  const engine = seed(); const before = engine.checkpoint();
  const result = rejected(command(engine, 'batch', { commands: [
    { command: 'track.add', arguments: { id: 'new-track', type: 'midi' } },
    { command: 'midi.notes.add', arguments: { clipId: 'clip-one', notes: [note({ id: 'new-note', startTick: 3840 })] } },
  ] }), 'NOTE_OUT_OF_BOUNDS');
  assert.equal(result.errors[0].details.batchIndex, 1); assert.deepEqual(engine.checkpoint(), before);
  for (const forbidden of ['batch', 'history.undo', 'history.redo']) {
    rejected(command(engine, 'batch', { commands: [{ command: forbidden, arguments: {} }] }), 'INVALID_BATCH_COMMAND');
    assert.deepEqual(engine.checkpoint(), before);
  }
  rejected(command(engine, 'batch', { commands: [] }), 'VALIDATION_ERROR');
  const unknown = rejected(command(engine, 'batch', { commands: [{ command: 'project.rename', arguments: { name: 'No' } }, { command: 'unknown', arguments: {} }] }), 'UNKNOWN_COMMAND');
  assert.equal(unknown.errors[0].details.batchIndex, 1); assert.deepEqual(engine.checkpoint(), before);
});

test('undo/redo monotonic revisions, branch invalidation and explicit empty-history failures', () => {
  const engine = new Engine();
  rejected(command(engine, 'history.undo'), 'NOTHING_TO_UNDO'); rejected(command(engine, 'history.redo'), 'NOTHING_TO_REDO');
  applied(command(engine, 'project.rename', { name: 'First' }));
  applied(command(engine, 'project.rename', { name: 'Second' }));
  applied(command(engine, 'history.undo')); assert.equal(engine.project.name, 'First'); assert.equal(engine.project.revision, 3);
  applied(command(engine, 'history.undo')); assert.equal(engine.project.name, 'Untitled'); assert.equal(engine.project.revision, 4);
  applied(command(engine, 'history.redo')); assert.equal(engine.project.name, 'First'); assert.equal(engine.project.revision, 5);
  applied(command(engine, 'project.rename', { name: 'Branch' })); assert.equal(engine.project.revision, 6);
  assert.deepEqual(engine.history, { canUndo: true, canRedo: false }); rejected(command(engine, 'history.redo'), 'NOTHING_TO_REDO');
});

test('checkpoint rollback restores project, undo and redo after a persistence failure', () => {
  const engine = seed();
  applied(command(engine, 'project.rename', { name: 'To undo' })); applied(command(engine, 'history.undo'));
  const checkpoint = engine.checkpoint();
  applied(command(engine, 'track.remove', { trackId: 'track-one' }));
  assert.equal(engine.canRedo, false);
  engine.restoreCheckpoint(checkpoint);
  assert.deepEqual(engine.checkpoint(), checkpoint);
  checkpoint.project.name = 'tampered caller copy'; checkpoint.history.snapshots[checkpoint.history.cursor + 1].name = 'also tampered';
  assert.equal(engine.project.name, 'Test Session');
  applied(command(engine, 'history.redo')); assert.equal(engine.project.name, 'To undo'); assert.equal(engine.project.revision, 4);
});

test('history can be serialized and restored, incompatible restore is rejected atomically', () => {
  const original = seed(); applied(command(original, 'project.rename', { name: 'Saved' })); applied(command(original, 'history.undo'));
  const restored = new Engine(JSON.parse(JSON.stringify(original.project)));
  restored.restoreHistory(JSON.parse(JSON.stringify(original.exportHistory())));
  assert.deepEqual(restored.checkpoint(), original.checkpoint());
  const before = restored.checkpoint();
  const brokenHistory = restored.exportHistory(); brokenHistory.projectRevision++;
  assert.throws(() => restored.restoreHistory(brokenHistory), EngineError); assert.deepEqual(restored.checkpoint(), before);
  const brokenCheckpoint = restored.checkpoint(); brokenCheckpoint.history.snapshots[0].sampleRate = 44100;
  assert.throws(() => restored.restoreCheckpoint(brokenCheckpoint), error => error.code === 'INVALID_HISTORY'); assert.deepEqual(restored.checkpoint(), before);
  const brokenProject = restored.checkpoint(); brokenProject.project.clips[0].notes[0].durationTicks = 999999;
  assert.throws(() => restored.restoreCheckpoint(brokenProject), error => error.code === 'NOTE_OUT_OF_BOUNDS'); assert.deepEqual(restored.checkpoint(), before);
  applied(command(restored, 'history.redo')); assert.equal(restored.project.name, 'Saved');
});

test('stable IDs survive edits, duplicate names and reorder-independent targeting', () => {
  const engine = seed();
  applied(command(engine, 'track.add', { id: 'track-two', name: 'Keys', type: 'midi' }));
  applied(command(engine, 'track.update', { trackId: 'track-one', name: 'Renamed', gainDb: -12, pan: -1, mute: true, solo: true, instrument: 'triangle', color: '#AABBCC' }));
  assert.equal(engine.project.tracks[1].name, 'Keys'); assert.equal(engine.project.tracks[0].id, 'track-one');
  applied(command(engine, 'midi.notes.update', { clipId: 'clip-one', noteId: 'note-one', pitch: 127, velocity: 1, channel: 15, startTick: 3360 }));
  assert.equal(engine.project.clips[0].notes[0].id, 'note-one'); assert.equal(engine.project.clips[0].notes[0].pitch, 127);
  const before = engine.checkpoint();
  for (const id of [engine.project.id, 'track-one', 'clip-one', 'note-one']) {
    rejected(command(engine, 'track.add', { id, type: 'midi' }), 'DUPLICATE_ID'); assert.deepEqual(engine.checkpoint(), before);
  }
  applied(command(engine, 'midi.notes.remove', { clipId: 'clip-one', noteIds: ['note-one'] }));
  rejected(command(engine, 'midi.notes.update', { clipId: 'clip-one', noteId: 'note-one', pitch: 60 }), 'NOT_FOUND');
});

test('MIDI boundary, numeric type and media type validation never partially edits notes', () => {
  const engine = seed(); const before = engine.checkpoint();
  for (const patch of [{ pitch: 128 }, { pitch: 2.5 }, { velocity: 0 }, { channel: 16 }, { durationTicks: -1 }, { startTick: -1 }, { startTick: NaN }]) {
    rejected(command(engine, 'midi.notes.update', { clipId: 'clip-one', noteId: 'note-one', ...patch }), 'VALIDATION_ERROR');
    assert.deepEqual(engine.checkpoint(), before);
  }
  rejected(command(engine, 'clip.update', { clipId: 'clip-one', lengthTicks: 100 }), 'NOTE_OUT_OF_BOUNDS');
  rejected(command(engine, 'clip.update', { clipId: 'clip-one', startSample: 0 }), 'TYPE_MISMATCH');
  rejected(command(engine, 'midi.notes.remove', { clipId: 'clip-one', noteIds: ['note-one', 'missing'] }), 'NOT_FOUND');
  rejected(command(engine, 'midi.notes.remove', { clipId: 'clip-one', noteIds: ['note-one', 'note-one'] }), 'VALIDATION_ERROR');
  rejected(command(engine, 'midi.notes.add', { clipId: 'clip-one', notes: [note({ id: 'would-fit' }), note({ id: 'overflow', startTick: 3840 })] }), 'NOTE_OUT_OF_BOUNDS');
  assert.deepEqual(engine.checkpoint(), before);
});

test('tempo, gain and safe-integer limits validate full replacement atomically', () => {
  const engine = seed();
  applied(command(engine, 'tempo.set', { tempoMap: [{ tick: 0, bpm: 20 }, { tick: 960, bpm: 300 }] }));
  applied(command(engine, 'project.settings', { masterGainDb: 12 }));
  const before = engine.checkpoint();
  for (const tempoMap of [[{ tick: 1, bpm: 120 }], [{ tick: 0, bpm: 120 }, { tick: 0, bpm: 99 }], [{ tick: 0, bpm: 120 }, { tick: 960, bpm: 100 }, { tick: 480, bpm: 120 }]]) {
    rejected(command(engine, 'tempo.set', { tempoMap }), 'INVALID_TEMPO_MAP'); assert.deepEqual(engine.checkpoint(), before);
  }
  rejected(command(engine, 'tempo.set', { tempoMap: [] }), 'VALIDATION_ERROR');
  rejected(command(engine, 'tempo.set', { tempoMap: [{ tick: 0, bpm: 301 }] }), 'VALIDATION_ERROR');
  rejected(command(engine, 'project.settings', { masterGainDb: -61 }), 'VALIDATION_ERROR');
  rejected(command(engine, 'clip.update', { clipId: 'clip-one', startTick: Number.MAX_SAFE_INTEGER }), 'TIME_OVERFLOW');
  assert.deepEqual(engine.checkpoint(), before);
});

test('audio assets enforce content addresses, reference types and source-rate trim bounds', () => {
  const engine = new Engine(createProject({ sampleRate: 48000 }));
  applied(command(engine, 'batch', { commands: [
    { command: 'asset.add', arguments: { asset: asset() } },
    { command: 'track.add', arguments: { id: 'audio-track', type: 'audio' } },
    { command: 'clip.add', arguments: { id: 'audio-clip', type: 'audio', trackId: 'audio-track', assetId: 'asset-one', startSample: 48000, offsetFrames: 12000, lengthFrames: 12000 } },
  ] }));
  assert.equal(engine.project.clips[0].offsetFrames, 12000); assert.equal(engine.project.clips[0].gainDb, 0);
  const before = engine.checkpoint();
  rejected(command(engine, 'clip.update', { clipId: 'audio-clip', lengthFrames: 12001 }), 'AUDIO_OUT_OF_BOUNDS');
  rejected(command(engine, 'clip.update', { clipId: 'audio-clip', startTick: 0 }), 'TYPE_MISMATCH');
  rejected(command(engine, 'midi.notes.add', { clipId: 'audio-clip', notes: [note()] }), 'TYPE_MISMATCH');
  rejected(command(engine, 'track.update', { trackId: 'audio-track', instrument: 'sine' }), 'TYPE_MISMATCH');
  rejected(command(engine, 'asset.add', { asset: asset({ id: 'asset-two', path: `assets/${'b'.repeat(64)}.wav` }) }), 'INVALID_ASSET_PATH');
  rejected(command(engine, 'asset.add', { asset: asset({ id: 'asset-two', path: '../secret.wav' }) }), 'VALIDATION_ERROR');
  rejected(command(engine, 'clip.add', { type: 'audio', trackId: 'audio-track', assetId: 'missing', startSample: 0, offsetFrames: 0, lengthFrames: 1 }), 'NOT_FOUND');
  rejected(command(engine, 'clip.add', { type: 'midi', trackId: 'audio-track' }), 'TYPE_MISMATCH');
  assert.deepEqual(engine.checkpoint(), before);
  applied(command(engine, 'clip.update', { clipId: 'audio-clip', offsetFrames: 0, lengthFrames: 24000, gainDb: -3 }));
  applied(command(engine, 'track.remove', { trackId: 'audio-track' }));
  assert.equal(engine.project.clips.length, 0); assert.equal(engine.project.assets.length, 1);
  applied(command(engine, 'history.undo')); assert.equal(engine.project.clips[0].id, 'audio-clip');
});

test('remove cascade and caller-owned command arrays cannot mutate committed state', () => {
  const engine = seed();
  const args = { clipId: 'clip-one', notes: [note({ id: 'note-two', startTick: 480 })] };
  const result = applied(command(engine, 'midi.notes.add', args));
  args.notes[0].pitch = 1; result.changes.created.push('fake');
  assert.equal(engine.project.clips[0].notes[1].pitch, 60);
  const removed = applied(command(engine, 'track.remove', { trackId: 'track-one' }));
  assert.deepEqual(removed.changes.removed, ['track-one', 'clip-one', 'note-one', 'note-two']);
  assert.equal(engine.project.clips.length, 0);
  applied(command(engine, 'history.undo')); assert.equal(engine.project.clips[0].notes.length, 2);
  applied(command(engine, 'clip.remove', { clipId: 'clip-one' })); assert.equal(engine.project.tracks.length, 1);
});

test('revision overflow is reported without corrupting project or history', () => {
  const project = createProject(); project.revision = Number.MAX_SAFE_INTEGER;
  const engine = new Engine(project); const before = engine.checkpoint();
  rejected(command(engine, 'project.rename', { name: 'Overflow' }), 'REVISION_OVERFLOW');
  assert.deepEqual(engine.checkpoint(), before);
});

test('large legal MIDI import and cascade do not exceed JavaScript function argument limits', () => {
  const engine = new Engine();
  const count = 130000;
  applied(command(engine, 'track.add', { id: 'large-track', type: 'midi' }));
  applied(command(engine, 'clip.add', { id: 'large-clip', trackId: 'large-track', type: 'midi', lengthTicks: count }));
  const notes = Array.from({ length: count }, (_, index) => note({ id: `large-note-${index}`, startTick: index, durationTicks: 1 }));
  const added = applied(command(engine, 'midi.notes.add', { clipId: 'large-clip', notes }));
  assert.equal(added.changes.created.length, count);
  const removed = applied(command(engine, 'track.remove', { trackId: 'large-track' }));
  assert.equal(removed.changes.removed.length, count + 2);
  assert.equal(engine.project.clips.length, 0);
});
