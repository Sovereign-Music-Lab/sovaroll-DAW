import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createProject, Engine } from '../src/core/engine.mjs';
import { listBackups, createAutoBackup, readBackup, backupBaseName } from '../src/auto-backup.mjs';
import { writeSidecar } from '../src/session-store.mjs';

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'newdaw-backups-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'song.newdaw.json'), engine = new Engine(createProject());
  await fs.writeFile(file, JSON.stringify(engine.project));
  return { dir, file, engine };
}
const rename = (engine, name) => assert.equal(engine.execute({ command: 'project.rename', arguments: { name } }).status, 'applied');
const registryFile = file => `${file}.autobackups.json`;

test('backup JSON roundtrip, unchanged skip, forced copy and UUID-only download', async t => {
  const { dir, file, engine } = await fixture(t);
  assert.deepEqual((await listBackups(file)).files, []);
  const first = await createAutoBackup(file, engine.project, { now: new Date('2026-01-01T00:00:00Z') });
  assert.equal(first.status, 'created'); assert.equal(first.files.length, 1); assert.equal(first.files[0].sequence, 1);
  const restored = await readBackup(file, first.id); assert.deepEqual(restored.project, engine.project); assert.deepEqual(restored.bytes, await fs.readFile(path.join(dir, restored.entry.file)));
  const listing = await listBackups(file), registryBefore = await fs.readFile(registryFile(file));
  assert.equal((await createAutoBackup(file, engine.project)).status, 'skipped'); assert.deepEqual(await fs.readFile(registryFile(file)), registryBefore);
  const forced = await createAutoBackup(file, engine.project, { force: true }); assert.equal(forced.files.length, 2); assert.equal(forced.files[0].sequence, 2); assert.equal(forced.files[1].id, first.id);
  assert.equal(listing.lastFingerprint, first.fingerprint);
  for (const id of ['../song.newdaw.json', first.files[0].file, '../' + first.id, 'not-a-uuid']) await assert.rejects(readBackup(file, id), error => error.code === 'INVALID_BACKUP_ID' && error.status === 422);
  await assert.rejects(readBackup(file, '00000000-0000-4000-8000-000000000000'), error => error.code === 'NOT_FOUND' && error.status === 404);
});

test('rotation retains newest sequences across restart and clock reversal; shrinking works without edits', async t => {
  const { dir, file, engine } = await fixture(t), ids = [];
  for (let i = 0; i < 4; i++) {
    rename(engine, `Version ${i}`);
    ids.push((await createAutoBackup(file, engine.project, { maxCount: 3, now: Date.UTC(2026, 0, 5 - i) })).id);
  }
  const listed = await listBackups(file); assert.deepEqual(listed.files.map(entry => entry.id), ids.slice(1).reverse());
  assert.deepEqual(listed.files.map(entry => entry.sequence), [4, 3, 2]);
  const shrink = await createAutoBackup(file, engine.project, { maxCount: 1 }); assert.equal(shrink.status, 'skipped'); assert.equal(shrink.files.length, 1); assert.equal(shrink.files[0].sequence, 4);
  assert.equal((await fs.readdir(dir)).filter(name => name.includes('.autosave-')).length, 1);
  rename(engine, 'After restart'); const next = await createAutoBackup(file, engine.project, { maxCount: 1 }); assert.equal(next.files[0].sequence, 5);
});

test('rotation leaves unregistered matching-prefix files and ordinary .bak untouched', async t => {
  const { dir, file, engine } = await fixture(t), ordinary = `${file}.bak`, fake = `${path.basename(file)}.autosave-user-1-extra.bak`;
  await fs.writeFile(ordinary, 'user backup'); await fs.writeFile(path.join(dir, fake), 'unregistered');
  const first = await createAutoBackup(file, engine.project, { maxCount: 1 }); rename(engine, 'Changed'); await createAutoBackup(file, engine.project, { maxCount: 1 });
  await assert.rejects(fs.stat(path.join(dir, first.files[0].file)), { code: 'ENOENT' });
  assert.equal(await fs.readFile(ordinary, 'utf8'), 'user backup'); assert.equal(await fs.readFile(path.join(dir, fake), 'utf8'), 'unregistered');
});

