import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Engine } from '../src/core/engine.mjs';
import { acquireProjectLock, saveProject } from '../src/storage.mjs';
import { commitSessionState, updateSessionSettings, DEFAULT_SESSION_SETTINGS, loadSessionState } from '../src/session-store.mjs';
import { prepareProjectVersion, loadSavedCheckpoint } from '../src/project-save.mjs';
import { inspectExistingProject, prepareExistingProject } from '../src/project-open.mjs';
import { encodeWav } from '../src/media/wav.mjs';
import { createAutoBackup } from '../src/auto-backup.mjs';
import { previewDraft, createDraft, listDrafts, inspectDraft, prepareDraft, beginDraftPublication, finalizeDraftPublication, abortDraftPublication } from '../src/project-drafts.mjs';

const exec = promisify(execFile), absent = filename => assert.rejects(fs.lstat(filename), { code: 'ENOENT' });
async function tree(directory) {
  const out = {};
  for (const item of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const filename = path.join(directory, item.name); out[item.name] = item.isDirectory() ? await tree(filename) : item.isSymbolicLink() ? `link:${await fs.readlink(filename)}` : await fs.readFile(filename);
  }
  return out;
}
async function fixture(t) {
  const directory = await fs.mkdtemp('/private/tmp/newdaw-drafts-'), registry = path.join(directory, 'store', 'drafts.json'), folder = path.join(directory, 'Project'), releases = [];
  const reserve = async (filename, options) => { const release = await acquireProjectLock(filename, 'http://127.0.0.1:4317', options); releases.push(release); return release; };
  t.after(async () => { for (const release of releases) await release().catch(() => {}); await fs.rm(directory, { recursive: true, force: true }); });
  return { directory, registry, folder, reserve,
    async create(options = {}) { return createDraft(registry, { projectFolder: folder, expectedRegistryRevision: (await previewDraft(registry, { projectFolder: folder })).revision, reserveTarget: reserve, ...options }); },
    async prepare(created, options = {}) { const inspected = await inspectDraft(registry, created.draft.id); return prepareDraft(registry, created.draft.id, { expectedFingerprint: inspected.fingerprint, reserveTarget: reserve, ...options }); },
  };
}
async function edit(created, name) {
  const previous = created.checkpoint, engine = new Engine(previous.project); engine.restoreCheckpoint(previous);
  assert.equal(engine.execute({ command: 'project.rename', arguments: { name } }).status, 'applied');
  const result = await commitSessionState(created.projectPath, { currentCheckpoint: previous, nextCheckpoint: engine.checkpoint(), settings: created.settings, persistProject: saveProject });
  created.checkpoint = result.checkpoint; created.project = result.checkpoint.project; return created;
}

test('preview and absent recovery listing are read-only, including a new nested project folder and registry parent', async t => {
  const f = await fixture(t), before = await tree(f.directory), preview = await previewDraft(f.registry, { projectFolder: path.join(f.folder, 'nested'), sampleRate: 44100 });
  assert.equal(preview.revision, 0); assert.equal(preview.nextNumber, 1); assert.equal(preview.name, 'Untitled1'); assert.equal(preview.sampleRate, 44100);
  assert.deepEqual(await listDrafts(f.registry), { status: 'new', revision: 0, nextNumber: 1, entries: [], warnings: [] }); assert.deepEqual(await tree(f.directory), before);
});

test('new draft is truly never-saved with an empty editable project, retained lock/history/settings and no saved baseline', async t => {
  const f = await fixture(t), created = await f.create({ sampleRate: 96000 });
  assert.equal(created.project.tempoTrackEnabled,false);assert.equal(created.project.fixedTempoBpm,120);assert.deepEqual(created.project.timeSignature,{numerator:4,denominator:4});
  assert.equal(created.project.name, 'Untitled1'); assert.equal(created.project.sampleRate, 96000); assert.equal(created.project.revision, 0); assert.deepEqual(created.project.tracks, []); assert.deepEqual(created.project.clips, []); assert.deepEqual(created.project.assets, []);
  assert.equal(created.saved.available, false); assert.equal(created.saved.checkpoint, null); assert.equal(created.saved.dirty, true); assert.equal(created.saved.persistence.status, 'never-saved'); assert.equal(created.willInitializeSavedCheckpoint, false);
  assert.equal(created.draft.neverSaved, true); assert.equal(created.draft.projectFolder, f.folder); assert.equal(created.registryRevision, 1); assert.equal(created.resources, 'deferred');
  assert.ok((await fs.stat(`${created.projectPath}.lock`)).isFile()); await absent(`${created.projectPath}.saved.json`); assert.equal((await loadSessionState(created.projectPath, created.project)).history.schemaVersion, 2);
  assert.deepEqual((await listDrafts(f.registry)).entries.map(row => [row.name, row.status, row.resumable]), [['Untitled1', 'ready', true]]);
});

