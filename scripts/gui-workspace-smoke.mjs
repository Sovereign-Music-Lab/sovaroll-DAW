// Actual Chrome and CLI checks on temporary projects only. No user project is opened.
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
import { encodeWav } from '../src/media/wav.mjs';
const { chromium } = await import(process.env.NEWDAW_PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), exec = promisify(execFile), hash = bytes => createHash('sha256').update(bytes).digest('hex');
const directory = await fs.mkdtemp('/private/tmp/newdaw-workspace-gui-'), aPath = path.join(directory, 'A.newdaw.json'), recentPath = path.join(directory, '.recent.json');
const session = await startServer({ projectPath: aPath, recentPath, port: 0, demo: true, quiet: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome' }), page = await browser.newPage({ viewport: { width: 1512, height: 1180 } }), tests = [], pageErrors = [];
page.on('pageerror', error => pageErrors.push(error.message));
const get = async (route = '/api/state') => { const response = await fetch(session.url + route); assert.equal(response.status, 200); return response.json(); };
const check = id => { tests.push(id); console.log(`PASS ${id}`); };
const action = async (work, route) => { const pending = page.waitForResponse(response => new URL(response.url()).pathname === route && response.request().method() === 'POST').then(async response => ({ status: response.status(), body: await response.json() })); await work(); return pending; };
const ok = response => { assert.equal(response.status, 200, JSON.stringify(response.body)); return response.body; };
const cli = async (...args) => JSON.parse((await exec(process.execPath, ['src/cli.mjs', ...args, '--url', session.url], { cwd: root, timeout: 25000 })).stdout);
const waitState = async () => { const state = await get(); if (state.project) await page.waitForFunction(value => document.querySelector('#project-name')?.value === value.name && Number(document.querySelector('#revision-label')?.textContent.match(/\d+/)?.[0]) === value.revision, state.project); else await page.waitForFunction(() => !document.querySelector('#workspace-empty').hidden); return state; };
const edit = async (command, args = {}) => { const result = await cli('command', command, JSON.stringify(args)); await waitState(); return result; };
const ready = async () => page.waitForFunction(() => document.querySelector('#projects-preview') && !document.querySelector('#projects-preview').disabled);
const library = async () => { if (!await page.locator('#projects-dialog').evaluate(element => element.open)) await page.locator('#projects-button').click(); await ready(); };
const closeLibrary = async () => { await page.locator('#projects-close').click(); await page.waitForFunction(() => !document.querySelector('#projects-dialog').open); };
let plan;
const preview = async (filename, mode = 'active') => { await library(); await page.locator('#projects-open-mode').selectOption(mode); await page.locator('#projects-path').fill(filename); plan = ok(await action(() => page.locator('#projects-preview').click(), '/api/workspace/open/plan')); await ready(); return plan; };
const documentPlan = async (id, kind) => { await library(); plan = ok(await action(() => page.locator(`[data-document-${kind}="${id}"]`).click(), `/api/workspace/${kind}/plan`)); await ready(); return plan; };
const apply = async (policy = 'preserve') => { if (await page.locator('#projects-current-policy').isVisible()) await page.locator('#projects-current-policy').selectOption(policy); if (plan.kind === 'close') await page.locator('#projects-close-confirm').check(); const result = await action(() => page.locator('#projects-open').click(), `/api/workspace/${plan.kind}`); if (result.status === 200 && plan.kind !== 'close' && plan.mode !== 'inactive') await page.waitForFunction(() => !document.querySelector('#projects-dialog').open); else await ready(); await waitState(); return result; };
const entry = async filename => (await get()).workspace.documents.find(item => item.projectPath === filename);
try {
  const initial = await get(), bDirectory = path.join(directory, 'B-media'), bPath = path.join(bDirectory, 'B.json'), cPath = path.join(directory, 'C.json'), missingPath = path.join(directory, 'Missing.json');
  await fs.mkdir(path.join(bDirectory, 'assets'), { recursive: true });
  const bBytes = Buffer.from(encodeWav({ sampleRate: 8000, channels: [Float32Array.from({ length: 8000 }, (_, index) => .15 * Math.sin(index * .1))] }));
  const bAsset = { id: 'b-source', name: 'B sound.wav', sha256: hash(bBytes), path: `assets/${hash(bBytes)}.wav`, sampleRate: 8000, channels: 1, frames: 8000 };
  const bBase = createProject({ name: 'B before history' }), bOrigin = new Engine(bBase), bEngine = new Engine(bBase);
  assert.equal(bEngine.execute({ command: 'batch', arguments: { commands: [
    { command: 'project.rename', arguments: { name: 'B Project' } }, { command: 'asset.add', arguments: { asset: bAsset } },
    { command: 'track.add', arguments: { id: 'b-track', type: 'audio', name: 'B audio' } }, { command: 'clip.add', arguments: { id: 'b-clip', type: 'audio', trackId: 'b-track', assetId: bAsset.id, startSample: 0, offsetFrames: 0, lengthFrames: 8000 } },
  ] } }).status, 'applied');
  await fs.writeFile(path.join(bDirectory, bAsset.path), bBytes); await saveProject(bPath, bBase); await commitSessionState(bPath, { currentCheckpoint: bOrigin.checkpoint(), nextCheckpoint: bEngine.checkpoint() }); await saveExplicitCheckpoint(bPath, bEngine.project);
  await saveProject(cPath, createProject({ name: 'C Project' }));
  const missing = structuredClone(bEngine.project); missing.id = 'missing-project'; missing.name = 'Deferred Missing'; missing.assets[0].name = 'Absent source.wav'; await saveProject(missingPath, missing);
  await page.goto(session.url); await page.waitForFunction(() => !document.querySelector('#projects-button').disabled); await library();
  assert.equal(await page.locator('[data-open-document]').count(), 1); const aId = (await entry(aPath)).id;
  assert.equal(await page.locator(`[data-document-activate="${aId}"]`).isEnabled(), false); assert.match(await page.locator('#projects-open-summary').textContent(), /활성:/);
  check('gui.workspace.initial-open-document-and-active-marker');

  await edit('project.rename', { name: 'A Unsaved Work' }); const aWorking = await fs.readFile(aPath), aBaseline = await fs.readFile(`${aPath}.saved.json`), aBefore = await get();
  await closeLibrary(); await page.locator('#play').click(); await page.waitForFunction(() => document.querySelector('#play').classList.contains('playing'), { timeout: 30000 });
  await preview(bPath, 'inactive'); assert.equal(plan.requiresCurrentPolicy, false); assert.equal(await page.locator('#projects-current-policy').isVisible(), false); ok(await apply());
  assert.equal((await get()).workspace.activeId, aBefore.workspace.activeId); assert.equal((await get()).project.name, 'A Unsaved Work'); const bId = (await entry(bPath)).id;
  assert.equal((await entry(bPath)).resources, 'deferred'); assert.equal(await page.locator('[data-open-document]').count(), 2); assert.deepEqual(await fs.readFile(aPath), aWorking); assert.deepEqual(await fs.readFile(`${aPath}.saved.json`), aBaseline);
  check('gui.workspace.inactive-open-keeps-current-work-and-defers-media');
  assert.equal(await page.locator('#play').evaluate(element => element.classList.contains('playing')), true);
  const position = await page.locator('#position-time').textContent(); await page.waitForFunction(value => document.querySelector('#position-time').textContent !== value, position);
  await closeLibrary(); await page.locator('#stop').click(); await library();
  check('gui.workspace.inactive-open-keeps-existing-audio-playback-running');
  await fs.mkdir(path.join(root, 'docs/screenshots'), { recursive: true }); await page.screenshot({ path: path.join(root, 'docs/screenshots/v78-open-documents.png'), fullPage: true });

  await documentPlan(bId, 'activate'); assert.equal(plan.requiresCurrentPolicy, true); assert.equal(await page.locator('#projects-open').isEnabled(), false);
  await page.locator('#projects-current-policy').selectOption('preserve'); await page.locator('#projects-cancel-plan').click(); assert.equal((await get()).workspace.activeId, aId); assert.deepEqual(await fs.readFile(aPath), aWorking);
  check('gui.workspace.activation-dirty-policy-and-cancel-preserve-current');

  let release, seenResolve; const gate = new Promise(resolve => { release = resolve; }), seen = new Promise(resolve => { seenResolve = resolve; });
  await page.route('**/api/workspace/activate/plan', async route => { seenResolve(); await gate; await route.continue(); });
  const pending = page.waitForResponse(response => new URL(response.url()).pathname === '/api/workspace/activate/plan').then(response => response.json());
  await page.locator(`[data-document-activate="${bId}"]`).click(); await seen;
  try { for (const selector of ['#projects-path', '#projects-preview', '#projects-open-mode', '#projects-refresh', '[data-document-close]', '[data-document-activate]', '[data-recent-preview]']) assert.equal(await page.locator(selector).first().isEnabled(), false, selector); assert.equal(await page.locator('#projects-close').isEnabled(), true); } finally { release(); }
  plan = await pending; await page.unroute('**/api/workspace/activate/plan'); await ready(); ok(await apply());
  assert.equal((await get()).project.name, 'B Project'); assert.equal((await entry(bPath)).resources, 'initialized'); assert.equal((await get()).workspace.documents.length, 2); assert.deepEqual(await fs.readFile(aPath), aWorking); assert.deepEqual(await fs.readFile(`${aPath}.saved.json`), aBaseline);
  check('gui.workspace.activation-loading-guards-and-preserve-switch');

  assert.equal((await get()).history.canUndo, true); await edit('project.rename', { name: 'B Edited' }); assert.equal(JSON.parse(await fs.readFile(bPath)).name, 'B Edited'); assert.deepEqual(await fs.readFile(aPath), aWorking);
  ok(await action(() => page.locator('#undo').click(), '/api/command')); await waitState(); assert.equal((await get()).project.name, 'B Project');
  check('gui.workspace.document-history-and-edit-file-remain-independent');
  const audioResponse = await fetch(session.url + `/api/assets/${bAsset.id}/file`); assert.equal(audioResponse.status, 200); assert.deepEqual(Buffer.from(await audioResponse.arrayBuffer()), bBytes);
  await page.locator('#render-button').click(); await page.waitForSelector('.render-result a', { timeout: 30000 }); const renderResponse = await fetch(new URL(await page.locator('.render-result a').getAttribute('href'), session.url)); assert.equal(renderResponse.status, 200); assert.ok((await renderResponse.arrayBuffer()).byteLength > 44);
  check('gui.workspace.active-document-media-and-render-use-target-folder');

  await edit('project.rename', { name: 'B Explicit Before Switch' }); await documentPlan(aId, 'activate'); ok(await apply('save'));
  assert.equal(JSON.parse(await fs.readFile(`${bPath}.saved.json`)).project.name, 'B Explicit Before Switch'); assert.equal((await get()).project.name, 'A Unsaved Work');
  ok(await action(() => page.locator('#undo').click(), '/api/command')); await waitState(); assert.equal((await get()).project.name, initial.project.name); assert.equal(JSON.parse(await fs.readFile(bPath)).name, 'B Explicit Before Switch');
  check('gui.workspace.save-before-switch-and-returned-document-undo');

  await preview(bPath, 'inactive'); ok(await apply()); assert.equal((await get()).workspace.documents.length, 2); assert.equal((await entry(bPath)).id, bId); assert.equal((await get()).workspace.activeId, aId);
  await preview(aPath, 'inactive'); assert.equal(plan.sameDocument, true); assert.equal(ok(await apply()).status, 'unchanged'); assert.equal((await get()).workspace.activeId, aId); assert.match(await page.locator('#projects-message').textContent(), /활성 상태는 바뀌지/);
  check('gui.workspace.already-open-path-does-not-duplicate-document');
  await preview(cPath, 'inactive'); ok(await apply()); const cId = (await entry(cPath)).id; await documentPlan(cId, 'close'); assert.equal(await page.locator('#projects-open').isEnabled(), false); await page.locator('#projects-cancel-plan').click(); assert.ok(await entry(cPath));
  await documentPlan(cId, 'close'); ok(await apply()); assert.equal(await entry(cPath), undefined); assert.equal((await get()).workspace.activeId, aId); assert.equal(JSON.parse(await fs.readFile(cPath)).name, 'C Project');
  check('gui.workspace.inactive-close-confirmation-cancel-and-files-preserved');

  await documentPlan(bId, 'activate'); ok(await apply()); await edit('project.rename', { name: 'B Save On Close' }); await documentPlan(aId, 'activate'); ok(await apply());
  const activeBaselineBeforeClosingB = await fs.readFile(`${aPath}.saved.json`);
  await documentPlan(bId, 'close'); assert.equal(plan.policyTarget, 'target'); assert.equal(plan.requiresCurrentPolicy, true); assert.match(await page.locator('#projects-policy-title').textContent(), /닫을/); ok(await apply('save'));
  assert.equal((await get()).workspace.activeId, aId); assert.equal(await entry(bPath), undefined); assert.equal(JSON.parse(await fs.readFile(`${bPath}.saved.json`)).project.name, 'B Save On Close'); assert.deepEqual(await fs.readFile(`${aPath}.saved.json`), activeBaselineBeforeClosingB);
  check('gui.workspace.inactive-close-saves-target-without-saving-active');

  await edit('project.rename', { name: 'A Preserve On Close' }); const beforeCloseA = await fs.readFile(aPath), beforeCloseSavedA = await fs.readFile(`${aPath}.saved.json`);
  await documentPlan(aId, 'close'); ok(await apply('preserve')); const empty = await get(); assert.equal(empty.project, null); assert.equal(empty.workspace.activeId, null); assert.equal(empty.workspace.documents.length, 0);
  assert.equal(await page.locator('#workspace-empty').evaluate(element => element.hidden), false);
  assert.match(await page.locator('#projects-open-summary').textContent(), /활성 프로젝트 없음/); assert.equal(await page.locator('#projects-preview').isEnabled(), true);
  await closeLibrary(); assert.equal(await page.locator('#workspace-empty').isVisible(), true); for (const selector of ['#document-button', '#undo', '#render-button']) assert.equal(await page.locator(selector).isEnabled(), false, selector);
  assert.equal(await page.locator('#projects-button').isEnabled(), true); assert.deepEqual(await fs.readFile(aPath), beforeCloseA); assert.deepEqual(await fs.readFile(`${aPath}.saved.json`), beforeCloseSavedA);
  check('gui.workspace.active-close-shows-usable-no-active-state');
  await page.screenshot({ path: path.join(root, 'docs/screenshots/v78-no-active-project.png'), fullPage: true });

  await page.locator('#workspace-open-button').click(); await ready(); const recent = await get('/api/document/recent'), bRecent = recent.entries.find(item => item.projectPath === bPath); const bBeforeRemove = await fs.readFile(bPath);
  ok(await action(() => page.locator(`[data-recent-remove="${bRecent.id}"]`).click(), '/api/workspace/recent/remove')); await ready(); assert.equal((await get('/api/document/recent')).entries.some(item => item.id === bRecent.id), false); assert.deepEqual(await fs.readFile(bPath), bBeforeRemove);
  check('gui.workspace.recent-removal-works-without-active-project');

  await preview(cPath, 'inactive'); ok(await apply()); assert.equal((await get()).project, null); const reopenedC = await entry(cPath); assert.equal(reopenedC.resources, 'deferred');
  await documentPlan(reopenedC.id, 'activate'); ok(await apply()); assert.equal((await get()).project.name, 'C Project');
  check('gui.workspace.inactive-open-from-empty-then-explicit-activation');

  await preview(missingPath, 'inactive'); ok(await apply()); assert.equal(await page.locator('#resolve-dialog').evaluate(element => element.open), false); const missingId = (await entry(missingPath)).id;
  assert.equal((await entry(missingPath)).resources, 'deferred'); await documentPlan(missingId, 'activate'); ok(await apply()); await page.waitForFunction(() => document.querySelector('#resolve-dialog').open); await page.locator('#resolve-close').click();
  assert.equal((await get()).project.name, 'Deferred Missing'); await documentPlan(reopenedC.id, 'activate'); ok(await apply());
  check('gui.workspace.missing-media-resolver-runs-only-on-activation');

  await library(); await documentPlan(reopenedC.id, 'close'); let releaseClose, closeSeenResolve; const closeGate = new Promise(resolve => { releaseClose = resolve; }), closeSeen = new Promise(resolve => { closeSeenResolve = resolve; });
  await page.route('**/api/workspace/close', async route => { closeSeenResolve(); await closeGate; await route.continue(); });
  await page.locator('#projects-close-confirm').check(); const staleClose = action(() => page.locator('#projects-open').click(), '/api/workspace/close'); await closeSeen;
  await edit('project.rename', { name: 'C Concurrent Edit' }); releaseClose(); assert.equal((await staleClose).status, 409); await page.unroute('**/api/workspace/close'); await ready();
  assert.equal((await get()).project.name, 'C Concurrent Edit'); assert.ok(await entry(cPath)); assert.equal(await page.locator('#projects-open').isEnabled(), false);
  check('gui.workspace.close-frozen-plan-rejects-concurrent-cli-edit');

  await preview(aPath, 'inactive'); ok(await apply()); const reopenedA = await entry(aPath); await documentPlan(reopenedA.id, 'activate'); const prior = await get();
  const externalClosePlan = await cli('project-close-plan', reopenedA.id); await cli('project-close', externalClosePlan.id, '--current', 'preserve');
  await page.waitForFunction(() => document.querySelector('#projects-open').disabled); assert.equal((await get()).workspace.activeId, prior.workspace.activeId); assert.equal(await entry(aPath), undefined);
  check('gui.workspace.external-close-invalidates-pending-activation');

  await page.locator('#projects-path').fill(path.join(directory, 'absent-project.json')); const failedOpen = await action(() => page.locator('#projects-preview').click(), '/api/workspace/open/plan'); assert.ok(failedOpen.status >= 400); await ready(); assert.equal((await get()).workspace.activeId, prior.workspace.activeId); assert.equal((await get()).project.name, 'C Concurrent Edit');
  check('gui.workspace.failed-open-preserves-active-and-inactive-documents');

  await documentPlan(reopenedC.id, 'close'); ok(await apply('preserve')); assert.equal((await get()).project, null); assert.equal((await get()).workspace.documents.length, 1);
  assert.equal((await entry(missingPath)).id, missingId); await documentPlan(missingId, 'activate'); ok(await apply());
  await page.waitForFunction(() => document.querySelector('#resolve-dialog').open); await page.locator('#resolve-close').click();
  assert.equal((await get()).workspace.activeId, missingId); assert.equal((await get()).project.name, 'Deferred Missing');
  await documentPlan(missingId, 'close'); ok(await apply()); assert.equal((await get()).project, null);
  await preview(bPath, 'active'); ok(await apply()); assert.equal((await get()).project.name, 'B Save On Close'); assert.equal((await get()).workspace.documents.length, 1); assert.equal((await get()).history.canUndo, true);
  check('gui.workspace.active-close-allows-existing-activation-and-persisted-open');

  async function delayedStateTransition(trigger, switchDocument) {
    let release, seenResolve, held = false, oldSnapshot;
    const gate = new Promise(resolve => { release = resolve; }), seen = new Promise(resolve => { seenResolve = resolve; });
    await page.route('**/api/state', async route => {
      if (held) return route.continue(); held = true;
      const response = await route.fetch(), body = await response.body(); oldSnapshot = JSON.parse(body); seenResolve(); await gate; await route.fulfill({ response, body });
    });
    try {
      await trigger(); await seen; await switchDocument(); const next = await waitState(); assert.ok(oldSnapshot.sequence < next.sequence); release();
      await page.waitForFunction(() => !document.querySelector('#projects-button').disabled); await waitState();
      assert.equal((await get()).workspace.activeId, next.workspace.activeId);
      if (next.project) assert.equal(await page.locator('#workspace-empty').evaluate(element => element.hidden), true);
      else assert.equal(await page.locator('#workspace-empty').evaluate(element => element.hidden), false);
    } finally { release(); await page.unroute('**/api/state'); }
  }
  await delayedStateTransition(async () => { await page.locator('#document-button').focus(); await page.keyboard.press('Control+s'); }, async () => {
    const current = (await get()).workspace.activeId, closePlan = await cli('project-close-plan', current); await cli('project-close', closePlan.id, '--current', 'preserve');
  });
  assert.equal((await get()).project, null); await library();
  await page.locator('#projects-path').fill(bPath); await page.locator('#projects-open-mode').selectOption('active');
  await delayedStateTransition(() => page.locator('#projects-preview').click(), async () => {
    const openPlan = await cli('project-open-plan', aPath); await cli('project-open', openPlan.id);
  });
  await ready(); assert.equal((await get()).project.name, 'A Preserve On Close'); assert.equal(await page.locator('#projects-open').isEnabled(), false);
  check('gui.workspace.delayed-state-responses-cannot-undo-close-or-activation');

  await closeLibrary(); await edit('project.rename', { name: 'A Render Gate' });
  let releaseRender, renderSeenResolve, renderHeld = false;
  const renderGate = new Promise(resolve => { releaseRender = resolve; }), renderSeen = new Promise(resolve => { renderSeenResolve = resolve; });
  await page.route('**/api/jobs/*', async route => {
    if (renderHeld || route.request().method() !== 'GET') return route.continue(); renderHeld = true;
    let response, body, job;
    for (let attempt = 0; attempt < 100; attempt++) {
      response = await route.fetch(); body = await response.body(); job = JSON.parse(body);
      if (['completed', 'done', 'succeeded'].includes(job.status)) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(['completed', 'done', 'succeeded'].includes(job.status), JSON.stringify(job));
    renderSeenResolve(); await renderGate; await route.fulfill({ response, body });
  });
  const lateRenderResponse = page.waitForResponse(response => /\/api\/jobs\/[^/]+$/.test(new URL(response.url()).pathname));
  try {
    await page.locator('#render-button').click(); await renderSeen;
    const activeId = (await get()).workspace.activeId, closePlan = await cli('project-close-plan', activeId); await cli('project-close', closePlan.id, '--current', 'preserve'); await waitState();
    assert.equal((await get()).project, null); releaseRender(); await lateRenderResponse;
    await page.waitForFunction(() => document.querySelector('#job-bar').hidden && !document.querySelector('.render-result a'));
    assert.equal(await page.locator('.render-result a').count(), 0); assert.equal(await page.locator('#workspace-empty').isVisible(), true);
    const openPlan = await cli('project-open-plan', bPath); await cli('project-open', openPlan.id); await waitState();
    assert.equal(await page.locator('.render-result a').count(), 0);
  } finally { releaseRender(); await page.unroute('**/api/jobs/*'); }
  check('gui.workspace.delayed-completed-render-cannot-reappear-after-active-close');

  assert.deepEqual(pageErrors, []);
  const paths = ['public/projects.mjs', 'public/session.mjs','public/app.mjs', 'public/document.mjs', 'public/resolution.mjs', 'public/index.html', 'public/styles.css', 'src/workspace.mjs', 'src/recent-projects.mjs', 'src/project-open.mjs', 'src/document-session.mjs', 'src/project-save.mjs', 'src/revert-media.mjs', 'src/project-files.mjs', 'src/project-drafts.mjs','src/project-locations.mjs','src/folder-browser.mjs', 'src/storage.mjs','src/session-store.mjs', 'src/auto-backup.mjs', 'src/server.mjs', 'src/cli.mjs', 'src/core/engine.mjs', 'scripts/gui-workspace-smoke.mjs' ,'public/editing.mjs','public/midi-events.mjs','src/core/editing.mjs','src/core/midi-events.mjs','src/core/schema.mjs','src/demo.mjs','src/media-resolution.mjs','src/media-search.mjs','src/media/common.mjs','src/media/midi.mjs','src/media/render.mjs','src/media/midi-stream.mjs','src/media/midi-playback.mjs','src/core/controllers.mjs','src/media/midi-curves.mjs','src/media/midi-chase.mjs','src/media/controller-bend.mjs','src/media/midi-controllers-query.mjs','src/core/modifiers.mjs','src/media/midi-modifiers.mjs','public/midi-modifiers.mjs','src/core/merge.mjs','public/midi-merge.mjs','src/chase-settings.mjs','public/chase-settings.mjs','src/controller-settings.mjs','public/controller-settings.mjs','src/media/controller-readout.mjs','public/controller-lanes.mjs','src/media/time.mjs','src/media/wav.mjs','src/render-worker.mjs'];
  for(const file of ['public/native-midi.mjs', 'src/native-midi-settings.mjs', 'src/native-transport.mjs', 'native/macos/client.mjs', 'native/macos/project-plan.mjs', 'native/macos/midi-bridge.swift', 'scripts/build-native-midi.mjs','src/reset-settings.mjs','public/reset-settings.mjs','native/macos/reset-policy.mjs','src/media/midi-display-time.mjs','src/media/midi-length-adjustment.mjs','src/timing-settings.mjs','public/timing-settings.mjs','src/media/musical-time.mjs','public/musical-time-display.mjs','src/media/display-time-edit.mjs','public/inspector-time.mjs','src/media/elapsed-time.mjs','src/media/timecode.mjs','src/media/timeline-projection.mjs','src/media/time-display.mjs','public/time-display-settings.mjs','src/media/editor-geometry.mjs','src/media/ruler-intervals.mjs'])if(!paths.includes(file))paths.push(file);
 for(const file of ['src/media/note-paint.mjs','src/media/note-shapes.mjs','src/media/exact-tempo.mjs','src/media/time-edit-resolver.mjs','src/media/formatted-time-command.mjs','src/core/controller-paint.mjs','src/media/controller-shape-gesture.mjs','src/media/controller-shapes.mjs','src/media/controller-paint.mjs','src/media/controller-time-gesture.mjs','src/media/pointer-time-grid.mjs','src/media/snap-grid.mjs','public/snap-grid-settings.mjs'])if(!paths.includes(file))paths.push(file);
 const sourceHashes = Object.fromEntries(await Promise.all(paths.map(async filename => [filename, hash(await fs.readFile(path.join(root, filename)))])));
  const receipt = { status: 'passed', executedAt: new Date().toISOString(), command: 'NEWDAW_PLAYWRIGHT_MODULE=<installed playwright> node scripts/gui-workspace-smoke.mjs', browser: 'headless Chrome', isolatedFixture: true, tests, pageErrors, screenshots: ['docs/screenshots/v78-open-documents.png', 'docs/screenshots/v78-no-active-project.png'], sourceHashes };
  await fs.mkdir(path.join(root, '.test-output'), { recursive: true }); await fs.writeFile(path.join(root, '.test-output/gui-workspace.json'), `${JSON.stringify(receipt, null, 2)}\n`); console.log(JSON.stringify(receipt, null, 2));
} catch (error) {
  await fs.mkdir(path.join(root, '.test-output'), { recursive: true }); await page.screenshot({ path: path.join(root, '.test-output/gui-workspace-failure.png'), fullPage: true }).catch(() => {}); console.error(`FAILED after ${tests.length} checks:`, error); throw error;
} finally { await browser.close(); await session.close(); await fs.rm(directory, { recursive: true, force: true }); }
