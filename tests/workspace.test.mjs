import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Engine, createProject } from '../src/core/engine.mjs';
import { acquireProjectLock } from '../src/storage.mjs';
import { updateSessionSettings, DEFAULT_SESSION_SETTINGS, canonicalProjectHash } from '../src/session-store.mjs';
import { saveExplicitCheckpoint, previewProjectVersion, prepareProjectVersion } from '../src/project-save.mjs';
import { inspectExistingProject } from '../src/project-open.mjs';
import { encodeWav } from '../src/media/wav.mjs';
import { createWorkspace } from '../src/workspace.mjs';
import { createDraft, inspectDraft, beginDraftPublication, finalizeDraftPublication } from '../src/project-drafts.mjs';

const command = (engine, name) => assert.equal(engine.execute({ command: 'project.rename', arguments: { name } }).status, 'applied');
async function tree(directory) {
  const result = {};
  for (const item of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join(directory, item.name);
    result[item.name] = item.isDirectory() ? await tree(file) : item.isSymbolicLink() ? `link:${await fs.readlink(file)}` : await fs.readFile(file);
  }
  return result;
}
async function fixture(t, { initial = true, wav = false } = {}) {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'newdaw-workspace-'))), releases = [], reserved = [], saved = [];
  const paths = {}, contexts = {}, engines = {};
  const reserve = async filename => { reserved.push(filename); const release = await acquireProjectLock(filename, 'http://127.0.0.1:4317'); releases.push(release); return release; };
  const fromPrepared = prepared => {
    const engine = new Engine(prepared.project); engine.restoreCheckpoint(prepared.checkpoint);
    return { engine, projectPath: prepared.projectPath, directory: prepared.directory, saved: prepared.saved, settings: prepared.settings, persistence: prepared.persistence, draft: prepared.draft ?? null,
      releaseLock: prepared.releaseLock, resources: prepared.resources, documentState: { saved: prepared.saved },
      autoBackup: { lastId: null, nextDueAt: 123456, running: false }, backupBaselineHash: canonicalProjectHash(engine.project) };
  };
  for (const name of ['A', 'B', 'C']) {
    const filename = path.join(directory, `${name}.newdaw.json`), engine = new Engine(createProject({ name }));
    if (name === 'B') {
      command(engine, 'B edited once'); command(engine, 'B edited twice'); engine.execute({ command: 'history.undo', arguments: {} });
      if (wav) {
        const bytes = Buffer.from(encodeWav({ sampleRate: 8000, channels: [new Float32Array(80).fill(.2)] })), sha256 = createHash('sha256').update(bytes).digest('hex');
        const project = engine.project; project.assets.push({ id: 'wave', name: 'Recorded.wav', sha256, path: `assets/${sha256}.wav`, sampleRate: 8000, channels: 1, frames: 80 });
        engines[name] = new Engine(project); await fs.mkdir(path.join(directory, 'assets')); await fs.writeFile(path.join(directory, project.assets[0].path), bytes);
      }
    }
    engines[name] ??= engine; paths[name] = filename;
    await fs.writeFile(filename, JSON.stringify(engines[name].project));
    const settings = structuredClone(DEFAULT_SESSION_SETTINGS); if (name === 'B') { settings.revision = 7; settings.autoBackup.intervalMinutes = 13; }
    await updateSessionSettings(filename, engines[name].checkpoint(), settings);
    if (name === 'A') await saveExplicitCheckpoint(filename, engine.project);
    contexts[name] = fromPrepared(await inspectExistingProject(filename, { deferredMedia: true }));
  }
  let active = initial ? contexts.A : null, emitted = 0, queue = Promise.resolve();
  if (active) active.releaseLock = await reserve(paths.A);
  const callbacks = {
    captureActive: () => active,
    fromPrepared,
    adopt: async (context, publish) => { active = context; publish(); },
    deactivate: async publish => { active = null; publish(); },
    saveContext: async (context, input = {}) => {
      if (context.draft) {
        const checkpoint = context.engine.checkpoint();
        const preview = await previewProjectVersion(context.projectPath, { checkpoint, mode: 'saveAs', outputPath: input.saveOutputPath });
        if (input.dryRun) return preview;
        const intent = await beginDraftPublication(draftRegistryPath, context.draft.id, { targetPath: preview.projectPath, project: checkpoint.project });
        const prepared = await prepareProjectVersion(context.projectPath, { checkpoint, settings: context.settings, mode: 'saveAs', outputPath: preview.projectPath, reserveTarget: reserve });
        await finalizeDraftPublication(draftRegistryPath, context.draft.id, { intentId: intent.intentId });
        const value = { available: true, checkpoint: prepared.savedCheckpoint, dirty: false, persistence: { status: 'saved', warnings: [] } }, release = context.releaseLock;
        saved.push(context.projectPath); Object.assign(context, { projectPath: prepared.projectPath, directory: path.dirname(prepared.projectPath), releaseLock: prepared.releaseLock, saved: value, draft: null });
        if (active?.openId === context.openId) active = context;
        workspace.contextChanged(); await release?.(); await workspace.remember(context); return value;
      }
      saved.push(context.projectPath); const value = await saveExplicitCheckpoint(context.projectPath, context.engine.project); context.saved = value; if (active?.openId === context.openId) active.saved = value; return value;
    },
    acceptSaved: (context, value) => { if (active?.openId === context.openId) active.saved = value; },
    reserveTarget: reserve,
    runExclusive: callback => { const result = queue.then(callback); queue = result.catch(() => {}); return result; },
    emit: () => emitted++, isClosed: () => false,
  };
  const draftRegistryPath = path.join(directory, 'recent.json.drafts.json');
  const workspace = createWorkspace({ initial: active, ...Object.fromEntries(Object.keys(callbacks).map(key => [key, (...args) => callbacks[key](...args)])), recentPath: path.join(directory, 'recent.json'), draftRegistryPath });
  t.after(async () => { for (const release of releases) await release().catch(() => {}); await fs.rm(directory, { recursive: true, force: true }); });
  return { directory, paths, contexts, engines, workspace, callbacks, reserved, saved, draftRegistryPath, get active() { return active; }, set active(value) { active = value; }, get emitted() { return emitted; },
    async rename(context, name) { command(context.engine, name); await fs.writeFile(context.projectPath, JSON.stringify(context.engine.project)); await updateSessionSettings(context.projectPath, context.engine.checkpoint(), context.settings); },
    async open(name, mode = 'inactive', extra = {}) { const plan = await workspace.planOpen({ expectedWorkspaceRevision: workspace.snapshot().revision, projectPath: paths[name], mode }); return workspace.open({ expectedWorkspaceRevision: plan.workspaceRevision, planId: plan.id, ...extra }); },
    async activate(id, extra = {}) { const plan = await workspace.planActivate({ expectedWorkspaceRevision: workspace.snapshot().revision, documentId: id }); return workspace.activate({ expectedWorkspaceRevision: plan.workspaceRevision, planId: plan.id, ...extra }); },
    async close(id, extra = {}) { const plan = await workspace.planClose({ expectedWorkspaceRevision: workspace.snapshot().revision, documentId: id }); return workspace.close({ expectedWorkspaceRevision: plan.workspaceRevision, planId: plan.id, ...extra }); },
    async new(mode = 'active', extra = {}) { const plan = await workspace.planNew({ expectedWorkspaceRevision: workspace.snapshot().revision, projectFolder: path.join(directory, 'Draft Folder'), mode }); return workspace.new({ expectedWorkspaceRevision: plan.workspaceRevision, planId: plan.id, ...extra }); },
    async recover(draftId, mode = 'active', extra = {}) { const plan = await workspace.planRecover({ expectedWorkspaceRevision: workspace.snapshot().revision, draftId, mode }); return workspace.recover({ expectedWorkspaceRevision: plan.workspaceRevision, planId: plan.id, ...extra }); },
  };
}

