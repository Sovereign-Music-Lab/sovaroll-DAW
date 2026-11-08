// Isolated actual Chrome + CLI verification. Never opens a user project.
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { startServer } from '../src/server.mjs';
import { encodeWav } from '../src/media/wav.mjs';
const { chromium } = await import(process.env.NEWDAW_PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), exec = promisify(execFile);
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'newdaw-document-gui-'));
let activePath = path.join(directory, 'Session.newdaw.json'), session = await startServer({ projectPath: activePath, port: 0, demo: true, quiet: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1512, height: 1180 } }), checks = [], errors = [];
page.on('pageerror', error => errors.push(error.message));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const state = async () => (await (await fetch(session.url + '/api/state')).json());
const check = id => { checks.push(id); console.log(`PASS ${id}`); };
const waitRevision = async revision => page.waitForFunction(value => Number(document.querySelector('#revision-label')?.textContent.match(/\d+/)?.[0]) === value, revision);
const ready = async () => page.waitForFunction(() => document.querySelector('#document-save') && !document.querySelector('#document-save').disabled);
const refresh = async () => { await page.locator('#document-refresh').click(); await ready(); };
const open = async () => { await page.locator('#document-button').click(); await page.waitForFunction(() => document.querySelector('#document-dialog')?.open); await ready(); };
const close = async () => { await page.locator('#document-close').click(); await page.waitForFunction(() => !document.querySelector('#document-dialog')?.open); };
const cli = async (...args) => JSON.parse((await exec(process.execPath, ['src/cli.mjs', ...args, '--url', session.url], { cwd: root, timeout: 20000 })).stdout);
const edit = async (command, args = {}) => { const result = await cli('command', command, JSON.stringify(args)); await waitRevision(result.projectRevision); return result; };
const action = async (work, route) => {
  const responsePromise = page.waitForResponse(response => new URL(response.url()).pathname === route && response.request().method() === 'POST')
    .then(async response => ({ status: response.status(), body: await response.json() }));
  await work(); return responsePromise;
};
const success = result => { assert.equal(result.status, 200, JSON.stringify(result.body)); return result.body; };
const save = async () => { const result = success(await action(() => page.locator('#document-save').click(), '/api/document/save')); await ready(); return result; };
const preview = async () => { const result = success(await action(() => page.locator('#document-revert-plan').click(), '/api/document/revert/plan')); await ready(); await page.waitForSelector('#document-revert-preview:not([hidden])'); return result; };
const choose = async policy => { await page.locator('#document-revert-confirm').check(); await page.locator('#document-media-policy').selectOption(policy); };
const revert = async policy => { await choose(policy); const response = await action(() => page.locator('#document-revert-apply').click(), '/api/document/revert'); await ready(); return response; };
// Freeze an actual request before the concurrent edit: the UI also prevents a
// newly clicked stale plan, while the server must reject already-sent requests.
const concurrentRevert = async mutation => {
  await choose('keep'); let release, observed;
  const gate = new Promise(resolve => { release = resolve; }), seen = new Promise(resolve => { observed = resolve; });
  await page.route('**/api/document/revert', async route => { observed(); await gate; await route.continue(); });
  const pending = action(() => page.locator('#document-revert-apply').click(), '/api/document/revert');
  try { await seen; await mutation(); release(); const response = await pending; await ready(); assert.equal(await page.locator('#document-revert-apply').isEnabled(), false); return response; }
  finally { release(); await page.unroute('**/api/document/revert'); }
};
const wav = frequency => Buffer.from(encodeWav({ sampleRate: 8000, channels: [Float32Array.from({ length: 800 }, (_, i) => .2 * Math.sin(2 * Math.PI * frequency * i / 8000))] }));
const importSource = async frequency => {
  const bytes = wav(frequency), source = path.join(directory, `External-${frequency}.wav`); await fs.writeFile(source, bytes);
  // Chrome can evict an upload response body from its inspector cache; inspect
  // the HTTP status and authoritative server/UI state instead of the CDP body.
  const pending = page.waitForResponse(response => new URL(response.url()).pathname === '/api/import/wav' && response.request().method() === 'POST');
  await page.locator('#import-file').setInputFiles(source); const response = await pending; assert.equal(response.status(), 200);
  const snapshot = await state(); await waitRevision(snapshot.project.revision); await page.waitForFunction(() => !document.querySelector('#document-button').disabled);
  const asset = snapshot.project.assets.find(item => item.sha256 === hash(bytes)); assert.ok(asset);
  return { bytes, source, asset, filename: path.join(path.dirname(snapshot.session.document.projectPath), asset.path) };
};
const absent = async filename => assert.rejects(fs.lstat(filename), { code: 'ENOENT' });

