// Real Chrome, shared CLI/HTTP commands and isolated files; no user project fixtures.
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { startServer } from '../src/server.mjs';
const {chromium}=await import(process.env.NEWDAW_PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),exec=promisify(execFile),hash=b=>createHash('sha256').update(b).digest('hex');
const dir=await fs.mkdtemp('/private/tmp/newdaw-midi-events-gui-'),projectPath=path.join(dir,'Events.newdaw.json');
let session=await startServer({projectPath,port:0,demo:false,quiet:true});
const browser=await chromium.launch({headless:true,channel:'chrome'}),page=await browser.newPage({viewport:{width:1512,height:1180}}),tests=[],pageErrors=[];
page.setDefaultTimeout(25000);page.on('pageerror',e=>pageErrors.push(e.message));
const get=async()=>{const r=await fetch(session.url+'/api/state');assert.equal(r.status,200);return r.json();};
const cli=async(...args)=>JSON.parse((await exec(process.execPath,['src/cli.mjs',...args,'--url',session.url],{cwd:root,timeout:25000})).stdout);
const cmd=(name,args={})=>cli('command',name,JSON.stringify(args));
const check=id=>{tests.push(id);console.log('PASS '+id);};
const clip=async()=>(await get()).project.clips.find(c=>c.id==='clip-midi');
const open=async()=>{await page.locator('#midi-events-button').click();await page.locator('#midi-events-dialog').waitFor({state:'visible'});await page.waitForFunction(()=>!document.querySelector('#midi-events-apply').disabled);};
const select=async id=>page.locator(`[data-midi-event-id="${id}"]`).click();
const field=name=>page.locator(`#midi-events-fields [name="${name}"]`);
const apply=async()=>{const expected=(await get()).project.revision+1;await page.locator('#midi-events-apply').click();await page.waitForFunction(revision=>document.querySelector('#midi-events-context').textContent.includes(`REV ${revision}`),expected);await page.waitForFunction(()=>!document.querySelector('#midi-events-apply').disabled);};
const reset=async type=>{await page.locator('#midi-events-new-type').selectOption(type);await page.locator('#midi-events-new').click();};
const close=()=>page.locator('#midi-events-close').click();
try{
 const timing=await cli('timing-settings');await cli('timing-settings',JSON.stringify({expectedRevision:timing.settings.revision,expectedFingerprint:timing.fingerprint,options:{displayPpq:960}}));
 await cmd('batch',{commands:[{command:'track.add',arguments:{id:'midi-track',type:'midi',name:'Event source'}},{command:'clip.add',arguments:{id:'clip-midi',trackId:'midi-track',type:'midi',name:'Controllers and notes',lengthTicks:3840,notes:[{id:'note-one',pitch:60,velocity:90,channel:2,startTick:120,durationTicks:480,releaseVelocity:45,noteOffEncoding:'noteOff',onOrder:3,offOrder:8}],events:[{id:'cc-one',tick:0,order:0,kind:'channel',status:0xb2,data:[64,127]},{id:'bend-one',tick:120,order:2,kind:'channel',status:0xe2,data:[1,64]},{id:'off-one',tick:600,order:9,kind:'channel',status:0xb2,data:[64,0]}]}}]});
 await page.goto(session.url);await page.waitForFunction(()=>document.querySelector('#midi-events-dialog')&&!document.querySelector('#midi-events-button').disabled);await open();
 assert.equal(await page.locator('#midi-events-rows tr').count(),4);assert.match(await page.locator('#midi-events-rows').innerText(),/release 45/);assert.match(await page.locator('#midi-events-dialog').innerText(),/소리에 반영하지 않습니다/);
 check('gui.midi-events.actual-list-includes-notes-controllers-and-render-limit');

 await select('cc-one');await field('value').fill('80');await field('channel').fill('4');await field('tick').fill('30');await apply();let event=(await clip()).events.find(e=>e.id==='cc-one');assert.equal(event.status,0xb3);assert.deepEqual(event.data,[64,80]);assert.equal(event.tick,30);assert.equal(event.order,0);
 check('gui.midi-events.controller-edit-keeps-type-and-updates-channel-tick-value');

 await select('bend-one');await field('value').fill('16383');await apply();assert.deepEqual((await clip()).events.find(e=>e.id==='bend-one').data,[127,127]);assert.match(await page.locator('#midi-events-rows').innerText(),/16383 \(\+8191\)/);
 check('gui.midi-events.pitchbend-preserves-full-14-bit-range');

 await select('note-one');await field('releaseVelocity').fill('103');await field('channel').fill('5');await apply();let note=(await clip()).notes[0];assert.equal(note.releaseVelocity,103);assert.equal(note.channel,4);assert.equal(note.onOrder,3);assert.equal(note.offOrder,8);
 check('gui.midi-events.note-release-and-channel-edit-preserve-source-order');
 await field('noteOffEncoding').selectOption('zeroVelocityNoteOn');await page.locator('#midi-events-apply').click();assert.match(await page.locator('#midi-events-status').innerText(),/0이어야/);assert.equal((await clip()).notes[0].releaseVelocity,103);await field('releaseVelocity').fill('0');await apply();assert.equal((await clip()).notes[0].noteOffEncoding,'zeroVelocityNoteOn');
 check('gui.midi-events.zero-velocity-noteoff-refuses-nonzero-release');

 for(const [type,values,expected]of [['program',{channel:'7',value:'126'},[0xc6,[126]]],['channelPressure',{channel:'8',value:'76'},[0xd7,[76]]],['poly',{channel:'9',pitch:'61',value:'100'},[0xa8,[61,100]]]]){
  await reset(type);for(const[k,v]of Object.entries(values))await field(k).fill(v);await field('tick').fill('240');await apply();assert.ok((await clip()).events.some(e=>e.status===expected[0]&&JSON.stringify(e.data)===JSON.stringify(expected[1])));
 }
 check('gui.midi-events-add-program-channel-and-poly-pressure');

 await reset('sysex');await field('frame').selectOption('247');await field('payload').fill('7D 01 FF 00');await field('tick').fill('300');await apply();event=(await clip()).events.find(e=>e.kind==='sysex');assert.equal(event.status,247);assert.deepEqual(event.data,[125,1,255,0]);await select(event.id);assert.equal(await field('frame').isEnabled(),false);await field('payload').fill('7D 02 F7');await apply();assert.deepEqual((await clip()).events.find(e=>e.id===event.id).data,[125,2,247]);
 check('gui.midi-events-sysex-f7-payload-byte-edit-keeps-frame');
 const beforeInvalid=(await get()).project;await field('payload').fill('7D GG');await page.locator('#midi-events-apply').click();assert.match(await page.locator('#midi-events-status').innerText(),/16진수/);assert.deepEqual((await get()).project,beforeInvalid);
 check('gui.midi-events-invalid-hex-keeps-project-unchanged');

 await reset('meta');await field('metaType').fill('1');await field('payload').fill('FF 80 00');await apply();event=(await clip()).events.find(e=>e.kind==='meta');assert.equal(event.metaType,1);assert.deepEqual(event.data,[255,128,0]);await select(event.id);assert.equal(await field('metaType').isEnabled(),false);
 check('gui.midi-events-opaque-meta-bytes-and-immutable-type');

 await page.locator('#midi-events-filter').selectOption('cc');assert.equal(await page.locator('#midi-events-rows [data-midi-event-id]').count(),2);await page.locator('#midi-events-channel-filter').selectOption({value:'3'});assert.equal(await page.locator('#midi-events-rows [data-midi-event-id]').count(),1);assert.equal(await page.locator('#midi-events-rows [data-midi-event-id]').getAttribute('data-midi-event-id'),'cc-one');await page.locator('#midi-events-filter').selectOption('all');await page.locator('#midi-events-channel-filter').selectOption('none');assert.equal(await page.locator('#midi-events-rows [data-midi-event-id]').count(),2);await page.locator('#midi-events-channel-filter').selectOption('all');
 check('gui.midi-events-type-and-channel-filters-use-stored-events');

 await select('cc-one');await field('value').fill('77');await cmd('midi.events.update',{clipId:'clip-midi',eventId:'cc-one',data:[64,66]});await page.waitForFunction(()=>document.querySelector('#midi-events-status').textContent.includes('다른 편집'));assert.equal(await field('value').inputValue(),'77');assert.equal(await page.locator('#midi-events-apply').isEnabled(),false);await page.locator('#midi-events-refresh').click();await page.waitForFunction(()=>!document.querySelector('#midi-events-apply').disabled);assert.equal(await field('value').inputValue(),'66');assert.equal(await page.locator('#midi-events-apply').isEnabled(),true);
 check('gui.midi-events-cli-sse-stale-edit-preserves-input-until-refresh');

 const removed=(await clip()).events.find(e=>e.kind==='sysex');await select(removed.id);const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/command'&&r.request().method()==='POST');await page.locator('#midi-events-delete').click();assert.equal((await response).status(),200);await page.waitForFunction(()=>!document.querySelector('#midi-events-apply').disabled);assert.ok(!(await clip()).events.some(e=>e.id===removed.id));await close();await page.locator('#undo').click();await page.waitForFunction(()=>!document.querySelector('#undo').disabled);assert.ok((await clip()).events.some(e=>e.id===removed.id));await open();assert.ok(await page.locator(`[data-midi-event-id="${removed.id}"]`).count());
 check('gui.midi-events-delete-and-main-undo-restore-original-event-id-bytes');

 await close();for(const format of ['0','1']){if(!await page.locator('#midi-export-dialog').evaluate(element=>element.open))await page.locator('#midi-export-open').click();await page.locator('#midi-export-format').selectOption(format);const download=page.waitForEvent('download');await page.locator('#midi-download').click();const output=await download,bytes=await fs.readFile(await output.path());assert.equal(bytes.toString('ascii',0,4),'MThd');assert.equal(bytes.readUInt16BE(8),Number(format));assert.equal(bytes.readUInt16BE(10),format==='0'?1:2);}
 check('gui.midi-events-export-menu-produces-real-smf-zero-and-one');

 await cmd('midi.events.add',{clipId:'clip-midi',events:Array.from({length:205},(_,i)=>({id:`page-event-${i}`,kind:'channel',status:0xb0,tick:1000+i,data:[1,i%128]}))});await open();assert.equal(await page.locator('#midi-events-rows [data-midi-event-id]').count(),200);assert.match(await page.locator('#midi-events-page').innerText(),/1 \/ 2/);await page.locator('#midi-events-next').click();assert.ok(await page.locator('#midi-events-rows [data-midi-event-id]').count()<200);await select('page-event-204');await field('value').fill('19');await apply();assert.equal((await clip()).events.find(e=>e.id==='page-event-204').data[1],19);
 check('gui.midi-events-paginated-row-edit-targets-correct-stable-id');

 await page.locator('#midi-events-filter').selectOption('sysex');await select(removed.id);await fs.mkdir(path.join(root,'docs/screenshots'),{recursive:true});await page.screenshot({path:path.join(root,'docs/screenshots/v78-midi-events.png'),fullPage:true});await close();
 const beforeRestart=(await get()).project;await session.close();session=await startServer({projectPath,port:0,demo:false,quiet:true});await page.goto(session.url);await page.waitForFunction(()=>document.querySelector('#midi-events-dialog')&&!document.querySelector('#midi-events-button').disabled);assert.deepEqual((await get()).project,beforeRestart);await open();assert.match(await page.locator('#midi-events-context').innerText(),/events/);
 check('gui.midi-events-restart-reopens-saved-events-with-unchanged-project');

 const other=path.join(dir,'Other.newdaw.json');await exec(process.execPath,['src/cli.mjs','init',other],{cwd:root});const plan=await cli('open-plan',other);await cli('open',plan.id??plan.planId,'--current','preserve');await page.waitForFunction(()=>!document.querySelector('#midi-events-dialog').open);assert.equal(await page.locator('#midi-events-button').isEnabled(),false);assert.equal((await get()).project.clips.length,0);
 check('gui.midi-events-document-switch-closes-stale-editor');

 assert.deepEqual(pageErrors,[]);
 const paths=[];for(const base of ['src','public'])for(const entry of await fs.readdir(path.join(root,base),{recursive:true,withFileTypes:true}))if(entry.isFile()&&/\.(mjs|html|css)$/.test(entry.name))paths.push(path.relative(root,path.join(entry.parentPath,entry.name)));paths.push('scripts/gui-midi-events-smoke.mjs');
 for(const file of ['public/native-midi.mjs', 'src/native-midi-settings.mjs', 'src/native-transport.mjs', 'native/macos/client.mjs', 'native/macos/project-plan.mjs', 'native/macos/midi-bridge.swift', 'scripts/build-native-midi.mjs','src/reset-settings.mjs','public/reset-settings.mjs','native/macos/reset-policy.mjs','src/media/midi-display-time.mjs','src/media/midi-length-adjustment.mjs','src/timing-settings.mjs','public/timing-settings.mjs','src/media/musical-time.mjs','public/musical-time-display.mjs','src/media/display-time-edit.mjs','public/inspector-time.mjs','src/media/elapsed-time.mjs','src/media/timecode.mjs','src/media/timeline-projection.mjs','src/media/time-display.mjs','public/time-display-settings.mjs','src/media/editor-geometry.mjs','src/media/ruler-intervals.mjs'])if(!paths.includes(file))paths.push(file);
 for(const file of ['src/media/note-paint.mjs','src/media/note-shapes.mjs','src/media/exact-tempo.mjs','src/media/time-edit-resolver.mjs','src/media/formatted-time-command.mjs','src/core/controller-paint.mjs','src/media/controller-shape-gesture.mjs','src/media/controller-shapes.mjs','src/media/controller-paint.mjs','src/media/controller-time-gesture.mjs','src/media/pointer-time-grid.mjs','src/media/snap-grid.mjs','public/snap-grid-settings.mjs'])if(!paths.includes(file))paths.push(file);
 const sourceHashes=Object.fromEntries(await Promise.all(paths.sort().map(async name=>[name,hash(await fs.readFile(path.join(root,name)))])));
 const receipt={status:'passed',executedAt:new Date().toISOString(),command:'NEWDAW_PLAYWRIGHT_MODULE=<installed playwright> node scripts/gui-midi-events-smoke.mjs',browser:'headless Chrome',isolatedFixture:true,tests,pageErrors,screenshots:['docs/screenshots/v78-midi-events.png'],sourceHashes};await fs.mkdir(path.join(root,'.test-output'),{recursive:true});await fs.writeFile(path.join(root,'.test-output/gui-midi-events.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt,null,2));
}catch(error){await fs.mkdir(path.join(root,'.test-output'),{recursive:true});await page.screenshot({path:path.join(root,'.test-output/gui-midi-events-failure.png'),fullPage:true}).catch(()=>{});console.error(`FAILED after ${tests.length} checks; pageErrors=${JSON.stringify(pageErrors)}:`,error);throw error;}
finally{await browser.close();await session.close();await fs.rm(dir,{recursive:true,force:true});}
