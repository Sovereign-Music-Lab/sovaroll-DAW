import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { writeSidecar } from '../src/session-store.mjs';
import { DEFAULT_PROJECT_LOCATION_SETTINGS, getProjectLocationSettings, updateProjectLocationSettings, resolveProjectLocation, withProjectLocationSettings, inspectProjectFolder, validateProjectFolderName } from '../src/project-locations.mjs';

const exec = promisify(execFile), moduleURL = new URL('../src/project-locations.mjs', import.meta.url).href;
const absent = filename => assert.rejects(fs.lstat(filename), { code: 'ENOENT' });
async function fixture(t) {
  const directory = await fs.mkdtemp('/private/tmp/newdaw-locations-'), profile = path.join(directory, 'profile', 'recent.json.locations.json'), base = path.join(directory, 'Default Base'), other = path.join(directory, 'Chosen Final Folder');
  await fs.mkdir(base); await fs.mkdir(other); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return { directory, profile, base, other };
}
async function tree(directory) {
  const result = {};
  for (const item of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const filename = path.join(directory, item.name); result[item.name] = item.isDirectory() ? await tree(filename) : item.isSymbolicLink() ? `link:${await fs.readlink(filename)}` : await fs.readFile(filename);
  }
  return result;
}
const configure = f => updateProjectLocationSettings(f.profile, { expectedRevision: 0, defaultLocation: f.base, locationMode: 'default' });

test('absent profile starts in prompt mode with no default, and cancelled prompt/read never create files', async t => {
  const f = await fixture(t), before = await tree(f.directory), current = await getProjectLocationSettings(f.profile);
  assert.deepEqual(current, { status: 'new', settings: DEFAULT_PROJECT_LOCATION_SETTINGS, fingerprint: null, warnings: [] });
  for (const chosenFolder of [undefined, null, '']) {
    const result = await resolveProjectLocation(f.profile, { chosenFolder }); assert.equal(result.requiresPrompt, true); assert.equal(result.projectFolder, null); assert.equal(result.settingsRevision, 0); assert.equal(result.settingsFingerprint, null);
  }
  assert.deepEqual(await tree(f.directory), before);
});

test('partial settings persist canonical default location and retain omitted fields across process reload', async t => {
  const f = await fixture(t), first = await updateProjectLocationSettings(f.profile, { expectedRevision: 0, defaultLocation: `${f.base}/` });
  assert.equal(first.status, 'saved'); assert.equal(first.settings.defaultLocation, f.base); assert.equal(first.settings.locationMode, 'prompt'); assert.equal(first.settings.revision, 1);
  const second = await updateProjectLocationSettings(f.profile, { expectedRevision: 1, locationMode: 'default' }); assert.equal(second.settings.defaultLocation, f.base); assert.equal(second.settings.revision, 2);
  const child = `const {getProjectLocationSettings}=await import(${JSON.stringify(moduleURL)});process.stdout.write(JSON.stringify(await getProjectLocationSettings(process.argv[1])));`;
  const reopened = JSON.parse((await exec(process.execPath, ['--input-type=module', '-e', child, f.profile])).stdout);
  assert.deepEqual(reopened.settings, second.settings); assert.equal(reopened.fingerprint, second.fingerprint); await absent(`${f.profile}.lock`);
});

test('default mode resolves parent plus a separate literal Untitled folder name without making the target', async t => {
  const f = await fixture(t), saved = await configure(f), before = await tree(f.directory);
  for (const folderName of [undefined, '', '   ']) {
    const result = await resolveProjectLocation(f.profile, { folderName }); assert.equal(result.folderName, 'Untitled'); assert.equal(result.projectFolder, path.join(f.base, 'Untitled')); assert.equal(result.requiresPrompt, false); assert.equal(result.settingsFingerprint, saved.fingerprint);
  }
  const named = await resolveProjectLocation(f.profile, { folderName: '  Session One  ' }); assert.equal(named.folderName, 'Session One'); assert.equal(named.projectFolder, path.join(f.base, 'Session One'));
  assert.deepEqual(await tree(f.directory), before); await absent(path.join(f.base, 'Untitled'));
});

