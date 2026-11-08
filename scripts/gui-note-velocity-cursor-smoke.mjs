// v14 real Chrome fidelity checks. Temporary fixtures; no user's open session.
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {startServer} from '../src/server.mjs';
const {chromium}=await import(process.env.NEWDAW_PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),exec=promisify(execFile),hash=b=>createHash('sha256').update(b).digest('hex');
const dir=await fs.mkdtemp('/private/tmp/newdaw-controller-fidelity-'),projectPath=path.join(dir,'Fidelity.newdaw.json');
let session=await startServer({projectPath,port:0,demo:false,quiet:true});
const browser=await chromium.launch({headless:true,channel:'chrome'}),page=await browser.newPage({viewport:{width:1580,height:1260}}),tests=[],pageErrors=[];
page.setDefaultTimeout(25000);page.on('pageerror',e=>{pageErrors.push(e.message);console.error('PAGEERROR '+e.stack);});
const get=async()=>{const response=await fetch(session.url+'/api/state');assert.equal(response.status,200);return response.json();};
const cli=async(...args)=>JSON.parse((await exec(process.execPath,['src/cli.mjs',...args,'--url',session.url],{cwd:root,timeout:30000,maxBuffer:8*1024*1024})).stdout);
const cmd=(command,args={})=>cli('command',command,JSON.stringify(args));
const current=async()=>(await get()).project.clips.find(c=>c.id==='fidelity-clip');
const check=id=>{tests.push(id);console.log('PASS '+id);};
const ready=async()=>page.waitForFunction(()=>document.querySelector('#controller-add')&&!document.querySelector('#controller-add').disabled);
const settled=async before=>{await page.waitForFunction(rev=>Number(document.querySelector('#revision-label').textContent.replace(/\D/g,''))>rev,before);await ready();};
let activeLane;
const lane=()=>page.locator(`[data-controller-lane="${activeLane}"]`),canvas=()=>page.locator(`[data-controller-canvas="${activeLane}"]`);
async function choose(kind,channel=0,key){await lane().locator('[data-controller-kind]').selectOption(kind);if(kind!=='sysex')await lane().locator('[data-controller-channel]').selectOption({value:String(channel)});if(kind==='cc'||kind==='polyPressure'){const field=lane().locator(kind==='cc'?'[data-controller-cc]':'[data-controller-pitch]');await field.fill(String(key??(kind==='cc'?1:60)));await field.dispatchEvent('change');}await canvas().scrollIntoViewIfNeeded();}
async function add(kind,channel=0,key){await page.locator('#controller-add').click();activeLane=await page.locator('[data-controller-lane]').last().getAttribute('data-controller-lane');await choose(kind,channel,key);return activeLane;}
async function pos(tick,value,kind='cc'){await canvas().scrollIntoViewIfNeeded();const b=await canvas().boundingBox(),zoom=Number(await page.locator('#zoom').inputValue()),scroll=await page.locator('#piano-scroll').evaluate(e=>e.scrollLeft),max=kind==='pitchBend'?16383:127;return{x:b.x+tick/960*zoom-scroll,y:b.y+12+(1-value/max)*(b.height-26)};}
async function point(tick,value,kind='cc'){const p=await pos(tick,value,kind);await page.mouse.click(p.x,p.y);}
async function stroke(a,b,{kind='cc',keys=[],releaseBeforeUp=false}={}){for(const key of keys)await page.keyboard.down(key);const x=await pos(...a,kind),y=await pos(...b,kind);await page.mouse.move(x.x,x.y);await page.mouse.down();await page.mouse.move(y.x,y.y,{steps:8});if(releaseBeforeUp)for(const key of [...keys].reverse())await page.keyboard.up(key);await page.mouse.up();if(!releaseBeforeUp)for(const key of [...keys].reverse())await page.keyboard.up(key);}
async function cursor(projectTick){await page.locator('#timeline-ruler').scrollIntoViewIfNeeded();const b=await page.locator('#timeline-ruler').boundingBox(),zoom=Number(await page.locator('#zoom').inputValue());await page.mouse.click(b.x+projectTick/960*zoom,b.y+10);}
const structure=c=>c.events.map(e=>({id:e.id,tick:e.tick,order:e.order,kind:e.kind,status:e.status,key:[10,11].includes(e.status>>4)?e.data[0]:null}));
try{
 await cmd('track.add',{id:'t',type:'midi'});await cmd('clip.add',{id:'fidelity-clip',trackId:'t',type:'midi',startTick:960,lengthTicks:1920,notes:[{id:'a',pitch:60,velocity:40,startTick:240,durationTicks:240,channel:0},{id:'b',pitch:64,velocity:90,startTick:240,durationTicks:240,channel:1,releaseVelocity:30}]});
 await page.goto(session.url);await ready();activeLane=await page.locator('[data-controller-lane]').first().getAttribute('data-controller-lane');await choose('velocity','all');
 const readout=()=>lane().locator('[data-controller-cursor]');async function seek(tick){await page.locator('#piano-ruler').scrollIntoViewIfNeeded();const r=await page.locator('#piano-ruler').boundingBox(),zoom=Number(await page.locator('#zoom').inputValue());await page.mouse.click(r.x+(tick-960)/960*zoom,r.y+5);}
 const before=(await get()).project;await seek(1300);await page.waitForFunction(()=>document.querySelector('[data-controller-cursor]').dataset.raw==='40,90');assert.equal(await readout().isVisible(),true);check('gui.velocity-cursor-offset-and-overlapping-values');
 await choose('velocity',0);assert.equal(await readout().getAttribute('data-raw'),'40');await choose('releaseVelocity',1);assert.equal(await readout().getAttribute('data-raw'),'30');check('gui.velocity-cursor-channel-and-release-switch');
 await seek(960);await page.waitForFunction(()=>document.querySelector('[data-controller-cursor]').dataset.raw==='');assert.deepEqual((await get()).project,before);check('gui.velocity-cursor-before-first-note-without-source-mutation');
 await seek(1300);const rev=(await get()).project.revision;await cmd('midi.notes.update',{clipId:'fidelity-clip',noteId:'b',releaseVelocity:65});await settled(rev);assert.equal(await readout().getAttribute('data-raw'),'65');await cmd('history.undo');await page.waitForFunction(()=>document.querySelector('[data-controller-cursor]').dataset.raw==='30');check('gui.velocity-cursor-edit-and-Undo-refresh');
 assert.deepEqual(pageErrors,[]);await fs.writeFile(path.join(root,'.test-output/v49-velocity-cursor.json'),JSON.stringify({tests,pageErrors},null,2));console.log(JSON.stringify({tests:tests.length,pageErrors}));
}finally{await browser.close();await session.close();await fs.rm(dir,{recursive:true,force:true});}