test('inactive open retains active context, defers WAV reads, holds both locks and restores history/settings', async t => {
  const f = await fixture(t, { wav: true }), original = await fs.readFile(f.paths.B), activeId = f.workspace.snapshot().activeId;
  await f.rename(f.contexts.A, 'Dirty active');
  const realOpen = fs.open.bind(fs); let mediaReads = 0;
  t.mock.method(fs, 'open', (filename, ...args) => { if (String(filename).endsWith('.wav')) mediaReads++; return realOpen(filename, ...args); });
  const result = await f.open('B');
  assert.equal(result.workspace.activeId, activeId); assert.equal(f.active.engine, f.contexts.A.engine); assert.equal(result.workspace.documents.length, 2);
  const parked = f.workspace.contexts().find(context => context.projectPath === f.paths.B);
  assert.equal(parked.resources, 'deferred'); assert.equal(parked.settings.revision, 7); assert.equal(parked.settings.autoBackup.intervalMinutes, 13); assert.equal(parked.saved.available, true);
  assert.equal(mediaReads, 0); assert.equal(f.saved.length, 0); assert.equal(f.reserved.length, 2);
  assert.ok((await fs.lstat(`${f.paths.A}.lock`)).isFile()); assert.ok((await fs.lstat(`${f.paths.B}.lock`)).isFile()); assert.deepEqual(await fs.readFile(f.paths.B), original);
});

