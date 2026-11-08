import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { createProject } from '../src/core/engine.mjs';
import { MAX_RECENT_PROJECTS, listRecentProjects, recordRecentProject, removeRecentProject, clearRecentProjects } from '../src/recent-projects.mjs';

const exec = promisify(execFile), moduleURL = new URL('../src/recent-projects.mjs', import.meta.url).href;
const writeJSON = (filename, value) => fs.writeFile(filename, `${JSON.stringify(value)}\n`);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function fixture(t) {
  const directory = await fs.mkdtemp('/private/tmp/newdaw-recent-');
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return { directory, recentPath: path.join(directory, '.recent-projects.json') };
}
async function project(s, filename, name = filename) {
  const projectPath = path.join(s.directory, filename), value = createProject({ name }); await writeJSON(projectPath, value);
  return { projectPath, project: value };
}
async function record(s, filename, options = {}) {
  const listed = await listRecentProjects(s.recentPath, { inspect: false });
  return recordRecentProject(s.recentPath, filename, { expectedRegistryRevision: listed.revision, ...options });
}
const registry = async s => JSON.parse(await fs.readFile(s.recentPath));
const absent = async filename => assert.rejects(fs.lstat(filename), { code: 'ENOENT' });

test('absent registry listing is read-only and empty revision zero without creating parent directories', async t => {
  const s = await fixture(t), filename = path.join(s.directory, 'not-created', 'recent.json');
  assert.deepEqual(await listRecentProjects(filename), { status: 'new', revision: 0, entries: [], warnings: [] });
  await absent(path.dirname(filename));
  await assert.rejects(listRecentProjects(filename, { inspect: 'yes' }), error => error.code === 'INVALID_RECENT_OPTIONS');
});

test('successful record persists metadata, canonical absolute paths, stable IDs and strict MRU order across reopen', async t => {
  const s = await fixture(t), a = await project(s, 'A.json', 'Alpha'), b = await project(s, 'B.json', 'Beta');
  const first = await record(s, a.projectPath), second = await record(s, b.projectPath), reopened = await record(s, a.projectPath);
  assert.equal(first.status, 'recorded'); assert.equal(first.applied, true); assert.equal(first.revision, 1);
  assert.equal(reopened.entry.id, first.entry.id); assert.equal(reopened.entry.projectId, a.project.id); assert.equal(reopened.entry.name, 'Alpha');
  assert.equal(reopened.entry.projectPath, await fs.realpath(a.projectPath)); assert.equal(reopened.entry.sha256, hash(await fs.readFile(a.projectPath)));
  assert.deepEqual(reopened.entries.map(entry => entry.id), [first.entry.id, second.entry.id]); assert.deepEqual(reopened.entries.map(entry => entry.sequence), [3, 2]);
  assert.ok(Number.isFinite(Date.parse(reopened.entry.lastOpened)));
  const imported = await import(`${moduleURL}?reopened=${Date.now()}`), listed = await imported.listRecentProjects(s.recentPath);
  assert.equal(listed.revision, 3); assert.deepEqual(listed.entries.map(entry => entry.status), ['ready', 'ready']);
  assert.equal(listed.entries[0].id, first.entry.id);
});

test('file and parent symlink aliases deduplicate to one canonical project, while a later stored-file link swap is unreadable', async t => {
  const s = await fixture(t), actualDirectory = path.join(s.directory, 'actual'); await fs.mkdir(actualDirectory);
  const actual = path.join(actualDirectory, 'Song'); await writeJSON(actual, createProject({ name: 'Song' }));
  const fileAlias = path.join(s.directory, 'alias.json'), parentAlias = path.join(s.directory, 'folder-alias');
  await fs.symlink(actual, fileAlias); await fs.symlink(actualDirectory, parentAlias);
  const one = await record(s, actual), two = await record(s, fileAlias), three = await record(s, path.join(parentAlias, 'Song'));
  assert.equal(two.entry.id, one.entry.id); assert.equal(three.entry.id, one.entry.id); assert.equal(three.entries.length, 1);
  await fs.rename(actual, `${actual}.moved`); await fs.symlink(`${actual}.moved`, actual);
  const listed = await listRecentProjects(s.recentPath); assert.equal(listed.entries[0].status, 'unreadable');
  assert.equal(listed.entries[0].error.code, 'UNSAFE_PATH');
});

