// T-068 score view: toggle, display-only key signature, staff click entry with Undo,
// shared selection and Delete, Alt+Up/Down diatonic moves, persistence and English labels.
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { startServer } from '../src/server.mjs';
const { chromium } = await import(process.env.NEWDAW_PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(import.meta.dirname, '..'), exec = promisify(execFile);
const dir = await fs.mkdtemp('/private/tmp/newdaw-score-editor-'), projectPath = path.join(dir, 'Score.newdaw.json');
const session = await startServer({ projectPath, port: 0, demo: false, quiet: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1580, height: 1400 } }), tests = [], pageErrors = [];
page.setDefaultTimeout(15000);
page.on('pageerror', (e) => pageErrors.push(e.message));
const state = async () => (await fetch(session.url + '/api/state')).json();
const clip = async () => (await state()).project.clips.find((c) => c.id === 'c');
const cli = async (...args) => JSON.parse((await exec(process.execPath, ['src/cli.mjs', ...args, '--url', session.url], { cwd: root, timeout: 25000 })).stdout);
const cmd = (c, a = {}) => cli('command', c, JSON.stringify(a));
const revision = () => page.evaluate(() => Number(document.querySelector('#revision-label').textContent.replace(/\D/g, '')));
const settled = (rev) => page.waitForFunction((r) => Number(document.querySelector('#revision-label').textContent.replace(/\D/g, '')) > r, rev);
const check = (id) => { tests.push(id); console.log('PASS ' + id); };
const scoreNote = (id) => page.locator(`#score-svg [data-score-note="${id}"]`);

// Staff point → page coordinates using the drawn barlines (no private constants beyond staff geometry).
async function staffPoint(tick, staff, position) {
  const box = await page.locator('#score-svg').boundingBox();
  const { x0, x1 } = await page.evaluate(() => {
    const lines = [...document.querySelectorAll('#score-svg .score-barline')];
    return { x0: Number(lines[0].getAttribute('x1')), x1: Number(lines[1].getAttribute('x1')) };
  });
  const p = (await state()).project, barTicks = p.ppq * 4 * p.timeSignature.numerator / p.timeSignature.denominator;
  const bottom = staff === 'treble' ? 100 : 196;
  return { x: box.x + x0 + (x1 - x0) * tick / barTicks, y: box.y + bottom - position * 4 };
}

