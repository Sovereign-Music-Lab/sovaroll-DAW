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
async function fixture(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'newdaw-formatted-time-')),projectPath=path.join(dir,'A.newdaw.json');await saveProject(projectPath,{...createProject(),tempoMap:[{tick:0,bpm:120},{tick:3840,bpm:60}]});let s,fail=false;const start=()=>startServer({projectPath,port:0,demo:false,quiet:true,backupPollMs:60000,persistProject:async(...a)=>{if(fail)throw Error('Injected failure');return saveProject(...a);}});s=await start();const f={projectPath,get url(){return s.url;},set failSave(v){fail=v;},async restart(){await s.close();s=await start();}};t.after(async()=>{await s.close();await fs.rm(dir,{recursive:true,force:true});});await cmd(f,'track.add',{id:'t',type:'midi'});await cmd(f,'clip.add',{id:'c',trackId:'t',type:'midi',startTick:2880,lengthTicks:9600,notes:[{id:'n',startTick:1,durationTicks:959,pitch:60,velocity:90,channel:0,releaseVelocity:24},{id:'b',startTick:4000,durationTicks:100,pitch:64,velocity:80,channel:0}],events:[{id:'e',tick:10,kind:'channel',status:176,data:[11,60]}]});await cmd(f,'project.timeDisplay',{options:{primaryFormat:'seconds'}});return f;}
const get=async(s,r='/api/state')=>(await fetch(s.url+r)).json();
async function request(s,route,input,doc){const state=await get(s),r=await fetch(s.url+route,{method:'POST',headers:{'Content-Type':'application/json','X-Newdaw-Document':doc??state.session.document.id},body:JSON.stringify({expectedRevision:state.project.revision,...input})});return {status:r.status,body:await r.json()};}
const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.body));assert.notEqual(r.body.status,'error',JSON.stringify(r.body));return r.body;};
const cmd=async(s,command,args={})=>ok(await request(s,'/api/command',{command,arguments:args}));
async function edit(s,times,extra={},doc){const p=await get(s,'/api/workspace/timing-settings');return request(s,'/api/time/command',{command:'midi.notes.update',arguments:{clipId:'c',noteId:'n'},formattedTimes:times,expectedTimingRevision:p.settings.revision,expectedTimingFingerprint:p.fingerprint,...extra},doc);}
const cli=async(s,...a)=>JSON.parse((await exec(process.execPath,['src/cli.mjs',...a,'--url',s.url],{cwd:root,timeout:20000})).stdout);
const note=s=>s.project.clips[0].notes[0];
test('Formatted command HTTP CLI: atomic anchored note and controller move persists and shares Undo Redo',async t=>{
 const s=await fixture(t),before=await get(s),times={startTick:'00:00:01.000',durationTicks:'00:00:01.000'};
 const result=await cli(s,'time-command','midi.notes.update',JSON.stringify({clipId:'c',noteId:'n',pitch:62,velocity:77}),JSON.stringify(times),JSON.stringify({controllers:'extended'}));assert.equal(result.convertedCommand,'batch');assert.equal(result.project.revision,before.project.revision+1);assert.equal(note(result).startTick,1440);assert.equal(note(result).durationTicks,960);assert.equal(note(result).releaseVelocity,24);assert.equal(result.project.clips[0].events[0].tick,1449);assert.equal(result.timeConversions[1].startTick,4320);
 await s.restart();assert.deepEqual((await get(s)).project,result.project);await cmd(s,'history.undo');assert.deepEqual((await get(s)).project.clips,before.project.clips);await cmd(s,'history.redo');assert.deepEqual((await get(s)).project.clips,result.project.clips);
});
test('Formatted command rejection: inexact bad schema unsupported batch and raw collisions preserve bytes history',async t=>{
 const s=await fixture(t),before=await get(s),bytes=await fs.readFile(s.projectPath);
 for(const [times,extra]of [[{startTick:'00:00:00.001'},{}],[{startTick:'00:00:01.000'},{arguments:{clipId:'c',noteId:'n',startTick:0}}],[{}, {command:'batch'}],[{}, {timeOptions:{displayPpq:1000}}],[{}, {timeOptions:null}],[{}, {dryRun:'yes'}],[{}, {typo:true}],[{durationTicks:'-1'},{}]])assert.equal((await edit(s,times,extra)).status,422);
 assert.deepEqual((await get(s)).project,before.project);assert.deepEqual((await get(s)).historyView,before.historyView);assert.deepEqual(await fs.readFile(s.projectPath),bytes);
});
test('Formatted command guards: changed document revision profile and time format reject frozen drafts',async t=>{
 const s=await fixture(t),before=await get(s),p=await get(s,'/api/workspace/timing-settings');
 assert.equal((await edit(s,{}, {},'wrong')).status,409);assert.equal((await edit(s,{}, {expectedRevision:0})).status,409);
 await cmd(s,'project.timeDisplay',{options:{primaryFormat:'samples'}});assert.equal((await edit(s,{startTick:'00:00:01.000'},{expectedRevision:before.project.revision})).status,409);
 const r=await fetch(s.url+'/api/workspace/timing-settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedRevision:p.settings.revision,expectedFingerprint:p.fingerprint,options:{displayPpq:1000}})});assert.equal(r.status,200);assert.equal((await edit(s,{startTick:'48000'},{expectedTimingRevision:p.settings.revision,expectedTimingFingerprint:p.fingerprint})).status,409);assert.deepEqual((await get(s)).project.clips,before.project.clips);
});
test('Formatted command dry run and save failure never commit converted fields or history',async t=>{
 const s=await fixture(t),before=await get(s),bytes=await fs.readFile(s.projectPath),times={startTick:'00:00:01.000'};
 const result=await cli(s,'time-command','midi.notes.update','{"clipId":"c","noteId":"n"}',JSON.stringify(times),'--dry-run');assert.equal(result.applied,false);assert.equal(result.convertedArguments.startTick,1440);s.failSave=true;assert.equal((await edit(s,times)).status,500);assert.deepEqual((await get(s)).project,before.project);assert.deepEqual((await get(s)).historyView,before.historyView);assert.deepEqual(await fs.readFile(s.projectPath),bytes);
});
test('Formatted command value-only rounding and clip edit use one shared durable command path',async t=>{
 const s=await fixture(t),before=await get(s);let result=ok(await edit(s,{}, {arguments:{clipId:'c',noteId:'n',velocity:77}}));assert.deepEqual(note(result),{...note(before),velocity:77});
 result=ok(await edit(s,{startTick:'00:00:00.001'}, {timeOptions:{rounding:'nearest'}}));assert.equal(note(result).startTick,2);assert.equal(result.timeConversions[0].exact,false);
 result=ok(await edit(s,{startTick:'00:00:03.000',lengthTicks:'00:00:05.000'},{command:'clip.update',arguments:{clipId:'c'}}));assert.equal(result.project.clips[0].startTick,4800);assert.equal(result.project.clips[0].lengthTicks,4800);assert.equal(note(result).startTick,2);
});