test('MRU keeps at most twenty entries and eviction never changes projects or media files', async t => {
  const s = await fixture(t), items = [];
  for (let index = 0; index < 22; index++) { const item = await project(s, `Song-${index}.json`); items.push(item); await record(s, item.projectPath); }
  const listed = await listRecentProjects(s.recentPath); assert.equal(MAX_RECENT_PROJECTS, 20); assert.equal(listed.entries.length, 20); assert.equal(listed.revision, 22);
  assert.deepEqual(listed.entries.map(entry => entry.sequence), Array.from({ length: 20 }, (_, index) => 22 - index));
  for (const item of items) assert.deepEqual(JSON.parse(await fs.readFile(item.projectPath)), item.project);
});

test('list reports ready changed invalid missing and unreadable without removing entries or touching the registry', async t => {
  const s = await fixture(t), items = [];
  for (const name of ['Ready', 'Changed', 'Invalid', 'Missing', 'Unreadable']) { const item = await project(s, `${name}.json`); items.push(item); await record(s, item.projectPath); }
  await writeJSON(items[1].projectPath, { ...items[1].project, name: 'Edited after opening', revision: 1 });
  await fs.writeFile(items[2].projectPath, '{broken'); await fs.rm(items[3].projectPath); await fs.rename(items[4].projectPath, `${items[4].projectPath}.real`); await fs.symlink(`${items[4].projectPath}.real`, items[4].projectPath);
  const before = await fs.readFile(s.recentPath), listed = await listRecentProjects(s.recentPath);
  assert.deepEqual(listed.entries.map(entry => entry.status), ['unreadable', 'missing', 'invalid', 'changed', 'ready']);
  assert.equal(listed.entries.find(entry => entry.status === 'changed').currentName, 'Edited after opening');
  assert.equal(listed.entries.length, 5); assert.deepEqual(await fs.readFile(s.recentPath), before);
  const uninspected = await listRecentProjects(s.recentPath, { inspect: false }); assert.ok(uninspected.entries.every(entry => !Object.hasOwn(entry, 'status')));
});

test('returned metadata is detached and cannot mutate the durable registry', async t => {
  const s = await fixture(t), item = await project(s, 'A.json'), result = await record(s, item.projectPath), before = await fs.readFile(s.recentPath);
  result.entry.name = 'mutated'; result.entries[0].projectPath = '/not-real';
  const listed = await listRecentProjects(s.recentPath); listed.entries[0].id = 'edited'; listed.entries.length = 0;
  assert.deepEqual(await fs.readFile(s.recentPath), before); assert.equal((await listRecentProjects(s.recentPath)).entries.length, 1);
});

test('record remove and clear dry runs validate revisions and perform no filesystem writes', async t => {
  const s = await fixture(t), item = await project(s, 'A.json'), missingStore = path.join(s.directory, 'missing-parent', 'recent.json');
  const preview = await recordRecentProject(missingStore, item.projectPath, { expectedRegistryRevision: 0, dryRun: true });
  assert.equal(preview.status, 'validated'); assert.equal(preview.applied, false); assert.equal(preview.revision, 0); assert.equal(preview.plannedRevision, 1); await absent(path.dirname(missingStore));
  const committed = await record(s, item.projectPath), before = await fs.readFile(s.recentPath), files = await fs.readdir(s.directory);
  for (const work of [() => recordRecentProject(s.recentPath, item.projectPath, { expectedRegistryRevision: 1, dryRun: true }),
    () => removeRecentProject(s.recentPath, committed.entry.id, { expectedRegistryRevision: 1, dryRun: true }),
    () => clearRecentProjects(s.recentPath, { expectedRegistryRevision: 1, dryRun: true })]) {
    assert.equal((await work()).status, 'validated'); assert.deepEqual(await fs.readFile(s.recentPath), before); assert.deepEqual(await fs.readdir(s.directory), files);
  }
  await assert.rejects(recordRecentProject(s.recentPath, item.projectPath, { expectedRegistryRevision: 0, dryRun: true }), error => error.code === 'RECENT_REVISION_CONFLICT');
});

