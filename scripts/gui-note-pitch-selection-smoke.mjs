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
 await cmd('track.add',{id:'t',type:'midi'});await cmd('clip.add',{id:'c',trackId:'t',type:'midi',startTick:0,lengthTicks:1920,notes:[{id:'a',pitch:60,velocity:70,startTick:0,durationTicks:240},{id:'b',pitch:60,velocity:80,startTick:480,durationTicks:240}]});await page.goto(session.url);await ready();await page.locator('.midi-note[data-note-id="a"]').click();const before=await state();await page.keyboard.press('ArrowRight');assert.equal(await page.locator('.midi-note[data-note-id="b"]').evaluate(e=>e.classList.contains('selected')),true);assert.equal(await page.locator('.midi-note[data-note-id="a"]').evaluate(e=>e.classList.contains('selected')),false);check('gui.note-arrow-selects-next-without-move');await page.keyboard.press('Shift+ArrowLeft');assert.equal(await page.locator('.midi-note.selected').count(),2);assert.deepEqual((await state()).project,before.project);assert.deepEqual((await state()).historyView,before.historyView);check('gui.note-Shift-arrow-extends-selection-without-Undo');await page.locator('[data-piano-pitch="60"]').click({modifiers:['Meta']});assert.equal(await page.locator('.midi-note.selected').count(),2);check('gui.note-Cmd-keyboard-key-selects-all-exact-pitch');await page.locator('.midi-note[data-note-id="b"]').dblclick({modifiers:['Shift']});assert.equal(await page.locator('.midi-note.selected').count(),1);assert.equal(await page.locator('.midi-note[data-note-id="b"]').evaluate(e=>e.classList.contains('selected')),true);assert.deepEqual((await state()).project,before.project);check('gui.note-Shift-doubleclick-selects-following-pitch-without-edit');assert.deepEqual(pageErrors,[]);await fs.writeFile(path.join(root,'.test-output/v65-note-arrow.json'),JSON.stringify({tests,pageErrors},null,2));console.log(JSON.stringify({tests:tests.length,pageErrors}));
}finally{await browser.close();await session.close();await fs.rm(dir,{recursive:true,force:true});}
