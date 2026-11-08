import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine, createProject, validateProject, getCommandCatalog } from '../src/core/engine.mjs';
import { validateMidiEventBudget, checkMidiEventCopies, MAX_MIDI_EVENTS, MAX_MIDI_EVENT_BYTES, MAX_MIDI_PAYLOAD_BYTES } from '../src/core/midi-events.mjs';

const run = (engine, command, args = {}, options = {}) => engine.execute({ command, arguments: args, ...options });
const ok = response => { assert.equal(response.status, 'applied', JSON.stringify(response.errors)); return response; };
const rejected = (response, code) => { assert.equal(response.status, 'error', JSON.stringify(response)); assert.equal(response.errors[0].code, code, JSON.stringify(response.errors)); return response; };
const note = overrides => ({ id: 'note', pitch: 60, velocity: 90, channel: 0, startTick: 10, durationTicks: 20, ...overrides });
const cc = overrides => ({ id: 'cc', tick: 0, order: 0, kind: 'channel', status: 0xb0, data: [64, 127], ...overrides });
const sx = overrides => ({ id: 'sx', tick: 0, order: 1, kind: 'sysex', status: 0xf0, data: [0x7d, 0, 0xf7], ...overrides });
const meta = overrides => ({ id: 'meta', tick: 0, order: 2, kind: 'meta', status: 0xff, metaType: 0x01, data: [0, 128, 255], ...overrides });
function seed({ notes = [], events, lengthTicks = 100 } = {}) {
  const engine = new Engine();
  ok(run(engine, 'track.add', { id: 'track', type: 'midi' }));
  ok(run(engine, 'clip.add', { id: 'clip', trackId: 'track', type: 'midi', startTick: 0, lengthTicks, notes, ...(events === undefined ? {} : { events }) }));
  return engine;
}
const clip = (engine, id = 'clip') => engine.project.clips.find(value => value.id === id);

test('additive MIDI fields never normalize legacy project/checkpoint bytes on read', () => {
  const engine = seed({ notes: [note()] }), old = engine.project, bytes = JSON.stringify(old), checkpoint = engine.checkpoint();
  assert.equal(Object.hasOwn(old.clips[0], 'events'), false); assert.equal(Object.hasOwn(old.clips[0].notes[0], 'releaseVelocity'), false);
  assert.equal(validateProject(old), true); assert.equal(JSON.stringify(old), bytes);
  const restored = new Engine(old); restored.restoreCheckpoint(checkpoint);
  assert.equal(JSON.stringify(restored.project), bytes); assert.deepEqual(restored.checkpoint(), checkpoint);
  assert.equal(old.schemaVersion, 1);
});

test('all raw message categories, release forms and end-tick events are stored without rewriting bytes', () => {
  const events = [cc(), sx(), meta(), sx({ id: 'escape', order: 3, status: 0xf7, data: [0x90, 60, 100] }),
    cc({ id: 'poly', order: 4, status: 0xa3, data: [60, 79] }), cc({ id: 'program', order: 5, status: 0xc4, data: [127] }),
    cc({ id: 'pressure', order: 6, status: 0xd5, data: [1] }), cc({ id: 'bend', order: 7, status: 0xef, data: [0, 64] }),
    cc({ id: 'orphanOff', order: 8, status: 0x8f, data: [61, 72] }), cc({ id: 'orphanZero', order: 9, status: 0x91, data: [60, 0] }),
    cc({ id: 'pedalUp', tick: 100, order: 11, data: [64, 0] })];
  const notes = [note({ releaseVelocity: 65, noteOffEncoding: 'noteOff', onOrder: 10, offOrder: 12 }), note({ id: 'zero', pitch: 62, noteOffEncoding: 'zeroVelocityNoteOn', releaseVelocity: 0, onOrder: 13, offOrder: 14 })];
  const engine = seed({ notes, events }); assert.deepEqual(clip(engine).events, events); assert.deepEqual(clip(engine).notes, notes);
  const returned = engine.project; returned.clips[0].events[0].data[1] = 0; events[1].data.push(99);
  assert.equal(clip(engine).events[0].data[1], 127); assert.deepEqual(clip(engine).events[1].data, [0x7d, 0, 0xf7]);
});