test('explicit remove and clear affect only recent entries, including missing projects', async t => {
  const s = await fixture(t), a = await project(s, 'A.json'), b = await project(s, 'B.json'), first = await record(s, a.projectPath); await record(s, b.projectPath);
  const media = path.join(s.directory, 'original.wav'); await fs.writeFile(media, 'original media bytes'); const bBytes = await fs.readFile(b.projectPath);
  await fs.rm(a.projectPath);
  const removed = await removeRecentProject(s.recentPath, first.entry.id, { expectedRegistryRevision: 2 });
  assert.equal(removed.status, 'removed'); assert.equal(removed.revision, 3); assert.equal(removed.entries.length, 1);
  await assert.rejects(removeRecentProject(s.recentPath, first.entry.id, { expectedRegistryRevision: 3 }), error => error.code === 'RECENT_NOT_FOUND');
  const cleared = await clearRecentProjects(s.recentPath, { expectedRegistryRevision: 3 }); assert.equal(cleared.status, 'cleared'); assert.equal(cleared.revision, 4);
  assert.equal((await clearRecentProjects(s.recentPath, { expectedRegistryRevision: 4 })).status, 'unchanged');
  assert.deepEqual(await fs.readFile(b.projectPath), bBytes); assert.equal(await fs.readFile(media, 'utf8'), 'original media bytes'); await absent(a.projectPath);
});

test('invalid projects and malformed mutation options never become recent entries', async t => {
  const s = await fixture(t), invalid = path.join(s.directory, 'Invalid.json'); await fs.writeFile(invalid, '{}');
  await assert.rejects(recordRecentProject(s.recentPath, invalid, { expectedRegistryRevision: 0 })); await absent(s.recentPath);
  const item = await project(s, 'A.json');
  for (const value of [undefined, {}, { expectedRegistryRevision: -1 }, { expectedRegistryRevision: 0, dryRun: 'yes' }, { expectedRegistryRevision: 0, unknown: true }]) await assert.rejects(recordRecentProject(s.recentPath, item.projectPath, value), error => error.code === 'INVALID_RECENT_OPTIONS');
  await assert.rejects(recordRecentProject(s.recentPath, path.join(s.directory, 'missing.json'), { expectedRegistryRevision: 0 }), { code: 'ENOENT' });
  await absent(s.recentPath);
});

test('corrupt registries remain unavailable and unchanged until repaired outside these mutation APIs', async t => {
  const s = await fixture(t), item = await project(s, 'A.json'); await record(s, item.projectPath); const valid = await registry(s);
  for (const corrupt of ['{broken', JSON.stringify({ ...valid, schemaVersion: 99 }), JSON.stringify({ ...valid, entries: [valid.entries[0], valid.entries[0]] })]) {
    await fs.writeFile(s.recentPath, corrupt); const before = await fs.readFile(s.recentPath), listed = await listRecentProjects(s.recentPath);
    assert.equal(listed.status, 'unavailable'); assert.equal(listed.revision, null); assert.deepEqual(listed.entries, []); assert.equal(listed.warnings.length, 1);
    await assert.rejects(recordRecentProject(s.recentPath, item.projectPath, { expectedRegistryRevision: 1 }), error => error.code === 'INVALID_RECENT_REGISTRY');
    await assert.rejects(clearRecentProjects(s.recentPath, { expectedRegistryRevision: 1 }), error => error.code === 'INVALID_RECENT_REGISTRY');
    assert.deepEqual(await fs.readFile(s.recentPath), before);
  }
});

