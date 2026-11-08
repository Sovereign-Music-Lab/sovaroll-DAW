import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Engine, createProject } from '../src/core/engine.mjs';
import { loadSessionState, writeSidecar, DEFAULT_SESSION_SETTINGS } from '../src/session-store.mjs';
import { contentProjectHash, loadSavedCheckpoint, saveExplicitCheckpoint, prepareProjectVersion, previewProjectVersion } from '../src/project-save.mjs';

async function fixture(t, name = 'Song.newdaw.json') {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'newdaw-project-save-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, name), engine = new Engine(createProject({ name: 'Song' }));
  await fs.writeFile(file, JSON.stringify(engine.project)); return { dir, file, engine };
}
const rename = (engine, name) => assert.equal(engine.execute({ command: 'project.rename', arguments: { name } }).status, 'applied');
const candidate = engine => { const checkpoint = engine.checkpoint(); checkpoint.project.revision++; checkpoint.history.projectRevision++; return checkpoint; };
const state = file => fs.readFile(file).then(bytes => JSON.parse(bytes.toString('utf8')));

test('opening creates one durable baseline; dirty ignores only revision and preserves ownership IDs', async t => {
  const { file, engine } = await fixture(t), main = await fs.readFile(file), ids = ['ownership-first'];
  const opened = await loadSavedCheckpoint(file, engine.project, { ownershipIds: ids, now: '2026-11-07T00:00:00.000Z' });
  assert.equal(opened.available, true); assert.equal(opened.dirty, false); assert.equal(opened.checkpoint.origin, 'opened-project'); assert.deepEqual(opened.checkpoint.mediaOwnershipIds, ids);
  const revisionOnly = engine.project; revisionOnly.revision = 90;
  assert.equal(contentProjectHash(engine.project), contentProjectHash(revisionOnly)); assert.equal((await loadSavedCheckpoint(file, revisionOnly)).dirty, false);
  rename(engine, 'Edited'); const unsaved = await loadSavedCheckpoint(file, engine.project); assert.equal(unsaved.dirty, true); assert.equal(unsaved.checkpoint.saveId, opened.checkpoint.saveId);
  const saved = await saveExplicitCheckpoint(file, engine.project, { ownershipIds: ['ownership-first', 'ownership-second'] });
  assert.equal(saved.dirty, false); assert.equal(saved.checkpoint.origin, 'explicit'); assert.notEqual(saved.checkpoint.saveId, opened.checkpoint.saveId); assert.deepEqual(saved.checkpoint.mediaOwnershipIds, ['ownership-first', 'ownership-second']);
  assert.deepEqual(await fs.readFile(file), main);
});

test('corrupt and wrong-project saved checkpoints remain unavailable across opens until explicit Save', async t => {
  const { dir, file, engine } = await fixture(t), savedFile = `${file}.saved.json`;
  await fs.writeFile(savedFile, '{broken');
  for (let i = 0; i < 2; i++) { const result = await loadSavedCheckpoint(file, engine.project); assert.equal(result.available, false); assert.equal(result.dirty, null); }
  assert.equal(await fs.readFile(savedFile, 'utf8'), '{broken');
  const saved = await saveExplicitCheckpoint(file, engine.project); const preserved = saved.persistence.warnings.find(item => item.preserved).preserved;
  assert.equal(await fs.readFile(path.join(dir, preserved), 'utf8'), '{broken');
  const foreign = createProject({ name: 'Other' }); const otherSave = await saveExplicitCheckpoint(path.join(dir, 'Other.newdaw.json'), foreign);
  await fs.writeFile(savedFile, JSON.stringify(otherSave.checkpoint));
  const mismatched = await loadSavedCheckpoint(file, engine.project); assert.equal(mismatched.available, false); assert.equal(mismatched.persistence.warnings[0].code, 'SAVE_CHECKPOINT_MISMATCH');
  assert.equal((await state(savedFile)).project.id, foreign.id);
});