test('channel payloads, managed meta types and inconsistent release encodings reject atomically', () => {
  const engine = seed(), before = engine.checkpoint();
  for (const event of [cc({ status: 0x90, data: [60, 1] }), cc({ data: [64, 128] }), cc({ data: [64] }), cc({ status: 0xc0, data: [1, 2] }), cc({ status: 0xd0, data: [] })]) rejected(run(engine, 'midi.events.add', { clipId: 'clip', events: [event] }), 'INVALID_MIDI_EVENT');
  for (const metaType of [3, 0x2f, 0x51, 0x58]) rejected(run(engine, 'midi.events.add', { clipId: 'clip', events: [meta({ metaType })] }), 'MANAGED_MIDI_META');
  for (const event of [sx({ status: 0xf1 }), sx({ data: [-1] }), sx({ data: [256] }), sx({ metaType: 4 }), cc({ order: -1 }), meta({ metaType: 128 })]) rejected(run(engine, 'midi.events.add', { clipId: 'clip', events: [event] }), 'VALIDATION_ERROR');
  rejected(run(engine, 'midi.notes.add', { clipId: 'clip', notes: [note({ releaseVelocity: 4, noteOffEncoding: 'zeroVelocityNoteOn' })] }), 'INVALID_NOTE_RELEASE');
  assert.deepEqual(engine.checkpoint(), before);
});

test('events share global object IDs and same-tick order with both note endpoints', () => {
  const engine = seed({ notes: [note({ onOrder: 2, offOrder: 3 })], events: [cc()] }), before = engine.checkpoint();
  for (const [id, tick, order, code] of [['note', 1, 5, 'DUPLICATE_ID'], ['track', 1, 5, 'DUPLICATE_ID'], ['fresh', 10, 2, 'MIDI_ORDER_CONFLICT'], ['fresh', 30, 3, 'MIDI_ORDER_CONFLICT'], ['fresh', 0, 0, 'MIDI_ORDER_CONFLICT']]) rejected(run(engine, 'midi.events.add', { clipId: 'clip', events: [cc({ id, tick, order })] }), code);
  assert.deepEqual(engine.checkpoint(), before);
  ok(run(engine, 'midi.events.add', { clipId: 'clip', events: [cc({ id: 'allowed', tick: 1, order: 0 })] })); // Order is local to each tick.
  rejected(run(engine, 'midi.notes.update', { clipId: 'clip', noteId: 'note', startTick: 1, onOrder: 0 }), 'MIDI_ORDER_CONFLICT');
});

test('missing event IDs and orders are assigned after all existing and same-batch explicit orders', () => {
  const engine = seed({ notes: [note({ onOrder: 3, offOrder: 8 })] });
  const first = { kind: 'channel', status: 0xb0, tick: 0, data: [1, 90] }, second = { ...first, id: 'explicit', order: 20 };
  const response = ok(run(engine, 'midi.events.add', { clipId: 'clip', events: [first, second, { ...first, tick: 2 }] }));
  assert.deepEqual(clip(engine).events.map(event => event.order), [21, 20, 22]); assert.equal(new Set(response.changes.created).size, 3); assert.match(response.changes.created[0], /^event-/);
  assert.equal(Object.hasOwn(first, 'id'), false); assert.equal(Object.hasOwn(first, 'order'), false);
  const other = seed({ events: [{ ...first, order: 4 }] }); assert.equal(clip(other).events[0].order, 4); assert.match(clip(other).events[0].id, /^event-/);
});

test('source-order exhaustion refuses implicit allocation without wrapping or changing history', () => {
  const engine = seed({ events: [cc({ order: Number.MAX_SAFE_INTEGER })] }), before = engine.checkpoint();
  const input = cc({ id: 'new' }); delete input.order;
  rejected(run(engine, 'midi.events.add', { clipId: 'clip', events: [input] }), 'MIDI_ORDER_OVERFLOW'); assert.deepEqual(engine.checkpoint(), before);
  ok(run(engine, 'midi.events.add', { clipId: 'clip', events: [{ ...input, tick: 1, order: 0 }] }));
});

