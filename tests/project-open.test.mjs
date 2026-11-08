import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { Engine, createProject } from '../src/core/engine.mjs';
import { acquireProjectLock } from '../src/storage.mjs';
import { updateSessionSettings, DEFAULT_SESSION_SETTINGS, canonicalProjectHash } from '../src/session-store.mjs';
import { saveExplicitCheckpoint } from '../src/project-save.mjs';
import { createAutoBackup } from '../src/auto-backup.mjs';
import { registerCreatedMedia } from '../src/revert-media.mjs';
import { encodeWav } from '../src/media/wav.mjs';
import { inspectExistingProject, prepareExistingProject } from '../src/project-open.mjs';

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'newdaw-open-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'Existing.newdaw.json'), engine = new Engine(createProject({ name: 'Existing project' }));
  await fs.writeFile(file, JSON.stringify(engine.project)); return { dir, file, engine };
}
const reserve = filename => acquireProjectLock(filename, 'http://127.0.0.1:4317');
const rename = (engine, name) => assert.equal(engine.execute({ command: 'project.rename', arguments: { name } }).status, 'applied');
async function files(dir) {
  const result = {};
  for (const name of (await fs.readdir(dir)).sort()) { const stat = await fs.lstat(path.join(dir, name)); if (stat.isFile()) result[name] = await fs.readFile(path.join(dir, name)); else if (stat.isSymbolicLink()) result[name] = `link:${await fs.readlink(path.join(dir, name))}`; else result[name] = 'directory'; }
  return result;
}
async function seeded(t) {
  const f = await fixture(t); rename(f.engine, 'First edit'); rename(f.engine, 'Second edit'); f.engine.execute({ command: 'history.undo', arguments: {} });
  await fs.writeFile(f.file, JSON.stringify(f.engine.project));
  await updateSessionSettings(f.file, f.engine.checkpoint(), { revision: 4, autoBackup: { enabled: false, intervalMinutes: 12, maxCount: 8 } });
  await saveExplicitCheckpoint(f.file, f.engine.project); await createAutoBackup(f.file, f.engine.project); return f;
}

test('inspection restores validated history/settings/saved/backup state without filesystem writes', async t => {
  const f = await seeded(t), before = await files(f.dir), result = await inspectExistingProject(f.file);
  assert.deepEqual(result.project, f.engine.project); assert.deepEqual(result.checkpoint, f.engine.checkpoint()); assert.equal(result.checkpoint.history.cursor, 1);
  assert.equal(result.settings.revision, 4); assert.equal(result.settings.autoBackup.intervalMinutes, 12); assert.equal(result.saved.available, true); assert.equal(result.saved.dirty, false);
  assert.equal(result.backups.files.length, 1); assert.equal(result.backups.files[0].valid, true); assert.equal(result.backups.lastFingerprint, canonicalProjectHash(f.engine.project));
  assert.deepEqual(await files(f.dir), before); assert.equal(result.willInitializeSavedCheckpoint, false);
  assert.equal(result.fingerprint.sha256, createHash('sha256').update(await fs.readFile(f.file)).digest('hex')); assert.equal(result.projectPath, await fs.realpath(f.file));
});

test('opening an existing project holds its lock, preserves project bytes/revision and returns a resumable checkpoint', async t => {
  const f = await seeded(t), preview = await inspectExistingProject(f.file), original = await fs.readFile(f.file);
  const prepared = await prepareExistingProject(f.file, { expectedFingerprint: preview.fingerprint, reserveTarget: reserve });
  try {
    assert.equal(typeof prepared.releaseLock, 'function'); assert.ok((await fs.lstat(`${f.file}.lock`)).isFile());
    assert.deepEqual(await fs.readFile(f.file), original); assert.equal(prepared.project.revision, f.engine.project.revision);
    const restored = new Engine(prepared.project); restored.restoreCheckpoint(prepared.checkpoint); assert.equal(restored.canRedo, true);
    assert.equal(restored.execute({ command: 'history.redo', arguments: {} }).status, 'applied'); assert.equal(restored.project.name, 'Second edit');
  } finally { await prepared.releaseLock(); }
  await assert.rejects(fs.lstat(`${f.file}.lock`), { code: 'ENOENT' });
});

