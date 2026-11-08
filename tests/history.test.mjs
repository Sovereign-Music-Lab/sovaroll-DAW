import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine, EngineError, createProject, getCommandCatalog } from '../src/core/engine.mjs';

const run = (engine, command, args = {}, extra = {}) => engine.execute({ command, arguments: args, ...extra });
const ok = response => { assert.equal(response.status, 'applied', JSON.stringify(response.errors)); return response; };
const rejected = (response, code) => { assert.equal(response.status, 'error'); assert.equal(response.errors[0].code, code, JSON.stringify(response)); return response; };
const rename = (engine, name) => ok(run(engine, 'project.rename', { name }));
function sequence(count = 4) { const engine = new Engine(createProject({ name: 'Base' })); for (let i = 1; i <= count; i++) rename(engine, `Edit ${i}`); return engine; }

test('history view exposes detached action/time/state/details metadata without project snapshots', () => {
  const engine = new Engine();
  assert.deepEqual(engine.history, { canUndo: false, canRedo: false });
  const initial = engine.historyView;
  assert.equal(initial.cursor, 0); assert.equal(initial.maxSteps, 100); assert.deepEqual(initial.entries, []);
  assert.equal(initial.baseBoundaryId, initial.currentBoundaryId);
  rename(engine, 'A');
  const view = engine.historyView, entry = view.entries[0];
  assert.equal(entry.action, 'project.rename'); assert.equal(entry.label, 'Rename project'); assert.equal(entry.revision, 1);
  assert.equal(entry.state, 'applied'); assert.equal(entry.index, 0); assert.equal(entry.description, '');
  assert.equal(new Date(entry.time).toISOString(), entry.time); assert.deepEqual(entry.summary, { created: 0, updated: 1, removed: 0, targets: 1, commands: ['project.rename'] });
  assert.match(entry.details, /1 updated/); assert.equal(view.snapshots, undefined); assert.equal(view.entries[0].project, undefined);
  entry.description = 'outside mutation'; entry.summary.commands.push('fake'); view.cursor = 0;
  assert.equal(engine.historyView.entries[0].description, ''); assert.deepEqual(engine.historyView.entries[0].summary.commands, ['project.rename']);
  assert.equal(engine.historyView.cursor, 1);
  assert.ok(getCommandCatalog().some(c => c.command === 'history.goTo'));
});

test('a batch is one history entry with bounded changes summary and one boundary', () => {
  const engine = new Engine();
  ok(run(engine, 'batch', { commands: [
    { command: 'track.add', arguments: { id: 't', type: 'midi' } },
    { command: 'clip.add', arguments: { id: 'c', trackId: 't', type: 'midi', notes: [{ id: 'n', pitch: 60, startTick: 0, durationTicks: 100, velocity: 80 }] } },
  ] }));
  const history = engine.historyView;
  assert.equal(history.entries.length, 1); assert.equal(history.cursor, 1);
  assert.equal(history.entries[0].action, 'batch'); assert.equal(history.entries[0].label, 'Batch (2 commands)');
  assert.deepEqual(history.entries[0].summary.commands, ['track.add', 'clip.add']); assert.equal(history.entries[0].summary.created, 3);
  ok(run(engine, 'history.goTo', { index: 0 })); assert.equal(engine.project.tracks.length, 0);
  ok(run(engine, 'history.goTo', { boundaryId: history.entries[0].boundaryId })); assert.equal(engine.project.clips[0].notes[0].id, 'n');
  assert.equal(engine.historyView.entries.length, 1);
});

