import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Engine, createProject } from '../src/core/engine.mjs';
import { saveProject } from '../src/storage.mjs';
import { loadSessionState, commitSessionState, updateSessionSettings, canonicalProjectHash, DEFAULT_SESSION_SETTINGS, MAX_JOURNAL_BYTES, writeSidecar } from '../src/session-store.mjs';

const settings = (revision = 0, options = {}) => ({ revision, autoBackup: { ...DEFAULT_SESSION_SETTINGS.autoBackup, ...options } });
const rename = (engine, name) => { const result = engine.execute({ command: 'project.rename', arguments: { name } }); assert.equal(result.status, 'applied'); };
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'newdaw-journal-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'song.newdaw.json'), engine = new Engine(createProject({ name: 'Before' }));
  await fs.writeFile(file, JSON.stringify(engine.project));
  return { dir, file, engine };
}
const diskProject = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const load = async file => loadSessionState(file, await diskProject(file));

test('legacy projects load default settings and canonical fingerprint ignores JSON key order', async t => {
  const { file, engine } = await fixture(t), result = await load(file);
  assert.equal(result.history, null); assert.equal(result.persistence.status, 'new'); assert.deepEqual(result.settings, settings());
  assert.equal(canonicalProjectHash(engine.project), canonicalProjectHash(Object.fromEntries(Object.entries(engine.project).reverse())));
  const modified = engine.project; modified.name = 'Same revision changed externally';
  assert.notEqual(canonicalProjectHash(engine.project), canonicalProjectHash(modified));
});

test('durable history restores exact undo and redo boundary after project commit', async t => {
  const { file, engine } = await fixture(t), initial = engine.checkpoint();
  rename(engine, 'One'); rename(engine, 'Two');
  assert.equal(engine.execute({ command: 'history.undo', arguments: {} }).status, 'applied');
  const result = await commitSessionState(file, { currentCheckpoint: initial, nextCheckpoint: engine.checkpoint(), settings: settings(2, { enabled: false }) });
  const reopened = await load(file), restored = new Engine(await diskProject(file)); restored.restoreHistory(reopened.history);
  assert.deepEqual(restored.checkpoint(), result.checkpoint); assert.equal(restored.canRedo, true); assert.equal(restored.canUndo, true);
  assert.equal(restored.execute({ command: 'history.redo', arguments: {} }).status, 'applied'); assert.equal(restored.project.name, 'Two');
  assert.equal(reopened.settings.revision, 2); assert.equal(reopened.settings.autoBackup.enabled, false);
  const journal = JSON.parse(await fs.readFile(`${file}.history.json`, 'utf8'));
  assert.equal(Object.hasOwn(journal.current, 'project'), false); assert.equal(journal.current.projectHash, canonicalProjectHash(engine.project));
});

test('journal failure prevents project writer and leaves committed project untouched', async t => {
  const { file, engine } = await fixture(t), current = engine.checkpoint(); rename(engine, 'Candidate'); let called = false;
  await assert.rejects(commitSessionState(file, { currentCheckpoint: current, nextCheckpoint: engine.checkpoint(), writeJournal: async () => { throw new Error('journal fault'); }, persistProject: async () => { called = true; } }), /journal fault/);
  assert.equal(called, false); assert.equal((await diskProject(file)).name, 'Before'); assert.equal((await load(file)).history, null);
});

test('failed project save restores previous generation, including previously committed settings', async t => {
  const { file, engine } = await fixture(t);
  await updateSessionSettings(file, engine.checkpoint(), settings(4, { maxCount: 3 }));
  const current = engine.checkpoint(); rename(engine, 'Candidate');
  await assert.rejects(commitSessionState(file, { currentCheckpoint: current, nextCheckpoint: engine.checkpoint(), settings: settings(5), persistProject: async () => { throw new Error('disk full'); } }), /disk full/);
  const reopened = await load(file);
  assert.equal(reopened.persistence.status, 'restored-previous'); assert.deepEqual(reopened.history, current.history); assert.equal(reopened.settings.revision, 4);
  assert.equal((await diskProject(file)).name, 'Before');
});

test('crash after journal publication leaves previous history; post-project-commit error selects new history', async t => {
  const { file, engine } = await fixture(t), current = engine.checkpoint(); rename(engine, 'Candidate');
  await assert.rejects(commitSessionState(file, { currentCheckpoint: current, nextCheckpoint: engine.checkpoint(), writeJournal: async (name, bytes) => { await writeSidecar(name, bytes); throw new Error('crash after journal'); } }), /crash after journal/);
  assert.equal((await load(file)).persistence.status, 'restored-previous');
  const committed = await commitSessionState(file, { currentCheckpoint: current, nextCheckpoint: engine.checkpoint(), persistProject: async (name, project) => { await saveProject(name, project); throw new Error('postcommit crash'); } });
  assert.ok(committed.warnings.some(item => item.code === 'PROJECT_COMMITTED_WITH_WARNING'));
  assert.deepEqual((await load(file)).history, engine.exportHistory()); assert.equal((await diskProject(file)).name, 'Candidate');
});