test('preview never initializes missing Save baseline; actual open initializes opened-project once', async t => {
  const f = await fixture(t), original = await fs.readFile(f.file), before = await files(f.dir), preview = await inspectExistingProject(f.file);
  assert.equal(preview.saved.available, false); assert.equal(preview.willInitializeSavedCheckpoint, true); assert.deepEqual(await files(f.dir), before);
  const prepared = await prepareExistingProject(f.file, { expectedFingerprint: preview.fingerprint, reserveTarget: reserve });
  await prepared.releaseLock(); assert.equal(prepared.saved.available, true); assert.equal(prepared.saved.checkpoint.origin, 'opened-project');
  assert.deepEqual(prepared.saved.checkpoint.mediaOwnershipIds, []); assert.deepEqual(await fs.readFile(f.file), original);
  assert.deepEqual(prepared.settings, DEFAULT_SESSION_SETTINGS); assert.equal(prepared.checkpoint.history.entries.length, 0);
  assert.equal((await inspectExistingProject(f.file)).saved.checkpoint.saveId, prepared.saved.checkpoint.saveId);
});

test('corrupt sidecars are untouched by preview; actual open preserves history/backup originals and keeps Save unavailable', async t => {
  const f = await fixture(t);
  for (const suffix of ['.history.json', '.saved.json', '.autobackups.json']) await fs.writeFile(f.file + suffix, `{bad ${suffix}`);
  const before = await files(f.dir), preview = await inspectExistingProject(f.file);
  assert.equal(preview.persistence.status, 'reset'); assert.equal(preview.saved.available, false); assert.equal(preview.backups.status, 'reset'); assert.deepEqual(await files(f.dir), before);
  const prepared = await prepareExistingProject(f.file, { expectedFingerprint: preview.fingerprint, reserveTarget: reserve });
  await prepared.releaseLock(); assert.equal(prepared.saved.available, false); assert.equal(prepared.checkpoint.history.entries.length, 0); assert.equal(prepared.willInitializeSavedCheckpoint, false);
  assert.deepEqual(await fs.readFile(f.file), before[path.basename(f.file)]); assert.deepEqual(await fs.readFile(`${f.file}.saved.json`), before[`${path.basename(f.file)}.saved.json`]);
  const names = await fs.readdir(f.dir); assert.equal(names.filter(name => name.includes('.quarantine-')).length, 2);
  assert.ok(prepared.warnings.some(item => item.code === 'JOURNAL_INVALID')); assert.ok(prepared.warnings.some(item => item.code === 'BACKUP_REGISTRY_INVALID'));
});

test('same-revision external content change invalidates history while retaining the original journal on preview', async t => {
  const f = await seeded(t), originalJournal = await fs.readFile(`${f.file}.history.json`), changed = f.engine.project; changed.name = 'Changed outside the application';
  await fs.writeFile(f.file, JSON.stringify(changed)); const preview = await inspectExistingProject(f.file);
  assert.equal(preview.persistence.status, 'reset'); assert.ok(preview.persistence.warnings.some(item => item.code === 'JOURNAL_MISMATCH')); assert.deepEqual(await fs.readFile(`${f.file}.history.json`), originalJournal);
  assert.equal(preview.saved.available, true); assert.equal(preview.saved.dirty, true);
});

test('target fingerprint changes reject after lock acquisition and release without sidecar initialization', async t => {
  const f = await fixture(t), preview = await inspectExistingProject(f.file); let acquired = 0, released = 0;
  const changed = f.engine.project; changed.name = 'Changed after preview'; await fs.writeFile(f.file, JSON.stringify(changed));
  const before = await files(f.dir);
  await assert.rejects(prepareExistingProject(f.file, { expectedFingerprint: preview.fingerprint, reserveTarget: async filename => {
    acquired++; const release = await reserve(filename); return async () => { released++; await release(); };
  } }), error => error.code === 'PROJECT_FILE_CHANGED' && error.status === 409);
  assert.equal(acquired, 1); assert.equal(released, 1); assert.deepEqual(await files(f.dir), before);
});