try {
  await page.goto(session.url); await page.waitForFunction(() => !document.querySelector('#document-button').disabled); await open();
  const initial = await state(), originalPath = initial.session.document.projectPath, baselineBytes = await fs.readFile(`${originalPath}.saved.json`);
  assert.equal(initial.session.document.origin, 'opened-project'); assert.equal(initial.session.document.dirty, false);
  assert.match(await page.locator('#document-checkpoint').textContent(), /저장 상태와 같음/); assert.equal(await page.locator('#document-path').textContent(), originalPath);
  check('gui.document.opened-baseline-and-active-filename');

  await edit('project.rename', { name: 'Explicit Save Check' }); await refresh();
  assert.equal((await state()).session.document.dirty, true); assert.match(await page.locator('#document-checkpoint').textContent(), /저장 이후 변경 있음/);
  assert.deepEqual(await fs.readFile(`${originalPath}.saved.json`), baselineBytes);
  const revisionBeforeSave = (await state()).project.revision, saved = await save();
  assert.equal(saved.document.dirty, false); assert.equal(saved.document.origin, 'explicit'); assert.equal((await state()).project.revision, revisionBeforeSave);
  assert.equal(JSON.parse(await fs.readFile(`${originalPath}.saved.json`)).project.name, 'Explicit Save Check');
  check('gui.document.explicit-save-distinct-from-working-autosave');

  await close(); await edit('project.rename', { name: 'Keyboard Saved' });
  await page.locator('#timeline-scroll').focus(); success(await action(() => page.keyboard.press('Control+s'), '/api/document/save')); await ready();
  assert.equal((await state()).session.document.dirty, false); assert.equal(JSON.parse(await fs.readFile(`${originalPath}.saved.json`)).project.name, 'Keyboard Saved');
  check('gui.document.ctrl-s-saves-explicit-baseline');

  await open(); await edit('project.rename', { name: 'Unsaved While Typing' });
  const typingSaveId = (await state()).session.document.saveId;
  await page.locator('#document-output').fill('/temporary/not-committed.newdaw.json');
  await page.keyboard.press('Control+s');
  await page.waitForFunction(() => document.body.textContent.includes('입력 중인 값을 먼저 적용한 뒤 저장하세요.'));
  assert.equal((await state()).session.document.saveId, typingSaveId); assert.equal((await state()).session.document.dirty, true);
  check('gui.document.ctrl-s-does-not-save-uncommitted-form-input');
  const originalBeforeVersion = await fs.readFile(originalPath);
  const version = success(await action(() => page.locator('#document-version').click(), '/api/document/save-as')); await ready(); activePath = version.document.projectPath;
  assert.notEqual(activePath, originalPath); assert.match(version.document.fileName, /-01\.newdaw\.json$/); assert.equal(version.activated, true);
  assert.deepEqual(await fs.readFile(originalPath), originalBeforeVersion); assert.equal(await page.locator('#document-path').textContent(), activePath);
  await edit('project.rename', { name: 'Editing New Version' });
  assert.equal(JSON.parse(await fs.readFile(activePath)).name, 'Editing New Version'); assert.deepEqual(await fs.readFile(originalPath), originalBeforeVersion);
  check('gui.document.new-version-activates-real-new-file');

  await refresh(); const beforeCollision = await state(); await page.locator('#document-output').fill(originalPath);
  let response = await action(() => page.locator('#document-save-as').click(), '/api/document/save-as'); await ready();
  assert.equal(response.status, 409, JSON.stringify(response.body)); assert.equal((await state()).session.document.id, beforeCollision.session.document.id);
  assert.ok((await page.locator('#document-message').textContent()).length > 0); assert.deepEqual(await fs.readFile(originalPath), originalBeforeVersion);
  check('gui.document.save-as-collision-displays-error-without-overwrite');

  const collectedDirectory = path.join(directory, 'Collected'); await fs.mkdir(collectedDirectory);
  const output = path.join(collectedDirectory, 'Working.newdaw.json'), versionBytes = await fs.readFile(activePath);
  await page.locator('#document-output').fill(output);
  const collected = success(await action(() => page.locator('#document-save-as').click(), '/api/document/save-as')); await ready();
  const previousVersionPath = activePath; activePath = collected.document.projectPath;
  assert.equal(activePath, output); assert.deepEqual(await fs.readFile(previousVersionPath), versionBytes);
  for (const asset of (await state()).project.assets) assert.equal(hash(await fs.readFile(path.join(collectedDirectory, asset.path))), asset.sha256);
  assert.match(await page.locator('#save-state').textContent(), /Working\.newdaw\.json/);
  await fs.mkdir(path.join(root, 'docs/screenshots'), { recursive: true });
  await page.screenshot({ path: path.join(root, 'docs/screenshots/v78-document-save.png'), fullPage: true });
  check('gui.document.save-as-new-folder-collects-complete-wav-assets');

  await edit('project.rename', { name: 'Cancel Me' }); await refresh();
  const cancelledBefore = await state(), cancelledBytes = await fs.readFile(activePath); let planned = await preview();
  assert.equal(planned.historyWillReset, true); assert.match(await page.locator('#document-revert-preview').textContent(), /undo\/redo 이력도 초기화/);
  assert.equal(await page.locator('#document-revert-apply').isEnabled(), false);
  await page.locator('#document-media-policy').selectOption('keep'); assert.equal(await page.locator('#document-revert-apply').isEnabled(), false);
  await page.locator('#document-revert-confirm').check(); assert.equal(await page.locator('#document-revert-apply').isEnabled(), true);
  await page.locator('#document-media-policy').selectOption(''); assert.equal(await page.locator('#document-revert-apply').isEnabled(), false);
  await close(); assert.deepEqual((await state()).project, cancelledBefore.project); assert.deepEqual(await fs.readFile(activePath), cancelledBytes);
  check('gui.document.revert-warning-consent-policy-and-cancel');

  await open(); await preview();
  response = await concurrentRevert(() => edit('project.rename', { name: 'Concurrent CLI Edit' })); assert.equal(response.status, 409, JSON.stringify(response.body)); assert.equal((await state()).project.name, 'Concurrent CLI Edit');
  check('gui.document.stale-revert-plan-rejects-concurrent-cli-edit');
  await refresh(); await preview(); const beforeCLISave = (await state()).project.revision;
  response = await concurrentRevert(() => cli('save')); assert.equal((await state()).project.revision, beforeCLISave);
  assert.equal(response.status, 404, JSON.stringify(response.body)); assert.equal(response.body.errors[0].code, 'REVERT_PLAN_NOT_FOUND');
  check('gui.document.new-cli-save-invalidates-old-revert-without-revision-change');

  await refresh(); await close(); const keptSource = await importSource(431); await open(); planned = await preview(); assert.equal(planned.media.candidates.length, 1);
  const kept = success(await revert('keep')); assert.equal(kept.media.kept.length, 1); assert.equal((await state()).history.canUndo, false);
  assert.deepEqual(await fs.readFile(keptSource.filename), keptSource.bytes); assert.deepEqual(await fs.readFile(keptSource.source), keptSource.bytes);
  assert.equal((await state()).project.assets.some(asset => asset.id === keptSource.asset.id), false);
  check('gui.document.revert-keep-preserves-created-and-external-files');
  await save(); // Captures the kept, now-unused source as an older ownership baseline.

  await close(); const first = await importSource(557), unused = await importSource(719); await edit('history.undo');
  assert.equal((await state()).project.assets.some(asset => asset.id === unused.asset.id), false); assert.deepEqual(await fs.readFile(unused.filename), unused.bytes);
  await open();
  let release, observed; const gate = new Promise(resolve => { release = resolve; }), seen = new Promise(resolve => { observed = resolve; });
  await page.route('**/api/document/revert/plan', async route => { observed(); await gate; await route.continue(); });
  const gatedResponse = page.waitForResponse(result => new URL(result.url()).pathname === '/api/document/revert/plan');
  await page.locator('#document-revert-plan').click(); await seen;
  try { for (const selector of ['#document-output', '#document-save', '#document-version', '#document-refresh', '#document-revert-confirm', '#document-media-policy', '#document-trash-refresh']) assert.equal(await page.locator(selector).isEnabled(), false, selector); }
  finally { release(); }
  const gated = await gatedResponse; assert.equal(gated.status(), 200); planned = await gated.json(); await page.unroute('**/api/document/revert/plan'); await ready();
  check('gui.document.pending-preview-locks-competing-inputs');
  assert.equal(planned.media.candidates.length, 2); assert.ok(planned.media.candidates.some(row => row.assetId === unused.asset.id && row.currentAssetIds.length === 0));
  await choose('trash'); await page.screenshot({ path: path.join(root, 'docs/screenshots/v78-revert-media.png'), fullPage: true });
  const trashed = success(await action(() => page.locator('#document-revert-apply').click(), '/api/document/revert')); await ready();
  assert.equal(trashed.media.moved.length, 2); assert.equal(trashed.historyReset, true); await absent(first.filename); await absent(unused.filename);
  assert.deepEqual(await fs.readFile(first.source), first.bytes); assert.deepEqual(await fs.readFile(unused.source), unused.bytes); assert.deepEqual(await fs.readFile(keptSource.filename), keptSource.bytes);
  assert.equal(await page.locator('[data-restore-operation]').count(), 1);
  check('gui.document.trash-includes-owned-source-removed-from-pool');

  const operationId = trashed.media.operationId, savedId = (await state()).session.document.saveId, savedName = (await state()).project.name;
  await close(); await edit('project.rename', { name: 'Restart Working Changes' });
  const port = session.server.address().port; await session.close(); session = await startServer({ projectPath: activePath, port, demo: false, quiet: true });
  await page.reload(); await page.waitForFunction(() => !document.querySelector('#document-button').disabled); await open();
  assert.equal((await state()).session.document.saveId, savedId); assert.equal((await state()).session.document.dirty, true); assert.equal((await state()).project.name, 'Restart Working Changes');
  assert.equal(await page.locator(`[data-restore-operation="${operationId}"]`).count(), 1);
  check('gui.document.reopen-retains-explicit-point-and-trash-operation');

  await fs.writeFile(first.filename, 'occupied destination must survive');
  const restoreRoute = `/api/document/trash/${operationId}/restore`, beforeRestore = (await state()).project;
  const partial = success(await action(() => page.locator(`[data-restore-operation="${operationId}"]`).click(), restoreRoute)); await ready();
  assert.ok(partial.skipped.some(row => row.reason === 'destination-exists')); assert.equal(await fs.readFile(first.filename, 'utf8'), 'occupied destination must survive');
  assert.deepEqual(await fs.readFile(unused.filename), unused.bytes); assert.deepEqual((await state()).project, beforeRestore);
  check('gui.document.trash-restore-does-not-clobber-existing-file');
  await fs.rm(first.filename);
  const restored = success(await action(() => page.locator(`[data-restore-operation="${operationId}"]`).click(), restoreRoute)); await ready();
  assert.equal(restored.restored.length, 1); assert.deepEqual(await fs.readFile(first.filename), first.bytes); assert.deepEqual((await state()).project, beforeRestore);
  check('gui.document.trash-restore-recovers-missing-managed-media');
  await preview(); success(await revert('keep')); assert.equal((await state()).project.name, savedName); assert.equal((await state()).session.document.dirty, false);
  check('gui.document.revert-after-reopen-uses-last-explicit-checkpoint');

  assert.deepEqual(errors, []);
  const paths = ['public/session.mjs','public/app.mjs', 'public/document.mjs', 'public/projects.mjs', 'public/index.html', 'public/styles.css', 'src/core/engine.mjs', 'src/core/schema.mjs', 'src/server.mjs', 'src/cli.mjs', 'src/document-session.mjs', 'src/project-save.mjs', 'src/revert-media.mjs', 'src/storage.mjs','src/session-store.mjs', 'src/project-files.mjs', 'src/project-drafts.mjs','src/project-locations.mjs','src/folder-browser.mjs', 'src/project-open.mjs', 'src/recent-projects.mjs', 'src/workspace.mjs', 'src/auto-backup.mjs', 'scripts/gui-document-smoke.mjs' ,'public/editing.mjs','public/midi-events.mjs','public/resolution.mjs','src/core/editing.mjs','src/core/midi-events.mjs','src/demo.mjs','src/media-resolution.mjs','src/media-search.mjs','src/media/common.mjs','src/media/midi.mjs','src/media/midi-stream.mjs','src/media/midi-playback.mjs','src/media/render.mjs','src/media/time.mjs','src/media/wav.mjs','src/render-worker.mjs','src/core/controllers.mjs','src/media/midi-curves.mjs','src/media/midi-chase.mjs','src/media/controller-bend.mjs','src/core/modifiers.mjs','src/media/midi-modifiers.mjs','public/midi-modifiers.mjs','src/core/merge.mjs','public/midi-merge.mjs','src/chase-settings.mjs','public/chase-settings.mjs','src/controller-settings.mjs','public/controller-settings.mjs','src/media/controller-readout.mjs','src/media/midi-controllers-query.mjs','public/controller-lanes.mjs'];
  for(const file of ['public/native-midi.mjs', 'src/native-midi-settings.mjs', 'src/native-transport.mjs', 'native/macos/client.mjs', 'native/macos/project-plan.mjs', 'native/macos/midi-bridge.swift', 'scripts/build-native-midi.mjs','src/reset-settings.mjs','public/reset-settings.mjs','native/macos/reset-policy.mjs','src/media/midi-display-time.mjs','src/media/midi-length-adjustment.mjs','src/timing-settings.mjs','public/timing-settings.mjs','src/media/musical-time.mjs','public/musical-time-display.mjs','src/media/display-time-edit.mjs','public/inspector-time.mjs','src/media/elapsed-time.mjs','src/media/timecode.mjs','src/media/timeline-projection.mjs','src/media/time-display.mjs','public/time-display-settings.mjs','src/media/editor-geometry.mjs','src/media/ruler-intervals.mjs'])if(!paths.includes(file))paths.push(file);
 for(const file of ['src/media/note-paint.mjs','src/media/note-shapes.mjs','src/media/exact-tempo.mjs','src/media/time-edit-resolver.mjs','src/media/formatted-time-command.mjs','src/core/controller-paint.mjs','src/media/controller-shape-gesture.mjs','src/media/controller-shapes.mjs','src/media/controller-paint.mjs','src/media/controller-time-gesture.mjs','src/media/pointer-time-grid.mjs','src/media/snap-grid.mjs','public/snap-grid-settings.mjs'])if(!paths.includes(file))paths.push(file);
 const sourceHashes = Object.fromEntries(await Promise.all(paths.map(async filename => [filename, hash(await fs.readFile(path.join(root, filename)))])));
  const receipt = { status: 'passed', executedAt: new Date().toISOString(), command: 'NEWDAW_PLAYWRIGHT_MODULE=<installed playwright> node scripts/gui-document-smoke.mjs', browser: 'headless Chrome', isolatedFixture: true, tests: checks, pageErrors: errors, screenshots: ['docs/screenshots/v78-document-save.png', 'docs/screenshots/v78-revert-media.png'], sourceHashes };
  await fs.mkdir(path.join(root, '.test-output'), { recursive: true }); await fs.writeFile(path.join(root, '.test-output/gui-document.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify(receipt, null, 2));
} catch (error) {
  await fs.mkdir(path.join(root, '.test-output'), { recursive: true });
  await page.screenshot({ path: path.join(root, '.test-output/gui-document-failure.png'), fullPage: true }).catch(() => {});
  console.error(`FAILED after ${checks.length} checks:`, error); throw error;
} finally { await browser.close(); await session.close(); await fs.rm(directory, { recursive: true, force: true }); }
