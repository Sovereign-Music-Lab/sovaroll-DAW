import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {startServer} from '../src/server.mjs';
const {chromium}=await import(process.env.NEWDAW_PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(import.meta.dirname,'..'),exec=promisify(execFile),hash=b=>createHash('sha256').update(b).digest('hex');
const dir=await fs.mkdtemp('/private/tmp/newdaw-note-paint-'),projectPath=path.join(dir,'Controller.newdaw.json');
const start=()=>startServer({projectPath,port:0,demo:false,quiet:true});let session=await start();
const browser=await chromium.launch({headless:true,channel:'chrome'}),page=await browser.newPage({viewport:{width:1580,height:1660}}),tests=[],pageErrors=[];
page.setDefaultTimeout(15000);page.on('pageerror',e=>pageErrors.push(e.message));
const state=async()=>(await fetch(session.url+'/api/state')).json(),clip=async()=>(await state()).project.clips[0];
const cli=async(...args)=>JSON.parse((await exec(process.execPath,['src/cli.mjs',...args,'--url',session.url],{cwd:root,timeout:25000})).stdout),cmd=(c,a={})=>cli('command',c,JSON.stringify(a));
const ready=()=>page.waitForFunction(()=>document.querySelector('#controller-add')&&!document.querySelector('#controller-add').disabled);
const settled=async rev=>{await page.waitForFunction(r=>Number(document.querySelector('#revision-label').textContent.replace(/\D/g,''))>r,rev);await ready();};
const undo=async()=>{const rev=(await state()).project.revision;await cmd('history.undo');await settled(rev);};
const check=id=>{tests.push(id);console.log('PASS '+id);};
let laneId,laneKind='velocity';const canvas=()=>page.locator(`[data-controller-canvas="${laneId}"]`),field=id=>page.locator('#controller-'+id);
async function position(tick,value){await canvas().scrollIntoViewIfNeeded();const box=await canvas().boundingBox(),p=(await state()).project,zoom=Number(await page.locator('#zoom').inputValue()),scroll=await page.locator('#piano-scroll').evaluate(e=>e.scrollLeft);const local=p.timeDisplay?.pianoMode==='time-linear'?(tick<=960?tick/1920:.5+(tick-960)/960)*zoom*2:tick/960*zoom;return {x:box.x+local-scroll,y:box.y+12+(1-(value-(laneKind==='velocity'?1:0))/(laneKind==='velocity'?126:127))*(box.height-26)};}
async function click(tick,value){const p=await position(tick,value);await page.mouse.click(p.x,p.y);}
async function drag(from,to){const a=await position(...from),b=await position(...to);await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:8});await page.mouse.up();}
async function setting(options){const rev=(await state()).project.revision;await cmd('project.snapGrid',{options:{piano:options}});await settled(rev);}
const events=async()=>(await clip()).events.filter(e=>e.status===176&&e.data[0]===11);


