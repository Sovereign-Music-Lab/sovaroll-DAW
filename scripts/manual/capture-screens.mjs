// Capture real SovaRoll screenshots for the user manual (English and Korean UI).
// NEWDAW_PLAYWRIGHT_MODULE=/abs/playwright/index.mjs node scripts/manual/capture-screens.mjs [en|ko|all]
// Uses a temporary demo project; never touches sessions/. Writes docs/manual/images/<lang>/*.jpg
// and docs/manual/images/cli/*.jpg (real CLI output rendered as terminal images).
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {startServer} from '../../src/server.mjs';
import {findPlaywright} from '../agent/lib.mjs';

const root = path.resolve(import.meta.dirname, '../..'), exec = promisify(execFile);
const {chromium} = await import(process.env.NEWDAW_PLAYWRIGHT_MODULE || await findPlaywright() || 'playwright');
const langs = (process.argv[2] ?? 'all') === 'all' ? ['en', 'ko'] : [process.argv[2]];
const outRoot = path.join(root, 'docs/manual/images');
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sovaroll-manual-')), projectPath = path.join(dir, 'First-Light.newdaw.json');
const session = await startServer({projectPath, port: 0, demo: true, quiet: true});
const state = async () => (await fetch(session.url + '/api/state')).json();
const cli = async (...args) => (await exec(process.execPath, ['src/cli.mjs', ...args, '--url', session.url], {cwd: root, timeout: 60000, env: {...process.env, NO_COLOR: '1'}})).stdout;
const cmd = (name, a) => cli('command', name, JSON.stringify(a));
const shots = [];

// Enrich the demo: tempo, markers, locators, a folder name, so screens look like a real session.
await cmd('marker.add', {name: 'Intro', tick: 0});
await cmd('marker.add', {name: 'Theme', tick: 3840});
await cmd('marker.add', {name: 'Ending', tick: 11520});
await cmd('project.locators', {range: {startTick: 0, endTick: 7680}});
await cmd('project.rename', {name: 'First Light'});