test('saved checkpoint checksum failure is preserved and never silently replaced by current project', async t => {
  const { file, engine } = await fixture(t); const saved = await loadSavedCheckpoint(file, engine.project);
  saved.checkpoint.project.name = 'Tampered without updating hash'; await fs.writeFile(`${file}.saved.json`, JSON.stringify(saved.checkpoint));
  const result = await loadSavedCheckpoint(file, engine.project); assert.equal(result.available, false); assert.equal(result.persistence.warnings[0].code, 'INVALID_SAVE_CHECKPOINT');
});

test('explicit Save before-publication failure preserves old baseline; post-publication failure returns committed warning', async t => {
  const { file, engine } = await fixture(t), initial = await loadSavedCheckpoint(file, engine.project); rename(engine, 'Changed');
  await assert.rejects(saveExplicitCheckpoint(file, engine.project, { writeCheckpoint: async () => { throw new Error('disk fault'); } }), /disk fault/);
  assert.equal((await loadSavedCheckpoint(file, engine.project)).checkpoint.saveId, initial.checkpoint.saveId);
  const result = await saveExplicitCheckpoint(file, engine.project, { writeCheckpoint: async (filename, bytes, options) => { await writeSidecar(filename, bytes, options); throw new Error('after rename'); } });
  assert.equal(result.dirty, false); assert.ok(result.persistence.warnings.some(item => item.code === 'SAVE_COMMITTED_WITH_WARNING'));
  assert.equal((await loadSavedCheckpoint(file, engine.project)).checkpoint.saveId, result.checkpoint.saveId);
});

test('failed replacement of corrupt regular or symlink baseline cannot cause false initialization', async t => {
  const { dir, file, engine } = await fixture(t), savedFile = `${file}.saved.json`;
  await fs.writeFile(savedFile, '{broken');
  await assert.rejects(saveExplicitCheckpoint(file, engine.project, { writeCheckpoint: async () => { throw new Error('failed'); } }), /failed/);
  assert.equal((await loadSavedCheckpoint(file, engine.project)).available, false); assert.equal(await fs.readFile(savedFile, 'utf8'), '{broken');
  await fs.unlink(savedFile); const external = path.join(dir, 'external'); await fs.writeFile(external, 'not a checkpoint'); await fs.symlink(external, savedFile);
  await assert.rejects(saveExplicitCheckpoint(file, engine.project, { writeCheckpoint: async () => { throw new Error('failed link replacement'); } }), /failed link replacement/);
  assert.equal((await fs.lstat(savedFile)).isSymbolicLink(), true); assert.equal((await loadSavedCheckpoint(file, engine.project)).available, false);
  await saveExplicitCheckpoint(file, engine.project); assert.equal((await fs.lstat(savedFile)).isFile(), true); assert.equal(await fs.readFile(external, 'utf8'), 'not a checkpoint');
});

test('version naming skips project/sidecar/symlink collisions and keeps the original unchanged', async t => {
  const { dir, file, engine } = await fixture(t), source = await fs.readFile(file);
  await fs.writeFile(path.join(dir, 'Song-01.newdaw.json'), 'occupied'); await fs.writeFile(path.join(dir, 'Song-02.newdaw.json.saved.json'), 'orphan saved point');
  await fs.symlink(file, path.join(dir, 'Song-03.newdaw.json'));
  rename(engine, 'Version content'); const checkpoint = candidate(engine), result = await prepareProjectVersion(file, { checkpoint, ownershipIds: [] });
  assert.equal(path.basename(result.projectPath), 'Song-04.newdaw.json'); assert.deepEqual(await state(result.projectPath), checkpoint.project); assert.deepEqual(await fs.readFile(file), source);
  const history = await loadSessionState(result.projectPath, checkpoint.project); assert.deepEqual(history.history, result.checkpoint.history);
  const baseline = await loadSavedCheckpoint(result.projectPath, checkpoint.project); assert.equal(baseline.dirty, false); assert.equal(baseline.checkpoint.origin, 'explicit');
  assert.deepEqual(baseline.checkpoint.mediaOwnershipIds, []); assert.equal(checkpoint.project.id, engine.project.id);
});