test('registry symlinks are refused without reading or overwriting their targets', async t => {
  const s = await fixture(t), item = await project(s, 'A.json'), external = path.join(s.directory, 'external.json'); await writeJSON(external, { must: 'survive' });
  await fs.symlink(external, s.recentPath); const bytes = await fs.readFile(external);
  assert.equal((await listRecentProjects(s.recentPath)).status, 'unavailable');
  await assert.rejects(recordRecentProject(s.recentPath, item.projectPath, { expectedRegistryRevision: 0 }), error => error.code === 'UNSAFE_PATH');
  assert.equal((await fs.lstat(s.recentPath)).isSymbolicLink(), true); assert.deepEqual(await fs.readFile(external), bytes);
  const impossibleParent = path.join(s.directory, 'not-a-directory'); await fs.writeFile(impossibleParent, 'keep');
  const unavailable = await listRecentProjects(path.join(impossibleParent, 'recent.json'));
  assert.equal(unavailable.status, 'unavailable'); assert.equal(unavailable.revision, null); assert.equal(await fs.readFile(impossibleParent, 'utf8'), 'keep');
});

test('pre-publication write failure preserves the old registry and releases its lock', async t => {
  const s = await fixture(t), a = await project(s, 'A.json'), b = await project(s, 'B.json'); await record(s, a.projectPath); const before = await fs.readFile(s.recentPath);
  const rename = fs.rename; fs.rename = async (source, destination) => { if (destination === s.recentPath) throw Object.assign(new Error('injected before-publication failure'), { code: 'EIO' }); return rename(source, destination); };
  try { await assert.rejects(record(s, b.projectPath), { code: 'EIO' }); } finally { fs.rename = rename; }
  assert.deepEqual(await fs.readFile(s.recentPath), before); await absent(`${s.recentPath}.lock`);
  assert.equal((await record(s, b.projectPath)).revision, 2);
});

test('post-publication failure returns the committed registry with a warning instead of claiming rollback', async t => {
  const s = await fixture(t), a = await project(s, 'A.json'), b = await project(s, 'B.json'); await record(s, a.projectPath);
  const rename = fs.rename; fs.rename = async (source, destination) => { await rename(source, destination); if (destination === s.recentPath) throw Object.assign(new Error('injected post-publication failure'), { code: 'EIO' }); };
  let result; try { result = await record(s, b.projectPath); } finally { fs.rename = rename; }
  assert.equal(result.applied, true); assert.equal(result.revision, 2); assert.equal(result.warnings[0].code, 'RECENT_COMMITTED_WITH_WARNING');
  assert.equal((await listRecentProjects(s.recentPath)).entries[0].projectPath, b.projectPath); await absent(`${s.recentPath}.lock`);
});

test('same-process simultaneous writers serialize and stale expected revisions cannot lose the winner', async t => {
  const s = await fixture(t), a = await project(s, 'A.json'), b = await project(s, 'B.json');
  const results = await Promise.allSettled([a, b].map(item => recordRecentProject(s.recentPath, item.projectPath, { expectedRegistryRevision: 0 })));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'RECENT_REVISION_CONFLICT');
  assert.equal((await listRecentProjects(s.recentPath)).revision, 1); assert.equal((await listRecentProjects(s.recentPath)).entries.length, 1);
});

test('two real processes safely update one registry using fresh-revision retries', async t => {
  const s = await fixture(t), items = [];
  for (let index = 0; index < 8; index++) items.push(await project(s, `Process-${index}.json`));
  const worker = `const {listRecentProjects,recordRecentProject}=await import(${JSON.stringify(moduleURL)});const [store,...files]=process.argv.slice(1);for(const file of files){let done=false;for(let attempt=0;attempt<10;attempt++){const current=await listRecentProjects(store,{inspect:false});try{await recordRecentProject(store,file,{expectedRegistryRevision:current.revision,lockTimeoutMs:5000});done=true;break;}catch(error){if(error.code!=='RECENT_REVISION_CONFLICT')throw error;}}if(!done)throw new Error('retry exhausted');}`;
  await Promise.all([items.slice(0, 4), items.slice(4)].map(group => exec(process.execPath, ['--input-type=module', '-e', worker, s.recentPath, ...group.map(item => item.projectPath)], { timeout: 15000 })));
  const listed = await listRecentProjects(s.recentPath); assert.equal(listed.revision, 8); assert.equal(listed.entries.length, 8);
  assert.deepEqual(listed.entries.map(entry => entry.sequence), [8, 7, 6, 5, 4, 3, 2, 1]); assert.equal(new Set(listed.entries.map(entry => entry.id)).size, 8);
  await absent(`${s.recentPath}.lock`); await absent(`${s.recentPath}.lock.reclaim`);
});