test('history jumps atomically by index and stable boundary while revisions stay monotonic', () => {
  const engine = sequence(); const entries = engine.historyView.entries;
  const jump = ok(run(engine, 'history.goTo', { index: 1 }));
  assert.equal(jump.projectRevision, 5); assert.equal(jump.changes.steps, 3); assert.equal(engine.project.name, 'Edit 1');
  assert.deepEqual(engine.historyView.entries.map(e => e.state), ['applied', 'undone', 'undone', 'undone']);
  ok(run(engine, 'history.goTo', { boundaryId: entries[2].boundaryId })); assert.equal(engine.project.name, 'Edit 3'); assert.equal(engine.project.revision, 6);
  ok(run(engine, 'history.undo')); assert.equal(engine.project.name, 'Edit 2'); assert.equal(engine.project.revision, 7);
  ok(run(engine, 'history.redo')); assert.equal(engine.project.name, 'Edit 3'); assert.equal(engine.project.revision, 8);
  ok(run(engine, 'history.goTo', { index: 3 })); assert.equal(engine.project.revision, 9);
  assert.deepEqual(engine.historyView.entries.map(e => e.id), entries.map(e => e.id));
  ok(run(engine, 'history.goTo', { boundaryId: engine.historyView.baseBoundaryId })); assert.equal(engine.project.name, 'Base');
});

test('entry descriptions update revision without an edit step, survive navigation and can be cleared', () => {
  const engine = sequence(3); ok(run(engine, 'history.undo'));
  const before = engine.historyView, entryId = before.entries[1].id;
  ok(run(engine, 'history.describe', { entryId, description: '보컬 균형\n검토 완료' }));
  assert.equal(engine.project.revision, 5); assert.equal(engine.historyView.cursor, 2); assert.equal(engine.historyView.entries.length, 3); assert.equal(engine.canRedo, true);
  assert.equal(engine.historyView.entries[1].details, '보컬 균형\n검토 완료');
  ok(run(engine, 'history.goTo', { index: 0 })); assert.equal(engine.historyView.entries[1].description, '보컬 균형\n검토 완료');
  ok(run(engine, 'history.goTo', { index: 3 })); assert.equal(engine.historyView.entries[1].description, '보컬 균형\n검토 완료');
  ok(run(engine, 'history.describe', { entryId, description: '' })); assert.match(engine.historyView.entries[1].details, /updated/);
  assert.deepEqual(engine.historyView.entries.map(e => e.id), before.entries.map(e => e.id));
});

test('undo then edit truncates redo branch IDs without disturbing retained entry metadata', () => {
  const engine = sequence(4); const before = engine.historyView;
  ok(run(engine, 'history.describe', { entryId: before.entries[0].id, description: 'Keep this' }));
  ok(run(engine, 'history.goTo', { index: 1 })); rename(engine, 'Branch');
  const after = engine.historyView;
  assert.equal(after.entries.length, 2); assert.equal(after.cursor, 2); assert.equal(engine.canRedo, false);
  assert.equal(after.entries[0].id, before.entries[0].id); assert.equal(after.entries[0].description, 'Keep this');
  assert.notEqual(after.entries[1].id, before.entries[1].id);
  rejected(run(engine, 'history.goTo', { boundaryId: before.entries[3].boundaryId }), 'NOT_FOUND');
  rejected(run(engine, 'history.describe', { entryId: before.entries[2].id, description: 'Discarded' }), 'NOT_FOUND');
  ok(run(engine, 'history.undo')); assert.equal(engine.project.name, 'Edit 1');
});

test('default maximum retains the newest 100 steps and settings can grow or shrink it', () => {
  const engine = sequence(110); const view = engine.historyView;
  assert.equal(view.entries.length, 100); assert.equal(view.cursor, 100);
  ok(run(engine, 'history.goTo', { index: 0 })); assert.equal(engine.project.name, 'Edit 10'); rejected(run(engine, 'history.undo'), 'NOTHING_TO_UNDO');
  ok(run(engine, 'history.goTo', { index: 100 }));
  const previousBoundary = engine.historyView.currentBoundaryId;
  const result = ok(run(engine, 'history.settings', { maxSteps: 3 }));
  assert.equal(result.changes.droppedEntryIds.length, 97); assert.equal(engine.historyView.entries.length, 3); assert.equal(engine.historyView.cursor, 3);
  assert.equal(engine.historyView.currentBoundaryId, previousBoundary); assert.equal(engine.project.name, 'Edit 110');
  ok(run(engine, 'history.goTo', { index: 0 })); assert.equal(engine.project.name, 'Edit 107');
  ok(run(engine, 'history.settings', { maxSteps: 1000 })); assert.equal(engine.historyView.maxSteps, 1000); assert.equal(engine.historyView.entries.length, 3);
  const before = engine.checkpoint();
  for (const maxSteps of [0, -1, 1001, 1.5, NaN]) rejected(run(engine, 'history.settings', { maxSteps }), 'VALIDATION_ERROR');
  assert.deepEqual(engine.checkpoint(), before);
});