test('changed or symlink registered backups are diagnosed, never deleted or followed', async t => {
  const { dir, file, engine } = await fixture(t);
  const first = await createAutoBackup(file, engine.project), damagedPath = path.join(dir, first.files[0].file); await fs.writeFile(damagedPath, 'damaged bytes');
  rename(engine, 'Second'); const second = await createAutoBackup(file, engine.project, { maxCount: 1 }), secondPath = path.join(dir, second.files[0].file);
  const external = path.join(dir, 'external.txt'); await fs.writeFile(external, 'external stays'); await fs.unlink(secondPath); await fs.symlink(external, secondPath);
  rename(engine, 'Third'); const third = await createAutoBackup(file, engine.project, { maxCount: 1 });
  assert.equal(third.files.length, 3); assert.equal(third.files.filter(entry => entry.valid).length, 1);
  assert.equal(await fs.readFile(damagedPath, 'utf8'), 'damaged bytes'); assert.equal((await fs.lstat(secondPath)).isSymbolicLink(), true); assert.equal(await fs.readFile(external, 'utf8'), 'external stays');
  await assert.rejects(readBackup(file, first.id), error => error.code === 'BACKUP_CHANGED'); await assert.rejects(readBackup(file, second.id), error => error.code === 'UNSAFE_PATH');
});

test('malicious registry paths are quarantined and cannot read or rotate arbitrary files', async t => {
  const { dir, file, engine } = await fixture(t), first = await createAutoBackup(file, engine.project), original = path.join(dir, first.files[0].file);
  const registry = JSON.parse(await fs.readFile(registryFile(file), 'utf8')); registry.entries[0].file = '../outside.bak';
  await fs.writeFile(registryFile(file), JSON.stringify(registry));
  const result = await listBackups(file); assert.equal(result.status, 'reset'); assert.deepEqual(result.files, []); assert.ok(result.warnings[0].preserved.includes('.quarantine-'));
  const fresh = await createAutoBackup(file, engine.project, { maxCount: 1 }); assert.equal(fresh.files[0].sequence, 1); assert.notEqual(fresh.id, first.id); assert.ok((await fs.stat(original)).isFile());
});

test('symlink registry preserves external target and project-directory symlink is rejected', async t => {
  const { dir, file, engine } = await fixture(t), external = path.join(dir, 'external.txt'), link = `${dir}-alias`;
  await fs.writeFile(external, 'keep external'); await fs.symlink(external, registryFile(file));
  const result = await createAutoBackup(file, engine.project); assert.ok(result.warnings.some(item => item.code === 'BACKUP_REGISTRY_INVALID')); assert.equal(await fs.readFile(external, 'utf8'), 'keep external');
  await fs.symlink(dir, link); t.after(() => fs.unlink(link));
  await assert.rejects(createAutoBackup(path.join(link, path.basename(file)), engine.project), error => error.code === 'UNSAFE_PATH');
});

test('registry failure cleans staged backup and preserves last successful fingerprint and files', async t => {
  const { dir, file, engine } = await fixture(t), first = await createAutoBackup(file, engine.project), names = (await fs.readdir(dir)).sort(), registry = await fs.readFile(registryFile(file));
  rename(engine, 'Candidate');
  await assert.rejects(createAutoBackup(file, engine.project, { maxCount: 1, writeRegistry: async () => { throw new Error('registry disk full'); } }), /registry disk full/);
  assert.deepEqual((await fs.readdir(dir)).sort(), names); assert.deepEqual(await fs.readFile(registryFile(file)), registry);
  const after = await listBackups(file); assert.equal(after.lastFingerprint, first.fingerprint); assert.equal(after.files[0].id, first.id);
  const retry = await createAutoBackup(file, engine.project, { maxCount: 1 }); assert.equal(retry.files[0].sequence, 2); assert.equal(retry.status, 'created');
});

test('post-registry-publication failure reports committed backup and keeps it readable', async t => {
  const { file, engine } = await fixture(t);
  const result = await createAutoBackup(file, engine.project, { writeRegistry: async (name, bytes) => { await writeSidecar(name, bytes); throw new Error('fsync fault'); } });
  assert.equal(result.status, 'created'); assert.ok(result.warnings.some(item => item.code === 'BACKUP_COMMITTED_WITH_WARNING'));
  assert.deepEqual((await readBackup(file, result.id)).project, engine.project);
});