test('prompt selects its final folder without appending the default folder name or changing persisted mode', async t => {
  const f = await fixture(t); await configure(f); const before = await tree(f.directory);
  const result = await resolveProjectLocation(f.profile, { locationMode: 'prompt', chosenFolder: f.other, folderName: 'Would be extra nesting' });
  assert.equal(result.projectFolder, f.other); assert.equal(result.folderName, null); assert.equal(result.requiresPrompt, false); assert.equal((await getProjectLocationSettings(f.profile)).settings.locationMode, 'default'); assert.deepEqual(await tree(f.directory), before);
});

test('default mode requires a configured existing folder and never substitutes a home or working directory', async t => {
  const f = await fixture(t);
  await assert.rejects(resolveProjectLocation(f.profile, { locationMode: 'default' }), { code: 'DEFAULT_LOCATION_REQUIRED' });
  await assert.rejects(updateProjectLocationSettings(f.profile, { expectedRevision: 0, locationMode: 'default' }), { code: 'DEFAULT_LOCATION_REQUIRED' }); await absent(f.profile);
  await assert.rejects(updateProjectLocationSettings(f.profile, { expectedRevision: 0, defaultLocation: path.join(f.directory, 'not-created') }), { code: 'ENOENT' }); await absent(path.join(f.directory, 'not-created')); await absent(f.profile);
  await assert.rejects(updateProjectLocationSettings(f.profile, { expectedRevision: 0, defaultLocation: 'relative/folder' }), { code: 'INVALID_DEFAULT_LOCATION' });
});

test('folder names reject traversal, separators, controls and excessive UTF-8 length before touching a project directory', async t => {
  const f = await fixture(t); await configure(f); const before = await tree(f.directory);
  for (const folderName of ['.', '..', '../escape', 'nested/folder', 'nested\\folder', '/absolute', 'bad\0name', 'bad\nname', '가'.repeat(86), 123]) await assert.rejects(resolveProjectLocation(f.profile, { folderName }), { code: 'INVALID_PROJECT_FOLDER_NAME' });
  assert.equal(validateProjectFolderName('가'.repeat(85)), '가'.repeat(85)); assert.equal(validateProjectFolderName('.hidden'), '.hidden'); assert.deepEqual(await tree(f.directory), before);
});

test('a disappeared default can be retained while switching to prompt, and actual default resolution still fails', async t => {
  const f = await fixture(t); await configure(f); await fs.rmdir(f.base);
  assert.equal((await getProjectLocationSettings(f.profile)).settings.defaultLocation, f.base);
  await assert.rejects(resolveProjectLocation(f.profile), { code: 'ENOENT' });
  const changed = await updateProjectLocationSettings(f.profile, { expectedRevision: 1, locationMode: 'prompt' }); assert.equal(changed.settings.defaultLocation, f.base); assert.equal(changed.settings.locationMode, 'prompt');
  assert.equal((await resolveProjectLocation(f.profile, { chosenFolder: f.other })).projectFolder, f.other);
  await assert.rejects(updateProjectLocationSettings(f.profile, { expectedRevision: 2, locationMode: 'default' }), { code: 'ENOENT' });
  const cleared = await updateProjectLocationSettings(f.profile, { expectedRevision: 2, defaultLocation: null }); assert.equal(cleared.settings.defaultLocation, null); assert.equal(cleared.settings.revision, 3);
});

test('corrupt or schema-invalid profile stays intact for get, resolve and updates instead of becoming defaults', async t => {
  const f = await fixture(t); await configure(f);
  for (const value of ['{broken', JSON.stringify({ ...DEFAULT_PROJECT_LOCATION_SETTINGS, unexpected: true }), JSON.stringify({ ...DEFAULT_PROJECT_LOCATION_SETTINGS, locationMode: 'default' }), JSON.stringify({ ...DEFAULT_PROJECT_LOCATION_SETTINGS, revision: -1 })]) {
    await fs.writeFile(f.profile, value);
    for (const action of [() => getProjectLocationSettings(f.profile), () => resolveProjectLocation(f.profile, { chosenFolder: f.other }), () => updateProjectLocationSettings(f.profile, { expectedRevision: 0, locationMode: 'prompt' })]) await assert.rejects(action(), { code: 'INVALID_LOCATION_SETTINGS' });
    assert.equal(await fs.readFile(f.profile, 'utf8'), value); await absent(`${f.profile}.lock`);
  }
});