test('event update changes channel nibble only, validates shape and supports undo, dry run and revision guards', () => {
  const engine = seed({ events: [cc(), sx()] }), before = engine.checkpoint();
  const args = { clipId: 'clip', eventId: 'cc', tick: 9, order: 7, channel: 15, data: [10, 33] };
  assert.equal(run(engine, 'midi.events.update', args, { dryRun: true }).status, 'validated'); assert.deepEqual(engine.checkpoint(), before);
  rejected(run(engine, 'midi.events.update', args, { expectedRevision: 0 }), 'REVISION_CONFLICT');
  ok(run(engine, 'midi.events.update', args)); assert.deepEqual(clip(engine).events[0], cc({ status: 0xbf, tick: 9, order: 7, data: [10, 33] }));
  ok(run(engine, 'history.undo')); assert.deepEqual(clip(engine), before.project.clips[0]); ok(run(engine, 'history.redo')); assert.equal(clip(engine).events[0].status, 0xbf);
  const current = engine.checkpoint();
  for (const forbidden of ['kind', 'status', 'metaType']) rejected(run(engine, 'midi.events.update', { clipId: 'clip', eventId: 'cc', [forbidden]: 0 }), 'VALIDATION_ERROR');
  rejected(run(engine, 'midi.events.update', { clipId: 'clip', eventId: 'sx', channel: 1 }), 'TYPE_MISMATCH');
  rejected(run(engine, 'midi.events.update', { clipId: 'clip', eventId: 'cc' }), 'EMPTY_UPDATE');
  rejected(run(engine, 'midi.events.update', { clipId: 'clip', eventId: 'cc', data: [1] }), 'INVALID_MIDI_EVENT'); assert.deepEqual(engine.checkpoint(), current);
});

test('note release/order editing and atomic event batches survive checkpoint reload and undo/redo', () => {
  const engine = seed({ notes: [note()], events: [cc()] }), before = engine.checkpoint();
  ok(run(engine, 'batch', { commands: [
    { command: 'midi.notes.update', arguments: { clipId: 'clip', noteId: 'note', releaseVelocity: 67, noteOffEncoding: 'noteOff', onOrder: 5, offOrder: 6 } },
    { command: 'midi.events.add', arguments: { clipId: 'clip', events: [sx()] } },
    { command: 'midi.events.update', arguments: { clipId: 'clip', eventId: 'cc', data: [64, 0] } },
  ] }));
  const checkpoint = engine.checkpoint(), restored = new Engine(checkpoint.project); restored.restoreCheckpoint(JSON.parse(JSON.stringify(checkpoint)));
  assert.deepEqual(restored.checkpoint(), checkpoint); ok(run(restored, 'history.undo')); assert.deepEqual(clip(restored), before.project.clips[0]); ok(run(restored, 'history.redo')); assert.deepEqual(clip(restored), checkpoint.project.clips[0]);
  rejected(run(engine, 'batch', { commands: [{ command: 'midi.events.remove', arguments: { clipId: 'clip', eventIds: ['cc'] } }, { command: 'midi.events.update', arguments: { clipId: 'clip', eventId: 'sx', tick: 101 } }] }), 'MIDI_EVENT_OUT_OF_BOUNDS'); assert.deepEqual(engine.checkpoint(), checkpoint);
});

test('event deletion and track/clip cascades report every event ID without touching retained objects', () => {
  const engine = seed({ notes: [note()], events: [cc(), sx(), meta()] });
  const before = engine.checkpoint(); rejected(run(engine, 'midi.events.remove', { clipId: 'clip', eventIds: ['cc', 'missing'] }), 'NOT_FOUND'); rejected(run(engine, 'midi.events.remove', { clipId: 'clip', eventIds: ['cc', 'cc'] }), 'VALIDATION_ERROR'); assert.deepEqual(engine.checkpoint(), before);
  const removed = ok(run(engine, 'midi.events.remove', { clipId: 'clip', eventIds: ['sx'] })); assert.deepEqual(removed.changes.removed, ['sx']); assert.equal(clip(engine).notes[0].id, 'note');
  const result = ok(run(engine, 'clip.remove', { clipId: 'clip' })); assert.deepEqual(new Set(result.changes.removed), new Set(['clip', 'note', 'cc', 'meta']));
  ok(run(engine, 'history.undo')); const track = ok(run(engine, 'track.remove', { trackId: 'track' })); assert.deepEqual(new Set(track.changes.removed), new Set(['track', 'clip', 'note', 'cc', 'meta']));
});