test('corrupt and same-revision mismatched journals are preserved before fresh writes', async t => {
  const { file, engine, dir } = await fixture(t);
  await fs.writeFile(`${file}.history.json`, '{broken');
  const corrupt = await load(file); assert.equal(corrupt.persistence.status, 'reset'); assert.equal(corrupt.history, null);
  const preserved = corrupt.persistence.warnings[0].preserved; assert.equal(await fs.readFile(path.join(dir, preserved), 'utf8'), '{broken');
  await updateSessionSettings(file, engine.checkpoint(), settings(1));
  const modified = engine.project; modified.name = 'External same-revision content'; await fs.writeFile(file, JSON.stringify(modified));
  const mismatch = await load(file); assert.equal(mismatch.persistence.status, 'reset'); assert.equal(mismatch.persistence.warnings[0].code, 'JOURNAL_MISMATCH');
  await updateSessionSettings(file, new Engine(modified).checkpoint(), settings(2));
  assert.equal(await fs.readFile(path.join(dir, preserved), 'utf8'), '{broken');
  assert.equal((await fs.readdir(dir)).filter(name => name.includes('.quarantine-')).length, 2);
});

test('unsafe symlink journal is quarantined without following or overwriting its target', async t => {
  const { file, dir, engine } = await fixture(t), external = path.join(dir, 'external.txt');
  await fs.writeFile(external, 'keep me'); await fs.symlink(external, `${file}.history.json`);
  const result = await load(file); assert.equal(result.persistence.status, 'reset');
  const preserved = path.join(dir, result.persistence.warnings[0].preserved); assert.equal((await fs.lstat(preserved)).isSymbolicLink(), true);
  await updateSessionSettings(file, engine.checkpoint(), settings()); assert.equal(await fs.readFile(external, 'utf8'), 'keep me');
});

test('symlink project directory and directory sidecars are refused without mutation', async t => {
  const { file, dir, engine } = await fixture(t), link = `${dir}-link`;
  await fs.symlink(dir, link); t.after(() => fs.unlink(link));
  await assert.rejects(updateSessionSettings(path.join(link, path.basename(file)), engine.checkpoint(), settings()), error => error.code === 'UNSAFE_PATH');
  await fs.mkdir(`${file}.history.json`);
  await assert.rejects(load(file), error => error.code === 'UNSAFE_PATH');
  assert.equal((await fs.lstat(`${file}.history.json`)).isDirectory(), true);
});

test('settings-only changes preserve project bytes and handle faults on both sides of publication', async t => {
  const { file, engine } = await fixture(t), original = await fs.readFile(file);
  await updateSessionSettings(file, engine.checkpoint(), settings(1, { intervalMinutes: 12 }));
  await assert.rejects(updateSessionSettings(file, engine.checkpoint(), settings(2), { writeJournal: async () => { throw new Error('before publication'); } }), /before publication/);
  assert.equal((await load(file)).settings.revision, 1);
  const result = await updateSessionSettings(file, engine.checkpoint(), settings(3), { writeJournal: async (name, bytes) => { await writeSidecar(name, bytes); throw new Error('after publication'); } });
  assert.ok(result.warnings.some(item => item.code === 'SETTINGS_COMMITTED_WITH_WARNING')); assert.equal((await load(file)).settings.revision, 3);
  assert.deepEqual(await fs.readFile(file), original); await assert.rejects(fs.stat(`${file}.bak`), { code: 'ENOENT' });
});

test('journal byte retention trims history, never a large project or caller checkpoint', async t => {
  const { file, engine } = await fixture(t);
  for (let i = 0; i < 80; i++) assert.equal(engine.execute({ command: 'track.add', arguments: { id: `track-${i}`, type: 'midi', name: 'A'.repeat(120) } }).status, 'applied');
  const current = engine.checkpoint(); await fs.writeFile(file, JSON.stringify(current.project)); rename(engine, 'After large project');
  const next = engine.checkpoint(), untouched = structuredClone(next);
  const result = await commitSessionState(file, { currentCheckpoint: current, nextCheckpoint: next, maxBytes: 4096 });
  assert.ok((await fs.stat(file)).size > 4096); assert.ok((await fs.stat(`${file}.history.json`)).size <= 4096);
  assert.deepEqual(next, untouched); assert.deepEqual(result.checkpoint.project, next.project); assert.ok(result.warnings.some(item => item.code === 'HISTORY_TRIMMED'));
  assert.deepEqual((await load(file)).history, result.checkpoint.history);
});

test('oversized sidecar is preserved and settings bounds reject before writing', async t => {
  const { file, engine, dir } = await fixture(t), handle = await fs.open(`${file}.history.json`, 'w');
  await handle.truncate(MAX_JOURNAL_BYTES + 1); await handle.close();
  const result = await load(file); assert.equal(result.persistence.status, 'reset');
  assert.equal((await fs.stat(path.join(dir, result.persistence.warnings[0].preserved))).size, MAX_JOURNAL_BYTES + 1);
  for (const options of [{ intervalMinutes: 0 }, { intervalMinutes: 1441 }, { maxCount: 0 }, { maxCount: 1001 }, { enabled: 'yes' }]) await assert.rejects(updateSessionSettings(file, engine.checkpoint(), settings(1, options)), /Invalid session settings/);
  await assert.rejects(fs.stat(`${file}.history.json`), { code: 'ENOENT' });
});
