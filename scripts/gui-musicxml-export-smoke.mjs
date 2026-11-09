// T-069 MusicXML export: GUI download from the score view with the displayed key,
// CLI export with track selection, and API rejections without project edits.
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { startServer } from '../src/server.mjs';
const { chromium } = await import(process.env.NEWDAW_PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(import.meta.dirname, '..'), exec = promisify(execFile);
const dir = await fs.mkdtemp('/private/tmp/newdaw-musicxml-'), projectPath = path.join(dir, 'Score.newdaw.json');
const session = await startServer({ projectPath, port: 0, demo: false, quiet: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1580, height: 1400 }, acceptDownloads: true }), tests = [], pageErrors = [];
page.setDefaultTimeout(15000);
page.on('pageerror', (e) => pageErrors.push(e.message));
const state = async () => (await fetch(session.url + '/api/state')).json();
const cli = async (...args) => JSON.parse((await exec(process.execPath, ['src/cli.mjs', ...args, '--url', session.url], { cwd: root, timeout: 25000 })).stdout);
const cmd = (c, a = {}) => cli('command', c, JSON.stringify(a));
const check = (id) => { tests.push(id); console.log('PASS ' + id); };

try {
  const ppq = 960;
  await cmd('track.add', { id: 't', type: 'midi', name: 'Melody' });
  await cmd('clip.add', { id: 'c', trackId: 't', type: 'midi', startTick: 0, lengthTicks: ppq * 8, notes: [
    { id: 'a', pitch: 70, velocity: 90, startTick: 0, durationTicks: ppq },
    { id: 'b', pitch: 67, velocity: 90, startTick: ppq * 3, durationTicks: ppq * 2 },
  ] });
  await cmd('track.add', { id: 'bass', type: 'midi', name: 'Bass' });
  await cmd('clip.add', { id: 'd', trackId: 'bass', type: 'midi', startTick: 0, lengthTicks: ppq * 4, notes: [{ id: 'z', pitch: 36, velocity: 80, startTick: 0, durationTicks: ppq * 4 }] });
  const before = await state();

  // 1. Score toolbar exports the selected clip's track with the displayed key.
  await page.goto(session.url);
  await page.waitForFunction(() => !document.querySelector('#editor-view-score').hidden && document.querySelector('#note-grid [data-note-id="a"]'));
  await page.locator('#editor-view-score').click();
  await page.waitForFunction(() => !document.querySelector('#score-export-musicxml').hidden);
  await page.locator('#score-key').selectOption('-1');
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#score-export-musicxml').click()]);
  assert.match(download.suggestedFilename(), /Melody\.musicxml$/);
  const file = path.join(dir, 'gui.musicxml');
  await download.saveAs(file);
  const gui = await fs.readFile(file, 'utf8');
  assert.match(gui, /<score-partwise version="4.0">/);
  assert.match(gui, /<key><fifths>-1<\/fifths><\/key>/);
  assert.match(gui, /<part-name>Melody<\/part-name>/);
  assert.doesNotMatch(gui, /<part-name>Bass<\/part-name>/);
  assert.match(gui, /<step>B<\/step><alter>-1<\/alter><octave>4<\/octave>/);
  assert.equal((gui.match(/<tie type="start"\/>/g) ?? []).length, 1);
  await page.waitForFunction(() => /MusicXML/.test(document.querySelector('#notice-text')?.textContent ?? ''));
  assert.deepEqual((await state()).project, before.project);
  check('musicxml.GUI-score-toolbar-exports-track-with-displayed-key');

  // 2. CLI exports all MIDI tracks, or a selection, without editing the project.
  const all = path.join(dir, 'all.musicxml'), bass = path.join(dir, 'bass.musicxml');
  const resultAll = await cli('export-musicxml', all, '--key-fifths', '2');
  assert.equal(resultAll.partCount, 2);
  assert.equal(resultAll.measureCount, 2);
  assert.match(await fs.readFile(all, 'utf8'), /<key><fifths>2<\/fifths><\/key>/);
  const resultBass = await cli('export-musicxml', bass, '--track-id', 'bass');
  assert.equal(resultBass.partCount, 1);
  const bassXml = await fs.readFile(bass, 'utf8');
  assert.match(bassXml, /<part-name>Bass<\/part-name>/);
  assert.match(bassXml, /<step>C<\/step><octave>2<\/octave>[\s\S]*?<type>whole<\/type>[\s\S]*?<staff>2<\/staff>/);
  assert.deepEqual((await state()).project, before.project);
  check('musicxml.CLI-export-all-and-selected-tracks');

  // 3. Invalid key, audio/unknown track and stale revision are rejected without edits.
  const documentId = (await state()).document?.id;
  const headers = documentId ? { 'X-Newdaw-Document': documentId } : {};
  const status = async (query) => (await fetch(`${session.url}/api/export/musicxml?${query}`, { headers })).status;
  assert.equal(await status('fifths=9'), 422);
  assert.equal(await status('trackId=nope'), 422);
  assert.equal(await status(`expectedRevision=${before.project.revision + 5}`), 409);
  assert.equal(await status('format=1'), 422);
  assert.equal(await status(`expectedRevision=${before.project.revision}&trackId=t`), 200);
  assert.deepEqual((await state()).project, before.project);
  check('musicxml.API-rejects-invalid-requests-without-edits');

  assert.deepEqual(pageErrors, []);
  await fs.mkdir(path.join(root, '.test-output'), { recursive: true });
  await fs.copyFile(all, path.join(root, '.test-output/musicxml-sample.musicxml'));
  await fs.writeFile(path.join(root, '.test-output/musicxml-export.json'), JSON.stringify({ tests, pageErrors }, null, 2));
  console.log(JSON.stringify({ tests: tests.length, pageErrors }));
} catch (error) {
  await page.screenshot({ path: path.join(root, '.test-output/musicxml-export-failure.png'), fullPage: true }).catch(() => {});
  throw error;
} finally {
  await browser.close();
  await session.close();
  await fs.rm(dir, { recursive: true, force: true });
}
