// Actual isolated Chrome + CLI checks; all project/media fixtures are temporary.
// v0.8 GUI opens retain previous documents; CLI switches use activation for already-open paths.
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { startServer } from '../src/server.mjs';
import { Engine, createProject } from '../src/core/engine.mjs';
import { saveProject } from '../src/storage.mjs';
import { commitSessionState } from '../src/session-store.mjs';
import { saveExplicitCheckpoint } from '../src/project-save.mjs';
import { listRecentProjects, recordRecentProject } from '../src/recent-projects.mjs';
import { encodeWav } from '../src/media/wav.mjs';
const { chromium } = await import(process.env.NEWDAW_PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), exec = promisify(execFile), hash = bytes => createHash('sha256').update(bytes).digest('hex');
const directory = await fs.mkdtemp('/private/tmp/newdaw-projects-gui-'), aPath = path.join(directory, 'Current.newdaw.json'), recentPath = path.join(directory, '.recent.json');
let session = await startServer({ projectPath: aPath, recentPath, port: 0, demo: true, quiet: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome' }), page = await browser.newPage({ viewport: { width: 1512, height: 1180 } }), tests = [], pageErrors = [];
page.on('pageerror', error => pageErrors.push(error.message));
const get = async (route = '/api/state') => { const response = await fetch(session.url + route); assert.equal(response.status, 200); return response.json(); };
const check = id => { tests.push(id); console.log(`PASS ${id}`); };
const action = async (work, route) => { const pending = page.waitForResponse(response => new URL(response.url()).pathname === route && response.request().method() === 'POST').then(async response => ({ status: response.status(), body: await response.json() })); await work(); return pending; };
const ok = response => { assert.equal(response.status, 200, JSON.stringify(response.body)); return response.body; };
const waitState = async expected => page.waitForFunction(value => document.querySelector('#project-name')?.value === value.name && Number(document.querySelector('#revision-label')?.textContent.match(/\d+/)?.[0]) === value.revision, expected);
const cli = async (...args) => JSON.parse((await exec(process.execPath, ['src/cli.mjs', ...args, '--url', session.url], { cwd: root, timeout: 25000 })).stdout);
const activateFile = async filename => { const target = (await get()).workspace.documents.find(item => item.projectPath === filename); const inspected = await cli(target ? 'project-activate-plan' : 'project-open-plan', target?.id ?? filename); return cli(target ? 'project-activate' : 'project-open', inspected.id, '--current', 'preserve'); };
const edit = async (command, args = {}) => { const result = await cli('command', command, JSON.stringify(args)); await waitState((await get()).project); return result; };
const ready = async () => page.waitForFunction(() => document.querySelector('#projects-preview') && !document.querySelector('#projects-preview').disabled);
const openLibrary = async () => { await page.locator('#projects-button').click(); await page.waitForFunction(() => document.querySelector('#projects-dialog')?.open); await ready(); };
const closeLibrary = async () => { await page.locator('#projects-close').click(); await page.waitForFunction(() => !document.querySelector('#projects-dialog').open); };
const refresh = async () => { await page.locator('#projects-refresh').click(); await ready(); };
const preview = async filename => { await page.locator('#projects-path').fill(filename); const result = ok(await action(() => page.locator('#projects-preview').click(), '/api/workspace/open/plan')); await ready(); return result; };
const selectPolicy = async value => { if (await page.locator('#projects-current-policy').isVisible()) await page.locator('#projects-current-policy').selectOption(value); };
const apply = async (policy = 'preserve') => { await selectPolicy(policy); const response = await action(() => page.locator('#projects-open').click(), '/api/workspace/open'); if (response.status === 200) await page.waitForFunction(() => !document.querySelector('#projects-dialog').open); else await ready(); return response; };
const record = async filename => recordRecentProject(recentPath, filename, { expectedRegistryRevision: (await listRecentProjects(recentPath, { inspect: false })).revision });
const sourceBytes = value => Buffer.from(encodeWav({ sampleRate: 8000, channels: [new Float32Array(8000).fill(value)] }));
const assetFrom = (id, name, bytes) => ({ id, name, sha256: hash(bytes), path: `assets/${hash(bytes)}.wav`, sampleRate: 8000, channels: 1, frames: 8000 });

try {
  const initial = await get(), bDirectory = path.join(directory, 'Archive'), bPath = path.join(bDirectory, 'Archive.json'); await fs.mkdir(path.join(bDirectory, 'assets'), { recursive: true });
  const bBytes = sourceBytes(.17), extraBytes = sourceBytes(.04), baseB = structuredClone(initial.project);
  baseB.name = 'Archive before edit'; baseB.revision = 0; const originalAssetId = baseB.assets[0].id;
  baseB.assets = [assetFrom(originalAssetId, 'Archive source.wav', bBytes), assetFrom('asset-extra', 'Room source.wav', extraBytes)];
  for (const clip of baseB.clips.filter(clip => clip.type === 'audio')) { clip.assetId = originalAssetId; clip.offsetFrames = 0; clip.lengthFrames = 8000; }
  await fs.writeFile(path.join(bDirectory, baseB.assets[0].path), bBytes); await fs.writeFile(path.join(bDirectory, baseB.assets[1].path), extraBytes);
  const originB = new Engine(baseB), engineB = new Engine(baseB); assert.equal(engineB.execute({ command: 'project.rename', arguments: { name: 'Archive Session' } }).status, 'applied');
  await saveProject(bPath, baseB); await commitSessionState(bPath, { currentCheckpoint: originB.checkpoint(), nextCheckpoint: engineB.checkpoint() }); await saveExplicitCheckpoint(bPath, engineB.project);
  const cPath = path.join(directory, 'Missing-Media.json'), engineC = new Engine(createProject({ name: 'Missing Media Session' }));
  const missingAsset = assetFrom('missing-source', 'Absent performance.wav', sourceBytes(.23));
  assert.equal(engineC.execute({ command: 'batch', arguments: { commands: [
    { command: 'asset.add', arguments: { asset: missingAsset } }, { command: 'track.add', arguments: { id: 'missing-track', type: 'audio' } },
    { command: 'clip.add', arguments: { id: 'missing-clip', trackId: 'missing-track', type: 'audio', assetId: missingAsset.id, startSample: 0, offsetFrames: 0, lengthFrames: missingAsset.frames } },
  ] } }).status, 'applied');
  await saveProject(cPath, engineC.project); await saveExplicitCheckpoint(cPath, engineC.project);
  const dPath = path.join(directory, 'Gone.json'), ePath = path.join(directory, 'Invalid.json');
  await saveProject(dPath, createProject({ name: 'Gone Session' })); await saveProject(ePath, createProject({ name: 'Invalid Session' }));
  for (const filename of [bPath, cPath, dPath, ePath]) await record(filename);
  await fs.unlink(dPath); await fs.writeFile(ePath, '{invalid project');
  await page.goto(session.url); await page.waitForFunction(() => !document.querySelector('#projects-button').disabled); await openLibrary();
  assert.equal(await page.locator('[data-recent-id]').count(), 5); assert.match(await page.locator('#projects-recent-list').textContent(), /파일 없음/); assert.match(await page.locator('#projects-recent-list').textContent(), /프로젝트 형식 오류/);
  await fs.mkdir(path.join(root, 'docs/screenshots'), { recursive: true }); await page.screenshot({ path: path.join(root, 'docs/screenshots/v78-recent-projects.png'), fullPage: true });
  check('gui.projects.recent-list-multiple-files-and-live-diagnostics');

  let recent = await get('/api/document/recent'); const goneId = recent.entries.find(entry => entry.projectPath === dPath).id, invalidId = recent.entries.find(entry => entry.projectPath === ePath).id;
  const beforeErrors = await get();
  for (const id of [goneId, invalidId]) { const response = await action(() => page.locator(`[data-recent-preview="${id}"]`).click(), '/api/workspace/open/plan'); await ready(); assert.ok(response.status >= 400); assert.equal((await get()).session.document.id, beforeErrors.session.document.id); assert.equal(await page.locator('#projects-plan').isVisible(), false); assert.ok((await page.locator('#projects-message').textContent()).length > 0); }
  check('gui.projects.missing-and-invalid-recent-files-preserve-current-document');
  await edit('project.rename', { name: 'Working Current' }); const aBeforeCancel = await fs.readFile(aPath), aSavedBeforeCancel = await fs.readFile(`${aPath}.saved.json`);
  let plan = await preview(bPath); assert.equal(plan.requiresCurrentPolicy, true); assert.equal(await page.locator('#projects-open').isEnabled(), false); assert.equal(plan.target.media.length, 2);
  assert.equal(await page.locator('.projects-media-list li').count(), 2); await selectPolicy('preserve'); assert.equal(await page.locator('#projects-open').isEnabled(), true);
  await page.locator('#projects-cancel-plan').click(); assert.equal(await page.locator('#projects-plan').isVisible(), false); assert.deepEqual(await fs.readFile(aPath), aBeforeCancel); assert.deepEqual(await fs.readFile(`${aPath}.saved.json`), aSavedBeforeCancel);
  check('gui.projects.preview-explicit-dirty-policy-and-cancel-no-open');

  let release, seenResolve; const gate = new Promise(resolve => { release = resolve; }), seen = new Promise(resolve => { seenResolve = resolve; });
  await page.route('**/api/workspace/open/plan', async route => { seenResolve(); await gate; await route.continue(); });
  const pendingPreview = page.waitForResponse(response => new URL(response.url()).pathname === '/api/workspace/open/plan');
  await page.locator('#projects-preview').click(); await seen;
  try { for (const selector of ['#projects-path', '#projects-preview', '#projects-refresh', '#projects-remove-all', '#projects-current-policy', '[data-recent-preview]', '[data-recent-remove]']) assert.equal(await page.locator(selector).first().isEnabled(), false, selector); assert.equal(await page.locator('#projects-close').isEnabled(), true); } finally { release(); }
  assert.equal((await pendingPreview).status(), 200); await page.unroute('**/api/workspace/open/plan'); await ready();
  check('gui.projects.pending-preview-locks-competing-inputs');
  await selectPolicy('preserve'); await page.screenshot({ path: path.join(root, 'docs/screenshots/v78-project-open.png'), fullPage: true });

  let releaseOpen, openSeenResolve; const openGate = new Promise(resolve => { releaseOpen = resolve; }), openSeen = new Promise(resolve => { openSeenResolve = resolve; });
  await page.route('**/api/workspace/open', async route => { openSeenResolve(); await openGate; await route.continue(); });
  const pendingOpen = page.waitForResponse(response => new URL(response.url()).pathname === '/api/workspace/open'); await page.locator('#projects-open').click(); await openSeen;
  await edit('project.rename', { name: 'Concurrent CLI Current' }); releaseOpen(); const staleResponse = await pendingOpen; assert.equal(staleResponse.status(), 409); await page.unroute('**/api/workspace/open'); await ready();
  assert.equal((await get()).project.name, 'Concurrent CLI Current'); assert.equal(await page.locator('#projects-open').isEnabled(), false);
  check('gui.projects.frozen-open-guard-rejects-concurrent-cli-edit');
  await preview(bPath); await cli('save'); await page.waitForFunction(() => document.querySelector('#projects-message').textContent.includes('저장 기준이 바뀌었습니다'));
  assert.equal(await page.locator('#projects-open').isEnabled(), false);
  check('gui.projects.concurrent-explicit-save-invalidates-preview');

  const originalB = await fs.readFile(bPath); await preview(bPath); await fs.writeFile(bPath, JSON.stringify({ ...JSON.parse(originalB), name: 'Externally replaced target' }));
  let response = await apply(); assert.equal(response.status, 409, JSON.stringify(response.body)); assert.equal((await get()).session.document.projectPath, aPath); await fs.writeFile(bPath, originalB);
  check('gui.projects.changed-target-after-preview-is-rejected');
  await edit('project.rename', { name: 'Current Preserved Work' }); await edit('project.settings', { masterGainDb: -8 });
  const aBeforeOpen = await fs.readFile(aPath), aBaselineBeforeOpen = await fs.readFile(`${aPath}.saved.json`), beforeLower = await get();
  plan = await preview(bPath); assert.equal(plan.target.projectId, beforeLower.project.id); assert.ok(plan.target.projectRevision < beforeLower.project.revision);
  response = await apply('preserve'); const openedB = ok(response); await waitState((await get()).project);
  assert.equal(openedB.status, 'opened'); assert.equal((await get()).workspace.documents.length, 2); assert.equal((await get()).project.name, 'Archive Session'); assert.equal((await get()).project.revision, engineB.project.revision);
  assert.deepEqual(await fs.readFile(aPath), aBeforeOpen); assert.deepEqual(await fs.readFile(`${aPath}.saved.json`), aBaselineBeforeOpen); assert.match(await page.locator('#save-state').textContent(), /Archive\.json/);
  check('gui.projects.preserve-opens-lower-revision-same-project-id');
  assert.equal((await get()).history.canUndo, true); assert.equal(await page.locator('#undo').isEnabled(), true);
  await edit('project.rename', { name: 'Archive Edited Here' }); assert.equal(JSON.parse(await fs.readFile(bPath)).name, 'Archive Edited Here'); assert.deepEqual(await fs.readFile(aPath), aBeforeOpen);
  ok(await action(() => page.locator('#undo').click(), '/api/command')); await waitState({ name: 'Archive Session', revision: (await get()).project.revision });
  check('gui.projects.open-restores-history-and-subsequent-edit-writes-target');

  const assetResponse = await fetch(session.url + `/api/assets/${encodeURIComponent(originalAssetId)}/file`); assert.equal(assetResponse.status, 200); assert.deepEqual(Buffer.from(await assetResponse.arrayBuffer()), bBytes);
  await page.locator('#render-button').click(); await page.waitForSelector('.render-result a', { timeout: 30000 }); const renderHref = await page.locator('.render-result a').getAttribute('href');
  const rendered = await fetch(new URL(renderHref, session.url)); assert.equal(rendered.status, 200); assert.ok((await rendered.arrayBuffer()).byteLength > 44);
  check('gui.projects.media-download-and-render-use-new-project-directory');

  await openLibrary(); recent = await get('/api/document/recent'); const aId = recent.entries.find(entry => entry.projectPath === aPath).id;
  ok(await action(() => page.locator(`[data-recent-preview="${aId}"]`).click(), '/api/workspace/open/plan')); await ready(); ok(await apply()); await waitState((await get()).project); assert.equal((await get()).session.document.projectPath, aPath);
  check('gui.projects.recent-entry-opens-actual-file');
  await edit('project.rename', { name: 'Saved Before Switching' }); await openLibrary(); await preview(bPath); const saveOpened = ok(await apply('save'));
  assert.equal(saveOpened.currentSaved, true); assert.equal(JSON.parse(await fs.readFile(`${aPath}.saved.json`)).project.name, 'Saved Before Switching');
  check('gui.projects.save-policy-updates-current-baseline-before-open');

  await page.locator('#document-button').click(); await page.waitForFunction(() => document.querySelector('#document-dialog').open && !document.querySelector('#document-revert-plan').disabled);
  ok(await action(() => page.locator('#document-revert-plan').click(), '/api/document/revert/plan')); await page.waitForSelector('#document-revert-preview:not([hidden])');
  await activateFile(aPath); await waitState((await get()).project);
  await page.waitForFunction(() => !document.querySelector('#document-dialog').open || document.querySelector('#document-revert-preview').hidden);
  if (await page.locator('#document-dialog').evaluate(element => element.open)) await page.locator('#document-close').click();
  assert.equal((await get()).session.document.projectPath, aPath);
  check('gui.projects.cli-open-sse-clears-old-document-plan');

  let releaseState, stateSeenResolve, stateHeld = false, oldSnapshot;
  const stateGate = new Promise(resolve => { releaseState = resolve; }), stateSeen = new Promise(resolve => { stateSeenResolve = resolve; });
  await page.route('**/api/state', async route => {
    if (stateHeld) return route.continue();
    stateHeld = true;
    const response = await route.fetch(), bytes = await response.body(); oldSnapshot = JSON.parse(bytes); stateSeenResolve();
    await stateGate; await route.fulfill({ response, body: bytes });
  });
  try {
    await page.locator('#document-button').focus(); await page.keyboard.press('Control+s'); await stateSeen;
    assert.equal(oldSnapshot.session.document.projectPath, aPath);
    await activateFile(bPath);
    const switched = await get(); await waitState(switched.project); assert.ok(oldSnapshot.sequence < switched.sequence);
    assert.equal(switched.session.document.projectPath, bPath); releaseState();
    await page.waitForFunction(() => !document.querySelector('#document-save').disabled);
    await waitState(switched.project); assert.match(await page.locator('#save-state').textContent(), /Archive\.json/);
    assert.equal((await get()).session.document.id, switched.session.document.id);
  } finally { releaseState(); await page.unroute('**/api/state'); }
  check('gui.projects.delayed-old-get-cannot-replace-new-document-snapshot');
  await activateFile(aPath); await waitState((await get()).project);

  const port = session.server.address().port; await session.close(); session = await startServer({ projectPath: aPath, recentPath, port, demo: false, quiet: true });
  await page.reload(); await page.waitForFunction(() => !document.querySelector('#projects-button').disabled); await openLibrary();
  recent = await get('/api/document/recent'); assert.ok(recent.entries.some(entry => entry.projectPath === bPath)); assert.ok(recent.entries.some(entry => entry.projectPath === cPath)); assert.ok(recent.entries.some(entry => entry.projectPath === dPath && entry.status === 'missing'));
  check('gui.projects.recent-list-persists-multiple-paths-across-restart');

  const removeId = recent.entries.find(entry => entry.projectPath === ePath).id; let releaseRemove, removeSeenResolve;
  const removeGate = new Promise(resolve => { releaseRemove = resolve; }), removeSeen = new Promise(resolve => { removeSeenResolve = resolve; });
  await page.route('**/api/workspace/recent/remove', async route => { removeSeenResolve(); await removeGate; await route.continue(); });
  const pendingRemove = page.waitForResponse(result => new URL(result.url()).pathname === '/api/workspace/recent/remove'); await page.locator(`[data-recent-remove="${removeId}"]`).click(); await removeSeen;
  await record(bPath); releaseRemove(); assert.equal((await pendingRemove).status(), 409); await page.unroute('**/api/workspace/recent/remove'); await ready();
  assert.ok((await get('/api/document/recent')).entries.some(entry => entry.id === removeId)); await refresh();
  check('gui.projects.registry-conflict-keeps-entry-and-offers-refresh');
  const fileBeforeRemove = await fs.readFile(bPath); recent = await get('/api/document/recent'); const bId = recent.entries.find(entry => entry.projectPath === bPath).id;
  ok(await action(() => page.locator(`[data-recent-remove="${bId}"]`).click(), '/api/workspace/recent/remove')); await ready(); assert.deepEqual(await fs.readFile(bPath), fileBeforeRemove);
  assert.equal((await get('/api/document/recent')).entries.some(entry => entry.id === bId), false);
  check('gui.projects.remove-recent-entry-never-deletes-project');

  await preview(cPath); assert.match(await page.locator('#projects-plan-details').textContent(), /사용 불가 1개/); ok(await apply());
  await page.waitForFunction(() => document.querySelector('#resolve-dialog')?.open); assert.equal((await get()).project.name, 'Missing Media Session'); await page.locator('#resolve-close').click();
  await edit('project.rename', { name: 'Missing media still editable' });
  check('gui.projects.missing-media-open-triggers-resolver-and-remains-editable');

  await openLibrary(); const beforeClear = await fs.readFile(aPath), beforeClearB = await fs.readFile(bPath), countBeforeClear = (await get('/api/document/recent')).entries.length;
  await page.locator('#projects-remove-all').click(); assert.equal(await page.locator('#projects-confirm-remove-all').isEnabled(), false); await page.locator('#projects-clear-cancel').click(); assert.equal((await get('/api/document/recent')).entries.length, countBeforeClear);
  await page.locator('#projects-remove-all').click(); await page.locator('#projects-clear-check').check(); ok(await action(() => page.locator('#projects-confirm-remove-all').click(), '/api/workspace/recent/remove')); await ready();
  assert.equal((await get('/api/document/recent')).entries.length, 0); assert.deepEqual(await fs.readFile(aPath), beforeClear); assert.deepEqual(await fs.readFile(bPath), beforeClearB);
  check('gui.projects.clear-recent-requires-inline-confirmation-and-keeps-files');

  const goodRegistry = await fs.readFile(recentPath); await fs.writeFile(recentPath, '{broken recent registry'); await refresh(); assert.match(await page.locator('#projects-recent-summary').textContent(), /목록을 읽을 수 없습니다/); assert.equal(await page.locator('#projects-path').isEnabled(), true);
  await preview(bPath); const openedDespiteRegistry = ok(await apply('preserve')); assert.equal(openedDespiteRegistry.status, 'opened'); assert.equal((await get()).session.document.projectPath, bPath); assert.ok(openedDespiteRegistry.warnings.length > 0); assert.equal(await fs.readFile(recentPath, 'utf8'), '{broken recent registry');
  await fs.writeFile(recentPath, goodRegistry);
  check('gui.projects.unavailable-recent-registry-does-not-roll-back-open');

  assert.deepEqual(pageErrors, []);
  const paths = ['public/projects.mjs', 'public/session.mjs','public/app.mjs', 'public/document.mjs', 'public/resolution.mjs', 'public/index.html', 'public/styles.css', 'src/workspace.mjs', 'src/recent-projects.mjs', 'src/project-open.mjs', 'src/document-session.mjs', 'src/project-save.mjs', 'src/revert-media.mjs', 'src/project-files.mjs', 'src/project-drafts.mjs','src/project-locations.mjs','src/folder-browser.mjs', 'src/storage.mjs','src/session-store.mjs', 'src/auto-backup.mjs', 'src/server.mjs', 'src/cli.mjs', 'src/core/engine.mjs', 'scripts/gui-projects-smoke.mjs' ,'public/editing.mjs','public/midi-events.mjs','src/core/editing.mjs','src/core/midi-events.mjs','src/core/schema.mjs','src/demo.mjs','src/media-resolution.mjs','src/media-search.mjs','src/media/common.mjs','src/media/midi.mjs','src/media/midi-stream.mjs','src/media/midi-playback.mjs','src/media/render.mjs','src/media/time.mjs','src/media/wav.mjs','src/render-worker.mjs','src/core/controllers.mjs','src/media/midi-curves.mjs','src/media/midi-chase.mjs','src/media/controller-bend.mjs','src/core/modifiers.mjs','src/media/midi-modifiers.mjs','public/midi-modifiers.mjs','src/core/merge.mjs','public/midi-merge.mjs','src/chase-settings.mjs','public/chase-settings.mjs','src/controller-settings.mjs','public/controller-settings.mjs','src/media/controller-readout.mjs','src/media/midi-controllers-query.mjs','public/controller-lanes.mjs'];
  for(const file of ['public/native-midi.mjs', 'src/native-midi-settings.mjs', 'src/native-transport.mjs', 'native/macos/client.mjs', 'native/macos/project-plan.mjs', 'native/macos/midi-bridge.swift', 'scripts/build-native-midi.mjs','src/reset-settings.mjs','public/reset-settings.mjs','native/macos/reset-policy.mjs','src/media/midi-display-time.mjs','src/media/midi-length-adjustment.mjs','src/timing-settings.mjs','public/timing-settings.mjs','src/media/musical-time.mjs','public/musical-time-display.mjs','src/media/display-time-edit.mjs','public/inspector-time.mjs','src/media/elapsed-time.mjs','src/media/timecode.mjs','src/media/timeline-projection.mjs','src/media/time-display.mjs','public/time-display-settings.mjs','src/media/editor-geometry.mjs','src/media/ruler-intervals.mjs'])if(!paths.includes(file))paths.push(file);
 for(const file of ['src/media/note-paint.mjs','src/media/note-shapes.mjs','src/media/exact-tempo.mjs','src/media/time-edit-resolver.mjs','src/media/formatted-time-command.mjs','src/core/controller-paint.mjs','src/media/controller-shape-gesture.mjs','src/media/controller-shapes.mjs','src/media/controller-paint.mjs','src/media/controller-time-gesture.mjs','src/media/pointer-time-grid.mjs','src/media/snap-grid.mjs','public/snap-grid-settings.mjs'])if(!paths.includes(file))paths.push(file);
 const sourceHashes = Object.fromEntries(await Promise.all(paths.map(async filename => [filename, hash(await fs.readFile(path.join(root, filename)))])));
  const receipt = { status: 'passed', executedAt: new Date().toISOString(), command: 'NEWDAW_PLAYWRIGHT_MODULE=<installed playwright> node scripts/gui-projects-smoke.mjs', browser: 'headless Chrome', isolatedFixture: true, tests, pageErrors, screenshots: ['docs/screenshots/v78-project-open.png', 'docs/screenshots/v78-recent-projects.png'], sourceHashes };
  await fs.mkdir(path.join(root, '.test-output'), { recursive: true }); await fs.writeFile(path.join(root, '.test-output/gui-projects.json'), `${JSON.stringify(receipt, null, 2)}\n`); console.log(JSON.stringify(receipt, null, 2));
} catch (error) {
  await fs.mkdir(path.join(root, '.test-output'), { recursive: true }); await page.screenshot({ path: path.join(root, '.test-output/gui-projects-failure.png'), fullPage: true }).catch(() => {}); console.error(`FAILED after ${tests.length} checks:`, error); throw error;
} finally { await browser.close(); await session.close(); await fs.rm(directory, { recursive: true, force: true }); }