const browser = await chromium.launch({headless: true, channel: 'chrome', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']});
try {
  for (const lang of langs) {
    const out = path.join(outRoot, lang); await fs.mkdir(out, {recursive: true});
    const ctx = await browser.newContext({viewport: {width: 1600, height: 1000}, deviceScaleFactor: 1});
    await ctx.addInitScript(l => { try { localStorage.setItem('sovaroll.language.v1', l); } catch {} }, lang);
    const page = await ctx.newPage(); page.setDefaultTimeout(15000);
    await page.goto(session.url);
    await page.waitForFunction(() => /동기화|synchroni[sz]ed/i.test(document.getElementById('connection-status')?.textContent ?? ''));
    await page.waitForTimeout(600);
    const p = (await state()).project;
    const keys = p.clips.find(c => c.type === 'midi');
    const shot = async (name, target, note) => {
      const file = path.join(out, name + '.jpg');
      if (target) await page.locator(target).first().screenshot({path: file, type: 'jpeg', quality: 82});
      else await page.screenshot({path: file, type: 'jpeg', quality: 82});
      shots.push({lang, name, note}); process.stdout.write(`${lang}/${name} `);
    };
    const badges = async items => page.evaluate(list => {
      document.querySelectorAll('.manual-badge').forEach(n => n.remove());
      for (const [i, sel] of list.entries()) {
        const el = document.querySelector(sel); if (!el) continue; const r = el.getBoundingClientRect();
        const b = document.createElement('div'); b.className = 'manual-badge'; b.textContent = String(i + 1);
        b.style.cssText = `position:fixed;z-index:99999;left:${Math.max(2, r.left - 6)}px;top:${Math.max(2, r.top - 6)}px;width:26px;height:26px;border-radius:13px;background:#ff5a36;color:#fff;font:700 15px/26px system-ui;text-align:center;box-shadow:0 0 0 3px rgba(0,0,0,.55)`;
        const box = document.createElement('div'); box.className = 'manual-badge';
        box.style.cssText = `position:fixed;z-index:99998;left:${r.left - 2}px;top:${r.top - 2}px;width:${r.width + 4}px;height:${r.height + 4}px;border:2px solid #ff5a36;border-radius:6px;pointer-events:none`;
        document.body.append(box, b);
      }
    }, items);
    const clearBadges = () => page.evaluate(() => document.querySelectorAll('.manual-badge').forEach(n => n.remove()));
    const dialogShot = async (name, trigger, {menu, before} = {}) => {
      if (menu) { const d = page.locator('#' + menu); if (!(await d.evaluate(e => e.open))) await d.locator('summary').first().click(); }
      if (before) await before();
      await page.evaluate(sel => { let e = document.querySelector(sel)?.parentElement; while (e) { if (e.tagName === 'DETAILS') e.open = true; e = e.parentElement; } }, trigger);
      await page.locator(trigger).first().click();
      await page.waitForTimeout(500);
      const open = page.locator('dialog[open]');
      if (await open.count()) await shot(name, 'dialog[open]'); else await shot(name);
      await page.keyboard.press('Escape'); await page.waitForTimeout(250);
      await page.evaluate(() => document.querySelectorAll('details[open]').forEach(d => { if (d.id !== 'recording-panel') d.open = false; }));
      if (await page.locator('dialog[open]').count()) await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
    };

    // 1. Overview with numbered areas
    await page.locator(`.timeline-clip[data-clip-id="${keys.id}"]`).first().click({position: {x: 14, y: 10}});
    await page.waitForTimeout(300);
    await shot('01-overview');
    await badges(['.topbar, header', '.transport, #play', '#recording-panel', '#track-heads', '#timeline-scroll', '#inspector-content', '.editor', '#master-gain']);
    await shot('02-overview-numbered'); await clearBadges();
    // 2. Regions
    await shot('03-transport', '#play >> xpath=ancestor::*[contains(@class,"transport")][1]').catch(() => shot('03-transport', 'header'));
    await shot('04-arrangement', '.arrangement, #main-workspace');
    await shot('05-inspector', '.inspector, #inspector-content');
    // 3. Piano roll with a selection
    await page.locator('#piano-scroll').scrollIntoViewIfNeeded();
    const first = page.locator('#note-grid .midi-note').first();
    await first.click(); await page.keyboard.press('ControlOrMeta+a'); await page.waitForTimeout(300);
    await shot('06-piano-roll', '.editor');
    await shot('07-controller-lanes', '#controller-lanes');
    // 4. Score view
    await page.locator('#editor-view-score').click(); await page.waitForTimeout(600);
    await shot('08-score-view', '.editor');
    await page.locator('#editor-view-piano').click(); await page.waitForTimeout(300);
    // 5. Dialogs
    await dialogShot('09-midi-tools', '#midi-tools-button');
    await dialogShot('10-step-input', '#step-input-open');
    await dialogShot('11-midi-events', '#midi-events-button');
    await dialogShot('12-import-options', '#import-button');
    await dialogShot('13-mix-export', '#render-button');
    await dialogShot('14-midi-export', '#midi-export-open');
    await dialogShot('15-projects', '#projects-button');
    await dialogShot('16-history', '#history-button');
    await dialogShot('17-backups', '#backups-button');
    await dialogShot('18-tempo-signature', '#tempo-map-button');
    await dialogShot('19-markers', '#project-markers-open');
    await dialogShot('20-track-folders', '#track-folders-open');
    await dialogShot('21-locators', '#locators-edit');
    await dialogShot('22-add-tracks', '#add-track');
    await dialogShot('23-clip-tools', '#clip-tools-button');
    await dialogShot('24-help-shortcuts', '#help-button');
    await dialogShot('25-media-pool', '#media-pool-button');
    await dialogShot('26-time-display', '#time-display-open');
    await dialogShot('27-snap-grid', '#snap-grid-open');
    // 6. Menus and panels
    for (const [name, id] of [['28-editing-tools-menu', 'editing-tools-menu'], ['29-clip-operations-menu', 'arrangement-edit-menu'], ['30-audition-menu', 'audition-tools-menu']]) {
      const d = page.locator('#' + id); await d.locator('summary').first().click(); await page.waitForTimeout(300);
      await shot(name, '#' + id + ' >> xpath=ancestor::*[contains(@class,"section-toolbar") or contains(@class,"arrangement-toolbar")][1]').catch(() => shot(name));
      await d.locator('summary').first().click();
    }
    const rec = page.locator('#recording-panel'); if (!(await rec.evaluate(e => e.open))) await rec.locator('summary').first().click();
    await page.waitForTimeout(300); await shot('31-recording-panel', '#recording-panel'); await rec.locator('summary').first().click();
    // 7. Audio clip inspector
    const audio = p.clips.find(c => c.type === 'audio');
    if (audio) { await page.locator(`.timeline-clip[data-clip-id="${audio.id}"]`).first().click({position: {x: 14, y: 10}}); await page.waitForTimeout(400); await shot('32-audio-clip-inspector', '.inspector, #inspector-content'); }
    // 8. Mixer / master
    await shot('33-master-meter', '#master-playback-meter >> xpath=ancestor::*[contains(@class,"master") or contains(@class,"inspector")][1]').catch(() => shot('33-master-meter'));
    // 9. Playback state
    await page.locator('#play').click(); await page.waitForTimeout(2500); await shot('34-playing'); await page.locator('#stop').click();
    // 10. Language switch
    await shot('35-language-select', '#language-select >> xpath=..');
    await ctx.close(); process.stdout.write('\n');
  }

  // CLI: real output rendered as terminal images
  const cliOut = path.join(outRoot, 'cli'); await fs.mkdir(cliOut, {recursive: true});
  const term = await browser.newPage({viewport: {width: 1100, height: 400}, deviceScaleFactor: 1});
  const terminal = async (name, commandText, text) => {
    const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const lines = text.replace(/\x1b\[[0-9;]*m/g, '').split('\n'); const shown = lines.slice(0, 34).join('\n') + (lines.length > 34 ? `\n… (${lines.length - 34} more lines)` : '');
    await term.setContent(`<body style="margin:0;background:#1e1f22"><div id="t" style="display:inline-block;min-width:1000px;max-width:1080px;margin:16px;border-radius:10px;overflow:hidden;box-shadow:0 8px 30px #0008;font:13px/1.45 Menlo,monospace">
      <div style="background:#2d2f34;padding:8px 12px;color:#aaa;font:12px system-ui"><span style="color:#ff5f56">●</span> <span style="color:#ffbd2e">●</span> <span style="color:#27c93f">●</span> &nbsp; Terminal — sovaroll-DAW</div>
      <pre style="margin:0;padding:14px 16px;background:#141518;color:#e6e6e6;white-space:pre-wrap"><span style="color:#7ee787">$</span> ${esc(commandText)}\n${esc(shown)}</pre></div></body>`);
    await term.locator('#t').screenshot({path: path.join(cliOut, name + '.jpg'), type: 'jpeg', quality: 85});
    shots.push({lang: 'cli', name}); process.stdout.write(`cli/${name} `);
  };
  const raw = async (...args) => (await exec(process.execPath, ['src/cli.mjs', ...args], {cwd: root, timeout: 60000})).stdout;
  await terminal('01-guide', 'npm run cli -- guide', await raw('guide'));
  await terminal('02-document', 'npm run cli -- document', await cli('document'));
  await terminal('09-guide-edit', 'npm run cli -- guide edit', await raw('guide', 'edit'));
  await terminal('10-import', 'npm run cli -- import tone.wav --at-sample 48000', await (async () => { const {encodeWav} = await import('../../src/media/wav.mjs'); const n = 48000, c = new Float32Array(n); for (let i = 0; i < n; i++) c[i] = 0.3 * Math.sin(2 * Math.PI * 220 * i / 48000) * (1 - i / n); const f = path.join(dir, 'tone.wav'); await fs.writeFile(f, encodeWav({sampleRate: 48000, channels: [c, c]})); return cli('import', f, '--at-sample', '48000'); })());
  await terminal('03-markers', 'npm run cli -- markers', await cli('markers'));
  await terminal('04-dry-run', `npm run cli -- command track.update '{"trackId":"…","gainDb":-6}' --dry-run`, await cli('command', 'track.update', JSON.stringify({trackId: (await state()).project.tracks[0].id, gainDb: -6}), '--dry-run'));
  const wav = path.join(dir, 'mix.wav'), mid = path.join(dir, 'song.mid');
  await terminal('05-render', 'npm run cli -- render mix.wav', await cli('render', wav));
  await terminal('06-export-midi', 'npm run cli -- export-midi song.mid', await cli('export-midi', mid));
  await terminal('07-history', 'npm run cli -- history', await cli('history'));
  await terminal('08-help', 'npm run cli -- --help', await raw('--help'));
  await fs.writeFile(path.join(outRoot, 'index.json'), JSON.stringify({capturedAt: new Date().toISOString(), viewport: '1600x1000', project: 'built-in First Light demo + markers/locators', shots}, null, 2) + '\n');
  console.log(`\n${shots.length} images`);
} finally { await browser.close(); await session.close(); await fs.rm(dir, {recursive: true, force: true}); }
