// Isolated browser + CLI checks for missing-media resolution. No user project.
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {startServer} from '../src/server.mjs';
import {encodeWav} from '../src/media/wav.mjs';
const {chromium}=await import(process.env.NEWDAW_PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),exec=promisify(execFile);
const directory=await fs.mkdtemp(path.join(os.tmpdir(),'newdaw-resolve-gui-')),projectPath=path.join(directory,'session.newdaw.json');
let session=await startServer({projectPath,port:0,demo:true,quiet:true});
const browser=await chromium.launch({headless:true,channel:'chrome'}),page=await browser.newPage({viewport:{width:1512,height:1100}}),checks=[],errors=[];
page.on('pageerror',e=>errors.push(e.message));
const state=async()=>(await(await fetch(session.url+'/api/state')).json());
const check=id=>{checks.push(id);console.log(`PASS ${id}`);};
const waitRevision=async r=>page.waitForFunction(n=>Number(document.querySelector('#revision-label')?.textContent.match(/\d+/)?.[0])===n,r);
const cli=async(command,args)=>{const response=JSON.parse((await exec(process.execPath,['src/cli.mjs','command',command,JSON.stringify(args),'--url',session.url],{cwd:root})).stdout);await waitRevision(response.projectRevision);return response;};
const post=async(route,input)=>{const response=await fetch(session.url+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});assert.ok(response.ok(),await response.clone().text());return response.json();};
const action=async(callback,route)=>{const promise=page.waitForResponse(r=>r.url().endsWith(route)&&r.request().method()==='POST');await callback();const response=await promise;return {status:response.status(),body:await response.json()};};
const close=async()=>{await page.locator('#resolve-close').click();await page.waitForFunction(()=>!document.querySelector('#resolve-dialog').open);};
const open=async()=>{await page.locator('#media-pool-button').click();await page.locator('#media-resolve-button').click();await page.waitForFunction(()=>document.querySelector('#resolve-dialog')?.open);await page.waitForFunction(()=>!document.querySelector('#resolve-refresh').disabled);};
const search=async(mode,location,name)=>{
 await page.locator('#resolve-mode').selectOption(mode);await page.locator('#resolve-location').fill(location);if(name)await page.locator('#resolve-name').fill(name);
 const response=await action(()=>page.locator('#resolve-start').click(),'/api/media/search');assert.equal(response.status,202,JSON.stringify(response.body));
 await page.waitForFunction(()=>document.querySelector('#resolve-status').textContent.includes('검색 완료'));return response.body;
};
const preview=async()=>{
 await page.locator('input[name=resolve-candidate]').first().check();const response=await action(()=>page.locator('#resolve-preview').click(),'/api/media/plan');assert.equal(response.status,200,JSON.stringify(response.body));await page.waitForSelector('#resolve-plan:not([hidden])');return response.body;
};
const accept=async()=>{const r=await action(()=>page.locator('#resolve-accept').click(),'/api/media/accept');return r;};
try{
 const initial=await state(),asset=initial.project.assets[0],assetPath=path.join(directory,asset.path),original=await fs.readFile(assetPath),projectBytes=await fs.readFile(projectPath);
 const sources=path.join(directory,'sources'),nested=path.join(sources,'Nested');await fs.mkdir(nested,{recursive:true});
 const originalPath=path.join(nested,'Original.wav');await fs.writeFile(originalPath,original);await fs.rm(assetPath);
 await page.goto(session.url);await page.waitForFunction(()=>document.querySelector('#resolve-dialog')?.open);assert.match(await page.locator('#resolve-status').textContent(),/누락 1개/);assert.equal((await state()).project.revision,initial.project.revision);check('gui.resolve.open-time-missing-dialog');
 await close();assert.deepEqual(await fs.readFile(projectPath),projectBytes);assert.equal((await state()).project.clips.length,initial.project.clips.length);check('gui.resolve.close-keeps-missing-project');
 await open();await search('folder',sources,'Original.wav');assert.equal(await page.locator('input[name=resolve-candidate]').count(),0);check('gui.resolve.folder-does-not-search-children');
 await search('search',sources,'Original.wav');assert.equal(await page.locator('input[name=resolve-candidate]').count(),1);
 let releasePlan,requestSeen;const gate=new Promise(r=>releasePlan=r),seen=new Promise(r=>requestSeen=r);
 await page.route('**/api/media/plan',async route=>{requestSeen();await gate;await route.continue();});
 await page.locator('input[name=resolve-candidate]').first().check();
 const planResponse=page.waitForResponse(r=>r.url().endsWith('/api/media/plan'));
 await page.locator('#resolve-preview').click();await seen;
 try {for(const selector of ['#resolve-asset','#resolve-refresh','#resolve-round','#resolve-automap','input[name=resolve-candidate]'])assert.equal(await page.locator(selector).isEnabled(),false);}finally{releasePlan();}
 const planHttp=await planResponse;assert.equal(planHttp.status(),200);let plan=await planHttp.json();await page.unroute('**/api/media/plan');await page.waitForSelector('#resolve-plan:not([hidden])');check('gui.resolve.preview-locks-competing-inputs');assert.equal(plan.rows[0].exactHash,true);assert.equal(await page.locator('#resolve-consent-label').isVisible(),false);check('gui.resolve.recursive-search-preview');
 let response=await accept();assert.equal(response.status,200);assert.equal(response.body.projectChanged,false);assert.deepEqual(await fs.readFile(projectPath),projectBytes);assert.deepEqual(await fs.readFile(assetPath),original);check('gui.resolve.exact-restore-keeps-project-revision');
 // Changed content with an explicit filename; search filters matter even though
 // exact-hash candidates are deliberately also discoverable under other names.
 await fs.rm(assetPath);await page.locator('#resolve-refresh').click();await page.waitForFunction(()=>document.querySelector('#resolve-status').textContent.includes('누락 1개'));
 const changed=Buffer.from(encodeWav({sampleRate:asset.sampleRate,channels:Array.from({length:asset.channels},()=>new Float32Array(asset.frames).fill(.15))}));
 const changedPath=path.join(sources,'Replacement.WAV');await fs.writeFile(changedPath,changed);
 await page.locator('#resolve-case').check();await search('search',sources,'replacement.wav');assert.equal(await page.locator('input[name=resolve-candidate]').count(),1); // exact original only
 await page.locator('#resolve-case').uncheck();await search('search',sources,'replacement.wav');assert.equal(await page.locator('input[name=resolve-candidate]').count(),2);check('gui.resolve.case-sensitive-editable-search-name');
 await search('file',changedPath);plan=await preview();assert.equal(plan.requiresReplacementConsent,true);assert.equal(await page.locator('#resolve-accept').isEnabled(),false);check('gui.resolve.changed-content-requires-review');
 await page.locator('#resolve-consent').check();response=await accept();assert.equal(response.status,200);await waitRevision(response.body.projectRevision);let changedState=await state();assert.notEqual(changedState.project.assets[0].sha256,asset.sha256);assert.equal(changedState.project.clips.find(c=>c.assetId===asset.id).id,initial.project.clips.find(c=>c.assetId===asset.id).id);assert.deepEqual(await fs.readFile(changedPath),changed);check('gui.resolve.relink-all-references-and-retain-source');
 await close();await cli('history.undo',{});assert.equal((await state()).project.assets[0].sha256,asset.sha256);await cli('history.redo',{});assert.equal((await state()).project.assets[0].sha256,changedState.project.assets[0].sha256);check('gui.resolve.shared-cli-undo-redo');
 const port=session.server.address().port;await session.close();session=await startServer({projectPath,port,quiet:true});await page.reload();await page.waitForFunction(()=>!document.querySelector('#undo').disabled);await cli('history.undo',{});assert.equal((await state()).project.assets[0].sha256,asset.sha256);check('gui.resolve.reopen-preserves-relink-undo');
 // Old source remains missing after undo, and a stale preview must not overwrite
 // a concurrent CLI edit. We refresh after the expected rejection.
 await open();await search('file',changedPath);await preview();await cli('project.rename',{name:'Concurrent editor'});await page.locator('#resolve-consent').check();response=await accept();assert.equal(response.status,409);assert.equal((await state()).project.name,'Concurrent editor');check('gui.resolve.stale-plan-rejected');
 await page.locator('#resolve-refresh').click();await page.waitForFunction(()=>document.querySelector('#resolve-status').textContent.includes('누락 1개'));await search('file',changedPath);await preview();await fs.writeFile(changedPath,Buffer.from(encodeWav({sampleRate:asset.sampleRate,channels:Array.from({length:asset.channels},()=>new Float32Array(asset.frames).fill(.2))})));await page.locator('#resolve-consent').check();response=await accept();assert.equal(response.status,409);assert.equal((await state()).project.assets[0].sha256,asset.sha256);check('gui.resolve.changed-candidate-rejected');
 // Two missing sources plus multiple users; Accept attempts mapping all others.
 await page.locator('#resolve-refresh').click();await page.waitForFunction(()=>document.querySelector('#resolve-status').textContent.includes('누락 1개'));
 const extra=Buffer.from(encodeWav({sampleRate:8000,channels:[new Float32Array(800).fill(.27)]}));const current=await state();
 const imported=await fetch(session.url+`/api/import/wav?name=Other.wav&expectedRevision=${current.project.revision}`,{method:'POST',headers:{'Content-Type':'audio/wav'},body:extra});assert.ok(imported.ok);const importedResult=await imported.json();await waitRevision(importedResult.projectRevision);
 const extraAsset=(await state()).project.assets.find(a=>a.sha256!==asset.sha256),extraPath=path.join(directory,extraAsset.path);await fs.writeFile(path.join(nested,'Other.wav'),extra);await fs.rm(extraPath);
 await page.locator('#resolve-refresh').click();await page.waitForFunction(()=>document.querySelector('#resolve-status').textContent.includes('누락 2개'));await page.locator('#resolve-asset').selectOption(asset.id);await search('file',originalPath);plan=await preview();assert.equal(plan.rows.length,2);assert.ok(plan.rows.some(r=>r.automatic));
 await page.screenshot({path:path.join(root,'docs/screenshots/v78-media-resolution.png'),fullPage:true});response=await accept();assert.equal(response.status,200);assert.deepEqual(await fs.readFile(extraPath),extra);check('gui.resolve.accept-automaps-other-missing-source');
 // Search Stop is exercised on a real asynchronous walk, without artificial delay.
 await fs.rm(assetPath);await page.locator('#resolve-refresh').click();await page.waitForFunction(()=>document.querySelector('#resolve-status').textContent.includes('누락 1개'));
 const large=path.join(directory,'search-many');await fs.mkdir(large);await Promise.all(Array.from({length:700},(_,i)=>fs.writeFile(path.join(large,`candidate-${i}.wav`),extra)));
 await page.locator('#resolve-mode').selectOption('search');await page.locator('#resolve-location').fill(large);response=await action(()=>page.locator('#resolve-start').click(),'/api/media/search');const searchId=response.body.id;
 await page.locator('#resolve-stop').click();await page.waitForFunction(()=>document.querySelector('#resolve-status').textContent.includes('검색 중지'));
 const stopped=await(await fetch(session.url+`/api/media/search/${searchId}`)).json();assert.equal(stopped.status,'stopped');assert.equal(stopped.truncated,false);check('gui.resolve.stop-search-without-project-edit');
 // Removal only removes genuine missing entries, never a changed-but-present file.
 await fs.writeFile(extraPath,'damaged retained bytes');await page.locator('#resolve-refresh').click();await page.waitForFunction(()=>document.querySelector('#resolve-status').textContent.includes('내용 변경 1개'));
 response=await action(()=>page.locator('#resolve-remove').click(),'/api/media/remove-missing');assert.equal(response.status,200);assert.equal((await state()).project.assets.length,2);assert.match(await page.locator('#resolve-plan').textContent(),/Pool 원본 1개/);check('gui.resolve.remove-missing-impact-preview');
 response=await action(()=>page.locator('#resolve-accept').click(),'/api/media/remove-missing');assert.equal(response.status,200);await waitRevision(response.body.projectRevision);assert.equal((await state()).project.assets.length,1);assert.equal(await fs.readFile(extraPath,'utf8'),'damaged retained bytes');await close();await cli('history.undo',{});assert.equal((await state()).project.assets.length,2);check('gui.resolve.remove-all-missing-keeps-disk-and-undo');
 assert.deepEqual(errors,[]);
 const paths=['public/app.mjs','public/resolution.mjs','public/editing.mjs','public/session.mjs','public/index.html','public/styles.css','src/core/engine.mjs','src/core/schema.mjs','src/server.mjs','src/project-locations.mjs','src/folder-browser.mjs','src/storage.mjs','src/session-store.mjs','src/auto-backup.mjs','src/workspace.mjs','src/project-open.mjs','src/document-session.mjs','src/project-drafts.mjs','public/projects.mjs','src/cli.mjs','src/project-files.mjs','src/media-search.mjs','src/media-resolution.mjs','scripts/gui-resolution-smoke.mjs' ,'public/document.mjs','public/midi-events.mjs','src/core/editing.mjs','src/core/midi-events.mjs','src/demo.mjs','src/media/common.mjs','src/media/midi.mjs','src/media/render.mjs','src/media/midi-stream.mjs','src/media/midi-playback.mjs','src/core/controllers.mjs','src/media/midi-curves.mjs','src/media/midi-chase.mjs','src/media/controller-bend.mjs','src/media/midi-controllers-query.mjs','src/core/modifiers.mjs','src/media/midi-modifiers.mjs','public/midi-modifiers.mjs','src/core/merge.mjs','public/midi-merge.mjs','src/chase-settings.mjs','public/chase-settings.mjs','src/controller-settings.mjs','public/controller-settings.mjs','src/media/controller-readout.mjs','public/controller-lanes.mjs','src/media/time.mjs','src/media/wav.mjs','src/project-save.mjs','src/recent-projects.mjs','src/render-worker.mjs','src/revert-media.mjs'];
 for(const file of ['public/native-midi.mjs', 'src/native-midi-settings.mjs', 'src/native-transport.mjs', 'native/macos/client.mjs', 'native/macos/project-plan.mjs', 'native/macos/midi-bridge.swift', 'scripts/build-native-midi.mjs','src/reset-settings.mjs','public/reset-settings.mjs','native/macos/reset-policy.mjs','src/media/midi-display-time.mjs','src/media/midi-length-adjustment.mjs','src/timing-settings.mjs','public/timing-settings.mjs','src/media/musical-time.mjs','public/musical-time-display.mjs','src/media/display-time-edit.mjs','public/inspector-time.mjs','src/media/elapsed-time.mjs','src/media/timecode.mjs','src/media/timeline-projection.mjs','src/media/time-display.mjs','public/time-display-settings.mjs','src/media/editor-geometry.mjs','src/media/ruler-intervals.mjs'])if(!paths.includes(file))paths.push(file);
 for(const file of ['src/media/note-paint.mjs','src/media/note-shapes.mjs','src/media/exact-tempo.mjs','src/media/time-edit-resolver.mjs','src/media/formatted-time-command.mjs','src/core/controller-paint.mjs','src/media/controller-shape-gesture.mjs','src/media/controller-shapes.mjs','src/media/controller-paint.mjs','src/media/controller-time-gesture.mjs','src/media/pointer-time-grid.mjs','src/media/snap-grid.mjs','public/snap-grid-settings.mjs'])if(!paths.includes(file))paths.push(file);
 const sourceHashes=Object.fromEntries(await Promise.all(paths.map(async f=>[f,createHash('sha256').update(await fs.readFile(path.join(root,f))).digest('hex')])));
 const receipt={status:'passed',executedAt:new Date().toISOString(),command:'NEWDAW_PLAYWRIGHT_MODULE=<installed playwright> node scripts/gui-resolution-smoke.mjs',tests:checks,pageErrors:errors,sourceHashes};
 await fs.mkdir(path.join(root,'.test-output'),{recursive:true});await fs.writeFile(path.join(root,'.test-output/gui-resolution.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt,null,2));
}finally{await browser.close();await session.close();await fs.rm(directory,{recursive:true,force:true});}