test('clip and track copies give events independent IDs while preserving raw payload and note release/source order', () => {
  const engine = seed({ notes: [note({ releaseVelocity: 63, onOrder: 5, offOrder: 9 })], events: [cc(), sx()] }), original = clip(engine);
  ok(run(engine, 'clip.duplicate', { clipId: 'clip', count: 2 })); ok(run(engine, 'track.duplicate', { trackId: 'track', newTrackId: 'other' }));
  const all = engine.project.clips, ids = all.flatMap(value => value.events.map(event => event.id)); assert.equal(new Set(ids).size, ids.length);
  for (const value of all) { assert.deepEqual(value.events.map(({ id, ...rest }) => rest), original.events.map(({ id, ...rest }) => rest)); assert.deepEqual(value.notes.map(({ id, ...rest }) => rest), original.notes.map(({ id, ...rest }) => rest)); }
  ok(run(engine, 'midi.events.update', { clipId: all[1].id, eventId: all[1].events[0].id, data: [64, 0] })); assert.equal(clip(engine).events[0].data[1], 127);
});

test('split partitions raw events exactly once and preserves original note endpoints, with synthetic boundary defaults', () => {
  const engine = seed({ notes: [note({ startTick: 10, durationTicks: 80, releaseVelocity: 74, noteOffEncoding: 'noteOff', onOrder: 4, offOrder: 20 }), note({ id: 'ending', startTick: 20, durationTicks: 30, onOrder: 5, offOrder: 15 })],
    events: [cc({ tick: 0 }), sx({ tick: 49 }), cc({ id: 'boundary', tick: 50, order: 14, data: [64, 0] }), meta({ tick: 100 })] });
  const before = engine.checkpoint(), response = ok(run(engine, 'clip.split', { clipId: 'clip', atTick: 50 })), [left, right] = engine.project.clips;
  assert.deepEqual(left.events.map(event => [event.id, event.tick]), [['cc', 0], ['sx', 49]]); assert.deepEqual(right.events.map(event => [event.id, event.tick]), [['boundary', 0], ['meta', 50]]);
  assert.equal(right.events[0].order, 14); assert.equal(left.notes[1].offOrder, 15); // Original same-tick stream order spans the two fragments.
  assert.equal(left.notes[0].onOrder, 4); for (const key of ['offOrder', 'releaseVelocity', 'noteOffEncoding']) assert.equal(Object.hasOwn(left.notes[0], key), false);
  assert.equal(Object.hasOwn(right.notes[0], 'onOrder'), false); assert.equal(right.notes[0].releaseVelocity, 74); assert.equal(right.notes[0].offOrder, 20); assert.notEqual(right.notes[0].id, 'note');
  assert.deepEqual(response.changes.warnings.map(item => item.code), ['MIDI_SPLIT_STATE_NOT_CHASED']); assert.ok(response.changes.updated.includes('boundary')); assert.ok(response.changes.updated.includes('meta'));
  ok(run(engine, 'history.undo')); assert.deepEqual(engine.project.clips, before.project.clips);
});

test('trim cannot silently drop end events, while move preserves their clip-relative coordinates', () => {
  const engine = seed({ events: [cc({ tick: 100 })] }), before = engine.checkpoint();
  rejected(run(engine, 'clip.update', { clipId: 'clip', lengthTicks: 99 }), 'MIDI_EVENT_OUT_OF_BOUNDS'); assert.deepEqual(engine.checkpoint(), before);
  ok(run(engine, 'clip.update', { clipId: 'clip', lengthTicks: 101 })); ok(run(engine, 'clip.move', { clipId: 'clip', startTick: 500 })); assert.equal(clip(engine).events[0].tick, 100); assert.equal(clip(engine).events[0].order, 0);
});

test('quantize/reset/legato/transpose/velocity change notes only and preserve release/source order and raw events', () => {
  const engine = seed({ notes: [note({ startTick: 11, durationTicks: 17, releaseVelocity: 53, noteOffEncoding: 'noteOff', onOrder: 10, offOrder: 20 })], events: [cc(), sx(), meta()] }), events = clip(engine).events;
  for (const [command, args] of [['midi.notes.quantize', { gridTicks: 10 }], ['midi.notes.resetQuantize', {}], ['midi.notes.freezeQuantize', {}], ['midi.notes.legato', { gapTicks: 1 }], ['midi.notes.transpose', { semitones: 3 }], ['midi.notes.velocity', { mode: 'set', value: 80 }]]) {
    ok(run(engine, command, { clipId: 'clip', ...args })); assert.deepEqual(clip(engine).events, events); const current = clip(engine).notes[0]; assert.equal(current.releaseVelocity, 53); assert.equal(current.onOrder, 10); assert.equal(current.offOrder, 20); assert.equal(current.noteOffEncoding, 'noteOff');
  }
});