test('strict fingerprint detects whitespace-only edits and same-bytes inode replacement', async t => {
  const f = await fixture(t), initial = await inspectExistingProject(f.file), bytes = await fs.readFile(f.file);
  await fs.appendFile(f.file, '\n');
  await assert.rejects(prepareExistingProject(f.file, { expectedFingerprint: initial.fingerprint, reserveTarget: reserve }), error => error.code === 'PROJECT_FILE_CHANGED');
  const second = await inspectExistingProject(f.file); await fs.rename(f.file, `${f.file}.old`); await fs.writeFile(f.file, await fs.readFile(`${f.file}.old`));
  await assert.rejects(prepareExistingProject(f.file, { expectedFingerprint: second.fingerprint, reserveTarget: reserve }), error => error.code === 'PROJECT_FILE_CHANGED');
  assert.deepEqual(await fs.readFile(f.file), Buffer.concat([bytes, Buffer.from('\n')])); await assert.rejects(fs.lstat(`${f.file}.saved.json`), { code: 'ENOENT' });
});

test('post-reservation validation failure releases the target and never creates or substitutes a demo', async t => {
  const f = await fixture(t), preview = await inspectExistingProject(f.file); let released = 0;
  await assert.rejects(prepareExistingProject(f.file, { expectedFingerprint: preview.fingerprint, reserveTarget: async filename => {
    const release = await reserve(filename); await fs.writeFile(filename, '{invalid after lock'); return async () => { released++; await release(); };
  } }), error => error.code === 'INVALID_PROJECT_JSON');
  assert.equal(released, 1); assert.equal(await fs.readFile(f.file, 'utf8'), '{invalid after lock'); await assert.rejects(fs.lstat(`${f.file}.saved.json`), { code: 'ENOENT' });
});

test('missing, malformed, oversized and symlink paths fail without creating targets or following links', async t => {
  const f = await fixture(t), preview = await inspectExistingProject(f.file), missing = path.join(f.dir, 'missing', 'Project.json'); let reserved = false;
  await assert.rejects(inspectExistingProject(missing), { code: 'ENOENT' });
  await assert.rejects(prepareExistingProject(missing, { expectedFingerprint: preview.fingerprint, reserveTarget: async () => { reserved = true; return () => {}; } }), { code: 'ENOENT' });
  assert.equal(reserved, false); await assert.rejects(fs.lstat(path.dirname(missing)), { code: 'ENOENT' });
  const alias = path.join(f.dir, 'alias.json'); await fs.symlink(f.file, alias); await assert.rejects(inspectExistingProject(alias), error => error.code === 'UNSAFE_PROJECT_PATH');
  const parent = path.join(f.dir, 'real'), link = path.join(f.dir, 'parent-link'); await fs.mkdir(parent); await fs.writeFile(path.join(parent, 'Project.json'), JSON.stringify(f.engine.project)); await fs.symlink(parent, link);
  await assert.rejects(inspectExistingProject(path.join(link, 'Project.json')), error => error.code === 'UNSAFE_PROJECT_PATH');
  const huge = path.join(f.dir, 'Huge.json'), handle = await fs.open(huge, 'w'); await handle.truncate(16 * 1024 * 1024 + 1); await handle.close(); await assert.rejects(inspectExistingProject(huge), error => error.code === 'FILE_TOO_LARGE');
  const malformed = path.join(f.dir, 'Malformed.json'); await fs.writeFile(malformed, '{}'); await assert.rejects(inspectExistingProject(malformed), error => error.code === 'VALIDATION_ERROR');
});

