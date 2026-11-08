import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine, createProject, getCommandCatalog, validateProject } from '../src/core/engine.mjs';
import { renderProject, projectDurationSeconds } from '../src/media/render.mjs';

const run = (engine, command, args = {}, extra = {}) => engine.execute({ command, arguments: args, ...extra });
const ok = result => { assert.equal(result.status, 'applied', JSON.stringify(result.errors)); assert.equal(result.applied, true); return result; };
const rejected = (result, code) => { assert.equal(result.status, 'error', JSON.stringify(result)); assert.equal(result.applied, false); assert.equal(result.errors[0].code, code, JSON.stringify(result)); assert.deepEqual(result.changes, {}); return result; };
const wav = (id, digest, sampleRate = 24000, frames = sampleRate * 2) => ({ id, name: `${id}.wav`, sha256: digest.repeat(64), path: `assets/${digest.repeat(64)}.wav`, sampleRate, channels: 1, frames });
const replacement = (asset, overrides = {}) => {
  const { id, name, ...metadata } = asset;
  const sha256 = 'd'.repeat(64);
  return { assetId: id, ...metadata, sha256, path: `assets/${sha256}.wav`, ...overrides };
};
const withoutRevision = project => { const copy = structuredClone(project); delete copy.revision; return copy; };
const assetById = (engine, id = 'asset-a') => engine.project.assets.find(asset => asset.id === id);
function fixture() {
  const engine = new Engine(createProject({ name: 'Relink fixture', sampleRate: 48000 }));
  ok(run(engine, 'batch', { commands: [
    ...[wav('asset-a', 'a'), wav('asset-b', 'b', 44100), wav('asset-unused', 'c', 8000)].map(asset => ({ command: 'asset.add', arguments: { asset } })),
    { command: 'track.add', arguments: { id: 'track-audio', type: 'audio', name: 'Audio' } },
    { command: 'track.add', arguments: { id: 'track-midi', type: 'midi', name: 'Keys' } },
    { command: 'clip.add', arguments: { id: 'clip-a1', trackId: 'track-audio', type: 'audio', assetId: 'asset-a', startSample: 2400, offsetFrames: 6000, lengthFrames: 12000, gainDb: -4 } },
    { command: 'clip.add', arguments: { id: 'clip-a2', trackId: 'track-audio', type: 'audio', assetId: 'asset-a', startSample: 30000, offsetFrames: 12000, lengthFrames: 24000, gainDb: -9 } },
    { command: 'clip.add', arguments: { id: 'clip-b', trackId: 'track-audio', type: 'audio', assetId: 'asset-b', startSample: 240, offsetFrames: 441, lengthFrames: 882 } },
    { command: 'clip.add', arguments: { id: 'clip-midi', trackId: 'track-midi', type: 'midi', lengthTicks: 1920, notes: [{ id: 'note-a', pitch: 62, startTick: 120, durationTicks: 240, velocity: 87, channel: 3, quantizeReference: { startTick: 123, durationTicks: 240 } }] } },
  ] }));
  return engine;
}
function singleSource({ sampleRate = 44100, offsetFrames = 1, lengthFrames = 100, frames = 44100 } = {}) {
  const engine = new Engine(createProject());
  ok(run(engine, 'batch', { commands: [
    { command: 'asset.add', arguments: { asset: wav('asset-a', 'a', sampleRate, frames) } },
    { command: 'track.add', arguments: { id: 'track-audio', type: 'audio' } },
    { command: 'clip.add', arguments: { id: 'clip-a1', trackId: 'track-audio', type: 'audio', assetId: 'asset-a', startSample: 123, offsetFrames, lengthFrames } },
  ] }));
  return engine;
}