test('a timing edit that collides explicit same-tick orders is rejected without silently renumbering sources', () => {
  const engine = seed({ notes: [note({ startTick: 11, onOrder: 5 })], events: [cc({ tick: 10, order: 5 })] }), before = engine.checkpoint();
  rejected(run(engine, 'midi.notes.quantize', { clipId: 'clip', gridTicks: 10 }), 'MIDI_ORDER_CONFLICT'); assert.deepEqual(engine.checkpoint(), before);
});

test('payload size and project event budgets are bounded, and copy amplification fails before creating copies', () => {
  const engine = seed(), before = engine.checkpoint();
  rejected(run(engine, 'midi.events.add', { clipId: 'clip', events: [sx({ data: new Array(MAX_MIDI_EVENT_BYTES + 1).fill(0) })] }), 'VALIDATION_ERROR'); assert.deepEqual(engine.checkpoint(), before);
  const payload = new Array(MAX_MIDI_EVENT_BYTES).fill(0), project = seed().project;
  project.clips[0].events = Array.from({ length: 5 }, (_, index) => sx({ id: `payload-${index}`, order: index, data: payload }));
  assert.throws(() => validateProject(project), { code: 'MIDI_PAYLOAD_LIMIT' });
  const records = new Array(MAX_MIDI_EVENTS).fill({ data: [] }), budgetProject = { clips: [{ type: 'midi', events: records }] };
  assert.equal(validateMidiEventBudget(budgetProject).count, MAX_MIDI_EVENTS);
  assert.throws(() => validateMidiEventBudget({ clips: [...budgetProject.clips, { type: 'midi', events: [{ data: [] }] }] }), { code: 'MIDI_EVENT_LIMIT' });
  assert.throws(() => checkMidiEventCopies(budgetProject, [{ type: 'midi', events: [{ data: [] }] }]), { code: 'COPY_LIMIT' });
  assert.equal(MAX_MIDI_PAYLOAD_BYTES, 4 * MAX_MIDI_EVENT_BYTES);
  const copied = seed({ events: [sx({ data: new Array(65536).fill(0) })] }), checkpoint = copied.checkpoint();
  rejected(run(copied, 'clip.duplicate', { clipId: 'clip', count: 64 }), 'COPY_LIMIT'); assert.deepEqual(copied.checkpoint(), checkpoint);
});

test('event catalog schemas expose only supported edits and reject raw events on audio clips', () => {
  const catalog = getCommandCatalog();
  for (const name of ['midi.events.add', 'midi.events.update', 'midi.events.remove']) assert.ok(catalog.some(entry => entry.command === name));
  const update = catalog.find(entry => entry.command === 'midi.events.update').schema.properties; assert.ok(update.channel); assert.equal(update.status, undefined); assert.equal(update.kind, undefined); assert.equal(update.metaType, undefined);
  const engine = seed(); ok(run(engine, 'track.add', { id: 'audio', type: 'audio' }));
  rejected(run(engine, 'clip.add', { id: 'bad', trackId: 'audio', type: 'midi', events: [cc()] }), 'TYPE_MISMATCH');
});

test('source-order groups are optional shared lineage values, never global object IDs or legacy normalization', () => {
  const engine = seed({ notes: [note()] }); assert.equal(Object.hasOwn(clip(engine), 'midiOrderGroup'), false);
  ok(run(engine, 'clip.split', { clipId: 'clip', atTick: 50 })); assert.ok(engine.project.clips.every(value => !Object.hasOwn(value, 'midiOrderGroup')));
  for (const id of ['grouped-one', 'grouped-two']) ok(run(engine, 'clip.add', { id, trackId: 'track', type: 'midi', midiOrderGroup: 'track' }));
  assert.equal(validateProject(engine.project), true); // Shared with both another group and an object ID by design.
  const current = engine.checkpoint();
  rejected(run(engine, 'clip.add', { trackId: 'track', type: 'midi', midiOrderGroup: '' }), 'VALIDATION_ERROR');
  rejected(run(engine, 'clip.update', { clipId: 'grouped-one', midiOrderGroup: 'other' }), 'VALIDATION_ERROR');
  assert.deepEqual(engine.checkpoint(), current);
});