test('missing/changed managed WAVs are reported but do not block opening or mutate media', async t => {
  const f = await fixture(t), bytes = Buffer.from(encodeWav({ sampleRate: 8000, channels: [new Float32Array(80).fill(.2)] })), sha256 = createHash('sha256').update(bytes).digest('hex');
  const ready = { id: 'ready', name: 'Ready.wav', sha256, path: `assets/${sha256}.wav`, sampleRate: 8000, channels: 1, frames: 80 }, missing = { ...ready, id: 'missing', name: 'Missing.wav', sha256: 'a'.repeat(64), path: `assets/${'a'.repeat(64)}.wav` }, changed = { ...ready, id: 'changed', name: 'Changed.wav', sha256: 'b'.repeat(64), path: `assets/${'b'.repeat(64)}.wav` };
  const project = f.engine.project; project.assets = [ready, missing, changed]; await fs.writeFile(f.file, JSON.stringify(project)); await fs.mkdir(path.join(f.dir, 'assets')); await fs.writeFile(path.join(f.dir, ready.path), bytes); await fs.writeFile(path.join(f.dir, changed.path), 'changed media bytes');
  const preview = await inspectExistingProject(f.file); assert.deepEqual(preview.media.assets.map(item => item.status), ['ready', 'missing', 'changed']);
  const prepared = await prepareExistingProject(f.file, { expectedFingerprint: preview.fingerprint, reserveTarget: reserve }); await prepared.releaseLock();
  assert.deepEqual(prepared.media.assets.map(item => item.status), ['ready', 'missing', 'changed']); assert.ok(prepared.warnings.some(item => item.code === 'ASSET_MISSING')); assert.ok(prepared.warnings.some(item => item.code === 'ASSET_CHANGED'));
  assert.equal(await fs.readFile(path.join(f.dir, changed.path), 'utf8'), 'changed media bytes'); assert.deepEqual(await fs.readFile(path.join(f.dir, ready.path)), bytes); await assert.rejects(fs.stat(path.join(f.dir, missing.path)), { code: 'ENOENT' });
});

test('actual opened baseline captures existing ownership IDs while inspection leaves its absence intact', async t => {
  const f = await fixture(t), bytes = Buffer.from(encodeWav({ sampleRate: 8000, channels: [new Float32Array(80).fill(.2)] })), sha256 = createHash('sha256').update(bytes).digest('hex');
  const asset = { id: 'owned', name: 'Owned.wav', sha256, path: `assets/${sha256}.wav`, sampleRate: 8000, channels: 1, frames: 80 };
  await fs.mkdir(path.join(f.dir, 'assets')); await fs.writeFile(path.join(f.dir, asset.path), bytes); const owned = await registerCreatedMedia(f.file, asset);
  const preview = await inspectExistingProject(f.file); assert.equal(preview.willInitializeSavedCheckpoint, true); await assert.rejects(fs.stat(`${f.file}.saved.json`), { code: 'ENOENT' });
  const prepared = await prepareExistingProject(f.file, { expectedFingerprint: preview.fingerprint, reserveTarget: reserve }); await prepared.releaseLock();
  assert.deepEqual(prepared.saved.checkpoint.mediaOwnershipIds, [owned.ownershipId]);
});

test('an already locked target is not modified, and missing/invalid fingerprint never attempts reservation', async t => {
  const f = await fixture(t), preview = await inspectExistingProject(f.file), release = await reserve(f.file), before = await files(f.dir);
  try { await assert.rejects(prepareExistingProject(f.file, { expectedFingerprint: preview.fingerprint, reserveTarget: reserve }), /already open/); assert.deepEqual(await files(f.dir), before); }
  finally { await release(); }
  let called = false;
  for (const expectedFingerprint of [undefined, {}, { ...preview.fingerprint, sha256: 'invalid' }]) await assert.rejects(prepareExistingProject(f.file, { expectedFingerprint, reserveTarget: () => { called = true; } }), error => error.code === 'EXPECTED_FINGERPRINT_REQUIRED');
  assert.equal(called, false);
});

test('an external edit during initial saved-baseline publication is detected before adoption and releases the lock', async t => {
  const f = await fixture(t), preview = await inspectExistingProject(f.file), original = await fs.readFile(f.file), realLink = fs.link.bind(fs); let injected = false;
  t.mock.method(fs, 'link', async (source, destination) => {
    await realLink(source, destination);
    if (String(destination).endsWith('.saved.json') && !injected) { injected = true; await fs.appendFile(f.file, '\n'); }
  });
  await assert.rejects(prepareExistingProject(f.file, { expectedFingerprint: preview.fingerprint, reserveTarget: reserve }), error => error.code === 'PROJECT_FILE_CHANGED' && error.status === 409);
  assert.equal(injected, true); await assert.rejects(fs.lstat(`${f.file}.lock`), { code: 'ENOENT' });
  assert.deepEqual(await fs.readFile(f.file), Buffer.concat([original, Buffer.from('\n')]));
  assert.ok((await fs.lstat(`${f.file}.saved.json`)).isFile());
});

