// Optional browser integration check: NEWDAW_PLAYWRIGHT_MODULE=/absolute/path/playwright/index.mjs node scripts/gui-smoke.mjs
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startServer } from '../src/server.mjs';
const {chromium}=await import(process.env.NEWDAW_PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'newdaw-gui-'));
const session=await startServer({projectPath:path.join(dir,'test.newdaw.json'),port:0,demo:true,quiet:true});
const browser=await chromium.launch({headless:true,channel:'chrome'});
const page=await browser.newPage({viewport:{width:1512,height:1050}}),errors=[];
page.on('pageerror',error=>errors.push(error.message));
const state=async()=>(await fetch(session.url+'/api/state')).json();
const waitRevision=async(revision)=>page.waitForFunction(r=>document.getElementById('revision-label')?.textContent.includes(String(r)),revision);
try {
 await page.goto(session.url);await page.waitForSelector('.midi-note');await page.waitForFunction(()=>document.getElementById('connection-status').textContent.includes('동기화'));
 assert.equal(await page.locator('.track-head').count(),3);assert.equal(await page.locator('.midi-note').count(),32);
 await page.locator('#add-note').click();await waitRevision(2);assert.equal((await state()).project.clips[0].notes.length,33);
 const note=(await state()).project.clips[0].notes.at(-1);
 await page.locator(`#note-form input[name="velocity"]`).fill('67');await page.locator('#note-form button[type="submit"]').click();await waitRevision(3);assert.equal((await state()).project.clips[0].notes.find(n=>n.id===note.id).velocity,67);
 await page.locator('#undo').click();await waitRevision(4);assert.equal((await state()).project.clips[0].notes.find(n=>n.id===note.id).velocity,96);
 const exec=promisify(execFile);await exec(process.execPath,['src/cli.mjs','command','track.update','{"trackId":"track-keys","name":"CLI verified"}','--url',session.url],{cwd:root});await page.waitForFunction(()=>document.querySelector('.track-name').textContent==='CLI verified');
 await page.locator('#play').click();await page.waitForFunction(()=>document.getElementById('playback-status').textContent.includes('재생 중'),{},{timeout:20000});
 await page.locator('#stop').click();await page.waitForFunction(()=>document.getElementById('playback-status').textContent==='정지');
 const mute=page.locator('[data-track-id="track-bass"] button[data-action="mute"]');await mute.click();await waitRevision(6);assert.equal((await state()).project.tracks[1].mute,true);
 await page.locator('#import-file').setInputFiles(path.join(root,'examples','assets', (await fs.readdir(path.join(root,'examples','assets')))[0]));await waitRevision(7);assert.equal((await state()).project.tracks.length,4);
 const [midiDownload]=await Promise.all([page.waitForEvent('download'),page.locator('#midi-download').click()]);assert.ok(midiDownload.suggestedFilename().endsWith('.mid'));
 await page.locator('#render-button').click();await page.waitForSelector('.render-result a');const [wavDownload]=await Promise.all([page.waitForEvent('download',{timeout:20000}),page.locator('.render-result a').click()]);assert.ok(wavDownload.suggestedFilename().endsWith('.wav'));
 // Restore a clean-looking test session for the review artifact; user session was never edited.
 await page.locator('#notice-dismiss').click();await page.locator('[data-clip-id="clip-keys"]').click();
 await fs.mkdir(path.join(root,'docs','screenshots'),{recursive:true});await page.screenshot({path:path.join(root,'docs','screenshots','v39-studio-desktop.png'),fullPage:true});
 await page.setViewportSize({width:960,height:900});await page.screenshot({path:path.join(root,'docs','screenshots','v39-studio-compact.png'),fullPage:false});
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({status:'passed',checks:['initial session','GUI note add/update','undo','CLI to GUI SSE','Web Audio play/stop state','track mute','WAV import','MIDI and WAV downloads','desktop and compact screenshots'],pageErrors:errors,screenshot:'docs/screenshots/v78-studio-desktop.png'},null,2));
} finally {await browser.close();await session.close();await fs.rm(dir,{recursive:true,force:true});}
