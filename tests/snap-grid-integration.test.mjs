import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {startServer} from '../src/server.mjs';
import {createProject} from '../src/core/engine.mjs';
import {saveProject} from '../src/storage.mjs';
const exec=promisify(execFile),root=path.resolve(import.meta.dirname,'..');
async function fixture(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'newdaw-snap-time-')),projectPath=path.join(dir,'A.newdaw.json');await saveProject(projectPath,{...createProject(),tempoMap:[{tick:0,bpm:120},{tick:3840,bpm:60}]});let s,fail=false;const start=()=>startServer({projectPath,port:0,demo:false,quiet:true,backupPollMs:60000,persistProject:async(...a)=>{if(fail)throw Error('Injected failure');return saveProject(...a);}});s=await start();const f={projectPath,get url(){return s.url;},set failSave(v){fail=v;},async restart(){await s.close();s=await start();}};t.after(async()=>{await s.close();await fs.rm(dir,{recursive:true,force:true});});await cmd(f,'track.add',{id:'t',type:'midi'});await cmd(f,'clip.add',{id:'c',trackId:'t',type:'midi',startTick:2880,lengthTicks:9600,notes:[{id:'n',startTick:1,durationTicks:959,pitch:60,velocity:90,channel:0,releaseVelocity:24},{id:'b',startTick:4000,durationTicks:100,pitch:64,velocity:80,channel:0}],events:[{id:'e',tick:10,kind:'channel',status:176,data:[11,60]}]});await cmd(f,'project.timeDisplay',{options:{primaryFormat:'seconds'}});return f;}
const get=async(s,r='/api/state')=>(await fetch(s.url+r)).json();
async function request(s,route,input,doc){const state=await get(s),r=await fetch(s.url+route,{method:'POST',headers:{'Content-Type':'application/json','X-Newdaw-Document':doc??state.session.document.id},body:JSON.stringify({expectedRevision:state.project.revision,...input})});return {status:r.status,body:await r.json()};}
const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.body));assert.notEqual(r.body.status,'error',JSON.stringify(r.body));return r.body;};
const cmd=async(s,command,args={})=>ok(await request(s,'/api/command',{command,arguments:args}));
async function edit(s,times,extra={},doc){const p=await get(s,'/api/workspace/timing-settings');return request(s,'/api/time/command',{command:'midi.notes.update',arguments:{clipId:'c',noteId:'n'},formattedTimes:times,expectedTimingRevision:p.settings.revision,expectedTimingFingerprint:p.fingerprint,...extra},doc);}
const cli=async(s,...a)=>JSON.parse((await exec(process.execPath,['src/cli.mjs',...a,'--url',s.url],{cwd:root,timeout:20000})).stdout);
const note=s=>s.project.clips[0].notes[0];
async function snap(s,input,extra={},doc){const p=await get(s,'/api/workspace/timing-settings');return request(s,'/api/time/snap',{expectedTimingRevision:p.settings.revision,expectedTimingFingerprint:p.fingerprint,...input,...extra},doc);}
test('Saved snap HTTP CLI: independent origins and shared query use persisted settings without writes',async t=>{
 const s=await fixture(t);await cmd(s,'clip.update',{clipId:'c',startTick:2881});await cmd(s,'project.snapGrid',{options:{piano:{mode:'time',origin:'project',seconds:'1000-ms'}}});const before=await get(s),bytes=await fs.readFile(s.projectPath);
 const q=await cli(s,'time-snap',JSON.stringify({scope:'piano',clipId:'c',localTick:{numerator:'19',denominator:'20'}}));assert.equal(q.result.tick,3840);assert.equal(q.result.localTick,959);assert.equal(q.result.inputOriginTick,2881);assert.equal(q.result.originTick,0);assert.deepEqual((await get(s)).project,before.project);assert.deepEqual((await get(s)).historyView,before.historyView);assert.deepEqual(await fs.readFile(s.projectPath),bytes);
 await s.restart();assert.equal((await cli(s,'time-snap',JSON.stringify({scope:'piano',clipId:'c',localTick:0}))).result.localTick,959);await cmd(s,'history.undo');assert.ok(!(await get(s)).project.snapGrid);await cmd(s,'history.redo');assert.equal((await get(s)).project.snapGrid.piano.origin,'project');
});
test('Saved snap query guards: project document and timing profile changes reject stale context',async t=>{
 const s=await fixture(t),old=await get(s),profile=await get(s,'/api/workspace/timing-settings'),input={scope:'piano',clipId:'c',localTick:0};assert.equal((await snap(s,input,{},'wrong')).status,409);await cmd(s,'project.snapGrid',{options:{piano:{mode:'time'}}});assert.equal((await snap(s,input,{expectedRevision:old.project.revision})).status,409);assert.equal((await snap(s,input,{expectedTimingFingerprint:'stale'})).status,409);assert.equal((await snap(s,input,{expectedTimingRevision:profile.settings.revision+1})).status,409);
});
test('Saved snap query: exact errors malformed inputs and unresolved frame-second preset never mutate',async t=>{
 const s=await fixture(t);await cmd(s,'project.snapGrid',{options:{piano:{mode:'time',seconds:'1-ms'}}});const before=await get(s),bytes=await fs.readFile(s.projectPath);
 for(const input of [{localTick:1,clipId:'c'},{localTick:-1,clipId:'c'},{localTick:0,clipId:'missing'},{localTick:0,clipId:'c',typo:true},{localTick:0,clipId:'c',rounding:'truncate'},{localTick:0,clipId:'c',cell:'yes'}])assert.equal((await snap(s,input)).status,422);
 const bad=await request(s,'/api/command',{command:'project.snapGrid',arguments:{options:{piano:{timecode:'1-second'}}}});assert.equal(bad.body.status,'error');assert.deepEqual((await get(s)).project,before.project);assert.deepEqual((await get(s)).historyView,before.historyView);assert.deepEqual(await fs.readFile(s.projectPath),bytes);
});
test('Saved snap settings: dry-run and failed persistence preserve previous project and history',async t=>{
 const s=await fixture(t),before=await get(s),bytes=await fs.readFile(s.projectPath),args={options:{piano:{mode:'time'}}};assert.equal((await cli(s,'command','project.snapGrid',JSON.stringify(args),'--dry-run')).applied,false);s.failSave=true;assert.equal((await request(s,'/api/command',{command:'project.snapGrid',arguments:args})).body.status,'error');assert.deepEqual((await get(s)).project,before.project);assert.deepEqual((await get(s)).historyView,before.historyView);assert.deepEqual(await fs.readFile(s.projectPath),bytes);
});
test('Saved snap query: primary format and piano format remain independent and cells retain exact targets',async t=>{
 const s=await fixture(t);await cmd(s,'project.timeDisplay',{options:{primaryFormat:'seconds',timelineFormat:'timecode',pianoFormat:'samples'}});await cmd(s,'project.snapGrid',{options:{primary:{mode:'time',seconds:'1000-ms'},piano:{mode:'time',samples:'1-sample',sourceRounding:'nearest'}}});const a=ok(await snap(s,{scope:'primary',localTick:1900}));assert.equal(a.format,'seconds');assert.equal(a.result.tick,1920);const b=ok(await snap(s,{clipId:'c',localTick:0,cell:true}));assert.equal(b.format,'samples');assert.equal(b.result.collapsed,true);assert.equal(b.result.durationTicks,0);assert.notDeepEqual(b.result.start.targetTick,b.result.end.targetTick);
});
