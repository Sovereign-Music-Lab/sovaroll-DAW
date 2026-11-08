// Real Chrome/CLI on isolated temporary projects. Never opens user documents.
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { startServer } from '../src/server.mjs';
import { encodeWav } from '../src/media/wav.mjs';
const { chromium } = await import(process.env.NEWDAW_PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), exec = promisify(execFile), hash = bytes => createHash('sha256').update(bytes).digest('hex');
const directory = await fs.mkdtemp('/private/tmp/newdaw-drafts-gui-'), aPath = path.join(directory, 'Existing.newdaw.json'), recentPath = path.join(directory, '.recent.json'), registryPath = `${recentPath}.drafts.json`;
let session = await startServer({ projectPath: aPath, recentPath, port: 0, demo: true, quiet: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome' }), page = await browser.newPage({ viewport: { width: 1512, height: 1180 } }), tests = [], pageErrors = [], writes = [];
page.setDefaultTimeout(25000);
page.on('pageerror', error => pageErrors.push(error.message)); page.on('request', request => { if (request.method() === 'POST') writes.push(new URL(request.url()).pathname); });
const get = async (route = '/api/state') => { const response = await fetch(session.url + route); assert.equal(response.status, 200); return response.json(); };
const check = id => { tests.push(id); console.log(`PASS ${id}`); };
const absent = filename => assert.rejects(fs.lstat(filename), { code: 'ENOENT' });
const action = async (work, route) => { const pending = page.waitForResponse(response => new URL(response.url()).pathname === route && response.request().method() === 'POST').then(async response => ({ status: response.status(), body: await response.json() })); await work(); return pending; };
const ok = response => { assert.equal(response.status, 200, JSON.stringify(response.body)); return response.body; };
const cli = async (...args) => JSON.parse((await exec(process.execPath, ['src/cli.mjs', ...args, '--url', session.url], { cwd: root, timeout: 25000 })).stdout);
const waitState = async () => { const state = await get(); if (state.project) await page.waitForFunction(value => document.querySelector('#project-name')?.value === value.name && Number(document.querySelector('#revision-label')?.textContent.match(/\d+/)?.[0]) === value.revision, state.project); else await page.waitForFunction(() => !document.querySelector('#workspace-empty').hidden); return state; };
const edit = async (command, args = {}) => { const result = await cli('command', command, JSON.stringify(args)); await waitState(); return result; };
const ready = async () => page.waitForFunction(() => document.querySelector('#projects-preview') && !document.querySelector('#projects-preview').disabled);
const docReady = async () => page.waitForFunction(() => document.querySelector('#document-save') && !document.querySelector('#document-save').disabled);
const library = async () => { if (!await page.locator('#projects-dialog').evaluate(element => element.open)) await page.locator('#projects-button').click(); await ready(); };
const closeLibrary = async () => { await page.locator('#projects-close').click(); await page.waitForFunction(() => !document.querySelector('#projects-dialog').open); };
const docOpen = async () => { await page.locator('#document-button').click(); await docReady(); };
const docClose = async () => { await page.locator('#document-close').click(); await page.waitForFunction(() => !document.querySelector('#document-dialog').open); };
let plan;
const newPlan = async (folder, mode = 'active', rate = 48000) => { await library(); if (!await page.locator('.projects-new').evaluate(element => element.open)) await page.locator('#projects-new-toggle').click(); if (!await page.locator('.projects-direct-location').evaluate(element => element.open)) await page.locator('#projects-direct-toggle').click(); await page.locator('#projects-use-direct-path').check(); await page.locator('#projects-new-folder').fill(folder); await page.locator('#projects-new-rate').fill(String(rate)); await page.locator('#projects-new-mode').selectOption(mode); plan = ok(await action(() => page.locator('#projects-new-preview').click(), '/api/workspace/new/plan')); await ready(); return plan; };
const targetPlan = async (id, kind) => { await library(); plan = ok(await action(() => page.locator(`[data-document-${kind}="${id}"]`).click(), `/api/workspace/${kind}/plan`)); await ready(); return plan; };
const recoverPlan = async (id, mode = 'active') => { await library(); if (!await page.locator('.projects-drafts').evaluate(element => element.open)) await page.locator('#projects-drafts-toggle').click(); await page.locator('#projects-drafts-mode').selectOption(mode); plan = ok(await action(() => page.locator(`[data-draft-recover="${id}"]`).click(), '/api/workspace/recover/plan')); await ready(); return plan; };
const choose = async (policy = 'preserve', output) => { if (await page.locator('#projects-current-policy').isVisible()) await page.locator('#projects-current-policy').selectOption(policy); if (output) await page.locator('#projects-policy-output').fill(output); if (plan.kind === 'close') await page.locator('#projects-close-confirm').check(); };
const apply = async (policy = 'preserve', output) => { await choose(policy, output); const result = await action(() => page.locator('#projects-open').click(), `/api/workspace/${plan.kind}`); if (result.status === 200 && plan.kind !== 'close' && plan.mode !== 'inactive') await page.waitForFunction(() => !document.querySelector('#projects-dialog').open); else await ready(); await waitState(); return result; };
const firstSave = async output => { await page.locator('#document-output').fill(output); const response = await action(() => page.locator('#document-save-as').click(), '/api/document/save-as'); await docReady(); await waitState(); return response; };
const working = entry => path.join(entry.projectFolder, `.newdaw-draft-${entry.id}.newdaw.json`);
try {
  await page.goto(session.url); await page.waitForFunction(() => !document.querySelector('#projects-button').disabled); const initial = await get(), initialBytes = await fs.readFile(aPath), folder1 = path.join(directory, 'Draft One');
  let releasePreview, previewSeenResolve; const previewGate = new Promise(resolve => { releasePreview = resolve; }), previewSeen = new Promise(resolve => { previewSeenResolve = resolve; });
  await page.route('**/api/workspace/new/plan', async route => { previewSeenResolve(); await previewGate; await route.continue(); });
  const pendingPreview = newPlan(folder1, 'active', 44100); await previewSeen;
  try { for (const selector of ['#projects-new-folder', '#projects-new-rate', '#projects-new-mode', '#projects-new-preview', '#projects-path', '#projects-drafts-mode', '#projects-refresh']) assert.equal(await page.locator(selector).isEnabled(), false, selector); assert.equal(await page.locator('#projects-close').isEnabled(), true); } finally { releasePreview(); }
  await pendingPreview; await page.unroute('**/api/workspace/new/plan');
  check('gui.drafts.new-preview-locks-competing-inputs');
  assert.equal(plan.target.name, 'Untitled1'); await absent(folder1); assert.equal((await get('/api/workspace/drafts')).entries.length, 0);
  await page.locator('#projects-cancel-plan').click(); assert.equal((await get()).workspace.documents.length, 1); await absent(folder1);
  check('gui.drafts.new-preview-cancel-does-not-create-working-files');

  await newPlan(folder1, 'active', 44100); ok(await apply()); let current = await get(), draft1 = (await get('/api/workspace/drafts')).entries.find(entry => entry.name === 'Untitled1');
  assert.equal(current.project.sampleRate, 44100); assert.equal(current.session.document.neverSaved, true); assert.equal(current.session.document.projectPath, null); assert.equal(current.session.document.available, false); assert.equal(current.session.document.dirty, true);
  assert.equal(current.session.document.displayName, 'Untitled1'); assert.match(await page.locator('#save-state').textContent(), /첫 저장 전|아직 이름으로 저장하지/); await absent(`${working(draft1)}.saved.json`); assert.deepEqual(await fs.readFile(aPath), initialBytes);
  check('gui.drafts.new-untitled-has-no-named-save-or-revert-baseline');

  const beforeShortcut = writes.length; await page.locator('#timeline-scroll').focus(); await page.keyboard.press('Control+s'); await docReady();
  assert.equal(await page.locator('#document-dialog').evaluate(element => element.open), true); assert.equal(await page.locator('#document-output').evaluate(element => document.activeElement === element), true);
  assert.equal(writes.slice(beforeShortcut).some(route => route === '/api/document/save' || route === '/api/document/save-as'), false); assert.equal(await page.locator('#document-version').isEnabled(), false); assert.equal(await page.locator('#document-revert-plan').isEnabled(), false); assert.equal(await page.locator('#document-path').textContent(), `Untitled1 · 작업 폴더: ${folder1}`);
  await fs.mkdir(path.join(root, 'docs/screenshots'), { recursive: true }); await page.screenshot({ path: path.join(root, 'docs/screenshots/v78-first-save.png'), fullPage: true }); await docClose(); await absent(`${working(draft1)}.saved.json`);
  check('gui.drafts.ctrl-s-opens-first-save-form-without-saving');

  await edit('project.settings', { masterGainDb: -9 });
  const sourceBytes = Buffer.from(encodeWav({ sampleRate: 8000, channels: [Float32Array.from({ length: 8000 }, (_, index) => .1 * Math.sin(index * .13))] })), source = path.join(directory, 'Original.wav'); await fs.writeFile(source, sourceBytes);
  const upload = page.waitForResponse(response => new URL(response.url()).pathname === '/api/import/wav' && response.request().method() === 'POST');
  await page.locator('#import-button').click();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('#import-choose-file').click()]);
  await chooser.setFiles(source); assert.equal((await upload).status(), 200); current = await waitState();
  const draftAsset = current.project.assets.find(asset => asset.sha256 === hash(sourceBytes)); assert.ok(draftAsset); assert.deepEqual(await fs.readFile(path.join(folder1, draftAsset.path)), sourceBytes); await absent(`${working(draft1)}.saved.json`);
  check('gui.drafts.edit-and-import-persist-working-state-without-first-save');

  await page.locator('#backups-button').click(); await page.waitForFunction(() => document.querySelector('#backups-dialog').open && document.querySelector('#backup-status').textContent.length > 0 && !document.querySelector('#backup-now').disabled);
  ok(await action(() => page.locator('#backup-now').click(), '/api/backups/create')); await page.waitForSelector('#backup-list a'); const backups = await get('/api/backups'); assert.equal(backups.files.length, 1); assert.equal(backups.files[0].file, 'Untitled1-01.bak'); const backupResponse = await fetch(session.url + await page.locator('#backup-list a').getAttribute('href')); assert.equal(backupResponse.status, 200); assert.equal((await backupResponse.json()).masterGainDb, -9);
  await page.locator('#backups-dialog [data-close-dialog]').click(); await absent(`${working(draft1)}.saved.json`);
  check('gui.drafts.numbered-backup-is-available-before-first-save');

  current = await get(); const draft1OpenId = current.workspace.activeId, beforeRecovery = current.project, historyCount = current.historyView.entries.length;
  await targetPlan(draft1OpenId, 'close'); assert.equal(plan.requiresCurrentPolicy, true); ok(await apply('preserve')); assert.equal((await get()).project, null); assert.equal((await get('/api/workspace/drafts')).entries.find(entry => entry.id === draft1.id).resumable, true); await absent(`${working(draft1)}.saved.json`);
  const port = session.server.address().port; await session.close(); session = await startServer({ projectPath: aPath, recentPath, port, demo: false, quiet: true }); await page.reload(); await page.waitForFunction(() => !document.querySelector('#projects-button').disabled);
  await recoverPlan(draft1.id); ok(await apply()); current = await get(); assert.deepEqual(current.project, beforeRecovery); assert.equal(current.historyView.entries.length, historyCount); assert.equal(current.session.document.neverSaved, true); const recoveredBytes = await fetch(session.url + `/api/assets/${draftAsset.id}/file`); assert.deepEqual(Buffer.from(await recoveredBytes.arrayBuffer()), sourceBytes);
  check('gui.drafts.preserved-work-recovers-after-restart-with-history-and-wav');

  await docOpen(); const beforeCollision = await get(); let response = await firstSave(aPath); assert.equal(response.status, 409, JSON.stringify(response.body)); assert.equal((await get()).session.document.neverSaved, true); assert.equal((await get()).workspace.activeId, beforeCollision.workspace.activeId); assert.deepEqual(await fs.readFile(aPath), initialBytes); await absent(`${working(draft1)}.saved.json`);
  check('gui.drafts.first-save-collision-preserves-draft-and-destination');
  await fs.mkdir(path.join(directory, 'Named'));
  const namedPath = path.join(directory, 'Named', 'First.newdaw.json'), oldRequestId = (await get()).session.document.id, stableOpenId = (await get()).workspace.activeId;
  ok(await firstSave(namedPath)); current = await get(); assert.equal(current.workspace.activeId, stableOpenId); assert.notEqual(current.session.document.id, oldRequestId); assert.equal(current.session.document.neverSaved, false); assert.equal(current.session.document.projectPath, namedPath); assert.equal(current.session.document.available, true); assert.equal(current.session.document.dirty, false); assert.equal(current.historyView.entries.length, historyCount);
  assert.equal(JSON.parse(await fs.readFile(`${namedPath}.saved.json`)).project.masterGainDb, -9); assert.deepEqual(await fs.readFile(path.join(path.dirname(namedPath), draftAsset.path)), sourceBytes); assert.equal(await page.locator('#document-version').isEnabled(), true); assert.equal(await page.locator('#document-revert-plan').isEnabled(), true);
  check('gui.drafts.first-save-publishes-named-media-history-and-baseline');
  await docClose(); await library(); if (!await page.locator('.projects-drafts').evaluate(element => element.open)) await page.locator('#projects-drafts-toggle').click(); const published = (await get('/api/workspace/drafts')).entries.find(entry => entry.id === draft1.id); assert.equal(published.status, 'published'); assert.equal(published.resumable, false); assert.equal(await page.locator(`[data-draft-recover="${draft1.id}"]`).isEnabled(), false);
  check('gui.drafts.published-working-copy-cannot-be-recovered-twice');

  const folder2 = path.join(directory, 'Draft Two'); await newPlan(folder2, 'inactive'); assert.equal(plan.target.name, 'Untitled2'); ok(await apply()); let documents = (await get()).workspace.documents, draft2 = documents.find(entry => entry.neverSaved), draft2Entry = (await get('/api/workspace/drafts')).entries.find(entry => entry.id === draft2.draftId);
  assert.equal((await get()).workspace.activeId, stableOpenId); assert.equal(draft2.resources, 'deferred'); const namedBefore = await fs.readFile(namedPath), namedSavedBefore = await fs.readFile(`${namedPath}.saved.json`);
  await targetPlan(draft2.id, 'close'); await page.locator('#projects-current-policy').selectOption('save'); await page.locator('#projects-close-confirm').check(); assert.equal(await page.locator('#projects-policy-output').isVisible(), true); assert.equal(await page.locator('#projects-open').isEnabled(), false);
  const secondPath = path.join(directory, 'Named', 'Second.newdaw.json'); ok(await apply('save', secondPath)); assert.equal((await get()).workspace.activeId, stableOpenId); assert.equal((await get()).workspace.documents.some(entry => entry.id === draft2.id), false); assert.ok(JSON.parse(await fs.readFile(secondPath)).id); assert.deepEqual(await fs.readFile(namedPath), namedBefore); assert.deepEqual(await fs.readFile(`${namedPath}.saved.json`), namedSavedBefore); assert.equal((await get('/api/workspace/drafts')).entries.find(entry => entry.id === draft2Entry.id).status, 'published');
  check('gui.drafts.inactive-close-save-requires-path-and-saves-only-target');

  const folder3 = path.join(directory, 'Draft Three'); await newPlan(folder3); assert.equal(plan.target.name, 'Untitled3'); ok(await apply()); await edit('project.settings', { masterGainDb: -7 }); const draft3Open = (await get()).workspace.activeId;
  await targetPlan(stableOpenId, 'activate'); assert.equal(plan.requiresSavePath, true); await page.locator('#projects-current-policy').selectOption('save'); assert.equal(await page.locator('#projects-open').isEnabled(), false);
  const thirdPath = path.join(directory, 'Named', 'Third.newdaw.json'); ok(await apply('save', thirdPath)); assert.equal((await get()).workspace.activeId, stableOpenId); const namedThird = (await get()).workspace.documents.find(entry => entry.id === draft3Open); assert.equal(namedThird.neverSaved, false); assert.equal(namedThird.projectPath, thirdPath); assert.equal(JSON.parse(await fs.readFile(thirdPath)).masterGainDb, -7);
  check('gui.drafts.save-before-activation-first-saves-departing-untitled');

  const folder4 = path.join(directory, 'Draft Four'); await newPlan(folder4); assert.equal(plan.target.name, 'Untitled4'); ok(await apply()); const draft4 = (await get()).workspace.documents.find(entry => entry.active), draft4Entry = (await get('/api/workspace/drafts')).entries.find(entry => entry.id === draft4.draftId);
  await docOpen(); let releaseSave, saveSeenResolve; const saveGate = new Promise(resolve => { releaseSave = resolve; }), saveSeen = new Promise(resolve => { saveSeenResolve = resolve; });
  await page.route('**/api/document/save-as', async route => { saveSeenResolve(); await saveGate; await route.continue(); });
  const staleDestination = path.join(directory, 'Must-not-save.json'); await page.locator('#document-output').fill(staleDestination); const pendingSave = action(() => page.locator('#document-save-as').click(), '/api/document/save-as'); await saveSeen;
  await edit('project.settings', { masterGainDb: -5 }); releaseSave(); response = await pendingSave; assert.equal(response.status, 409, JSON.stringify(response.body)); await page.unroute('**/api/document/save-as'); await docReady(); await absent(staleDestination); assert.equal((await get()).session.document.neverSaved, true);
  check('gui.drafts.first-save-frozen-revision-rejects-concurrent-edit');

  await docClose(); await library(); const folder5 = path.join(directory, 'Draft Five'); await newPlan(folder5); await choose('preserve'); const registryBefore = await fs.readFile(registryPath);
  let releaseNew, newSeenResolve; const newGate = new Promise(resolve => { releaseNew = resolve; }), newSeen = new Promise(resolve => { newSeenResolve = resolve; });
  await page.route('**/api/workspace/new', async route => { newSeenResolve(); await newGate; await route.continue(); }); const pendingNew = action(() => page.locator('#projects-open').click(), '/api/workspace/new'); await newSeen;
  await edit('project.settings', { masterGainDb: -4 }); releaseNew(); response = await pendingNew; assert.equal(response.status, 409, JSON.stringify(response.body)); await page.unroute('**/api/workspace/new'); await ready(); assert.deepEqual(await fs.readFile(registryPath), registryBefore); await absent(folder5);
  check('gui.drafts.stale-new-plan-does-not-allocate-a-name-or-folder');

  await closeLibrary(); await docOpen(); let releaseMetadata, metadataSeenResolve, metadataDoneResolve; const metadataGate = new Promise(resolve => { releaseMetadata = resolve; }), metadataSeen = new Promise(resolve => { metadataSeenResolve = resolve; }), metadataDone = new Promise(resolve => { metadataDoneResolve = resolve; });
  await page.route('**/api/document', async route => { const response = await route.fetch(), body = await response.body(); metadataSeenResolve(); await metadataGate; await route.fulfill({ response, body }); metadataDoneResolve(); });
  await page.locator('#document-refresh').click(); await metadataSeen; const activatePlan = await cli('project-activate-plan', stableOpenId); await cli('project-activate', activatePlan.id, '--current', 'preserve'); await waitState(); releaseMetadata(); await metadataDone; await page.unroute('**/api/document'); await page.waitForFunction(() => !document.querySelector('#document-dialog').open);
  assert.equal((await get()).session.document.projectPath, namedPath); await docOpen(); assert.equal(await page.locator('#document-path').textContent(), namedPath); await docClose();
  check('gui.drafts.delayed-untitled-metadata-cannot-replace-new-active-document');

  await targetPlan(draft4.id, 'close'); ok(await apply('preserve')); await recoverPlan(draft4Entry.id, 'inactive'); ok(await apply()); const recovered4 = (await get()).workspace.documents.find(entry => entry.draftId === draft4Entry.id); assert.equal(recovered4.neverSaved, true); assert.equal((await get()).workspace.activeId, stableOpenId);
  await page.screenshot({ path: path.join(root, 'docs/screenshots/v78-draft-recovery.png'), fullPage: true });
  check('gui.drafts.recovery-can-remain-inactive-with-current-project-unchanged');

  await targetPlan(recovered4.id, 'activate'); ok(await apply()); const fourthPath = path.join(directory, 'Named', 'Fourth.newdaw.json'); await cli('save', '--output', fourthPath); await waitState(); assert.equal((await get()).session.document.neverSaved, false); assert.equal((await get()).session.document.projectPath, fourthPath); assert.equal(JSON.parse(await fs.readFile(`${fourthPath}.saved.json`)).project.masterGainDb, -4);
  check('gui.drafts.cli-first-save-updates-browser-and-publishes-baseline');

  assert.deepEqual(pageErrors, []);
  const paths = ['public/projects.mjs','public/document.mjs','public/app.mjs','public/resolution.mjs','public/session.mjs','public/index.html','public/styles.css','src/workspace.mjs','src/project-drafts.mjs','src/project-locations.mjs','src/folder-browser.mjs','src/project-open.mjs','src/recent-projects.mjs','src/document-session.mjs','src/project-save.mjs','src/project-files.mjs','src/revert-media.mjs','src/storage.mjs','src/session-store.mjs','src/auto-backup.mjs','src/server.mjs','src/cli.mjs','src/core/engine.mjs','scripts/gui-drafts-smoke.mjs' ,'public/editing.mjs','public/midi-events.mjs','src/core/editing.mjs','src/core/midi-events.mjs','src/core/schema.mjs','src/demo.mjs','src/media-resolution.mjs','src/media-search.mjs','src/media/common.mjs','src/media/midi.mjs','src/media/midi-stream.mjs','src/media/midi-playback.mjs','src/media/render.mjs','src/media/time.mjs','src/media/wav.mjs','src/render-worker.mjs','src/core/controllers.mjs','src/media/midi-curves.mjs','src/media/midi-chase.mjs','src/media/controller-bend.mjs','src/core/modifiers.mjs','src/media/midi-modifiers.mjs','public/midi-modifiers.mjs','src/core/merge.mjs','public/midi-merge.mjs','src/chase-settings.mjs','public/chase-settings.mjs','src/controller-settings.mjs','public/controller-settings.mjs','src/media/controller-readout.mjs','src/media/midi-controllers-query.mjs','public/controller-lanes.mjs'];
  for(const file of ['public/native-midi.mjs', 'src/native-midi-settings.mjs', 'src/native-transport.mjs', 'native/macos/client.mjs', 'native/macos/project-plan.mjs', 'native/macos/midi-bridge.swift', 'scripts/build-native-midi.mjs','src/reset-settings.mjs','public/reset-settings.mjs','native/macos/reset-policy.mjs','src/media/midi-display-time.mjs','src/media/midi-length-adjustment.mjs','src/timing-settings.mjs','public/timing-settings.mjs','src/media/musical-time.mjs','public/musical-time-display.mjs','src/media/display-time-edit.mjs','public/inspector-time.mjs','src/media/elapsed-time.mjs','src/media/timecode.mjs','src/media/timeline-projection.mjs','src/media/time-display.mjs','public/time-display-settings.mjs','src/media/editor-geometry.mjs','src/media/ruler-intervals.mjs'])if(!paths.includes(file))paths.push(file);
 for(const file of ['src/media/note-paint.mjs','src/media/note-shapes.mjs','src/media/exact-tempo.mjs','src/media/time-edit-resolver.mjs','src/media/formatted-time-command.mjs','src/core/controller-paint.mjs','src/media/controller-shape-gesture.mjs','src/media/controller-shapes.mjs','src/media/controller-paint.mjs','src/media/controller-time-gesture.mjs','src/media/pointer-time-grid.mjs','src/media/snap-grid.mjs','public/snap-grid-settings.mjs'])if(!paths.includes(file))paths.push(file);
 const sourceHashes = Object.fromEntries(await Promise.all(paths.map(async filename => [filename, hash(await fs.readFile(path.join(root, filename)))])));
  const receipt = { status:'passed', executedAt:new Date().toISOString(), command:'NEWDAW_PLAYWRIGHT_MODULE=<installed playwright> node scripts/gui-drafts-smoke.mjs', browser:'headless Chrome', isolatedFixture:true, tests, pageErrors, screenshots:['docs/screenshots/v78-first-save.png','docs/screenshots/v78-draft-recovery.png'],sourceHashes };
  await fs.mkdir(path.join(root,'.test-output'),{recursive:true});await fs.writeFile(path.join(root,'.test-output/gui-drafts.json'),`${JSON.stringify(receipt,null,2)}\n`);console.log(JSON.stringify(receipt,null,2));
} catch(error){await fs.mkdir(path.join(root,'.test-output'),{recursive:true});await page.screenshot({path:path.join(root,'.test-output/gui-drafts-failure.png'),fullPage:true}).catch(()=>{});console.error(`FAILED after ${tests.length} checks:`,error);throw error;}
finally{await browser.close();await session.close();await fs.rm(directory,{recursive:true,force:true});}