test('profile/folder symlinks and non-directory targets are refused without following or modifying their targets', async t => {
  const f = await fixture(t); await configure(f); const moved = `${f.profile}.real`, bytes = await fs.readFile(f.profile); await fs.rename(f.profile, moved); await fs.symlink(moved, f.profile);
  await assert.rejects(getProjectLocationSettings(f.profile), { code: 'UNSAFE_PATH' }); await assert.rejects(updateProjectLocationSettings(f.profile, { expectedRevision: 1, locationMode: 'prompt' }), { code: 'UNSAFE_PATH' }); assert.deepEqual(await fs.readFile(moved), bytes);
  const link = path.join(f.directory, 'alias'); await fs.symlink(f.other, link);
  await assert.rejects(inspectProjectFolder(link), { code: 'UNSAFE_DRAFT_PATH' });
  await assert.rejects(getProjectLocationSettings(path.join(link, 'locations.json')), { code: 'UNSAFE_DRAFT_PATH' });
  const regular = path.join(f.directory, 'regular-file'); await fs.writeFile(regular, 'keep'); await assert.rejects(inspectProjectFolder(regular), { code: 'UNSAFE_DRAFT_PATH' }); assert.equal(await fs.readFile(regular, 'utf8'), 'keep');
});

test('existing final folders are usable but prompt missing/relative folders and default targets occupied by files are rejected', async t => {
  const f = await fixture(t); await configure(f); const occupied = path.join(f.base, 'Occupied'); await fs.writeFile(occupied, 'user file');
  await assert.rejects(resolveProjectLocation(f.profile, { folderName: 'Occupied' }), { code: 'UNSAFE_DRAFT_PATH' });
  await assert.rejects(resolveProjectLocation(f.profile, { locationMode: 'prompt', chosenFolder: 'relative' }), { code: 'INVALID_CHOSEN_FOLDER' });
  await assert.rejects(resolveProjectLocation(f.profile, { locationMode: 'prompt', chosenFolder: path.join(f.directory, 'missing') }), { code: 'ENOENT' });
  await assert.rejects(resolveProjectLocation(f.profile, { chosenFolder: f.other }), { code: 'INVALID_LOCATION_REQUEST' });
  await fs.mkdir(path.join(f.base, 'Existing')); assert.equal((await resolveProjectLocation(f.profile, { folderName: 'Existing' })).projectFolder, path.join(f.base, 'Existing')); assert.equal(await fs.readFile(occupied, 'utf8'), 'user file');
});

test('CAS rejects stale updates, unchanged preferences do not rewrite bytes, and dry runs create no files or locks', async t => {
  const f = await fixture(t), before = await tree(f.directory);
  const preview = await updateProjectLocationSettings(f.profile, { expectedRevision: 0, defaultLocation: f.base, locationMode: 'default', dryRun: true }); assert.equal(preview.status, 'validated'); assert.equal(preview.settings.revision, 1); assert.deepEqual(await tree(f.directory), before);
  const saved = await configure(f), stored = await fs.readFile(f.profile), stat = await fs.stat(f.profile);
  await assert.rejects(updateProjectLocationSettings(f.profile, { expectedRevision: 0, defaultLocation: f.other }), { code: 'LOCATIONS_CONFLICT' });
  assert.equal((await updateProjectLocationSettings(f.profile, { expectedRevision: 1, defaultLocation: f.base })).status, 'unchanged'); assert.equal((await fs.stat(f.profile)).ino, stat.ino); assert.deepEqual(await fs.readFile(f.profile), stored);
  const next = await updateProjectLocationSettings(f.profile, { expectedRevision: 1, defaultLocation: f.other, dryRun: true }); assert.equal(next.settings.revision, 2); assert.equal(next.fingerprint, saved.fingerprint); assert.deepEqual(await fs.readFile(f.profile), stored); await absent(`${f.profile}.lock`);
});