test('media editing commands expose strict schemas and preserve the existing project v1 format', () => {
  const definitions = getCommandCatalog();
  const relink = definitions.find(entry => entry.command === 'asset.relink');
  assert.equal(relink.schema.properties.framePolicy.default, 'exact');
  assert.deepEqual(relink.schema.properties.framePolicy.enum, ['exact', 'nearest']);
  assert.equal(definitions.find(entry => entry.command === 'asset.removeMissing').schema.properties.assetIds.uniqueItems, true);
  const engine = fixture(), before = engine.checkpoint(), mapping = replacement(assetById(engine));
  for (const args of [{ mappings: [] }, { mappings: [mapping], verified: true }, { mappings: [{ ...mapping, name: 'rename.wav' }] },
    { mappings: [{ ...mapping, sampleRate: 44100.5 }] }, { mappings: [{ ...mapping, channels: 0 }] }, { mappings: [{ ...mapping, frames: 0 }] },
    { mappings: [{ ...mapping, path: '../outside.wav' }] }, { mappings: [mapping], framePolicy: 'truncate' }]) {
    rejected(run(engine, 'asset.relink', args), 'VALIDATION_ERROR');
    assert.deepEqual(engine.checkpoint(), before);
  }
  rejected(run(engine, 'asset.removeMissing', { assetIds: [] }), 'VALIDATION_ERROR');
  rejected(run(engine, 'asset.removeMissing', { assetIds: ['asset-a', 'asset-a'] }), 'VALIDATION_ERROR');
  assert.equal(engine.project.schemaVersion, 1);
});

test('same-rate relink preserves stable IDs, names, complete clip state, MIDI references and history metadata', () => {
  const engine = fixture(), before = engine.project;
  const result = ok(run(engine, 'asset.relink', { mappings: [replacement(assetById(engine))] }));
  assert.deepEqual(engine.project.clips, before.clips);
  assert.deepEqual(engine.project.tracks, before.tracks);
  assert.deepEqual(engine.project.tempoMap, before.tempoMap);
  assert.deepEqual(assetById(engine), { ...before.assets[0], sha256: 'd'.repeat(64), path: `assets/${'d'.repeat(64)}.wav` });
  assert.deepEqual(engine.project.assets.slice(1), before.assets.slice(1));
  assert.deepEqual(result.changes.updated, ['asset-a', 'clip-a1', 'clip-a2']);
  assert.deepEqual(result.changes.relinked, { assetIds: ['asset-a'], clipIds: ['clip-a1', 'clip-a2'], framePolicy: 'exact', conversions: [{ assetId: 'asset-a', fromSampleRate: 24000, toSampleRate: 24000, clipIds: ['clip-a1', 'clip-a2'], rounding: 'none', adjustments: [] }] });
  assert.equal(engine.historyView.entries.at(-1).label, 'Relink audio assets');
  assert.equal(engine.historyView.entries.at(-1).summary.updated, 3);
  assert.equal(validateProject(engine.project), true);
});

test('exact rate changes preserve source seconds and timeline playback across multiple assets', () => {
  const engine = fixture(), before = engine.project;
  const decoded = project => new Map(project.assets.map(asset => [asset.id, { sampleRate: asset.sampleRate, frames: asset.frames, channels: [new Float32Array(asset.frames).fill(0.25)] }]));
  const renderedBefore = renderProject(before, decoded(before), { tailSeconds: 0 });
  const result = ok(run(engine, 'asset.relink', { mappings: before.assets.slice(0, 2).map(asset => replacement(asset, { sampleRate: 48000, frames: 96000 })) }));
  const after = engine.project;
  for (const original of before.clips.filter(clip => clip.type === 'audio')) {
    const clip = after.clips.find(item => item.id === original.id), oldAsset = before.assets.find(asset => asset.id === original.assetId), newAsset = after.assets.find(asset => asset.id === clip.assetId);
    assert.equal(clip.offsetFrames / newAsset.sampleRate, original.offsetFrames / oldAsset.sampleRate);
    assert.equal(clip.lengthFrames / newAsset.sampleRate, original.lengthFrames / oldAsset.sampleRate);
    assert.equal(clip.startSample, original.startSample); assert.equal(clip.gainDb, original.gainDb); assert.equal(clip.assetId, original.assetId);
  }
  assert.equal(projectDurationSeconds(after), projectDurationSeconds(before));
  const renderedAfter = renderProject(after, decoded(after), { tailSeconds: 0 });
  assert.equal(renderedBefore.frames, renderedAfter.frames);
  assert.deepEqual(renderedAfter.channels, renderedBefore.channels);
  for (const conversion of result.changes.relinked.conversions) {
    assert.equal(conversion.rounding, 'none');
    for (const adjustment of conversion.adjustments) assert.deepEqual([adjustment.offsetDeltaFrames, adjustment.endDeltaFrames, adjustment.durationDeltaSeconds], [0, 0, 0]);
  }
});