test('inactive inspection and preparation defer all WAV reads without claiming availability', async t => {
  const f = await fixture(t), bytes = Buffer.from(encodeWav({ sampleRate: 8000, channels: [new Float32Array(80).fill(.2)] }));
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const ready = { id: 'ready', name: 'Ready.wav', sha256, path: `assets/${sha256}.wav`, sampleRate: 8000, channels: 1, frames: 80 };
  const missing = { ...ready, id: 'missing', sha256: 'a'.repeat(64), path: `assets/${'a'.repeat(64)}.wav` };
  const project = f.engine.project; project.assets = [ready, missing]; await fs.writeFile(f.file, JSON.stringify(project));
  await fs.mkdir(path.join(f.dir, 'assets')); await fs.writeFile(path.join(f.dir, ready.path), bytes);
  const realOpen = fs.open.bind(fs); let wavReads = 0;
  t.mock.method(fs, 'open', async (filename, ...args) => { if (String(filename).endsWith('.wav')) wavReads++; return realOpen(filename, ...args); });
  const before = await files(f.dir), preview = await inspectExistingProject(f.file, { deferredMedia: true });
  assert.equal(preview.resources, 'deferred'); assert.equal(preview.media.deferred, true); assert.deepEqual(await files(f.dir), before);
  const prepared = await prepareExistingProject(f.file, { deferredMedia: true, expectedFingerprint: preview.fingerprint, reserveTarget: reserve });
  await prepared.releaseLock();
  assert.equal(wavReads, 0); assert.equal(prepared.saved.available, true); assert.equal(prepared.resources, 'deferred');
  for (const item of prepared.media.assets) { assert.equal(item.status, 'deferred'); assert.equal(item.available, null); assert.equal(item.hashValid, null); assert.equal(item.bytes, null); }
  const active = await inspectExistingProject(f.file);
  assert.ok(wavReads > 0); assert.equal(active.resources, 'initialized'); assert.deepEqual(active.media.assets.map(asset => asset.status), ['ready', 'missing']);
});

test('invalid deferred-media options reject before reservation or saved-baseline writes', async t => {
  const f = await fixture(t), preview = await inspectExistingProject(f.file); let acquired = false;
  const before = await files(f.dir);
  await assert.rejects(inspectExistingProject(f.file, { deferredMedia: 'yes' }), { code: 'INVALID_PROJECT_OPEN' });
  await assert.rejects(prepareExistingProject(f.file, { expectedFingerprint: preview.fingerprint, deferredMedia: 1, reserveTarget: () => { acquired = true; } }), { code: 'INVALID_PROJECT_OPEN' });
  assert.equal(acquired, false); assert.deepEqual(await files(f.dir), before);
});

test('named-project preview and reopen share v2 validation for mixed legacy and numbered backups without touching files', async t => {
  const f = await seeded(t), latest = await createAutoBackup(f.file, f.engine.project, { baseName: 'Existing', force: true }), before = await files(f.dir);
  assert.equal(latest.files.length, 2); assert.equal(latest.files[0].file, 'Existing-02.bak');
  const preview = await inspectExistingProject(f.file); assert.equal(preview.backups.status, 'ready'); assert.equal(preview.backups.files.length, 2); assert.ok(preview.backups.files.every(entry => entry.valid));
  assert.equal(preview.backups.lastFingerprint, canonicalProjectHash(f.engine.project)); assert.ok(!preview.warnings.some(item => item.code === 'BACKUP_REGISTRY_INVALID')); assert.deepEqual(await files(f.dir), before);
  const prepared = await prepareExistingProject(f.file, { expectedFingerprint: preview.fingerprint, reserveTarget: reserve }); await prepared.releaseLock();
  assert.deepEqual(prepared.backups.files.map(entry => entry.id), preview.backups.files.map(entry => entry.id)); assert.deepEqual(await files(f.dir), before);
});