test('split creates one fresh lineage for ordered data, reuses it on later splits and undo restores the absent field', () => {
  const engine = seed({ notes: [note({ onOrder: 10, offOrder: 11 })], events: [cc({ tick: 100 })] }), before = engine.checkpoint();
  ok(run(engine, 'clip.split', { clipId: 'clip', atTick: 50 }));
  const first = engine.project.clips, group = first[0].midiOrderGroup; assert.match(group, /^midi-order-/); assert.equal(first[1].midiOrderGroup, group); assert.notEqual(group, first[0].id);
  ok(run(engine, 'clip.split', { clipId: 'clip', atTick: 5 })); assert.ok(engine.project.clips.every(value => value.midiOrderGroup === group));
  const persisted = new Engine(JSON.parse(JSON.stringify(engine.project))); assert.deepEqual(persisted.project.clips.map(value => value.midiOrderGroup), [group, group, group]);
  ok(run(engine, 'history.undo')); ok(run(engine, 'history.undo')); assert.deepEqual(engine.project.clips, before.project.clips);
});

test('independent consecutive copies keep source numbers but receive independent groups, including maximum-safe orders', () => {
  const engine = seed({ notes: [note({ onOrder: Number.MAX_SAFE_INTEGER, offOrder: Number.MAX_SAFE_INTEGER })], events: [cc()] }), before = clip(engine);
  ok(run(engine, 'clip.duplicate', { clipId: 'clip', count: 2 }));
  const copies = engine.project.clips.slice(1); assert.notEqual(copies[0].midiOrderGroup, copies[1].midiOrderGroup); assert.ok(copies.every(value => value.midiOrderGroup));
  assert.deepEqual(clip(engine), before);
  for (const copy of copies) { assert.equal(copy.notes[0].onOrder, Number.MAX_SAFE_INTEGER); assert.equal(copy.notes[0].offOrder, Number.MAX_SAFE_INTEGER); assert.equal(copy.events[0].order, 0); }
});

test('whole-track copy remaps each split lineage together while independent raw clips remain independent', () => {
  const engine = seed({ notes: [note({ onOrder: 10, offOrder: 11 })], events: [cc({ tick: 100 })] });
  ok(run(engine, 'clip.split', { clipId: 'clip', atTick: 50 }));
  ok(run(engine, 'clip.add', { id: 'independent', trackId: 'track', type: 'midi', startTick: 100, lengthTicks: 100, events: [cc({ id: 'other-cc' })] }));
  const source = engine.project.clips, sourceGroup = source[0].midiOrderGroup;
  ok(run(engine, 'track.duplicate', { trackId: 'track', newTrackId: 'copied-track' }));
  const copies = engine.project.clips.filter(value => value.trackId === 'copied-track');
  assert.equal(copies[0].midiOrderGroup, copies[1].midiOrderGroup); assert.notEqual(copies[0].midiOrderGroup, sourceGroup); assert.notEqual(copies[2].midiOrderGroup, copies[0].midiOrderGroup);
  assert.deepEqual(engine.project.clips.filter(value => value.trackId === 'track'), source);
  for (let index = 0; index < copies.length; index++) assert.deepEqual(copies[index].events.map(({ id, ...event }) => event), source[index].events.map(({ id, ...event }) => event));
});

test('deleting and reusing a clip ID cannot accidentally join a previous split lineage', () => {
  const engine = seed({ events: [cc({ tick: 100 })] }); ok(run(engine, 'clip.split', { clipId: 'clip', atTick: 50 }));
  const oldRight = engine.project.clips[1]; ok(run(engine, 'clip.remove', { clipId: 'clip' }));
  ok(run(engine, 'clip.add', { id: 'clip', trackId: 'track', type: 'midi', startTick: 0, lengthTicks: 100, events: [cc({ id: 'new-cc', tick: 100 })] }));
  ok(run(engine, 'clip.split', { clipId: 'clip', atTick: 25 }));
  const current = engine.project.clips, fresh = current.filter(value => value.id !== oldRight.id); assert.equal(fresh[0].midiOrderGroup, fresh[1].midiOrderGroup); assert.notEqual(fresh[0].midiOrderGroup, oldRight.midiOrderGroup);
});