test('default exact policy rejects a nonrepresentable source boundary without any state or history change', () => {
  const engine = singleSource(), before = engine.checkpoint();
  const result = rejected(run(engine, 'asset.relink', { mappings: [replacement(assetById(engine), { sampleRate: 48000, frames: 48000 })] }), 'ASSET_RATE_INCOMPATIBLE');
  assert.equal(result.errors[0].details.boundary, 'offset');
  assert.equal(result.errors[0].details.clipId, 'clip-a1');
  assert.deepEqual(engine.checkpoint(), before);
  const endOnly = singleSource({ offsetFrames: 0, lengthFrames: 1 });
  assert.equal(rejected(run(endOnly, 'asset.relink', { mappings: [replacement(assetById(endOnly), { sampleRate: 48000, frames: 48000 })] }), 'ASSET_RATE_INCOMPATIBLE').errors[0].details.boundary, 'end');
});

test('explicit nearest policy rounds both source boundaries half-up and reports exact half-frame deltas', () => {
  const engine = singleSource({ sampleRate: 48000, offsetFrames: 1, lengthFrames: 4, frames: 48000 });
  const result = ok(run(engine, 'asset.relink', { mappings: [replacement(assetById(engine), { sampleRate: 24000, frames: 24000 })], framePolicy: 'nearest' }));
  const clip = engine.project.clips[0];
  assert.equal(clip.offsetFrames, 1); assert.equal(clip.lengthFrames, 2); assert.equal(clip.startSample, 123);
  const conversion = result.changes.relinked.conversions[0];
  assert.equal(conversion.rounding, 'nearest');
  assert.deepEqual(conversion.adjustments[0], { clipId: 'clip-a1', previousOffsetFrames: 1, offsetFrames: 1, previousLengthFrames: 4, lengthFrames: 2, offsetDeltaFrames: 0.5, endDeltaFrames: 0.5, durationDeltaSeconds: 0 });
});

test('nearest policy reports duration changes and never silently clamps an empty or out-of-source range', () => {
  const engine = singleSource({ sampleRate: 6000, offsetFrames: 1, lengthFrames: 2, frames: 6000 });
  const result = ok(run(engine, 'asset.relink', { mappings: [replacement(assetById(engine), { sampleRate: 4000, frames: 4000 })], framePolicy: 'nearest' }));
  const adjustment = result.changes.relinked.conversions[0].adjustments[0];
  assert.equal(adjustment.offsetDeltaFrames, 1 / 3); assert.equal(adjustment.endDeltaFrames, 0);
  assert.equal(adjustment.durationDeltaSeconds, -1 / 12000);
  assert.equal(engine.project.clips[0].lengthFrames, 1);
  const collapsed = singleSource({ sampleRate: 48000, offsetFrames: 0, lengthFrames: 1, frames: 48000 }), before = collapsed.checkpoint();
  rejected(run(collapsed, 'asset.relink', { mappings: [replacement(assetById(collapsed), { sampleRate: 8000, frames: 8000 })], framePolicy: 'nearest' }), 'ASSET_RATE_INCOMPATIBLE');
  assert.deepEqual(collapsed.checkpoint(), before);
  const tooShort = singleSource({ sampleRate: 48000, offsetFrames: 1, lengthFrames: 4, frames: 48000 });
  rejected(run(tooShort, 'asset.relink', { mappings: [replacement(assetById(tooShort), { sampleRate: 24000, frames: 2 })], framePolicy: 'nearest' }), 'AUDIO_OUT_OF_BOUNDS');
});