test('Untitled numbers persist monotonically across folders and reopen; stale creation never consumes another number', async t => {
  const f = await fixture(t), first = await f.create(), other = path.join(f.directory, 'Other'); await first.releaseLock();
  const preview = await previewDraft(f.registry, { projectFolder: other }); assert.equal(preview.nextNumber, 2);
  const second = await f.create({ projectFolder: other, expectedRegistryRevision: preview.revision }); await second.releaseLock();
  await assert.rejects(f.create({ expectedRegistryRevision: 1 }), { code: 'DRAFT_REGISTRY_CONFLICT' });
  assert.equal((await previewDraft(f.registry, { projectFolder: f.folder })).nextNumber, 3); assert.equal(second.project.name, 'Untitled2'); assert.notEqual(first.project.id, second.project.id);
  assert.deepEqual((await listDrafts(f.registry)).entries.map(row => row.number), [2, 1]);
});

test('same-process competing creates use registry CAS without losing the winning number', async t => {
  const f = await fixture(t), options = { projectFolder: f.folder, expectedRegistryRevision: 0, reserveTarget: f.reserve };
  const results = await Promise.allSettled([createDraft(f.registry, options), createDraft(f.registry, options)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1); assert.equal(results.find(result => result.status === 'rejected').reason.code, 'DRAFT_REGISTRY_CONFLICT');
  assert.equal((await listDrafts(f.registry)).entries.length, 1); assert.equal((await listDrafts(f.registry)).nextNumber, 2);
});

test('two actual processes reserve unique persistent Untitled numbers using fresh-registry retries', async t => {
  const f = await fixture(t), draftsURL = new URL('../src/project-drafts.mjs', import.meta.url).href, storageURL = new URL('../src/storage.mjs', import.meta.url).href;
  const child = `const {previewDraft,createDraft}=await import(${JSON.stringify(draftsURL)});const {acquireProjectLock}=await import(${JSON.stringify(storageURL)});const [registry,folder]=process.argv.slice(1);for(let i=0;i<3;i++){let done=false;for(let attempt=0;attempt<20;attempt++){const preview=await previewDraft(registry,{projectFolder:folder});try{const result=await createDraft(registry,{projectFolder:folder,expectedRegistryRevision:preview.revision,reserveTarget:p=>acquireProjectLock(p,'child')});await result.releaseLock();done=true;break;}catch(e){if(e.code!=='DRAFT_REGISTRY_CONFLICT')throw e;}}if(!done)throw Error('retry exhausted');}`;
  await Promise.all(['One', 'Two'].map(name => exec(process.execPath, ['--input-type=module', '-e', child, f.registry, path.join(f.directory, name)], { timeout: 15000 })));
  const listed = await listDrafts(f.registry); assert.equal(listed.revision, 6); assert.equal(listed.nextNumber, 7); assert.deepEqual(listed.entries.map(entry => entry.number), [6, 5, 4, 3, 2, 1]); assert.ok(listed.entries.every(entry => entry.resumable)); await absent(`${f.registry}.lock`);
});

test('preserved close resumes working MIDI edits, undo/redo history and session settings without creating a Save point', async t => {
  const f = await fixture(t), created = await f.create(); await edit(created, 'Working changes');
  const engine = new Engine(created.project); engine.restoreCheckpoint(created.checkpoint);
  assert.equal(engine.execute({ command: 'track.add', arguments: { id: 'midi-track', name: 'Piano', type: 'midi', instrument: 'triangle' } }).status, 'applied');
  await commitSessionState(created.projectPath, { currentCheckpoint: created.checkpoint, nextCheckpoint: engine.checkpoint(), settings: created.settings, persistProject: saveProject });
  const settings = { revision: 8, autoBackup: { enabled: true, intervalMinutes: 13, maxCount: 4 } }; await updateSessionSettings(created.projectPath, engine.checkpoint(), settings);
  await createAutoBackup(created.projectPath, engine.project); const original = await fs.readFile(created.projectPath); await created.releaseLock();
  const prepared = await f.prepare(created); assert.equal(prepared.project.name, 'Working changes'); assert.equal(prepared.project.tracks[0].id, 'midi-track'); assert.equal(prepared.settings.revision, 8); assert.equal(prepared.backups.files.length, 1);
  const restored = new Engine(prepared.project); restored.restoreCheckpoint(prepared.checkpoint); assert.equal(restored.execute({ command: 'history.undo', arguments: {} }).status, 'applied'); assert.equal(restored.project.tracks.length, 0); assert.equal(restored.canRedo, true);
  assert.deepEqual(await fs.readFile(created.projectPath), original); await absent(`${created.projectPath}.saved.json`); assert.equal(prepared.saved.available, false); assert.equal(prepared.saved.dirty, true);
});

test('audio assets stay relative to the chosen folder, are deferred on inactive recovery and verified on active recovery', async t => {
  const f = await fixture(t), created = await f.create(), bytes = Buffer.from(encodeWav({ sampleRate: 8000, channels: [new Float32Array(80).fill(.1)] })), sha256 = createHash('sha256').update(bytes).digest('hex');
  const engine = new Engine(created.project), asset = { id: 'audio', name: 'Audio.wav', sha256, path: `assets/${sha256}.wav`, sampleRate: 8000, channels: 1, frames: 80 };
  assert.equal(engine.execute({ command: 'asset.add', arguments: { asset } }).status, 'applied'); await fs.mkdir(path.join(f.folder, 'assets')); await fs.writeFile(path.join(f.folder, asset.path), bytes);
  await commitSessionState(created.projectPath, { currentCheckpoint: created.checkpoint, nextCheckpoint: engine.checkpoint(), settings: created.settings, persistProject: saveProject }); await created.releaseLock();
  const open = fs.open.bind(fs); let reads = 0;
  t.mock.method(fs, 'open', (filename, ...args) => { if (String(filename).endsWith('.wav')) reads++; return open(filename, ...args); });
  const inactive = await f.prepare(created); assert.equal(reads, 0); assert.equal(inactive.media.assets[0].status, 'deferred'); await inactive.releaseLock();
  const active = await f.prepare(created, { deferredMedia: false }); assert.ok(reads > 0); assert.equal(active.media.assets[0].status, 'ready'); assert.equal(active.directory, f.folder); await absent(`${created.projectPath}.saved.json`);
});

test('a crashed owning process leaves a registered working draft recoverable with its durable edits', async t => {
  const f = await fixture(t), draftsURL = new URL('../src/project-drafts.mjs', import.meta.url).href, storageURL = new URL('../src/storage.mjs', import.meta.url).href;
  const child = `const {createDraft}=await import(${JSON.stringify(draftsURL)});const {acquireProjectLock}=await import(${JSON.stringify(storageURL)});const [registry,folder]=process.argv.slice(1);const result=await createDraft(registry,{projectFolder:folder,expectedRegistryRevision:0,reserveTarget:p=>acquireProjectLock(p,'child')});process.stdout.write(result.draft.id);process.exit(0);`;
  const id = (await exec(process.execPath, ['--input-type=module', '-e', child, f.registry, f.folder])).stdout;
  const inspected = await inspectDraft(f.registry, id); const prepared = await prepareDraft(f.registry, id, { expectedFingerprint: inspected.fingerprint, reserveTarget: f.reserve });
  assert.equal(prepared.project.name, 'Untitled1'); assert.equal(prepared.draft.id, id); await absent(`${prepared.projectPath}.saved.json`);
});

test('generic open rejects managed draft working paths and cannot initialize a false opened-project baseline', async t => {
  const f = await fixture(t), created = await f.create(); await created.releaseLock(); let reserved = false;
  await assert.rejects(inspectExistingProject(created.projectPath), { code: 'DRAFT_RECOVERY_REQUIRED' });
  await assert.rejects(prepareExistingProject(created.projectPath, { expectedFingerprint: created.fingerprint, reserveTarget: () => { reserved = true; } }), { code: 'DRAFT_RECOVERY_REQUIRED' });
  assert.equal(reserved, false); await absent(`${created.projectPath}.saved.json`); assert.equal((await inspectDraft(f.registry, created.draft.id)).saved.available, false);
});

test('first Save carries project/history/settings unchanged and closes the recovery identity while retaining working bytes', async t => {
  const f = await fixture(t), created = await f.create(); await edit(created, 'Named musical content'); const original = await fs.readFile(created.projectPath), target = path.join(f.folder, 'Song.newdaw.json');
  const intent = await beginDraftPublication(f.registry, created.draft.id, { targetPath: target, project: created.project });
  const prepared = await prepareProjectVersion(created.projectPath, { checkpoint: created.checkpoint, settings: created.settings, mode: 'saveAs', outputPath: target, reserveTarget: f.reserve });
  const result = await finalizeDraftPublication(f.registry, created.draft.id, { intentId: intent.intentId }); assert.equal(result.status, 'published'); assert.equal(result.resumable, false);
  assert.deepEqual(prepared.project, created.project); assert.deepEqual(prepared.checkpoint.history, created.checkpoint.history); assert.deepEqual((await loadSessionState(target, created.project)).settings, created.settings);
  assert.equal((await loadSavedCheckpoint(target, created.project)).checkpoint.origin, 'explicit'); assert.deepEqual(await fs.readFile(created.projectPath), original); await absent(`${created.projectPath}.saved.json`);
  await assert.rejects(inspectDraft(f.registry, created.draft.id), { code: 'DRAFT_ALREADY_PUBLISHED' }); const listed = await listDrafts(f.registry); assert.equal(listed.entries[0].status, 'published'); assert.equal(listed.entries[0].targetPath, target);
});

test('a crash after named-file commit but before descriptor finalization never resumes a duplicate draft', async t => {
  const f = await fixture(t), created = await f.create(), target = path.join(f.folder, 'Recovered-Save.json');
  const intent = await beginDraftPublication(f.registry, created.draft.id, { targetPath: target, project: created.project });
  await fs.writeFile(target, JSON.stringify(created.project)); // Equivalent content with different formatting is a committed project.
  assert.equal((await listDrafts(f.registry)).entries[0].status, 'published'); await assert.rejects(inspectDraft(f.registry, created.draft.id), { code: 'DRAFT_ALREADY_PUBLISHED' });
  const abort = await abortDraftPublication(f.registry, created.draft.id, { intentId: intent.intentId }); assert.equal(abort.status, 'published'); assert.equal(abort.resumable, false);
  assert.equal((await finalizeDraftPublication(f.registry, created.draft.id, { intentId: intent.intentId })).status, 'published');
});

test('pre-publication failure can abort and retry, while an interrupted missing-target intent can recover its draft', async t => {
  const f = await fixture(t), created = await f.create(), target = path.join(f.folder, 'Incomplete.json');
  let intent = await beginDraftPublication(f.registry, created.draft.id, { targetPath: target, project: created.project });
  await assert.rejects(finalizeDraftPublication(f.registry, created.draft.id, { intentId: intent.intentId }), { code: 'DRAFT_NOT_PUBLISHED' });
  assert.equal((await abortDraftPublication(f.registry, created.draft.id, { intentId: intent.intentId })).status, 'ready');
  intent = await beginDraftPublication(f.registry, created.draft.id, { targetPath: target, project: created.project });
  assert.equal((await listDrafts(f.registry)).entries[0].status, 'incomplete'); await created.releaseLock();
  const recovered = await f.prepare(created); assert.equal(recovered.draft.state, 'ready'); assert.ok(recovered.warnings.some(item => item.code === 'DRAFT_PUBLICATION_INCOMPLETE'));
  const next = await beginDraftPublication(f.registry, created.draft.id, { targetPath: target, project: created.project }); assert.notEqual(next.intentId, intent.intentId); await absent(`${created.projectPath}.saved.json`);
});

test('a changed or unsafe publication destination remains ambiguous and cannot be reset to a resumable draft', async t => {
  const f = await fixture(t), created = await f.create(), target = path.join(f.folder, 'Occupied.json');
  const intent = await beginDraftPublication(f.registry, created.draft.id, { targetPath: target, project: created.project });
  await fs.writeFile(target, JSON.stringify({ ...created.project, name: 'Different content' })); const bytes = await fs.readFile(target);
  for (const action of [() => inspectDraft(f.registry, created.draft.id), () => finalizeDraftPublication(f.registry, created.draft.id, { intentId: intent.intentId }), () => abortDraftPublication(f.registry, created.draft.id, { intentId: intent.intentId })]) await assert.rejects(action(), { code: 'DRAFT_PUBLICATION_AMBIGUOUS' });
  assert.equal((await listDrafts(f.registry)).entries[0].status, 'ambiguous'); assert.deepEqual(await fs.readFile(target), bytes);
});

test('corrupt registry/descriptor and foreign working identity are preserved and never recovered as another project', async t => {
  const f = await fixture(t), created = await f.create(); await created.releaseLock(); const registryBytes = await fs.readFile(f.registry), descriptorBytes = await fs.readFile(created.draft.descriptorPath);
  await fs.writeFile(f.registry, '{bad registry'); assert.equal((await listDrafts(f.registry)).status, 'unavailable'); await assert.rejects(f.create(), { code: 'INVALID_DRAFT_REGISTRY' }); assert.equal(await fs.readFile(f.registry, 'utf8'), '{bad registry'); await fs.writeFile(f.registry, registryBytes);
  await fs.writeFile(created.draft.descriptorPath, '{bad descriptor'); await assert.rejects(inspectDraft(f.registry, created.draft.id), { code: 'INVALID_DRAFT_DESCRIPTOR' }); assert.equal((await listDrafts(f.registry)).entries[0].resumable, false); assert.equal(await fs.readFile(created.draft.descriptorPath, 'utf8'), '{bad descriptor');
  await fs.writeFile(created.draft.descriptorPath, descriptorBytes); await fs.writeFile(created.projectPath, JSON.stringify({ ...created.project, id: 'foreign-project' })); await assert.rejects(inspectDraft(f.registry, created.draft.id), { code: 'DRAFT_PROJECT_MISMATCH' }); await absent(`${created.projectPath}.saved.json`);
});

test('unsafe ancestor, registry and working-file symlinks are refused without following or overwriting targets', async t => {
  const f = await fixture(t), real = path.join(f.directory, 'Real'), link = path.join(f.directory, 'Link'); await fs.mkdir(real); await fs.symlink(real, link);
  await assert.rejects(previewDraft(f.registry, { projectFolder: path.join(link, 'Nested') }), { code: 'UNSAFE_DRAFT_PATH' }); await absent(path.join(real, 'Nested'));
  const created = await f.create(); await created.releaseLock(); const moved = `${created.projectPath}.real`; await fs.rename(created.projectPath, moved); await fs.symlink(moved, created.projectPath); const bytes = await fs.readFile(moved);
  await assert.rejects(inspectDraft(f.registry, created.draft.id), { code: 'UNSAFE_PROJECT_PATH' }); assert.deepEqual(await fs.readFile(moved), bytes); await absent(`${created.projectPath}.saved.json`);
  const registryReal = `${f.registry}.real`; await fs.rename(f.registry, registryReal); await fs.symlink(registryReal, f.registry); assert.equal((await listDrafts(f.registry)).status, 'unavailable'); await assert.rejects(f.create(), { code: 'UNSAFE_PATH' });
});

test('stale draft fingerprint or an already held project lock fails recovery without changing working bytes', async t => {
  const f = await fixture(t), created = await f.create(), preview = await inspectDraft(f.registry, created.draft.id), before = await fs.readFile(created.projectPath);
  await assert.rejects(prepareDraft(f.registry, created.draft.id, { expectedFingerprint: preview.fingerprint, reserveTarget: f.reserve }), /already open/);
  await created.releaseLock(); await fs.appendFile(created.projectPath, '\n');
  await assert.rejects(prepareDraft(f.registry, created.draft.id, { expectedFingerprint: preview.fingerprint, reserveTarget: f.reserve }), { code: 'PROJECT_FILE_CHANGED' });
  assert.deepEqual(await fs.readFile(created.projectPath), Buffer.concat([before, Buffer.from('\n')])); await absent(`${created.projectPath}.lock`); await absent(`${created.projectPath}.saved.json`);
});

test('failed creation leaves a discoverable incomplete reservation and never reuses its Untitled number', async t => {
  const f = await fixture(t);
  await assert.rejects(f.create({ reserveTarget: () => { throw new Error('reservation failed'); } }), error => error.details.numberReserved === true && error.details.recoveryRetained === true);
  const list = await listDrafts(f.registry); assert.equal(list.nextNumber, 2); assert.equal(list.entries[0].status, 'unavailable'); assert.equal(list.entries[0].resumable, false);
  const created = await f.create(); assert.equal(created.project.name, 'Untitled2'); assert.equal((await listDrafts(f.registry)).entries.length, 2);
});

test('metadata publication followed by a directory-sync error reports a committed warning and retains recoverability', async t => {
  const f = await fixture(t), rename = fs.rename.bind(fs); let injected = false;
  t.mock.method(fs, 'rename', async (source, destination) => { await rename(source, destination); if (String(destination).endsWith('.draft.json') && !injected) { injected = true; throw Object.assign(new Error('after metadata rename'), { code: 'EIO' }); } });
  const created = await f.create(), target = path.join(f.folder, 'Song.json');
  const intent = await beginDraftPublication(f.registry, created.draft.id, { targetPath: target, project: created.project });
  assert.equal(injected, true); assert.ok(intent.warnings.some(item => item.code === 'DRAFT_COMMITTED_WITH_WARNING')); assert.equal((await listDrafts(f.registry)).entries[0].resumable, true);
  await abortDraftPublication(f.registry, created.draft.id, { intentId: intent.intentId }); assert.equal((await inspectDraft(f.registry, created.draft.id)).draft.state, 'ready');
});

test('nonempty chosen folders are preserved and invalid creation inputs cannot initialize a false project', async t => {
  const f = await fixture(t); await fs.mkdir(f.folder); const user = path.join(f.folder, 'existing.wav'); await fs.writeFile(user, 'user bytes');
  const created = await f.create(); assert.equal(await fs.readFile(user, 'utf8'), 'user bytes'); await absent(`${created.projectPath}.saved.json`);
  await assert.rejects(createDraft(f.registry, { projectFolder: f.folder, reserveTarget: f.reserve }), { code: 'EXPECTED_DRAFT_REVISION_REQUIRED' });
  await assert.rejects(previewDraft(f.registry, { projectFolder: f.folder, sampleRate: 0 })); assert.equal((await listDrafts(f.registry)).nextNumber, 2);
});

test('an existing-folder constraint permits only the selected folder or one immediate child', async t => {
  const f = await fixture(t); await fs.mkdir(f.folder); const before = await tree(f.directory);
  for (const projectFolder of [path.join(f.folder, 'nested', 'child'), path.join(f.directory, 'Other')]) {
    await assert.rejects(f.create({ projectFolder, existingFolder: f.folder }), { code: 'INVALID_DRAFT_FOLDER' });
    assert.deepEqual(await tree(f.directory), before);
  }
  const first = await f.create({ existingFolder: f.folder }); assert.equal(first.directory, f.folder);
  const child = path.join(f.folder, 'Untitled'), second = await f.create({ projectFolder: child, existingFolder: f.folder }); assert.equal(second.directory, child);
  const third = await f.create({ projectFolder: child, existingFolder: f.folder }); assert.equal(third.directory, child);
});

test('a deleted required folder fails before registry reservation and remains absent', async t => {
  const f = await fixture(t), child = path.join(f.folder, 'Untitled'); await fs.mkdir(f.folder);
  await previewDraft(f.registry, { projectFolder: child }); await fs.rmdir(f.folder);
  await assert.rejects(createDraft(f.registry, { projectFolder: child, existingFolder: f.folder, expectedRegistryRevision: 0, reserveTarget: f.reserve }), { code: 'ENOENT' });
  await absent(f.folder); await absent(f.registry); await absent(path.dirname(f.registry));
});

test('a default parent removed immediately before child mkdir is not recreated; reserved number stays discoverable', async t => {
  const f = await fixture(t), child = path.join(f.folder, 'Untitled'); await fs.mkdir(f.folder); const mkdir = fs.mkdir.bind(fs); let removed = false, reserved = false;
  t.mock.method(fs, 'mkdir', async (filename, options) => {
    if (filename === child) { assert.equal(options?.recursive, false); await fs.rmdir(f.folder); removed = true; }
    return mkdir(filename, options);
  });
  await assert.rejects(f.create({ projectFolder: child, existingFolder: f.folder, reserveTarget: () => { reserved = true; } }), error => error.code === 'ENOENT' && error.details.numberReserved === true);
  assert.equal(removed, true); assert.equal(reserved, false); await absent(f.folder);
  const listing = await listDrafts(f.registry); assert.equal(listing.nextNumber, 2); assert.equal(listing.entries[0].status, 'unavailable'); assert.equal(listing.entries[0].resumable, false);
});

test('lock reservation cannot recreate a prompt folder removed after the directory check', async t => {
  const f = await fixture(t); await fs.mkdir(f.folder); let optionsSeen;
  await assert.rejects(f.create({ existingFolder: f.folder, reserveTarget: async (filename, options) => {
    optionsSeen = options; await fs.rmdir(f.folder); return f.reserve(filename, options);
  } }), error => error.code === 'ENOENT' && error.details.recoveryRetained === true);
  assert.deepEqual(optionsSeen, { createParent: false }); await absent(f.folder);
  const listing = await listDrafts(f.registry); assert.equal(listing.nextNumber, 2); assert.equal(listing.entries[0].status, 'unavailable');
});

test('a collision created after draft reservation preserves existing project and history bytes without publishing a descriptor', async t => {
  const f = await fixture(t); let working;
  await assert.rejects(f.create({ reserveTarget: async filename => {
    working = filename; const release = await f.reserve(filename);
    await fs.writeFile(filename, 'existing working bytes'); await fs.writeFile(`${filename}.history.json`, 'existing history bytes'); return release;
  } }), { code: 'OUTPUT_EXISTS' });
  assert.equal(await fs.readFile(working, 'utf8'), 'existing working bytes'); assert.equal(await fs.readFile(`${working}.history.json`, 'utf8'), 'existing history bytes');
  await absent(`${working}.draft.json`); await absent(`${working}.lock`); assert.equal((await listDrafts(f.registry)).nextNumber, 2);
});

test('first-Save intent refuses a stale caller project even when project ID and revision still match', async t => {
  const f = await fixture(t), created = await f.create(), before = await fs.readFile(created.draft.descriptorPath), changed = { ...created.project, name: 'External same-revision edit' };
  await fs.writeFile(created.projectPath, JSON.stringify(changed));
  await assert.rejects(beginDraftPublication(f.registry, created.draft.id, { targetPath: path.join(f.folder, 'First.json'), project: created.project }), { code: 'PROJECT_FILE_CHANGED' });
  assert.deepEqual(await fs.readFile(created.draft.descriptorPath), before); await absent(path.join(f.folder, 'First.json')); await absent(`${created.projectPath}.saved.json`);
});

test('numbered Untitled backup metadata survives read-only preview and actual draft recovery', async t => {
  const f = await fixture(t), created = await f.create(); await edit(created, 'Unsaved with backups');
  const backup = await createAutoBackup(created.projectPath, created.project, { baseName: created.draft.name }); await created.releaseLock();
  const before = await tree(f.directory), preview = await inspectDraft(f.registry, created.draft.id);
  assert.equal(preview.backups.status, 'ready'); assert.equal(preview.backups.files[0].file, 'Untitled1-01.bak'); assert.equal(preview.backups.files[0].id, backup.id); assert.equal(preview.backups.lastFingerprint, backup.fingerprint);
  assert.ok(!preview.warnings.some(item => item.code === 'BACKUP_REGISTRY_INVALID')); assert.deepEqual(await tree(f.directory), before);
  const prepared = await f.prepare(created); await prepared.releaseLock(); assert.equal(prepared.backups.files[0].id, backup.id); assert.equal(prepared.backups.lastFingerprint, backup.fingerprint); assert.deepEqual(await tree(f.directory), before); await absent(`${created.projectPath}.saved.json`);
});