test('open/activate/close previews and dry runs never initialize, lock, save or change recent registry', async t => {
  const f = await fixture(t), before = await tree(f.directory);
  const plan = await f.workspace.planOpen({ expectedWorkspaceRevision: 0, projectPath: f.paths.B, mode: 'inactive' });
  assert.equal(plan.requiresCurrentPolicy, false); assert.equal((await f.workspace.open({ expectedWorkspaceRevision: 0, planId: plan.id, dryRun: true })).status, 'validated');
  assert.deepEqual(await tree(f.directory), before); assert.equal(f.reserved.length, 1);
  await f.open('B'); const id = f.workspace.snapshot().documents.find(item => !item.active).id, afterOpen = await tree(f.directory);
  const activation = await f.workspace.planActivate({ expectedWorkspaceRevision: 1, documentId: id });
  await f.workspace.activate({ expectedWorkspaceRevision: 1, planId: activation.id, dryRun: true });
  const closing = await f.workspace.planClose({ expectedWorkspaceRevision: 1, documentId: id });
  await f.workspace.close({ expectedWorkspaceRevision: 1, planId: closing.id, dryRun: true });
  assert.deepEqual(await tree(f.directory), afterOpen); assert.equal(f.saved.length, 0); assert.equal(f.workspace.snapshot().revision, 1);
});

test('activation preserves parked engine/history/settings/timer and requires a decision for dirty current project', async t => {
  const f = await fixture(t); await f.rename(f.contexts.A, 'Unsaved A'); const originalA = f.workspace.snapshot().activeId;
  await f.open('B'); const parkedB = f.workspace.contexts().find(context => context.projectPath === f.paths.B), history = parkedB.engine.exportHistory();
  const plan = await f.workspace.planActivate({ expectedWorkspaceRevision: 1, documentId: parkedB.openId });
  assert.equal(plan.requiresCurrentPolicy, true); assert.equal(plan.policyTarget, 'current');
  await assert.rejects(f.workspace.activate({ expectedWorkspaceRevision: 1, planId: plan.id }), { code: 'CURRENT_POLICY_REQUIRED' });
  const result = await f.workspace.activate({ expectedWorkspaceRevision: 1, planId: plan.id, currentPolicy: 'preserve' });
  assert.equal(result.workspace.activeId, parkedB.openId); assert.equal(f.reserved.length, 2); assert.equal(f.saved.length, 0); assert.equal(parkedB.resources, 'initialized');
  assert.deepEqual(f.active.engine.exportHistory(), history); assert.equal(f.active.engine.canRedo, true); assert.equal(f.active.settings.autoBackup.intervalMinutes, 13);
  await f.activate(originalA);
  assert.equal(f.active.engine.project.name, 'Unsaved A'); assert.equal(f.active.autoBackup.nextDueAt, 123456); assert.equal(f.active.saved.checkpoint.project.name, 'A'); assert.equal(f.workspace.snapshot().documents.length, 2);
});

test('activating deferred media performs verification and reports missing/changed assets without mutation', async t => {
  const f = await fixture(t, { wav: true }); await f.open('B'); const parked = f.workspace.contexts().find(context => context.projectPath === f.paths.B), asset = parked.engine.project.assets[0];
  await fs.writeFile(path.join(f.directory, asset.path), 'changed');
  const realOpen = fs.open.bind(fs); let reads = 0;
  t.mock.method(fs, 'open', (filename, ...args) => { if (String(filename).endsWith('.wav')) reads++; return realOpen(filename, ...args); });
  const result = await f.activate(parked.openId);
  assert.ok(reads > 0); assert.ok(result.warnings.some(item => item.code === 'ASSET_CHANGED')); assert.equal(f.active.resources, 'initialized'); assert.equal(await fs.readFile(path.join(f.directory, asset.path), 'utf8'), 'changed');
});