test('relink rejects duplicate targets, unknown registrations, mismatched content addresses and short replacements atomically', () => {
  const engine = fixture(), before = engine.checkpoint(), mapping = replacement(assetById(engine));
  for (const [mappings, code] of [
    [[mapping, mapping], 'DUPLICATE_ID'],
    [[mapping, { ...mapping, assetId: 'not-registered' }], 'NOT_FOUND'],
    [[mapping, { ...replacement(assetById(engine, 'asset-b')), path: `assets/${'e'.repeat(64)}.wav` }], 'INVALID_ASSET_PATH'],
    [[mapping, replacement(assetById(engine, 'asset-b'), { frames: 1000 })], 'AUDIO_OUT_OF_BOUNDS'],
    [[{ ...mapping, frames: 35999 }], 'AUDIO_OUT_OF_BOUNDS'],
  ]) {
    rejected(run(engine, 'asset.relink', { mappings }), code);
    assert.deepEqual(engine.checkpoint(), before);
  }
  ok(run(engine, 'asset.relink', { mappings: [{ ...mapping, frames: 36000 }] }));
  assert.equal(assetById(engine).frames, 36000); // Unused tail may be shorter; no referenced range is clipped.
});

test('BigInt boundary conversion detects safe-integer overflow instead of accepting rounded arithmetic', () => {
  const engine = singleSource({ sampleRate: 1, offsetFrames: Number.MAX_SAFE_INTEGER - 1, lengthFrames: 1, frames: Number.MAX_SAFE_INTEGER });
  const before = engine.checkpoint();
  rejected(run(engine, 'asset.relink', { mappings: [replacement(assetById(engine), { sampleRate: 2, frames: Number.MAX_SAFE_INTEGER })] }), 'TIME_OVERFLOW');
  assert.deepEqual(engine.checkpoint(), before);
});

test('removeMissing removes all referencing audio events and only the supplied asset registrations', () => {
  const engine = fixture(), before = engine.project;
  const result = ok(run(engine, 'asset.removeMissing', { assetIds: ['asset-a', 'asset-unused'] }));
  assert.deepEqual(result.changes.removedMissing, { assetIds: ['asset-a', 'asset-unused'], clipIds: ['clip-a1', 'clip-a2'], assetCount: 2, clipCount: 2 });
  assert.deepEqual(result.changes.removed, ['asset-a', 'asset-unused', 'clip-a1', 'clip-a2']);
  assert.deepEqual(result.resolvedTargets, result.changes.removed);
  assert.deepEqual(engine.project.assets, [before.assets[1]]);
  assert.deepEqual(engine.project.clips, before.clips.filter(clip => clip.assetId !== 'asset-a'));
  assert.deepEqual(engine.project.tracks, before.tracks);
  assert.equal(engine.historyView.entries.at(-1).label, 'Remove missing audio assets');
  assert.equal(engine.historyView.entries.at(-1).summary.removed, 4);
  assert.equal(validateProject(engine.project), true);
});

test('removeMissing validates the entire ID list before removal and supports all registered missing assets', () => {
  const engine = fixture(), before = engine.checkpoint();
  rejected(run(engine, 'asset.removeMissing', { assetIds: ['asset-a', 'absent-id'] }), 'NOT_FOUND');
  assert.deepEqual(engine.checkpoint(), before);
  const result = ok(run(engine, 'asset.removeMissing', { assetIds: engine.project.assets.map(asset => asset.id) }));
  assert.equal(result.changes.removedMissing.assetCount, 3); assert.equal(result.changes.removedMissing.clipCount, 3);
  assert.equal(engine.project.assets.length, 0);
  assert.deepEqual(engine.project.clips, before.project.clips.filter(clip => clip.type === 'midi'));
  assert.deepEqual(engine.project.tracks, before.project.tracks);
});

test('relink and removeMissing both respect dry runs and stale revisions without altering checkpoints', () => {
  const engine = fixture(), before = engine.checkpoint();
  for (const [command, args] of [
    ['asset.relink', { mappings: [replacement(assetById(engine), { sampleRate: 48000, frames: 96000 })] }],
    ['asset.removeMissing', { assetIds: ['asset-a'] }],
  ]) {
    const preview = run(engine, command, args, { dryRun: true, expectedRevision: engine.project.revision });
    assert.equal(preview.status, 'validated'); assert.equal(preview.applied, false);
    assert.ok(preview.resolvedTargets.includes('asset-a'));
    assert.deepEqual(engine.checkpoint(), before);
    rejected(run(engine, command, args, { expectedRevision: engine.project.revision - 1 }), 'REVISION_CONFLICT');
    assert.deepEqual(engine.checkpoint(), before);
  }
});