test('overlapping same-snapshot requests publish exactly one backup', async t => {
  const { dir, file, engine } = await fixture(t);
  const results = await Promise.all(Array.from({ length: 8 }, () => createAutoBackup(file, engine.project)));
  assert.equal(results.filter(item => item.status === 'created').length, 1); assert.equal((await listBackups(file)).files.length, 1);
  assert.equal((await fs.readdir(dir)).filter(name => name.includes('.autosave-')).length, 1);
});

test('JSON-only backup keeps asset references, works with missing main file and never copies media', async t => {
  const { dir, file, engine } = await fixture(t), sha = 'a'.repeat(64);
  assert.equal(engine.execute({ command: 'asset.add', arguments: { asset: { id: 'asset-1', name: 'Missing source.wav', path: `assets/${sha}.wav`, sha256: sha, frames: 48000, sampleRate: 48000, channels: 2 } } }).status, 'applied');
  const result = await createAutoBackup(file, engine.project); await fs.unlink(file);
  const read = await readBackup(file, result.id); assert.equal(read.project.assets.length, 1); assert.equal(read.project.assets[0].path, `assets/${sha}.wav`);
  await assert.rejects(fs.stat(path.join(dir, 'assets')), { code: 'ENOENT' }); assert.equal((await listBackups(file)).files[0].valid, true);
});

test('different project identity preserves old registry/backups and starts separate ownership', async t => {
  const { dir, file, engine } = await fixture(t), first = await createAutoBackup(file, engine.project), other = createProject({ name: 'Replacement' });
  const result = await createAutoBackup(file, other, { maxCount: 1 }); assert.ok(result.warnings.some(item => item.code === 'BACKUP_PROJECT_MISMATCH'));
  assert.equal(result.files[0].sequence, 1); assert.ok((await fs.stat(path.join(dir, first.files[0].file))).isFile());
});

test('retention and timestamp bounds reject before writing', async t => {
  const { dir, file, engine } = await fixture(t);
  for (const maxCount of [0, 1001, 1.5, '10']) await assert.rejects(createAutoBackup(file, engine.project, { maxCount }), error => error.code === 'INVALID_BACKUP_SETTINGS');
  await assert.rejects(createAutoBackup(file, engine.project, { now: new Date('invalid') }), error => error.code === 'INVALID_BACKUP_SETTINGS');
  assert.deepEqual(await fs.readdir(dir), [path.basename(file)]);
});

test('numbered project backups preserve occupied files, symlinks and directories while skipping their numbers', async t => {
  const { dir, file, engine } = await fixture(t);
  await fs.writeFile(path.join(dir, 'song-01.bak'), 'foreign backup');
  await fs.symlink('song-01.bak', path.join(dir, 'song-02.bak'));
  await fs.mkdir(path.join(dir, 'song-03.bak'));
  const first = await createAutoBackup(file, engine.project, { baseName: 'song', maxCount: 1 });
  assert.equal(first.files[0].file, 'song-04.bak');
  rename(engine, 'A different display title');
  const next = await createAutoBackup(file, engine.project, { baseName: 'song', maxCount: 1 });
  assert.equal(next.files[0].file, 'song-05.bak');
  assert.deepEqual((await readBackup(file, next.id)).project, engine.project);
  await assert.rejects(fs.lstat(path.join(dir, 'song-04.bak')), { code: 'ENOENT' });
  assert.equal(await fs.readFile(path.join(dir, 'song-01.bak'), 'utf8'), 'foreign backup');
  assert.equal((await fs.lstat(path.join(dir, 'song-02.bak'))).isSymbolicLink(), true);
  assert.equal((await fs.lstat(path.join(dir, 'song-03.bak'))).isDirectory(), true);
});