test('canonical duplicate open selects the existing document without acquiring another lock', async t => {
  const f = await fixture(t); await f.open('B'); const id = f.workspace.snapshot().documents.find(item => !item.active).id;
  const noOp = await f.open('B'); assert.equal(noOp.status, 'unchanged'); assert.equal(noOp.workspace.revision, 1); assert.equal(f.reserved.length, 2);
  const result = await f.open('B', 'active'); assert.equal(result.workspace.activeId, id); assert.equal(result.workspace.documents.length, 2); assert.equal(f.reserved.length, 2);
  assert.equal((await f.open('B', 'active')).status, 'unchanged');
});

test('inactive close saves only its target and releases only that document lock', async t => {
  const f = await fixture(t); await f.open('B'); const parked = f.workspace.contexts().find(context => context.projectPath === f.paths.B), activeId = f.workspace.snapshot().activeId;
  await f.rename(f.contexts.A, 'A still dirty'); await f.rename(parked, 'B new edit');
  const plan = await f.workspace.planClose({ expectedWorkspaceRevision: 1, documentId: parked.openId });
  assert.equal(plan.requiresCurrentPolicy, true); assert.equal(plan.policyTarget, 'target');
  await assert.rejects(f.workspace.close({ expectedWorkspaceRevision: 1, planId: plan.id }), { code: 'CURRENT_POLICY_REQUIRED' });
  const result = await f.workspace.close({ expectedWorkspaceRevision: 1, planId: plan.id, currentPolicy: 'save' });
  assert.equal(result.targetSaved, true); assert.deepEqual(f.saved, [f.paths.B]); assert.equal(result.workspace.activeId, activeId); assert.equal(result.workspace.documents[0].dirty, true);
  await assert.rejects(fs.lstat(`${f.paths.B}.lock`), { code: 'ENOENT' }); assert.ok((await fs.lstat(`${f.paths.A}.lock`)).isFile()); assert.equal((await inspectExistingProject(f.paths.B)).saved.checkpoint.project.name, 'B new edit');
});

test('closing the active project leaves none active and preserves other documents until explicit activation', async t => {
  const f = await fixture(t); await f.open('B'); const { activeId, documents } = f.workspace.snapshot(), other = documents.find(item => !item.active).id;
  const result = await f.close(activeId);
  assert.equal(result.workspace.activeId, null); assert.equal(f.active, null); assert.deepEqual(result.workspace.documents.map(item => item.id), [other]); assert.equal(result.workspace.documents[0].active, false);
  assert.ok((await fs.lstat(`${f.paths.B}.lock`)).isFile()); await assert.rejects(fs.lstat(`${f.paths.A}.lock`), { code: 'ENOENT' });
  const activated = await f.activate(other); assert.equal(activated.workspace.activeId, other); assert.equal(activated.currentSaved, false); assert.equal(f.reserved.length, 2);
});

test('an empty workspace can open inactive, activate, close and reopen active without creating a demo', async t => {
  const f = await fixture(t, { initial: false }); assert.deepEqual(f.workspace.snapshot(), { revision: 0, activeId: null, documents: [], locationSettings: null });
  await f.open('B'); assert.equal(f.workspace.snapshot().activeId, null); const id = f.workspace.snapshot().documents[0].id;
  await f.activate(id); await f.close(id); assert.equal(f.workspace.snapshot().documents.length, 0);
  const result = await f.open('C', 'active'); assert.equal(result.workspace.documents[0].name, 'C'); assert.equal(result.workspace.documents[0].active, true);
});

test('workspace revisions, active command edits and same-revision explicit Save invalidate old plans', async t => {
  const f = await fixture(t), plan = await f.workspace.planOpen({ expectedWorkspaceRevision: 0, projectPath: f.paths.B, mode: 'inactive' });
  await f.rename(f.contexts.A, 'A changed');
  await assert.rejects(f.workspace.open({ expectedWorkspaceRevision: 0, planId: plan.id }), { code: 'WORKSPACE_CONFLICT' });
  const next = await f.workspace.planOpen({ expectedWorkspaceRevision: 0, projectPath: f.paths.B, mode: 'active' });
  await f.callbacks.saveContext(f.contexts.A);
  await assert.rejects(f.workspace.open({ expectedWorkspaceRevision: 0, planId: next.id, currentPolicy: 'preserve' }), { code: 'WORKSPACE_CONFLICT' });
  await f.open('B'); await assert.rejects(f.workspace.planClose({ expectedWorkspaceRevision: 0, documentId: f.workspace.snapshot().activeId }), { code: 'WORKSPACE_CONFLICT' });
});