test('limit shrink preserves current boundary, dropping oldest applied then farthest redo states', () => {
  const engine = sequence(6); const initial = engine.historyView;
  ok(run(engine, 'history.goTo', { index: 2 }));
  const currentBoundary = engine.historyView.currentBoundaryId;
  const result = ok(run(engine, 'history.settings', { maxSteps: 1 }));
  assert.equal(engine.project.name, 'Edit 2'); assert.equal(engine.historyView.cursor, 0);
  assert.equal(engine.historyView.baseBoundaryId, currentBoundary); assert.equal(engine.historyView.entries[0].id, initial.entries[2].id);
  assert.deepEqual(result.changes.droppedEntryIds, [initial.entries[0].id, initial.entries[1].id, initial.entries[5].id, initial.entries[4].id, initial.entries[3].id]);
  ok(run(engine, 'history.redo')); assert.equal(engine.project.name, 'Edit 3'); assert.equal(engine.historyView.maxSteps, 1);
});

test('history dry runs, stale requests and invalid boundaries preserve the complete checkpoint', () => {
  const engine = sequence(3); const before = engine.checkpoint(), entryId = engine.historyView.entries[0].id;
  for (const [command, args] of [
    ['history.goTo', { index: 0 }], ['history.describe', { entryId, description: 'Preview' }], ['history.settings', { maxSteps: 1 }],
  ]) {
    assert.equal(run(engine, command, args, { dryRun: true }).status, 'validated'); assert.deepEqual(engine.checkpoint(), before);
    rejected(run(engine, command, args, { expectedRevision: 0 }), 'REVISION_CONFLICT'); assert.deepEqual(engine.checkpoint(), before);
  }
  rejected(run(engine, 'history.goTo', {}), 'VALIDATION_ERROR');
  rejected(run(engine, 'history.goTo', { index: 0, boundaryId: before.history.baseBoundaryId }), 'VALIDATION_ERROR');
  rejected(run(engine, 'history.goTo', { index: 4 }), 'INDEX_OUT_OF_BOUNDS');
  rejected(run(engine, 'history.goTo', { boundaryId: 'missing' }), 'NOT_FOUND');
  rejected(run(engine, 'history.describe', { entryId, description: 'x'.repeat(2049) }), 'VALIDATION_ERROR');
  for (const command of ['history.goTo', 'history.describe', 'history.settings']) rejected(run(engine, 'batch', { commands: [{ command, arguments: {} }] }), 'INVALID_BATCH_COMMAND');
  assert.deepEqual(engine.checkpoint(), before);
});

test('v2 exports omit exactly the current snapshot and restore full stable metadata and quantize references', () => {
  const engine = new Engine();
  ok(run(engine, 'batch', { commands: [
    { command: 'track.add', arguments: { id: 't', type: 'midi' } },
    { command: 'clip.add', arguments: { id: 'c', trackId: 't', type: 'midi', notes: [{ id: 'n', pitch: 60, startTick: 40, durationTicks: 100, velocity: 80 }] } },
  ] }));
  ok(run(engine, 'midi.notes.quantize', { clipId: 'c', gridTicks: 100, basis: 'original' }));
  rename(engine, 'Third'); ok(run(engine, 'history.undo'));
  ok(run(engine, 'history.describe', { entryId: engine.historyView.entries[1].id, description: 'Quantize baseline kept' }));
  const exported = engine.exportHistory();
  assert.equal(exported.schemaVersion, 2); assert.equal(exported.snapshots.length, exported.entries.length + 1);
  assert.equal(exported.snapshots[exported.cursor], null); assert.equal(exported.snapshots.filter(value => value === null).length, 1);
  const restored = new Engine(JSON.parse(JSON.stringify(engine.project)));
  assert.equal(restored.restoreHistory(JSON.parse(JSON.stringify(exported))).migrated, false);
  assert.deepEqual(restored.checkpoint(), engine.checkpoint());
  exported.entries[0].summary.commands.push('mutation'); exported.snapshots[0].name = 'outside';
  assert.notEqual(restored.historyView.entries[0].summary.commands.at(-1), 'mutation');
  ok(run(restored, 'midi.notes.resetQuantize', { clipId: 'c' })); assert.equal(restored.project.clips[0].notes[0].startTick, 40);
  const isolated = restored.exportHistory(); isolated.entries[0].description = 'not shared'; assert.notEqual(restored.historyView.entries[0].description, 'not shared');
});

