import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {startServer} from '../src/server.mjs';
import {saveProject} from '../src/storage.mjs';
const exec=promisify(execFile),root=path.resolve(import.meta.dirname,'..');
async function fixture(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'newdaw-modifiers-http-')),projectPath=path.join(dir,'A.newdaw.json');let failSave=false,s;const start=()=>startServer({projectPath,port:0,demo:false,quiet:true,backupPollMs:60000,persistProject:async(...args)=>{if(failSave)throw new Error('Injected freeze save failure');return saveProject(...args);}});s=await start();t.after(async()=>{await s.close();await fs.rm(dir,{recursive:true,force:true});});return{dir,projectPath,get url(){return s.url;},set failSave(value){failSave=value;},async restart(){await s.close();s=await start();}};}
async function get(s,route='/api/state'){const r=await fetch(s.url+route);assert.equal(r.status,200);return r.json();}
async function post(s,command,args={},extra={}){const state=await get(s),r=await fetch(s.url+'/api/command',{method:'POST',headers:{'Content-Type':'application/json','X-Newdaw-Document':state.session.document.id},body:JSON.stringify({command,arguments:args,expectedRevision:state.project.revision,...extra})});return{status:r.status,body:await r.json()};}
const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.body.errors));assert.notEqual(r.body.status,'error');return r.body;};
const cmd=async(s,name,args={},extra={})=>ok(await post(s,name,args,extra));
const cli=async(s,...args)=>JSON.parse((await exec(process.execPath,['src/cli.mjs',...args,'--url',s.url],{cwd:root,timeout:20000})).stdout);
async function seed(s){await cmd(s,'track.add',{id:'t',type:'midi',name:'Modifiers'});await cmd(s,'clip.add',{id:'c',trackId:'t',type:'midi',name:'Original',lengthTicks:1920,notes:[{id:'n',pitch:60,velocity:90,startTick:240,durationTicks:480,channel:0,releaseVelocity:32}],events:[{id:'a',tick:0,kind:'channel',status:176,data:[11,20],curve:{type:'ramp'}},{id:'b',tick:960,kind:'channel',status:176,data:[11,100]}]});}
async function midi(s,format=1){const r=await fetch(s.url+'/api/export/midi?format='+format);assert.equal(r.status,200);return Buffer.from(await r.arrayBuffer());}
async function wav(s){const state=await get(s),r=await fetch(s.url+'/api/render',{method:'POST',headers:{'Content-Type':'application/json','X-Newdaw-Document':state.session.document.id},body:JSON.stringify({expectedRevision:state.project.revision,durationSeconds:1.2})});assert.equal(r.status,202);const job=await r.json();for(let i=0;i<400;i++){const next=await get(s,'/api/jobs/'+job.id);if(next.status==='completed'){const file=await fetch(s.url+next.url);return Buffer.from(await file.arrayBuffer());}if(next.status==='failed')assert.fail(JSON.stringify(next));await new Promise(r=>setTimeout(r,10));}assert.fail('WAV render timed out');}


test('controller bend HTTP/CLI: midpoint edits change actual MIDI WAV and persist one revision across restart undo redo',async t=>{
 const s=await fixture(t);await seed(s);const before=await get(s),oldMidi=await midi(s),oldWav=await wav(s);const result=await cli(s,'command','midi.controllers.bend',JSON.stringify({clipId:'c',eventId:'a',deltaValue:15}));assert.equal(result.applied,true);const after=await get(s);assert.equal(after.project.revision,before.project.revision+1);assert.deepEqual(after.project.clips[0].notes,before.project.clips[0].notes);assert.deepEqual(after.project.clips[0].events.map(({curve,...rest})=>rest),before.project.clips[0].events.map(({curve,...rest})=>rest));const bytes=[await midi(s,0),await midi(s,1),await wav(s)];assert.notDeepEqual(bytes[1],oldMidi);assert.notDeepEqual(bytes[2],oldWav);await s.restart();assert.deepEqual((await get(s)).project,after.project);assert.deepEqual([await midi(s,0),await midi(s,1),await wav(s)],bytes);await cmd(s,'history.undo');assert.deepEqual((await get(s)).project.clips,before.project.clips);assert.deepEqual(await wav(s),oldWav);await cmd(s,'history.redo');assert.deepEqual([await midi(s,0),await midi(s,1),await wav(s)],bytes);
});
test('controller bend HTTP/CLI: failed persist rolls back source geometry history MIDI WAV and restarted state',async t=>{
 const s=await fixture(t);await seed(s);const before=await get(s),file=await fs.readFile(s.projectPath),bytes=[await midi(s),await wav(s)];s.failSave=true;const result=await post(s,'midi.controllers.bend',{clipId:'c',eventId:'a',deltaValue:20});assert.equal(result.status,500);assert.equal(result.body.errors[0].code,'SAVE_FAILED');s.failSave=false;assert.deepEqual((await get(s)).project,before.project);assert.deepEqual((await get(s)).historyView,before.historyView);assert.deepEqual(await fs.readFile(s.projectPath),file);assert.deepEqual([await midi(s),await wav(s)],bytes);await s.restart();assert.deepEqual((await get(s)).project,before.project);assert.deepEqual((await get(s)).historyView,before.historyView);
});
test('controller bend HTTP/CLI: dry-run stale revision and malformed segment errors do not publish geometry',async t=>{
 const s=await fixture(t);await seed(s);const before=await get(s),dry=await cli(s,'command','midi.controllers.bend',JSON.stringify({clipId:'c',eventId:'a',deltaValue:20}),'--dry-run');assert.equal(dry.applied,false);assert.equal((await post(s,'midi.controllers.bend',{clipId:'c',eventId:'a',deltaValue:10},{expectedRevision:0})).status,409);const bad=await post(s,'midi.controllers.bend',{clipId:'c',eventId:'b',deltaValue:10});assert.equal(bad.status,422);assert.equal(bad.body.errors[0].code,'INVALID_CONTROLLER_SEGMENT');assert.deepEqual((await get(s)).project,before.project);assert.deepEqual((await get(s)).historyView,before.historyView);
});
test('controller bend HTTP/CLI: edited curves materialize identically through SMF0 SMF1 Freeze and Merge with actual WAV',async t=>{
 const s=await fixture(t);await seed(s);await cmd(s,'midi.controllers.bend',{clipId:'c',eventId:'a',deltaValue:15});const bytes=[await midi(s,0),await midi(s,1),await wav(s)];await cmd(s,'midi.modifiers.freeze',{trackId:'t'});assert.deepEqual([await midi(s,0),await midi(s,1),await wav(s)],bytes);await cmd(s,'history.undo');await cmd(s,'midi.mergeLoop',{leftTick:0,rightTick:1920,selectedTrackIds:['t'],eraseDestination:true});assert.deepEqual([await midi(s,0),await midi(s,1),await wav(s)],bytes);
});