test('external current or target project edits reject transition before explicit Save and preserve both contexts', async t => {
  const f = await fixture(t); await f.open('B'); const target = f.workspace.snapshot().documents.find(item => !item.active).id, activeId = f.workspace.snapshot().activeId;
  let plan = await f.workspace.planActivate({ expectedWorkspaceRevision: 1, documentId: target });
  const originalA = await fs.readFile(f.paths.A); await fs.appendFile(f.paths.A, '\n');
  await assert.rejects(f.workspace.activate({ expectedWorkspaceRevision: 1, planId: plan.id, currentPolicy: 'save' }), { code: 'PROJECT_FILE_CHANGED' });
  assert.equal(f.saved.length, 0); assert.equal(f.workspace.snapshot().activeId, activeId); await fs.writeFile(f.paths.A, originalA);
  plan = await f.workspace.planActivate({ expectedWorkspaceRevision: 1, documentId: target });
  const changed = f.engines.B.project; changed.name = 'External target'; await fs.writeFile(f.paths.B, JSON.stringify(changed));
  await assert.rejects(f.workspace.activate({ expectedWorkspaceRevision: 1, planId: plan.id, currentPolicy: 'save' }), { code: 'PROJECT_FILE_CHANGED' });
  assert.equal(f.saved.length, 0); assert.equal(f.workspace.snapshot().documents.length, 2);
});

test('external saved baselines refresh in preview, then later saved changes invalidate active and target actions', async t => {
  const f = await fixture(t); await f.rename(f.contexts.A, 'A edited'); await saveExplicitCheckpoint(f.paths.A, f.contexts.A.engine.project);
  await f.open('B'); const target = f.workspace.snapshot().documents.find(item => !item.active).id;
  let plan = await f.workspace.planActivate({ expectedWorkspaceRevision: 1, documentId: target });
  assert.equal(plan.current.dirty, false); assert.equal(plan.requiresCurrentPolicy, false);
  const replacement = await saveExplicitCheckpoint(f.paths.A, f.contexts.A.engine.project), original = await fs.readFile(`${f.paths.A}.saved.json`);
  await assert.rejects(f.workspace.activate({ expectedWorkspaceRevision: 1, planId: plan.id, currentPolicy: 'save' }), { code: 'WORKSPACE_CONFLICT' });
  assert.equal(f.saved.length, 0); assert.equal(f.workspace.snapshot().documents.find(item => item.active).saveId, replacement.checkpoint.saveId); assert.deepEqual(await fs.readFile(`${f.paths.A}.saved.json`), original);
  plan = await f.workspace.planClose({ expectedWorkspaceRevision: 1, documentId: target });
  await fs.appendFile(`${f.paths.B}.saved.json`, '\n');
  await assert.rejects(f.workspace.close({ expectedWorkspaceRevision: 1, planId: plan.id, currentPolicy: 'save' }), { code: 'WORKSPACE_CONFLICT' });
  assert.equal(f.saved.length, 0); assert.equal(f.workspace.snapshot().documents.length, 2);
});

test('a saved sidecar change between validated loading and raw-key capture rejects the inconsistent preview', async t => {
  const f = await fixture(t); await f.open('B'); const id = f.workspace.snapshot().documents.find(item => !item.active).id, originalId = f.workspace.snapshot().activeId;
  const realOpen = fs.open.bind(fs); let reads = 0, injected = false;
  t.mock.method(fs, 'open', async (filename, ...args) => {
    if (String(filename) === `${f.paths.B}.saved.json` && ++reads === 3) { injected = true; await fs.appendFile(filename, '\n'); }
    return realOpen(filename, ...args);
  });
  await assert.rejects(f.workspace.planActivate({ expectedWorkspaceRevision: 1, documentId: id }), { code: 'WORKSPACE_CONFLICT' });
  assert.equal(injected, true); assert.equal(f.workspace.snapshot().activeId, originalId); assert.equal(f.saved.length, 0); assert.equal(f.workspace.snapshot().revision, 1);
});