test('legacy v1 undo/redo stacks migrate in chronological order with unknown times represented honestly', () => {
  const base = createProject({ name: 'Base' });
  const one = { ...structuredClone(base), name: 'One', revision: 1 }, two = { ...structuredClone(base), name: 'Two', revision: 2 }, three = { ...structuredClone(base), name: 'Three', revision: 3 };
  const current = { ...one, revision: 4 };
  const legacy = { schemaVersion: 1, projectId: current.id, projectRevision: 4, undo: [base], redo: [three, two] };
  const engine = new Engine(current); const result = engine.restoreHistory(legacy);
  assert.equal(result.migrated, true); assert.equal(engine.exportHistory().schemaVersion, 2); assert.equal(engine.historyView.cursor, 1);
  assert.equal(engine.historyView.entries.length, 3); assert.ok(engine.historyView.entries.every(entry => entry.time === null && entry.revision === null && entry.action === 'legacy'));
  ok(run(engine, 'history.redo')); assert.equal(engine.project.name, 'Two');
  ok(run(engine, 'history.redo')); assert.equal(engine.project.name, 'Three');
  ok(run(engine, 'history.goTo', { index: 0 })); assert.equal(engine.project.name, 'Base');
  const checkpoint = engine.checkpoint(); const next = new Engine(checkpoint.project); next.restoreCheckpoint(checkpoint);
  assert.deepEqual(next.checkpoint(), checkpoint);
});

test('invalid v2 histories reject atomically: count, IDs, time, revisions, placeholders and projects', () => {
  const engine = sequence(3); const before = engine.checkpoint();
  const mutations = [
    h => { h.cursor = 100; }, h => { h.maxSteps = 1; }, h => { h.snapshots.pop(); },
    h => { h.entries[1].id = h.entries[0].id; }, h => { h.entries[0].boundaryId = h.baseBoundaryId; },
    h => { h.entries[0].time = '2026-02-30T12:00:00.000Z'; }, h => { h.entries[0].revision = 999; },
    h => { h.entries[0].description = 'x'.repeat(2049); }, h => { h.entries[0].surprise = true; },
    h => { h.entries[0].summary.created = -1; }, h => { h.snapshots[h.cursor] = structuredClone(before.project); },
    h => { h.snapshots[0] = null; }, h => { h.snapshots[0].id = 'other'; }, h => { h.snapshots[0].sampleRate = 44100; },
    h => { h.projectRevision++; }, h => { h.snapshots[0].revision = 99; },
  ];
  for (const mutate of mutations) {
    const invalid = structuredClone(before.history); mutate(invalid);
    assert.throws(() => engine.restoreHistory(invalid), EngineError); assert.deepEqual(engine.checkpoint(), before);
    assert.throws(() => engine.restoreCheckpoint({ ...structuredClone(before), history: invalid }), EngineError); assert.deepEqual(engine.checkpoint(), before);
  }
});