const requests=[];page.on('request',r=>{if(r.url().endsWith('/api/command')){const q=r.postDataJSON();if(q?.command==='midi.notes.paint')requests.push(q);}});const last=()=>requests.at(-1).arguments;
async function chooseLane(kind='velocity',channel='all'){laneKind=kind;laneId=await page.locator('[data-controller-lane]').first().getAttribute('data-controller-lane');const l=page.locator(`[data-controller-lane="${laneId}"]`);await l.locator('[data-controller-kind]').selectOption(kind);await l.locator('[data-controller-channel]').selectOption(String(channel));}
async function clearSelection(){await field('tool').selectOption('select');await page.keyboard.down('Alt');await click(3000,60);await page.keyboard.up('Alt');}
async function begin(from=[480,20],to){await field('tool').selectOption('select');const a=await position(...from);await page.mouse.move(a.x,a.y);await page.mouse.down();if(to)await move(...to);}
async function move(tick,value){const p=await position(tick,value);await page.mouse.move(p.x,p.y,{steps:4});}
const near=(n,x,t=1)=>assert.ok(Math.abs(n-x)<=t,`${n} expected ${x} ±${t}`),musical=()=>cmd('project.snapGrid',{options:{piano:{mode:'musical'}}});
try{
 await page.addInitScript(()=>{window.auditionAudio={starts:0,stops:0,revisions:[]};const start=AudioBufferSourceNode.prototype.start,stop=AudioBufferSourceNode.prototype.stop;AudioBufferSourceNode.prototype.start=function(...a){window.auditionAudio.starts++;window.auditionAudio.revisions.push(Number(document.querySelector('#revision-label')?.textContent.replace(/\D/g,'')));return start.apply(this,a);};AudioBufferSourceNode.prototype.stop=function(...a){window.auditionAudio.stops++;return stop.apply(this,a);};});
 const requests=[];page.on('request',r=>{if(r.url().endsWith('/api/midi/audition'))requests.push(r.postDataJSON());});
 await cmd('track.add',{id:'t',type:'midi'});await cmd('clip.add',{id:'c',trackId:'t',type:'midi',startTick:0,lengthTicks:9600,notes:[{id:'n',pitch:60,velocity:70,startTick:480,durationTicks:960}]});
 await page.goto(session.url);await ready();await chooseLane();assert.equal(await field('acoustic-feedback').isChecked(),false);
 let rev=(await state()).project.revision;await click(480,40);await settled(rev);await page.waitForTimeout(200);assert.equal(requests.length,0);check('audition-default-off');
 await field('acoustic-feedback').check();rev=(await state()).project.revision;await click(480,100);await settled(rev);await page.waitForFunction(()=>window.auditionAudio.starts>0);assert.equal(requests.at(-1).expectedRevision,(await state()).project.revision);assert.equal(requests.at(-1).updates[0].noteId,'n');check('audition-click-commits-then-plays-real-WebAudio');
 await page.waitForTimeout(450);const before=await state(),count=await page.evaluate(()=>window.auditionAudio.starts);await begin([480,30]);await page.waitForFunction(n=>window.auditionAudio.starts>n,count);await page.keyboard.press('Escape');await page.mouse.up();assert.deepEqual((await state()).project,before.project);assert.deepEqual((await state()).historyView,before.historyView);check('audition-drag-preview-and-Escape-preserve-source-history');
 await field('acoustic-feedback').uncheck();const n=requests.length;rev=(await state()).project.revision;await click(480,60);await settled(rev);await page.waitForTimeout(250);assert.equal(requests.length,n);check('audition-toggle-off-suppresses-requests');
 await field('acoustic-feedback').check();
 const unchanged=await state(),unchangedStarts=await page.evaluate(()=>window.auditionAudio.starts);await click(480,unchanged.project.clips[0].notes[0].velocity);await page.waitForFunction(n=>window.auditionAudio.starts>n,unchangedStarts);assert.deepEqual((await state()).project,unchanged.project);assert.deepEqual((await state()).historyView,unchanged.historyView);check('audition-unchanged-click-without-Undo');
 rev=(await state()).project.revision;await cmd('midi.notes.add',{clipId:'c',notes:[{id:'chord1',pitch:64,velocity:70,startTick:960,durationTicks:960},{id:'chord2',pitch:67,velocity:70,startTick:960,durationTicks:960}]});await settled(rev);
 for(const tool of ['line','parabola','sine','triangle','square']){
  await field('tool').selectOption(tool);await field('snap').uncheck();const before=await state(),a=await position(480,20),b=await position(960,110),heard=await page.evaluate(()=>window.auditionAudio.starts),requestCount=requests.length;
  await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:5});await page.waitForFunction(n=>window.auditionAudio.starts>n,heard);assert.ok(requests.length>requestCount);assert.deepEqual(requests.at(-1).updates.map(u=>u.noteId).sort(),['chord1','chord2']);await page.keyboard.press('Escape');await page.mouse.up();assert.deepEqual((await state()).project,before.project);assert.deepEqual((await state()).historyView,before.historyView);check('audition-'+tool+'-nearest-chord-preview-cancel');
 }
 await field('tool').selectOption('line');rev=(await state()).project.revision;const heard=await page.evaluate(()=>window.auditionAudio.starts);await drag([480,20],[960,110]);await settled(rev);const committedRevision=(await state()).project.revision;await page.waitForFunction(r=>window.auditionAudio.revisions.includes(r),committedRevision);assert.equal(requests.at(-1).expectedRevision,committedRevision);check('audition-line-commit-plays-new-revision');
 assert.deepEqual(pageErrors,[]);await page.screenshot({path:path.join(root,'docs/screenshots/v78-note-audition.png')});await fs.writeFile(path.join(root,'.test-output/v42-gui-note-audition.json'),JSON.stringify({tests,pageErrors,requests,webAudio:await page.evaluate(()=>window.auditionAudio),note:'Real WebAudio start/stop observed; no human listening claim'},null,2));console.log(JSON.stringify({tests:tests.length,pageErrors}));
}finally{await browser.close();await session.close();await fs.rm(dir,{recursive:true,force:true});}