test('relink and removeMissing are each undoable and redoable with monotonic revisions', () => {
  for (const [command, argsFor] of [
    ['asset.relink', engine => ({ mappings: [replacement(assetById(engine), { sampleRate: 48000, frames: 96000 })] })],
    ['asset.removeMissing', () => ({ assetIds: ['asset-a', 'asset-b'] })],
  ]) {
    const engine = fixture(), original = engine.project, steps = engine.historyView.entries.length;
    ok(run(engine, command, argsFor(engine))); const edited = engine.project;
    assert.equal(engine.historyView.entries.length, steps + 1);
    ok(run(engine, 'history.undo')); assert.deepEqual(withoutRevision(engine.project), withoutRevision(original));
    assert.equal(engine.project.revision, original.revision + 2);
    ok(run(engine, 'history.redo')); assert.deepEqual(withoutRevision(engine.project), withoutRevision(edited));
    assert.equal(engine.project.revision, original.revision + 3);
  }
});

test('mixed media commands batch atomically into one edit and a later invalid operation rolls everything back', () => {
  const engine = fixture(), before = engine.checkpoint();
  const commands = [
    { command: 'asset.relink', arguments: { mappings: [replacement(assetById(engine), { sampleRate: 48000, frames: 96000 })] } },
    { command: 'asset.removeMissing', arguments: { assetIds: ['asset-b'] } },
  ];
  const bad = rejected(run(engine, 'batch', { commands: [...commands, { command: 'clip.update', arguments: { clipId: 'clip-b', gainDb: -6 } }] }), 'NOT_FOUND');
  assert.equal(bad.errors[0].details.batchIndex, 2); assert.deepEqual(engine.checkpoint(), before);
  const preview = run(engine, 'batch', { commands }, { dryRun: true });
  assert.equal(preview.status, 'validated'); assert.equal(preview.changes.operations.length, 2); assert.deepEqual(engine.checkpoint(), before);
  ok(run(engine, 'batch', { commands }));
  assert.equal(engine.project.revision, before.project.revision + 1);
  assert.equal(engine.historyView.entries.length, before.history.entries.length + 1);
  assert.deepEqual(engine.historyView.entries.at(-1).summary.commands, ['asset.relink', 'asset.removeMissing']);
  ok(run(engine, 'history.undo')); assert.deepEqual(withoutRevision(engine.project), withoutRevision(before.project));
});

test('JSON reopen and persisted history retain relink metadata, references and removed-event recovery', () => {
  const engine = fixture();
  ok(run(engine, 'asset.relink', { mappings: [replacement(assetById(engine), { sampleRate: 48000, frames: 96000 })] }));
  const relinked = engine.project;
  ok(run(engine, 'asset.removeMissing', { assetIds: ['asset-a'] }));
  const checkpoint = JSON.parse(JSON.stringify(engine.checkpoint()));
  const reopened = new Engine(JSON.parse(JSON.stringify(engine.project)));
  reopened.restoreHistory(checkpoint.history);
  assert.deepEqual(reopened.checkpoint(), checkpoint);
  ok(run(reopened, 'history.undo'));
  assert.deepEqual(withoutRevision(reopened.project), withoutRevision(relinked));
  assert.deepEqual(reopened.project.clips.find(clip => clip.id === 'clip-midi').notes[0].quantizeReference, { startTick: 123, durationTicks: 240 });
  ok(run(reopened, 'history.undo')); assert.equal(assetById(reopened).sampleRate, 24000);
  assert.equal(reopened.project.clips.find(clip => clip.id === 'clip-a1').offsetFrames, 6000);
  reopened.restoreCheckpoint(checkpoint); assert.deepEqual(reopened.checkpoint(), checkpoint);
});