try {
  const ppq = 960;
  await cmd('track.add', { id: 't', type: 'midi' });
  await cmd('clip.add', { id: 'c', trackId: 't', type: 'midi', startTick: 0, lengthTicks: ppq * 8, notes: [
    { id: 'a', pitch: 61, velocity: 90, startTick: 0, durationTicks: ppq },
    { id: 'b', pitch: 67, velocity: 90, startTick: ppq * 3, durationTicks: ppq * 2 },
    { id: 'low', pitch: 48, velocity: 90, startTick: 0, durationTicks: ppq * 4 },
  ] });
  await page.goto(session.url);
  await page.waitForFunction(() => !document.querySelector('#editor-view-score').hidden && document.querySelector('#note-grid [data-note-id="a"]'));

  // 1. Toggle shows the score of the same clip; nothing is edited.
  const rev0 = await revision();
  await page.locator('#editor-view-score').click();
  await page.waitForFunction(() => document.querySelectorAll('#score-svg [data-score-note]').length === 3);
  assert.equal(await page.locator('#score-scroll').isVisible(), true);
  assert.equal(await page.locator('#piano-scroll').isHidden(), true);
  assert.equal(await page.locator('#editor-view-score').getAttribute('aria-pressed'), 'true');
  assert.equal(await scoreNote('a').getAttribute('data-spelling'), 'C♯4');
  assert.equal(await scoreNote('a').locator('[data-accidental="sharp"]').count(), 1);
  assert.equal(await scoreNote('b').locator('.score-tie').count(), 1);
  assert.equal(await scoreNote('b').locator('.score-head').count(), 2);
  assert.equal(await scoreNote('low').getAttribute('data-staff'), 'bass');
  assert.equal(await scoreNote('low').locator('.score-head.hollow[data-value="whole"]').count(), 1);
  assert.equal(await page.locator('#score-svg').getAttribute('data-bars'), '2');
  assert.equal(await revision(), rev0);
  check('score.GUI-toggle-shows-grand-staff-with-ties-accidentals');

  // 2. Key signature changes spelling only.
  await page.locator('#score-key').selectOption('-1');
  await page.waitForFunction(() => document.querySelector('#score-svg [data-score-note="a"]')?.dataset.spelling === 'D♭4');
  assert.equal(await page.locator('#score-svg [data-key-accidental="flat"]').count(), 2);
  assert.equal(await revision(), rev0);
  await page.locator('#score-key').selectOption('0');
  await page.waitForFunction(() => document.querySelector('#score-svg [data-score-note="a"]')?.dataset.spelling === 'C♯4');
  check('score.GUI-key-signature-respells-without-project-edit');

  // 3. Clicking an empty staff position adds that diatonic pitch at the snapped tick; Undo removes it.
  const point = await staffPoint(ppq * 5 + 20, 'treble', 4); // B4, bar 2 beat 2
  let rev = await revision();
  await page.mouse.click(point.x, point.y);
  await settled(rev);
  let notes = (await clip()).notes;
  const added = notes.find((n) => !['a', 'b', 'low'].includes(n.id));
  assert.ok(added, 'score click should add a note');
  assert.equal(added.pitch, 71);
  assert.equal(added.startTick, ppq * 5);
  await page.waitForFunction((id) => document.querySelector(`#score-svg [data-score-note="${id}"]`), added.id);
  rev = await revision();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
  await settled(rev);
  notes = (await clip()).notes;
  assert.equal(notes.length, 3);
  assert.equal(notes.some((n) => n.id === added.id), false);
  check('score.GUI-staff-click-adds-diatonic-note-and-Undo-removes');

  // 4. Selecting in the score selects the same note in the piano roll; Delete removes it.
  await scoreNote('a').locator('.score-head').click();
  await page.waitForFunction(() => document.querySelector('#score-svg [data-score-note="a"]').classList.contains('selected'));
  assert.equal(await page.locator('#note-grid [data-note-id="a"]').evaluate((e) => e.classList.contains('selected')), true);
  rev = await revision();
  await page.keyboard.press('Delete');
  await settled(rev);
  assert.equal((await clip()).notes.some((n) => n.id === 'a'), false);
  rev = await revision();
  await cmd('history.undo');
  await settled(rev);
  await page.waitForFunction(() => document.querySelector('#score-svg [data-score-note="a"]'));
  check('score.GUI-selection-shared-with-piano-roll-and-Delete');

  // 5. Alt+Up/Down moves selected notes by scale steps; Shift adds an octave.
  await scoreNote('b').locator('.score-head').first().click();
  rev = await revision();
  await page.keyboard.press('Alt+ArrowUp');
  await settled(rev);
  assert.equal((await clip()).notes.find((n) => n.id === 'b').pitch, 69);
  rev = await revision();
  await page.keyboard.press('Alt+Shift+ArrowDown');
  await settled(rev);
  assert.equal((await clip()).notes.find((n) => n.id === 'b').pitch, 57);
  await page.waitForFunction(() => document.querySelector('#score-svg [data-score-note="b"]')?.dataset.staff === 'bass');
  check('score.GUI-Alt-arrow-moves-scale-steps');

  // 6. The view choice persists across reload, and the piano roll comes back.
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('#score-svg [data-score-note]').length === 3);
  assert.equal(await page.locator('#piano-scroll').isHidden(), true);
  await page.locator('#editor-view-piano').click();
  assert.equal(await page.locator('#piano-scroll').isVisible(), true);
  assert.equal(await page.locator('#score-scroll').isHidden(), true);
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#note-grid [data-note-id="a"]'));
  assert.equal(await page.locator('#piano-scroll').isVisible(), true);
  assert.equal(await page.locator('#editor-view-piano').getAttribute('aria-pressed'), 'true');
  check('score.GUI-view-mode-persists-and-piano-roll-restores');

  // 7. English labels.
  await page.locator('#language-select').selectOption('en');
  await page.waitForFunction(() => document.querySelector('#editor-view-piano').textContent.trim() === 'Piano roll');
  assert.equal((await page.locator('#editor-view-score').textContent()).trim(), 'Score');
  await page.locator('#editor-view-score').click();
  await page.waitForFunction(() => /major/.test(document.querySelector('#score-key option[value="0"]').textContent));
  await page.locator('#language-select').selectOption('ko');
  await page.locator('#editor-view-piano').click();
  check('score.GUI-English-labels');

  assert.deepEqual(pageErrors, []);
  await fs.mkdir(path.join(root, '.test-output'), { recursive: true });
  await fs.writeFile(path.join(root, '.test-output/score-editor.json'), JSON.stringify({ tests, pageErrors }, null, 2));
  console.log(JSON.stringify({ tests: tests.length, pageErrors }));
} catch (error) {
  await page.screenshot({ path: path.join(root, '.test-output/score-editor-failure.png'), fullPage: true }).catch(() => {});
  throw error;
} finally {
  await browser.close();
  await session.close();
  await fs.rm(dir, { recursive: true, force: true });
}