test('same-process competing updates serialize and only one expected-revision writer commits', async t => {
  const f = await fixture(t), results = await Promise.allSettled([f.base, f.other].map(defaultLocation => updateProjectLocationSettings(f.profile, { expectedRevision: 0, defaultLocation })));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1); assert.equal(results.find(result => result.status === 'rejected').reason.code, 'LOCATIONS_CONFLICT'); assert.equal((await getProjectLocationSettings(f.profile)).settings.revision, 1); await absent(`${f.profile}.lock`);
});

test('two real processes update one profile with fresh-revision retries without losing any committed change', async t => {
  const f = await fixture(t), folders = [];
  for (let i = 0; i < 6; i++) { const folder = path.join(f.directory, `Base${i}`); await fs.mkdir(folder); folders.push(folder); }
  const child = `const {getProjectLocationSettings,updateProjectLocationSettings}=await import(${JSON.stringify(moduleURL)});const [file,...folders]=process.argv.slice(1);for(const defaultLocation of folders){let done=false;for(let attempt=0;attempt<20;attempt++){const {settings}=await getProjectLocationSettings(file);try{await updateProjectLocationSettings(file,{expectedRevision:settings.revision,defaultLocation});done=true;break;}catch(e){if(e.code!=='LOCATIONS_CONFLICT')throw e;}}if(!done)throw Error('retry exhausted');}`;
  await Promise.all([folders.slice(0, 3), folders.slice(3)].map(group => exec(process.execPath, ['--input-type=module', '-e', child, f.profile, ...group], { timeout: 15000 })));
  const current = await getProjectLocationSettings(f.profile); assert.equal(current.settings.revision, 6); assert.ok(folders.includes(current.settings.defaultLocation)); await absent(`${f.profile}.lock`); await absent(`${f.profile}.lock.reclaim`);
});

test('a held location guard prevents another actual process from updating preferences until project work completes', async t => {
  const f = await fixture(t), initial = await configure(f), marker = path.join(f.directory, 'created-by-guard');
  const code = `const {withProjectLocationSettings}=await import(${JSON.stringify(moduleURL)});const {promises:fs}=await import('node:fs');const [file,fingerprint,marker]=process.argv.slice(1);await withProjectLocationSettings(file,{expectedRevision:1,expectedFingerprint:fingerprint},async()=>{process.stdout.write('held');await new Promise(resolve=>process.stdin.once('data',resolve));process.stdin.pause();await fs.writeFile(marker,'created before settings update');return {warnings:[]};});`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', code, f.profile, initial.fingerprint, marker], { stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null) child.kill('SIGTERM'); });
  let errors = ''; child.stderr.on('data', bytes => { errors += bytes; });
  const exited = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(errors || `child exit ${code}`))); });
  await new Promise((resolve, reject) => { child.stdout.once('data', resolve); child.once('error', reject); });
  let complete = false; const update = updateProjectLocationSettings(f.profile, { expectedRevision: 1, defaultLocation: f.other }).then(result => { complete = true; return result; });
  await delay(40); assert.equal(complete, false); await absent(marker); child.stdin.end('go'); await exited;
  assert.equal((await update).settings.revision, 2); assert.equal(await fs.readFile(marker, 'utf8'), 'created before settings update'); await absent(`${f.profile}.lock`);
});