test('numbered backup migration retains and reads legacy entries and continues sequence after reopening', async t => {
  const { dir, file, engine } = await fixture(t);
  const old = await createAutoBackup(file, engine.project);
  rename(engine, 'Migration');
  const modern = await createAutoBackup(file, engine.project, { baseName: 'song' });
  assert.equal(modern.files[0].file, 'song-02.bak');
  assert.equal(modern.files[1].file, old.files[0].file);
  assert.deepEqual((await readBackup(file, old.id)).project, JSON.parse(await fs.readFile(path.join(dir, old.files[0].file))));
  const registry = JSON.parse(await fs.readFile(registryFile(file)));
  assert.equal(registry.schemaVersion, 2); assert.equal(registry.baseName, 'song');
  // Policy is persisted; a caller that does not specify it must retain it.
  const forced = await createAutoBackup(file, engine.project, { force: true });
  assert.equal(forced.files[0].file, 'song-03.bak');
  assert.equal((await listBackups(file)).files.length, 3);
});

test('Untitled numbered backups use the document number independently of hidden working filename', async t => {
  const { dir, engine } = await fixture(t), file = path.join(dir, '.newdaw-draft-00000000-0000-4000-8000-000000000001.newdaw.json');
  const first = await createAutoBackup(file, engine.project, { baseName: 'Untitled27' });
  assert.equal(first.files[0].file, 'Untitled27-01.bak');
  const second = await createAutoBackup(file, engine.project, { baseName: 'Untitled27', force: true });
  assert.equal(second.files[0].file, 'Untitled27-02.bak');
  assert.equal((await listBackups(file)).files.every(item => item.valid), true);
  await assert.rejects(createAutoBackup(file, engine.project, { baseName: 'Untitled28' }), /naming policy changed/);
});

test('numbered backup registry corruption preserves snapshots and skips occupied names after reset', async t => {
  const { dir, file, engine } = await fixture(t);
  const first = await createAutoBackup(file, engine.project, { baseName: 'song' });
  const registry = JSON.parse(await fs.readFile(registryFile(file))); registry.baseName = '../song';
  await fs.writeFile(registryFile(file), JSON.stringify(registry));
  const fresh = await createAutoBackup(file, engine.project, { baseName: 'song', maxCount: 1 });
  assert.equal(fresh.files[0].file, 'song-02.bak');
  assert.ok(fresh.warnings.some(item => item.code === 'BACKUP_REGISTRY_INVALID'));
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir, first.files[0].file))), engine.project);
});

test('numbered backup failure cannot delete an external replacement at the just-published path', async t => {
  const { dir, file, engine } = await fixture(t);
  await assert.rejects(createAutoBackup(file, engine.project, { baseName: 'song', writeRegistry: async () => {
    await fs.writeFile(path.join(dir, 'song-01.bak'), 'external replacement');
    throw new Error('registry publication failed');
  } }), /registry publication failed/);
  assert.equal(await fs.readFile(path.join(dir, 'song-01.bak'), 'utf8'), 'external replacement');
  const retry = await createAutoBackup(file, engine.project, { baseName: 'song' });
  assert.equal(retry.files[0].file, 'song-02.bak');
});

test('numbered backup base must match filename, rejecting traversal and unsafe forms without writes', async t => {
  const { dir, file, engine } = await fixture(t), before = await fs.readdir(dir);
  for (const baseName of ['../song', 'song/name', '.', '', 'other', 'song\\name', 'x'.repeat(221)]) await assert.rejects(createAutoBackup(file, engine.project, { baseName }), { code: 'INVALID_BACKUP_SETTINGS' });
  assert.deepEqual(await fs.readdir(dir), before);
});


test('dotfile project names retain a usable backup stem and readable numbered generations', async t => {
  const { dir, engine } = await fixture(t);
  for (const name of ['.session', '.newdaw.json', 'Session', 'Session.newdaw.json', 'Session.json']) {
    const file = path.join(dir, name), baseName = backupBaseName(file);
    assert.ok(baseName.length > 0); assert.equal(baseName, name.startsWith('.') ? name : 'Session');
    const made = await createAutoBackup(file, engine.project, { baseName });
    assert.equal(made.files[0].file, `${baseName}-${String(made.files[0].sequence).padStart(2, '0')}.bak`);
    assert.equal((await listBackups(file)).files[0].valid, true);
    assert.deepEqual((await readBackup(file, made.id)).project, engine.project);
  }
});