test('checkpoint restores cursor, descriptions, settings and redo after a failed persistence transaction', () => {
  const engine = sequence(5); ok(run(engine, 'history.settings', { maxSteps: 3 })); ok(run(engine, 'history.undo'));
  ok(run(engine, 'history.describe', { entryId: engine.historyView.entries[1].id, description: 'Retain on rollback' }));
  const checkpoint = engine.checkpoint(); rename(engine, 'Unsaved branch'); assert.equal(engine.canRedo, false);
  engine.restoreCheckpoint(checkpoint); assert.deepEqual(engine.checkpoint(), checkpoint); assert.equal(engine.canRedo, true); assert.equal(engine.historyView.maxSteps, 3);
  ok(run(engine, 'history.redo')); assert.equal(engine.project.name, 'Edit 5'); assert.equal(engine.historyView.entries[1].description, 'Retain on rollback');
});

test('byte trimming reports exact UTF-8 JSON size and never changes project or revision', () => {
  const engine = new Engine();
  ok(run(engine, 'batch', { commands: [
    { command: 'track.add', arguments: { id: 't', type: 'midi' } },
    { command: 'clip.add', arguments: { id: 'c', trackId: 't', type: 'midi', notes: Array.from({ length: 100 }, (_, i) => ({ id: `n-${i}`, pitch: 60, startTick: i, durationTicks: 1, velocity: 80 })) } },
  ] }));
  for (let i = 0; i < 6; i++) rename(engine, `한글 ${i}`);
  ok(run(engine, 'history.describe', { entryId: engine.historyView.entries[2].id, description: '🎹 음악\n"따옴표"'.repeat(50) }));
  const project = engine.project, currentBoundary = engine.historyView.currentBoundaryId;
  const beforeBytes = Buffer.byteLength(JSON.stringify(engine.exportHistory()));
  const trimmed = engine.trimHistoryToBytes(1024);
  assert.equal(trimmed.beforeBytes, beforeBytes); assert.equal(trimmed.bytes, Buffer.byteLength(JSON.stringify(engine.exportHistory())));
  assert.ok(trimmed.bytes <= 1024); assert.ok(trimmed.droppedEntryIds.length > 0); assert.equal(engine.historyView.currentBoundaryId, currentBoundary);
  assert.deepEqual(engine.project, project); assert.equal(engine.historyView.entries.length, 0); assert.equal(engine.historyView.cursor, 0);
  const restored = new Engine(project); restored.restoreHistory(engine.exportHistory()); assert.deepEqual(restored.checkpoint(), engine.checkpoint());
});

test('byte trimming at an undone boundary drops farthest redo states and preserves nearest redo order', () => {
  const engine = sequence(8); ok(run(engine, 'history.goTo', { index: 0 }));
  const project = engine.project, view = engine.historyView;
  const report = engine.trimHistoryToBytes(2000);
  assert.ok(report.bytes <= 2000); assert.deepEqual(engine.project, project); assert.equal(engine.historyView.baseBoundaryId, view.baseBoundaryId);
  assert.deepEqual(engine.historyView.entries.map(e => e.id), view.entries.slice(0, engine.historyView.entries.length).map(e => e.id));
  assert.ok(engine.historyView.entries.length > 0 && engine.historyView.entries.length < 8);
  ok(run(engine, 'history.redo')); assert.equal(engine.project.name, 'Edit 1');
  const before = engine.checkpoint();
  for (const size of [1023, -1, NaN, 2048.5]) { assert.throws(() => engine.trimHistoryToBytes(size), EngineError); assert.deepEqual(engine.checkpoint(), before); }
});

test('metadata commands before any edits do not invent musical undo steps', () => {
  const engine = new Engine(createProject({ name: 'Initial' })); const boundary = engine.historyView.baseBoundaryId;
  ok(run(engine, 'history.settings', { maxSteps: 2 })); assert.equal(engine.project.revision, 1); assert.equal(engine.canUndo, false);
  ok(run(engine, 'history.goTo', { index: 0 })); assert.equal(engine.project.revision, 2); assert.equal(engine.historyView.entries.length, 0);
  rename(engine, 'First'); assert.equal(engine.historyView.entries[0].revision, 3);
  ok(run(engine, 'history.undo')); assert.equal(engine.project.name, 'Initial'); assert.equal(engine.historyView.maxSteps, 2); assert.equal(engine.historyView.baseBoundaryId, boundary);
});