test('a verified dead lock owner is recovered but an active owner remains protected on timeout', async t => {
  const s = await fixture(t), item = await project(s, 'A.json'), lockPath = `${s.recentPath}.lock`;
  const deadPid = Number((await exec(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'])).stdout);
  await fs.mkdir(lockPath); await writeJSON(path.join(lockPath, 'owner.json'), { pid: deadPid, token: randomUUID(), createdAt: new Date().toISOString() });
  assert.equal((await record(s, item.projectPath)).status, 'recorded'); await absent(lockPath);
  await fs.mkdir(lockPath); const owner = { pid: process.pid, token: randomUUID(), createdAt: new Date().toISOString() }; await writeJSON(path.join(lockPath, 'owner.json'), owner);
  const before = await fs.readFile(s.recentPath);
  await assert.rejects(recordRecentProject(s.recentPath, item.projectPath, { expectedRegistryRevision: 1, lockTimeoutMs: 50 }), error => error.code === 'RECENT_LOCKED');
  assert.deepEqual(await fs.readFile(s.recentPath), before); assert.deepEqual(JSON.parse(await fs.readFile(path.join(lockPath, 'owner.json'))), owner);
});

test('owner inode replacement during polling is retried until its cooperative release, without losing the registry update', async t => {
  const s = await fixture(t), item = await project(s, 'A.json'), lockPath = `${s.recentPath}.lock`, ownerPath = path.join(lockPath, 'owner.json');
  const owner = () => ({ pid: process.pid, token: randomUUID(), createdAt: new Date().toISOString() });
  await fs.mkdir(lockPath); await writeJSON(ownerPath, owner());
  const open = fs.open.bind(fs); let reads = 0, replaced = false, released = false;
  t.mock.method(fs, 'open', async (filename, ...args) => {
    if (filename === ownerPath) {
      reads++;
      if (reads === 1) {
        // readSidecar already lstat'ed owner.json. Replace its inode now so the
        // production identity check, rather than an injected error, fires.
        const replacement = path.join(s.directory, 'replacement-owner.json');
        await writeJSON(replacement, owner()); await fs.rename(replacement, ownerPath); replaced = true;
      } else if (reads === 2) {
        await fs.unlink(ownerPath); await fs.rmdir(lockPath); released = true;
      }
    }
    return open(filename, ...args);
  });
  const result = await recordRecentProject(s.recentPath, item.projectPath, { expectedRegistryRevision: 0, lockTimeoutMs: 500 });
  assert.equal(replaced, true); assert.equal(released, true); assert.equal(result.status, 'recorded'); assert.equal(result.revision, 1); assert.equal(result.warnings.length, 0);
  assert.equal((await listRecentProjects(s.recentPath)).entries[0].projectPath, item.projectPath); await absent(lockPath); await absent(`${lockPath}.reclaim`);
});

test('changed live-owner identity remains protected and polling times out instead of reclaiming it', async t => {
  const s = await fixture(t), item = await project(s, 'A.json'), lockPath = `${s.recentPath}.lock`, ownerPath = path.join(lockPath, 'owner.json');
  const owner = { pid: process.pid, token: randomUUID(), createdAt: new Date().toISOString() }, successor = { ...owner, token: randomUUID() };
  await fs.mkdir(lockPath); await writeJSON(ownerPath, owner);
  const open = fs.open.bind(fs); let injected = false;
  t.mock.method(fs, 'open', async (filename, ...args) => {
    if (filename === ownerPath && !injected) {
      injected = true; const replacement = path.join(s.directory, 'successor-owner.json');
      await writeJSON(replacement, successor); await fs.rename(replacement, ownerPath);
    }
    return open(filename, ...args);
  });
  await assert.rejects(recordRecentProject(s.recentPath, item.projectPath, { expectedRegistryRevision: 0, lockTimeoutMs: 50 }), { code: 'RECENT_LOCKED' });
  assert.equal(injected, true); assert.deepEqual(JSON.parse(await fs.readFile(ownerPath)), successor); await absent(s.recentPath); await absent(`${lockPath}.reclaim`);
});

test('an owner replaced during dead-owner revalidation is never reclaimed using the previous dead identity', async t => {
  const s = await fixture(t), item = await project(s, 'A.json'), lockPath = `${s.recentPath}.lock`, ownerPath = path.join(lockPath, 'owner.json');
  const deadPid = Number((await exec(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'])).stdout);
  const dead = { pid: deadPid, token: randomUUID(), createdAt: new Date().toISOString() }, successor = { ...dead, pid: process.pid, token: randomUUID() };
  await fs.mkdir(lockPath); await writeJSON(ownerPath, dead);
  const open = fs.open.bind(fs); let reads = 0, injected = false;
  t.mock.method(fs, 'open', async (filename, ...args) => {
    if (filename === ownerPath && ++reads === 2) {
      assert.ok((await fs.lstat(`${lockPath}.reclaim`)).isDirectory());
      injected = true; const replacement = path.join(s.directory, 'successor-owner.json');
      await writeJSON(replacement, successor); await fs.rename(replacement, ownerPath);
    }
    return open(filename, ...args);
  });
  await assert.rejects(recordRecentProject(s.recentPath, item.projectPath, { expectedRegistryRevision: 0, lockTimeoutMs: 50 }), { code: 'RECENT_LOCKED' });
  assert.equal(injected, true); assert.deepEqual(JSON.parse(await fs.readFile(ownerPath)), successor); await absent(s.recentPath); await absent(`${lockPath}.reclaim`);
});

test('malformed or symlink owner files remain errors and are never treated as transient or reclaimable', async t => {
  const s = await fixture(t), item = await project(s, 'A.json'), lockPath = `${s.recentPath}.lock`, ownerPath = path.join(lockPath, 'owner.json');
  await fs.mkdir(lockPath); await fs.writeFile(ownerPath, '{unknown owner');
  await assert.rejects(recordRecentProject(s.recentPath, item.projectPath, { expectedRegistryRevision: 0, lockTimeoutMs: 50 }), SyntaxError);
  assert.equal(await fs.readFile(ownerPath, 'utf8'), '{unknown owner'); await fs.unlink(ownerPath);
  const external = path.join(s.directory, 'external-owner.json'), owner = { pid: process.pid, token: randomUUID(), createdAt: new Date().toISOString() };
  await writeJSON(external, owner); await fs.symlink(external, ownerPath);
  await assert.rejects(recordRecentProject(s.recentPath, item.projectPath, { expectedRegistryRevision: 0, lockTimeoutMs: 50 }), { code: 'UNSAFE_PATH' });
  assert.equal((await fs.lstat(ownerPath)).isSymbolicLink(), true); assert.deepEqual(JSON.parse(await fs.readFile(external)), owner); await absent(s.recentPath); await absent(`${lockPath}.reclaim`);
});

test('revision and sequence overflow reject without publishing partial metadata', async t => {
  const s = await fixture(t), item = await project(s, 'A.json'); await record(s, item.projectPath); const valid = await registry(s);
  await writeJSON(s.recentPath, { ...valid, sequence: Number.MAX_SAFE_INTEGER }); let before = await fs.readFile(s.recentPath);
  await assert.rejects(record(s, item.projectPath), error => error.code === 'RECENT_SEQUENCE_OVERFLOW'); assert.deepEqual(await fs.readFile(s.recentPath), before);
  await writeJSON(s.recentPath, { ...valid, revision: Number.MAX_SAFE_INTEGER }); before = await fs.readFile(s.recentPath);
  await assert.rejects(clearRecentProjects(s.recentPath, { expectedRegistryRevision: Number.MAX_SAFE_INTEGER }), error => error.code === 'RECENT_REVISION_OVERFLOW'); assert.deepEqual(await fs.readFile(s.recentPath), before);
});
