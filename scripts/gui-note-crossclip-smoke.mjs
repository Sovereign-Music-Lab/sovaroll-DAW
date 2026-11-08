import {saveProject} from '../src/storage.mjs';
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
let failSave=false;const start=()=>startServer({projectPath,port:0,demo:false,quiet:true,persistProject:async(f,p)=>{if(failSave)throw Error('Cut save failure');return saveProject(f,p);}});let session=await start();
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
 await cmd('track.add',{id:'t',type:'midi'});for(const [id,pitch,velocity] of [['c',60,70],['dest',80,90]])await cmd('clip.add',{id,trackId:'t',type:'midi',startTick:0,lengthTicks:3840,notes:[{id:id+'-note',pitch,velocity,startTick:480,durationTicks:960}]});await page.goto(session.url);await ready();await page.locator('#clip-select').selectOption('c');await chooseLane();await page.keyboard.down('Alt');await click(480,70);await page.keyboard.up('Alt');await field('copy-time-notes').click();const sourceBefore=await clip();
 await page.locator('#clip-select').selectOption('dest');await ready();await chooseLane();await page.keyboard.down('Alt');await click(480,90);await page.keyboard.up('Alt');const before=await state(),disk=await fs.readFile(projectPath);failSave=true;const rejected=page.waitForResponse(r=>r.url().endsWith('/api/command')&&r.request().postDataJSON()?.command==='midi.notes.remove');await field('cut-time-notes').click();assert.equal((await rejected).status(),500);await ready();failSave=false;assert.deepEqual((await state()).project,before.project);assert.deepEqual(await fs.readFile(projectPath),disk);check('gui.note-cut-save-failure-preserves-project-and-file');
 const rev=(await state()).project.revision;await field('paste-notes').click();await settled(rev);const after=await state(),dest=after.project.clips.find(c=>c.id==='dest');assert.equal(dest.notes.length,2);assert.ok(dest.notes.some(n=>n.pitch===60&&n.velocity===70));assert.deepEqual(after.project.clips.find(c=>c.id==='c'),sourceBefore);assert.deepEqual(dest.notes.find(n=>n.id==='dest-note'),before.project.clips.find(c=>c.id==='dest').notes[0]);check('gui.note-cross-clip-paste-uses-previous-clipboard-after-failed-Cut');
 await undo();assert.deepEqual((await state()).project.clips,before.project.clips);check('gui.note-cross-clip-paste-one-Undo');assert.deepEqual(pageErrors,[]);await fs.writeFile(path.join(root,'.test-output/v61-cut-crossclip.json'),JSON.stringify({tests,pageErrors},null,2));console.log(JSON.stringify({tests:tests.length,pageErrors}));
}finally{await browser.close();await session.close();await fs.rm(dir,{recursive:true,force:true});}
