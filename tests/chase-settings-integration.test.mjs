import {decodeWav} from '../src/media/wav.mjs';
import {parseMidi} from '../src/media/midi.mjs';
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



const profile=s=>get(s,'/api/workspace/chase-settings');
const patch=async(s,options,guard)=>{const p=guard??await profile(s),r=await fetch(s.url+'/api/workspace/chase-settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedRevision:p.settings.revision,expectedFingerprint:p.fingerprint,options})});return{status:r.status,body:await r.json()};};
async function preview(s,args={}){const state=await get(s),r=await fetch(s.url+'/api/render',{method:'POST',headers:{'Content-Type':'application/json','X-Newdaw-Document':state.session.document.id},body:JSON.stringify({expectedRevision:state.project.revision,startTick:480,...args})});if(r.status!==202)return{status:r.status,body:await r.json()};const job=await r.json();for(let i=0;i<400;i++){const done=await get(s,'/api/jobs/'+job.id);if(done.status==='completed'){const bytes=Buffer.from(await(await fetch(s.url+done.url)).arrayBuffer());return{status:200,job:done,bytes,audio:decodeWav(bytes)};}if(done.status==='failed')assert.fail(JSON.stringify(done.error));await new Promise(r=>setTimeout(r,10));}assert.fail('Preview timeout');}
const audible=r=>r.audio.channels[0].some(x=>Math.abs(x)>.001);
test('Chase profile HTTP/CLI: settings are shared persisted and independent of project bytes history and revision',async t=>{
 const s=await fixture(t);await seed(s);const before=await get(s),bytes=await fs.readFile(s.projectPath),p=await cli(s,'chase-settings');
 const result=await cli(s,'chase-settings',JSON.stringify({expectedRevision:p.settings.revision,expectedFingerprint:p.fingerprint,options:{notes:false,sysex:true}}));assert.equal(result.settings.revision,1);assert.equal((await profile(s)).settings.options.notes,false);assert.deepEqual((await get(s)).project,before.project);assert.deepEqual((await get(s)).historyView,before.historyView);assert.deepEqual(await fs.readFile(s.projectPath),bytes);await s.restart();assert.deepEqual((await profile(s)).settings,result.settings);
});
test('Chase profile HTTP: stale fingerprints wrong option types and dry run leave state unchanged',async t=>{
 const s=await fixture(t),first=await profile(s);await patch(s,{notes:false});const current=await profile(s);assert.equal((await patch(s,{sysex:true},first)).status,409);assert.equal((await patch(s,{notes:1},current)).status,422);await cli(s,'chase-settings',JSON.stringify({expectedRevision:current.settings.revision,expectedFingerprint:current.fingerprint,options:{notes:true}}),'--dry-run');assert.deepEqual(await profile(s),current);
});
test('Chase playback HTTP: saved Note setting changes decoded PCM and frozen job profile without editing the project',async t=>{
 const s=await fixture(t);await seed(s);await cmd(s,'midi.notes.update',{clipId:'c',noteId:'n',startTick:0,durationTicks:1000});const before=await get(s);const on=await preview(s);assert.equal(on.status,200);assert.equal(audible(on),true);assert.equal(on.job.stats.startSeconds,.25);const saved=(await patch(s,{notes:false})).body;const off=await preview(s);assert.equal(audible(off),false);assert.equal(off.job.chaseProfile.fingerprint,saved.fingerprint);assert.equal(off.job.chaseOptions.notes,false);assert.deepEqual((await get(s)).project,before.project);assert.deepEqual((await get(s)).historyView,before.historyView);
});
test('Chase playback HTTP: stale settings guard rejects before starting and explicit overrides preserve unspecified profile types',async t=>{
 const s=await fixture(t);await seed(s);const old=await profile(s);await patch(s,{notes:false,controllers:false});const denied=await preview(s,{expectedChaseRevision:old.settings.revision,expectedChaseFingerprint:old.fingerprint});assert.equal(denied.status,409);assert.equal(denied.body.errors[0].code,'CHASE_SETTINGS_CONFLICT');const custom=await preview(s,{chaseOptions:{notes:true}});assert.equal(custom.job.chaseOptions.notes,true);assert.equal(custom.job.chaseOptions.controllers,false);assert.equal((await preview(s,{chaseOptions:{notes:3}})).status,422);
});
test('Chase Merge HTTP/CLI: implicit options use profile snapshot while explicit Note override remains local',async t=>{
 const s=await fixture(t);await seed(s);await cmd(s,'midi.notes.update',{clipId:'c',noteId:'n',startTick:0,durationTicks:1000});await patch(s,{notes:false});const args={leftTick:480,rightTick:960,includeChase:true};let r=await cli(s,'command','midi.mergeLoop',JSON.stringify(args));assert.equal(r.changes.merge.chasedNoteCount,0);await cmd(s,'history.undo');r=await cli(s,'command','midi.mergeLoop',JSON.stringify({...args,chaseOptions:{notes:true}}));assert.equal(r.changes.merge.chasedNoteCount,1);assert.equal((await profile(s)).settings.options.notes,false);
});
test('Chase CLI render: start tick produces cropped WAV with frozen profile metadata and offline explicit options',async t=>{
 const s=await fixture(t);await seed(s);await cmd(s,'midi.notes.update',{clipId:'c',noteId:'n',startTick:0,durationTicks:1000});await patch(s,{notes:false});const out=path.join(s.dir,'located.wav');await cli(s,'render',out,'--start-tick','480','--duration','0.1');let audio=decodeWav(await fs.readFile(out));assert.equal(audio.frames,4800);assert.ok(audio.channels[0].every(n=>n===0));const meta=JSON.parse(await fs.readFile(out+'.render.json','utf8'));assert.equal(meta.stats.startTick,480);
 const offline=path.join(s.dir,'offline.wav');await cli(s,'offline-render',s.projectPath,offline,'--start-tick','480','--duration','0.1','--chase-options',JSON.stringify({notes:true}));audio=decodeWav(await fs.readFile(offline));assert.equal(audio.frames,4800);assert.ok(audio.channels[0].some(n=>Math.abs(n)>.001));
});