test('location guard detects same-revision raw file replacement and releases its lock on caller failure', async t => {
  const f = await fixture(t), current = await configure(f); let called = false;
  await fs.appendFile(f.profile, '\n');
  await assert.rejects(withProjectLocationSettings(f.profile, { expectedRevision: 1, expectedFingerprint: current.fingerprint }, async () => { called = true; }), { code: 'LOCATIONS_CONFLICT' }); assert.equal(called, false);
  const fresh = await getProjectLocationSettings(f.profile);
  await assert.rejects(withProjectLocationSettings(f.profile, { expectedRevision: 1, expectedFingerprint: fresh.fingerprint }, async () => { throw new Error('creation failed'); }), /creation failed/); await absent(`${f.profile}.lock`);
  assert.equal((await updateProjectLocationSettings(f.profile, { expectedRevision: 1, locationMode: 'prompt' })).settings.revision, 2);
});

test('pre-publication errors preserve the old profile; post-publication errors return committed settings with a warning', async t => {
  const f = await fixture(t); await configure(f); const before = await fs.readFile(f.profile);
  await assert.rejects(updateProjectLocationSettings(f.profile, { expectedRevision: 1, defaultLocation: f.other }, { writeSettings: async () => { throw new Error('before write'); } }), /before write/); assert.deepEqual(await fs.readFile(f.profile), before); await absent(`${f.profile}.lock`);
  const result = await updateProjectLocationSettings(f.profile, { expectedRevision: 1, defaultLocation: f.other }, { writeSettings: async (filename, bytes, options) => { await writeSidecar(filename, bytes, options); throw new Error('after publication'); } });
  assert.equal(result.applied, true); assert.equal(result.settings.revision, 2); assert.ok(result.warnings.some(item => item.code === 'LOCATION_SETTINGS_COMMITTED_WITH_WARNING')); assert.deepEqual((await getProjectLocationSettings(f.profile)).settings, result.settings);
});

test('verified dead owner may be reclaimed but live or unknown lock owners are preserved', async t => {
  const f = await fixture(t); await fs.mkdir(path.dirname(f.profile)); const lock = `${f.profile}.lock`, ownerFile = path.join(lock, 'owner.json'), deadPid = Number((await exec(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'])).stdout);
  await fs.mkdir(lock); await fs.writeFile(ownerFile, JSON.stringify({ pid: deadPid, token: randomUUID(), createdAt: new Date().toISOString() }));
  await configure(f); await absent(lock);
  await fs.mkdir(lock); const owner = { pid: process.pid, token: randomUUID(), createdAt: new Date().toISOString() }; await fs.writeFile(ownerFile, JSON.stringify(owner));
  await assert.rejects(updateProjectLocationSettings(f.profile, { expectedRevision: 1, defaultLocation: f.other }, { lockTimeoutMs: 50 }), { code: 'LOCATION_SETTINGS_LOCKED' }); assert.deepEqual(JSON.parse(await fs.readFile(ownerFile)), owner);
  await fs.writeFile(ownerFile, '{unverified'); await assert.rejects(updateProjectLocationSettings(f.profile, { expectedRevision: 1, defaultLocation: f.other }, { lockTimeoutMs: 50 }), { code: 'INVALID_LOCATION_LOCK' }); assert.equal(await fs.readFile(ownerFile, 'utf8'), '{unverified');
});

test('profile byte limits and revision overflow fail without silently resetting or overwriting preferences', async t => {
  const f = await fixture(t); await configure(f); const handle = await fs.open(f.profile, 'r+'); await handle.truncate(64 * 1024 + 1); await handle.close();
  await assert.rejects(getProjectLocationSettings(f.profile), error => error.code === 'FILE_TOO_LARGE' && error.status === 422); assert.equal((await fs.stat(f.profile)).size, 64 * 1024 + 1);
  const value = { ...DEFAULT_PROJECT_LOCATION_SETTINGS, revision: Number.MAX_SAFE_INTEGER, defaultLocation: f.base }; await fs.writeFile(f.profile, JSON.stringify(value)); const bytes = await fs.readFile(f.profile);
  await assert.rejects(updateProjectLocationSettings(f.profile, { expectedRevision: Number.MAX_SAFE_INTEGER, locationMode: 'default' }), { code: 'LOCATION_REVISION_OVERFLOW' }); assert.deepEqual(await fs.readFile(f.profile), bytes);
});