test('target reservation failure and preparation callback failure preserve current state without leaking acquired target lock', async t => {
  const f = await fixture(t), activeId = f.workspace.snapshot().activeId, reserve = f.callbacks.reserveTarget;
  f.callbacks.reserveTarget = async () => { throw Object.assign(new Error('locked elsewhere'), { code: 'PROJECT_LOCKED' }); };
  await assert.rejects(f.open('B', 'active'), { code: 'PROJECT_LOCKED' }); assert.equal(f.workspace.snapshot().activeId, activeId); await assert.rejects(fs.lstat(`${f.paths.B}.saved.json`), { code: 'ENOENT' });
  f.callbacks.reserveTarget = reserve; f.callbacks.fromPrepared = () => { throw new Error('invalid candidate'); };
  await assert.rejects(f.open('B', 'active'), /invalid candidate/);
  await assert.rejects(fs.lstat(`${f.paths.B}.lock`), { code: 'ENOENT' }); assert.ok((await fs.lstat(`${f.paths.A}.lock`)).isFile()); assert.equal(f.workspace.snapshot().documents.length, 1);
});

test('failed pre-publication adoption releases a new target but retains an already parked target and a successful current Save', async t => {
  const f = await fixture(t); await f.rename(f.contexts.A, 'Dirty A'); f.callbacks.adopt = async () => { throw new Error('activation failed'); };
  await assert.rejects(f.open('B', 'active', { currentPolicy: 'save' }), error => error.details.activated === false && error.details.currentSaved === true && error.details.targetPrepared === true);
  assert.deepEqual(f.saved, [f.paths.A]); assert.equal(f.workspace.snapshot().documents[0].dirty, false); await assert.rejects(fs.lstat(`${f.paths.B}.lock`), { code: 'ENOENT' });
  await f.open('B'); const id = f.workspace.snapshot().documents.find(item => !item.active).id;
  await assert.rejects(f.activate(id), /activation failed/); assert.ok((await fs.lstat(`${f.paths.B}.lock`)).isFile()); assert.equal(f.workspace.snapshot().documents.length, 2);
});

test('post-publication callback errors report committed activation and close while pre-publication close errors retain the target', async t => {
  const f = await fixture(t), adopt = f.callbacks.adopt;
  f.callbacks.adopt = async (context, publish) => { await adopt(context, publish); throw new Error('after publication'); };
  const result = await f.open('B', 'active'); assert.equal(result.applied, true); assert.ok(result.warnings.some(item => item.code === 'ACTIVATED_WITH_WARNING')); assert.equal(f.active.projectPath, f.paths.B);
  const id = f.workspace.snapshot().activeId, deactivate = f.callbacks.deactivate;
  f.callbacks.deactivate = async () => { throw new Error('before close publication'); };
  await assert.rejects(f.close(id), error => error.details.closed === false); assert.ok((await fs.lstat(`${f.paths.B}.lock`)).isFile()); assert.equal(f.workspace.snapshot().activeId, id);
  f.callbacks.deactivate = async publish => { await deactivate(publish); throw new Error('after close publication'); };
  const closed = await f.close(id); assert.equal(closed.workspace.activeId, null); assert.ok(closed.warnings.some(item => item.code === 'CLOSED_WITH_WARNING')); await assert.rejects(fs.lstat(`${f.paths.B}.lock`), { code: 'ENOENT' });
});

test('legacy replacement does not copy already adopted globals into the retired context', async t => {
  const f = await fixture(t), retired = f.contexts.A, oldEngine = retired.engine, oldPath = retired.projectPath;
  f.active = f.contexts.C; f.workspace.replaceActive(f.contexts.C);
  assert.equal(retired.engine, oldEngine); assert.equal(retired.projectPath, oldPath); assert.equal(f.workspace.snapshot().documents.length, 1); assert.equal(f.workspace.snapshot().documents[0].projectPath, f.paths.C);
});

test('recent removal works with no active document and guards both workspace and registry revisions', async t => {
  const f = await fixture(t, { initial: false }); await f.open('B'); const recent = await f.workspace.recent(); assert.equal(recent.entries.length, 1);
  const input = { expectedWorkspaceRevision: 1, expectedRegistryRevision: recent.revision, entryId: recent.entries[0].id };
  await f.workspace.changeRecent({ ...input, dryRun: true }); assert.equal((await f.workspace.recent()).entries.length, 1);
  await assert.rejects(f.workspace.changeRecent({ ...input, expectedWorkspaceRevision: 0 }), { code: 'WORKSPACE_CONFLICT' });
  await f.workspace.changeRecent(input); assert.equal((await f.workspace.recent()).entries.length, 0); assert.equal(f.workspace.snapshot().activeId, null); assert.equal(f.workspace.snapshot().documents.length, 1);
});