test('version suffix increments existing padded numbers and concurrent preparations use different targets', async t => {
  const { file, engine } = await fixture(t, 'Song-009.newdaw.json');
  const results = await Promise.all([prepareProjectVersion(file, { checkpoint: candidate(engine) }), prepareProjectVersion(file, { checkpoint: candidate(engine) })]);
  assert.deepEqual(results.map(result => path.basename(result.projectPath)).sort(), ['Song-010.newdaw.json', 'Song-011.newdaw.json']);
});

test('project filename is published last and target lock survives successful preparation for adoption', async t => {
  const { file, engine } = await fixture(t), order = []; let released = 0;
  const result = await prepareProjectVersion(file, { checkpoint: candidate(engine), settings: { ...structuredClone(DEFAULT_SESSION_SETTINGS), revision: 9 }, reserveTarget: async target => {
    await fs.writeFile(`${target}.lock`, 'owned'); return async () => { released++; await fs.unlink(`${target}.lock`); };
  }, publishFile: async (filename, bytes, options) => { order.push(filename); assert.equal(options.noClobber, true); await writeSidecar(filename, bytes, options); } });
  assert.deepEqual(order, [`${result.projectPath}.history.json`, `${result.projectPath}.saved.json`, result.projectPath]); assert.equal(released, 0); assert.equal(typeof result.releaseLock, 'function');
  assert.equal((await loadSessionState(result.projectPath, result.project)).settings.revision, 9); await result.releaseLock(); assert.equal(released, 1);
});

test('failed publication cleans only own staged sidecars, rolls back assets, releases target lock', async t => {
  const { dir, file, engine } = await fixture(t), original = await fs.readFile(file); let rolledBack = 0, released = 0, target;
  await assert.rejects(prepareProjectVersion(file, { checkpoint: candidate(engine), reserveTarget: async filename => { target = filename; return async () => { released++; }; }, prepareAssets: async () => ({ rollback: async () => { rolledBack++; } }), publishFile: async (filename, bytes, options) => {
    if (filename.endsWith('.saved.json')) throw new Error('savedpoint write failed'); await writeSidecar(filename, bytes, options);
  } }), /savedpoint write failed/);
  assert.equal(released, 1); assert.equal(rolledBack, 1); assert.deepEqual(await fs.readFile(file), original);
  assert.deepEqual(await fs.readdir(dir), [path.basename(file)]); await assert.rejects(fs.stat(target), { code: 'ENOENT' });
});

test('rollback preserves an externally changed sidecar and an existing Save As destination', async t => {
  const { dir, file, engine } = await fixture(t); let target;
  await assert.rejects(prepareProjectVersion(file, { checkpoint: candidate(engine), reserveTarget: async filename => { target = filename; return async () => {}; }, publishFile: async (filename, bytes, options) => {
    if (filename.endsWith('.saved.json')) { await fs.writeFile(`${target}.history.json`, 'externally changed'); throw new Error('abort'); }
    await writeSidecar(filename, bytes, options);
  } }), error => error.message === 'abort' && error.warnings.some(item => item.code === 'SAVE_CLEANUP_PRESERVED'));
  assert.equal(await fs.readFile(`${target}.history.json`, 'utf8'), 'externally changed');
  const occupied = path.join(dir, 'Existing.newdaw.json'); await fs.writeFile(occupied, 'user file');
  await assert.rejects(prepareProjectVersion(file, { checkpoint: candidate(engine), mode: 'saveAs', outputPath: occupied }), error => error.code === 'OUTPUT_EXISTS'); assert.equal(await fs.readFile(occupied, 'utf8'), 'user file');
});

