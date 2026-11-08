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


test('Chase HTTP/CLI: real CLI merges pedal-held zero pairs and selected SysEx then restart undo redo retains exact MIDI and WAV',async t=>{
 const s=await fixture(t);await seed(s);await cmd(s,'midi.notes.update',{clipId:'c',noteId:'n',startTick:0,durationTicks:100});await cmd(s,'midi.events.add',{clipId:'c',events:[{tick:0,kind:'channel',status:176,data:[64,127]},{tick:800,kind:'channel',status:176,data:[64,0]},{tick:10,kind:'sysex',status:240,data:[67,1,247]}]});
 const before=await get(s);const r=await cli(s,'command','midi.mergeLoop',JSON.stringify({leftTick:480,rightTick:960,includeChase:true,chaseOptions:{sysex:true}}));assert.equal(r.changes.merge.chasedNoteCount,1);const state=await get(s),c=state.project.clips.at(-1);assert.equal(c.notes[0].durationTicks,0);assert.ok(c.events.some(e=>e.kind==='sysex'));
 const bytes=[await midi(s,0),await midi(s,1),await wav(s)];assert.ok(parseMidi(bytes[0]).tracks.flatMap(t=>t.notes).some(n=>n.durationTicks===0));await s.restart();assert.deepEqual((await get(s)).project,state.project);assert.deepEqual([await midi(s,0),await midi(s,1),await wav(s)],bytes);
 await cmd(s,'history.undo');assert.deepEqual((await get(s)).project.clips,before.project.clips);await cmd(s,'history.redo');assert.deepEqual((await get(s)).project.clips,state.project.clips);
});
test('Chase HTTP: save failure restores original note timing history source file and exported MIDI',async t=>{
 const s=await fixture(t);await seed(s);await cmd(s,'midi.notes.update',{clipId:'c',noteId:'n',startTick:0,durationTicks:1000});const before=await get(s),file=await fs.readFile(s.projectPath),bytes=await midi(s);s.failSave=true;
 const result=await post(s,'midi.mergeLoop',{leftTick:480,rightTick:960,includeChase:true});assert.notEqual(result.status,200);s.failSave=false;assert.deepEqual((await get(s)).project,before.project);assert.deepEqual((await get(s)).historyView,before.historyView);assert.deepEqual(await fs.readFile(s.projectPath),file);assert.deepEqual(await midi(s),bytes);await s.restart();assert.deepEqual((await get(s)).project,before.project);
});
test('Instantaneous HTTP/CLI: zero length edit and explicit ordering persist and dry run stale and negative requests are atomic',async t=>{
 const s=await fixture(t);await seed(s);await cli(s,'command','midi.notes.update',JSON.stringify({clipId:'c',noteId:'n',durationTicks:0}));const before=await get(s);assert.equal(before.project.clips[0].notes[0].durationTicks,0);assert.equal(parseMidi(await midi(s)).tracks.flatMap(t=>t.notes)[0].durationTicks,0);
 await cmd(s,'midi.notes.update',{clipId:'c',noteId:'n',durationTicks:10},{dryRun:true});assert.deepEqual((await get(s)).project,before.project);
 assert.equal((await post(s,'midi.notes.update',{clipId:'c',noteId:'n',durationTicks:-1})).status,422);assert.equal((await post(s,'midi.notes.update',{clipId:'c',noteId:'n',durationTicks:10},{expectedRevision:0})).status,409);await s.restart();assert.deepEqual((await get(s)).project,before.project);
});
test('Instantaneous HTTP import: a zero pair exactly at the bar boundary extends the container without extending the note',async t=>{
 const s=await fixture(t),st=await get(s),data=Buffer.from([0x9e,0,0x90,60,90,0,0x80,60,45,0,0xff,0x2f,0]);
 const bytes=Buffer.alloc(22+data.length);bytes.write('MThd',0);bytes.writeUInt32BE(6,4);bytes.writeUInt16BE(0,8);bytes.writeUInt16BE(1,10);bytes.writeUInt16BE(960,12);bytes.write('MTrk',14);bytes.writeUInt32BE(data.length,18);data.copy(bytes,22);
 const response=await fetch(s.url+'/api/import/midi?name=Zero.mid&expectedRevision='+st.project.revision,{method:'POST',headers:{'Content-Type':'audio/midi','X-Newdaw-Document':st.session.document.id},body:bytes});assert.equal(response.status,200,JSON.stringify(await response.clone().json()));
 const c=(await get(s)).project.clips[0];assert.equal(c.notes[0].startTick,3840);assert.equal(c.notes[0].durationTicks,0);assert.ok(c.lengthTicks>3840);const parsed=parseMidi(await midi(s)).tracks.flatMap(t=>t.notes)[0];assert.equal(parsed.startTick,3840);assert.equal(parsed.durationTicks,0);assert.equal(parsed.releaseVelocity,45);
});