test('new-project preview/dry run are read-only and actual creation exposes a real never-saved document without recent entry', async t => {
  const f = await fixture(t, { initial: false }), before = await tree(f.directory), projectFolder = path.join(f.directory, 'Draft Folder');
  const plan = await f.workspace.planNew({ expectedWorkspaceRevision: 0, projectFolder, sampleRate: 44100, mode: 'active' });
  assert.equal(plan.target.name, 'Untitled1'); assert.equal(plan.target.projectPath, null); assert.equal(plan.requiresCurrentPolicy, false);
  await f.workspace.new({ expectedWorkspaceRevision: 0, planId: plan.id, dryRun: true }); assert.deepEqual(await tree(f.directory), before);
  const result = await f.workspace.new({ expectedWorkspaceRevision: 0, planId: plan.id }); const row = result.workspace.documents[0];
  assert.equal(row.projectPath, null); assert.equal(row.fileName, null); assert.equal(row.neverSaved, true); assert.equal(row.displayName, 'Untitled1'); assert.equal(row.projectFolder, projectFolder); assert.equal(row.dirty, true); assert.equal(f.active.engine.project.sampleRate, 44100);
  assert.equal((await f.workspace.recent()).entries.length, 0); assert.equal((await f.workspace.drafts()).entries[0].resumable, true); await assert.rejects(fs.stat(`${f.active.projectPath}.saved.json`), { code: 'ENOENT' });
});

test('switching from a draft requires a first-Save filename only for save and retains its stable open ID after publication', async t => {
  const f = await fixture(t), originalId = f.workspace.snapshot().activeId; await f.new(); const draft = f.workspace.contexts().find(context => context.draft), id = draft.openId, working = draft.projectPath;
  await f.rename(draft, 'Editable draft content'); const before = draft.engine.checkpoint();
  const plan = await f.workspace.planActivate({ expectedWorkspaceRevision: f.workspace.snapshot().revision, documentId: originalId });
  assert.equal(plan.requiresCurrentPolicy, true); assert.equal(plan.requiresSavePath, true);
  await assert.rejects(f.workspace.activate({ expectedWorkspaceRevision: plan.workspaceRevision, planId: plan.id, currentPolicy: 'save' }), { code: 'SAVE_OUTPUT_PATH_REQUIRED' });
  const target = path.join(f.directory, 'First saved.json'), result = await f.workspace.activate({ expectedWorkspaceRevision: plan.workspaceRevision, planId: plan.id, currentPolicy: 'save', saveOutputPath: target });
  assert.equal(result.workspace.activeId, originalId); const row = result.workspace.documents.find(item => item.id === id);
  assert.equal(row.neverSaved, false); assert.equal(row.projectPath, target); assert.equal(row.dirty, false); assert.deepEqual(draft.engine.checkpoint(), before); assert.deepEqual(f.saved, [working]);
  assert.equal((await f.workspace.drafts()).entries[0].resumable, false); await assert.rejects(fs.stat(`${working}.saved.json`), { code: 'ENOENT' });
});

test('dry-run save policy validates a draft destination without reserving it or changing the working project', async t => {
  const f = await fixture(t), originalId = f.workspace.snapshot().activeId; await f.new(); const plan = await f.workspace.planActivate({ expectedWorkspaceRevision: 1, documentId: originalId }), before = await tree(f.directory);
  await assert.rejects(f.workspace.activate({ expectedWorkspaceRevision: 1, planId: plan.id, currentPolicy: 'save', saveOutputPath: f.paths.A, dryRun: true }), { code: 'OUTPUT_EXISTS' });
  const target = path.join(f.directory, 'No-write-first-save.json'); await f.workspace.activate({ expectedWorkspaceRevision: 1, planId: plan.id, currentPolicy: 'save', saveOutputPath: target, dryRun: true });
  assert.deepEqual(await tree(f.directory), before); assert.equal(f.saved.length, 0); assert.equal(f.workspace.snapshot().documents.find(item => item.active).neverSaved, true);
});