test('post-publication writer failure is recognized and still produces a complete saved version', async t => {
  const { file, engine } = await fixture(t);
  const result = await prepareProjectVersion(file, { checkpoint: candidate(engine), publishFile: async (filename, bytes, options) => { await writeSidecar(filename, bytes, options); throw new Error('published before fault'); } });
  assert.equal(result.warnings.filter(item => item.code === 'SAVE_COMMITTED_WITH_WARNING').length, 3);
  assert.deepEqual(await state(result.projectPath), result.project); assert.equal((await loadSavedCheckpoint(result.projectPath, result.project)).available, true); assert.equal((await loadSessionState(result.projectPath, result.project)).persistence.status, 'restored');
});

test('no-clobber publication race reports 409 and never removes the competing file', async t => {
  const { file, engine } = await fixture(t); let racedFile;
  await assert.rejects(prepareProjectVersion(file, { checkpoint: candidate(engine), publishFile: async (filename, bytes, options) => {
    racedFile = filename; await fs.writeFile(filename, bytes, { flag: 'wx' }); await writeSidecar(filename, bytes, options);
  } }), error => error.code === 'OUTPUT_EXISTS' && error.status === 409);
  // Even identical bytes cannot establish ownership after an EEXIST result.
  assert.ok((await fs.stat(racedFile)).isFile());
});

test('cross-directory Save As requires media preparation and gives it detached source/target context', async t => {
  const { dir, file, engine } = await fixture(t), sha256 = 'a'.repeat(64), destination = path.join(dir, 'destination'); await fs.mkdir(destination);
  assert.equal(engine.execute({ command: 'asset.add', arguments: { asset: { id: 'asset-audio', name: 'Audio.wav', sha256, path: `assets/${sha256}.wav`, frames: 100, channels: 1, sampleRate: 48000 } } }).status, 'applied');
  const outputPath = path.join(destination, 'Copied.newdaw.json'), checkpoint = candidate(engine);
  await assert.rejects(prepareProjectVersion(file, { checkpoint, mode: 'saveAs', outputPath }), error => error.code === 'MEDIA_COLLECTION_REQUIRED'); assert.deepEqual(await fs.readdir(destination), []);
  let received;
  const result = await prepareProjectVersion(file, { checkpoint, mode: 'saveAs', outputPath, prepareAssets: async context => { received = structuredClone(context); context.project.name = 'must not mutate checkpoint'; return { warnings: [{ code: 'TEST_PREPARED', message: 'Prepared by callback.' }] }; } });
  assert.equal(received.sourceDirectory, dir); assert.equal(received.directory, destination); assert.equal(result.project.name, checkpoint.project.name); assert.equal(result.warnings[0].code, 'TEST_PREPARED');
});

test('unsafe destination directories and source identity changes reject before publication', async t => {
  const { dir, file, engine } = await fixture(t), targetDir = path.join(dir, 'target'), link = path.join(dir, 'link'); await fs.mkdir(targetDir); await fs.symlink(targetDir, link);
  await assert.rejects(prepareProjectVersion(file, { checkpoint: candidate(engine), mode: 'saveAs', outputPath: path.join(link, 'Copy.newdaw.json') }), error => error.code === 'UNSAFE_PATH');
  const foreign = new Engine(createProject()); await assert.rejects(prepareProjectVersion(file, { checkpoint: foreign.checkpoint() }), error => error.code === 'PROJECT_SAVE_MISMATCH');
  assert.deepEqual(await fs.readdir(targetDir), []);
});