test('closing a draft with preserve leaves recoverable edits and later recovery can remain inactive until explicit activation', async t => {
  const f = await fixture(t, { initial: false }); await f.new(); const context = f.workspace.contexts()[0], draftId = context.draft.id; await f.rename(context, 'Retained unsaved work'); const checkpoint = context.engine.checkpoint();
  await f.close(context.openId, { currentPolicy: 'preserve' }); assert.equal(f.workspace.snapshot().activeId, null); assert.equal(f.workspace.snapshot().documents.length, 0); assert.equal((await f.workspace.drafts()).entries[0].resumable, true);
  const plan = await f.workspace.planRecover({ expectedWorkspaceRevision: 2, draftId, mode: 'inactive' }), before = await tree(f.directory);
  await f.workspace.recover({ expectedWorkspaceRevision: 2, planId: plan.id, dryRun: true }); assert.deepEqual(await tree(f.directory), before);
  const result = await f.workspace.recover({ expectedWorkspaceRevision: 2, planId: plan.id }); assert.equal(result.workspace.activeId, null); assert.equal(result.workspace.documents[0].resources, 'deferred');
  assert.deepEqual(f.workspace.contexts()[0].engine.checkpoint(), checkpoint); await f.activate(result.workspace.documents[0].id); assert.equal(f.active.engine.project.name, 'Retained unsaved work'); assert.equal(f.active.draft.id, draftId); assert.equal((await f.workspace.recent()).entries.length, 0);
});

test('recovering an already open draft deduplicates by registered identity and never reacquires its lock', async t => {
  const f = await fixture(t); await f.new('inactive'); const row = f.workspace.snapshot().documents.find(item => item.neverSaved), count = f.reserved.length;
  assert.equal((await f.recover(row.draftId, 'inactive')).status, 'unchanged'); assert.equal(f.reserved.length, count);
  const result = await f.recover(row.draftId, 'active'); assert.equal(result.workspace.activeId, row.id); assert.equal(result.workspace.documents.length, 2); assert.equal(f.reserved.length, count);
});

test('new draft registry changes and recovered working-file changes invalidate previews without modifying active state', async t => {
  const f = await fixture(t), originalId = f.workspace.snapshot().activeId, projectFolder = path.join(f.directory, 'Draft Folder');
  const plan = await f.workspace.planNew({ expectedWorkspaceRevision: 0, projectFolder, mode: 'inactive' });
  const external = await createDraft(f.draftRegistryPath, { projectFolder, expectedRegistryRevision: 0, reserveTarget: f.callbacks.reserveTarget }); await external.releaseLock();
  await assert.rejects(f.workspace.new({ expectedWorkspaceRevision: 0, planId: plan.id }), { code: 'DRAFT_REGISTRY_CONFLICT' });
  const recovery = await f.workspace.planRecover({ expectedWorkspaceRevision: 0, draftId: external.draft.id, mode: 'active' }); await fs.appendFile(external.projectPath, '\n');
  await assert.rejects(f.workspace.recover({ expectedWorkspaceRevision: 0, planId: recovery.id }), { code: 'PROJECT_FILE_CHANGED' }); assert.equal(f.workspace.snapshot().activeId, originalId); assert.equal(f.workspace.snapshot().documents.length, 1);
});

test('inactive draft close-save publishes only its target and keeps the current named document active', async t => {
  const f = await fixture(t), originalId = f.workspace.snapshot().activeId; await f.new('inactive'); const context = f.workspace.contexts().find(item => item.draft), working = context.projectPath;
  await f.rename(context, 'Inactive draft edits'); await f.rename(f.contexts.A, 'A still unsaved');
  const target = path.join(f.directory, 'Inactive saved.json'), result = await f.close(context.openId, { currentPolicy: 'save', saveOutputPath: target });
  assert.equal(result.workspace.activeId, originalId); assert.equal(result.workspace.documents.length, 1); assert.equal(result.workspace.documents[0].dirty, true); assert.deepEqual(f.saved, [working]);
  assert.equal(JSON.parse(await fs.readFile(target)).name, 'Inactive draft edits'); await assert.rejects(fs.stat(`${target}.lock`), { code: 'ENOENT' }); assert.equal((await f.workspace.drafts()).entries[0].status, 'published');
});

test('new draft activation failure retains a registered recovery copy and releases only its prepared lock', async t => {
  const f = await fixture(t), originalId = f.workspace.snapshot().activeId; f.callbacks.adopt = async () => { throw new Error('cannot activate draft'); };
  await assert.rejects(f.new(), error => error.details.activated === false && error.details.targetPrepared === true);
  assert.equal(f.workspace.snapshot().activeId, originalId); const list = await f.workspace.drafts(); assert.equal(list.entries.length, 1); assert.equal(list.entries[0].resumable, true);
  const inspected = await inspectDraft(f.draftRegistryPath, list.entries[0].id); await assert.rejects(fs.stat(`${inspected.projectPath}.lock`), { code: 'ENOENT' }); await assert.rejects(fs.stat(`${inspected.projectPath}.saved.json`), { code: 'ENOENT' }); assert.equal((await f.workspace.recent()).entries.length, 0);
});