test('read-only preview shares version collision selection without reserving or writing anything', async t => {
  const { dir, file, engine } = await fixture(t), checkpoint = candidate(engine);
  await fs.writeFile(path.join(dir, 'Song-01.newdaw.json'), 'occupied'); await fs.writeFile(path.join(dir, 'Song-02.newdaw.json.history.json'), 'orphan');
  const before = (await fs.readdir(dir)).sort(), original = await fs.readFile(file);
  const preview = await previewProjectVersion(file, { checkpoint });
  assert.equal(path.basename(preview.projectPath), 'Song-03.newdaw.json'); assert.equal(preview.warnings[0].code, 'DESTINATION_NOT_RESERVED');
  assert.deepEqual((await fs.readdir(dir)).sort(), before); assert.deepEqual(await fs.readFile(file), original);
  // A later collision is allowed: the real operation must choose again.
  await fs.writeFile(preview.projectPath, 'another operation');
  const result = await prepareProjectVersion(file, { checkpoint }); assert.equal(path.basename(result.projectPath), 'Song-04.newdaw.json');
  assert.equal(await fs.readFile(preview.projectPath, 'utf8'), 'another operation');
});

test('Save As preview rejects occupied, missing-parent, symlink and malformed targets without mutations', async t => {
  const { dir, file, engine } = await fixture(t), checkpoint = candidate(engine), parent = path.join(dir, 'target'), link = path.join(dir, 'alias');
  await fs.mkdir(parent); await fs.symlink(parent, link); const occupied = path.join(parent, 'Occupied.newdaw.json'); await fs.writeFile(occupied, 'keep');
  const cases = [[occupied, 'OUTPUT_EXISTS'], [path.join(dir, 'missing', 'New.newdaw.json'), 'ENOENT'], [path.join(link, 'New.newdaw.json'), 'UNSAFE_PATH'], [`${dir}/invalid\0.newdaw.json`, 'INVALID_PROJECT_SAVE']];
  for (const [outputPath, code] of cases) await assert.rejects(previewProjectVersion(file, { checkpoint, mode: 'saveAs', outputPath }), error => error.code === code);
  assert.deepEqual(await fs.readdir(parent), ['Occupied.newdaw.json']); assert.equal(await fs.readFile(occupied, 'utf8'), 'keep');
  const free = path.join(parent, 'Free.newdaw.json'); assert.equal((await previewProjectVersion(file, { checkpoint, mode: 'saveAs', outputPath: free })).projectPath, free);
  await assert.rejects(fs.lstat(free), { code: 'ENOENT' });
});

test('preview rejects incompatible source identity and unwritable destination directories', async t => {
  const { dir, file, engine } = await fixture(t), foreign = new Engine(createProject());
  await assert.rejects(previewProjectVersion(file, { checkpoint: foreign.checkpoint() }), error => error.code === 'PROJECT_SAVE_MISMATCH');
  if (process.getuid?.() === 0) return;
  const parent = path.join(dir, 'read-only'); await fs.mkdir(parent); await fs.chmod(parent, 0o500);
  try { await assert.rejects(previewProjectVersion(file, { checkpoint: candidate(engine), mode: 'saveAs', outputPath: path.join(parent, 'New.newdaw.json') }), error => error.code === 'EACCES' || error.code === 'EPERM'); }
  finally { await fs.chmod(parent, 0o700); }
  assert.deepEqual(await fs.readdir(parent), []);
});

test('failed project publication reports callback-retained media without claiming the project committed', async t => {
  const { dir, file, engine } = await fixture(t), retained = path.join(dir, 'retained-copy.wav');
  await assert.rejects(prepareProjectVersion(file, { checkpoint: candidate(engine), prepareAssets: async () => {
    await fs.writeFile(retained, 'copy retained by caller'); return { retainedCopies: [retained] };
  }, publishFile: async () => { throw Object.assign(new Error('publication failed'), { details: { marker: 'preserved detail' } }); }
  }), error => error.message === 'publication failed' && error.details.projectCommitted === false && error.details.marker === 'preserved detail' && error.details.retainedCopies.length === 1 && error.details.retainedCopies[0] === retained);
  assert.equal(await fs.readFile(retained, 'utf8'), 'copy retained by caller');
  assert.deepEqual((await fs.readdir(dir)).sort(), [path.basename(file), path.basename(retained)].sort());
});
