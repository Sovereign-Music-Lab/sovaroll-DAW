import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { startServer } from '../src/server.mjs';
import { encodeWav, decodeWav } from '../src/media/wav.mjs';
import { parseMidi } from '../src/media/midi.mjs';
import { saveProject } from '../src/storage.mjs';
const exec=promisify(execFile),root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
async function session(t,options={}){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'newdaw-test-')),projectPath=path.join(dir,'test.newdaw.json'),server=await startServer({projectPath,port:0,demo:false,quiet:true,...options});t.after(async()=>{await server.close();await fs.rm(dir,{recursive:true,force:true});});return {...server,dir};}
async function get(s,p='/api/state'){const r=await fetch(s.url+p);assert.equal(r.status,200);return r.json();}
async function post(s,p,data){return fetch(s.url+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});}
async function cmd(s,command,argumentsValue={},extras={}){const state=await get(s);const response=await post(s,'/api/command',{command,arguments:argumentsValue,expectedRevision:state.project.revision,...extras});return {response,value:await response.json()};}
async function seeded(s){const result=await cmd(s,'batch',{commands:[{command:'track.add',arguments:{id:'midi-1',type:'midi',name:'Test',instrument:'sine'}},{command:'clip.add',arguments:{id:'clip-1',trackId:'midi-1',type:'midi',name:'Notes',startTick:0,lengthTicks:3840,notes:[{id:'note-1',pitch:69,startTick:0,durationTicks:960,velocity:100,channel:0}]}}]});assert.equal(result.response.status,200);}
async function waitJob(s,id){let job;for(let i=0;i<200;i++){job=await get(s,`/api/jobs/${id}`);if(job.status!=='running')return job;await new Promise(r=>setTimeout(r,20));}throw new Error('Render did not finish');}

test('CLI edits, SSE snapshots, dry-run, undo, conflict and persistence share one session',async t=>{
 const s=await session(t),initial=await get(s);assert.equal(initial.project.revision,0);
 const stream=await fetch(s.url+'/api/events'),reader=stream.body.getReader();t.after(()=>reader.cancel());const first=new TextDecoder().decode((await reader.read()).value);assert.match(first,/event: snapshot/);
 const before=await fs.readFile(s.projectPath,'utf8');
 const dry=await cmd(s,'track.add',{type:'midi',name:'Dry'},{dryRun:true});assert.equal(dry.value.applied,false);assert.equal(await fs.readFile(s.projectPath,'utf8'),before);assert.equal((await get(s)).project.tracks.length,0);
 const {stdout}=await exec(process.execPath,['src/cli.mjs','command','track.add','{"id":"cli-track","type":"midi","name":"From CLI"}','--url',s.url],{cwd:root});assert.equal(JSON.parse(stdout).status,'applied');
 const event=new TextDecoder().decode((await reader.read()).value);assert.match(event,/From CLI/);assert.match(event,/"revision":1/);await reader.cancel();
 const state=await get(s);assert.equal(state.project.tracks[0].id,'cli-track');assert.equal(JSON.parse(await fs.readFile(s.projectPath,'utf8')).revision,1);
 const stale=await cmd(s,'project.rename',{name:'stale'},{expectedRevision:0});assert.equal(stale.response.status,409);assert.notEqual(stale.value.project.name,'stale');
 const undo=await cmd(s,'history.undo');assert.equal(undo.value.project.tracks.length,0);assert.equal(undo.value.project.revision,2);
 const redo=await cmd(s,'history.redo');assert.equal(redo.value.project.tracks[0].id,'cli-track');assert.equal(redo.value.project.revision,3);
 assert.equal(JSON.parse(await fs.readFile(s.projectPath,'utf8')).revision,3);
 await assert.rejects(startServer({projectPath:s.projectPath,port:0,quiet:true}),/already open/);
});

test('WAV and MIDI interchange, immutable render revision, nonzero signal, undo imported media',async t=>{
 const s=await session(t);await seeded(s);
 const sampleRate=24000,mono=new Float32Array(2400);for(let i=0;i<mono.length;i++)mono[i]=.2*Math.sin(2*Math.PI*220*i/sampleRate);
 const state=await get(s),wav=encodeWav({sampleRate,channels:[mono]});
 const imported=await fetch(`${s.url}/api/import/wav?name=fixture.wav&expectedRevision=${state.project.revision}`,{method:'POST',headers:{'Content-Type':'audio/wav'},body:wav});assert.equal(imported.status,200);const importedState=await imported.json();assert.equal(importedState.project.assets.length,1);assert.equal(importedState.project.tracks.length,2);
 const peaks=await get(s,`/api/assets/${importedState.project.assets[0].id}/waveform`);assert.ok(peaks.peaks.some(p=>p>.1));
 const midi=await fetch(s.url+'/api/export/midi');const parsed=parseMidi(new Uint8Array(await midi.arrayBuffer()));assert.equal(parsed.tracks.flatMap(t=>t.notes).length,1);assert.ok(midi.headers.get('X-NewDAW-Loss-Report'));
 const renderResponse=await post(s,'/api/render',{expectedRevision:importedState.project.revision,durationSeconds:1});assert.equal(renderResponse.status,202);const render=await renderResponse.json();
 await cmd(s,'project.rename',{name:'Edit during render'});
 const job=await waitJob(s,render.jobId);assert.equal(job.status,'completed',JSON.stringify(job));assert.equal(job.revision,importedState.project.revision);assert.equal(job.stale,true);
 const output=decodeWav(new Uint8Array(await(await fetch(s.url+job.url)).arrayBuffer()));assert.equal(output.frames,48000);assert.ok(output.channels[0].some(v=>Math.abs(v)>.01));assert.equal(job.stats.clippedSamples,0);
 await cmd(s,'history.undo');const undo=await cmd(s,'history.undo');assert.equal(undo.value.project.assets.length,0);assert.equal(undo.value.project.tracks.length,1);
});

test('invalid binary, revision omissions, unauthorized asset metadata and cross-origin requests fail without mutations',async t=>{
 const s=await session(t),initial=await get(s);
 const malformed=await fetch(`${s.url}/api/import/wav?expectedRevision=0`,{method:'POST',headers:{'Content-Type':'audio/wav'},body:Buffer.from('no audio')});assert.equal(malformed.status,422);
 const missing=await post(s,'/api/command',{command:'project.rename',arguments:{name:'wrong'}});assert.equal(missing.status,400);
 const foreign=await fetch(s.url+'/api/state',{headers:{Origin:'https://example.com'}});assert.equal(foreign.status,403);
 const form=await fetch(s.url+'/api/command',{method:'POST',headers:{'Content-Type':'text/plain'},body:'{}'});assert.equal(form.status,415);
 const asset=await cmd(s,'batch',{commands:[{command:'asset.add',arguments:{asset:{path:'../../secret'}}}]});assert.equal(asset.response.status,422);
 assert.deepEqual((await get(s)).project,initial.project);
});

test('a failed project save rolls back state and undo history',async t=>{
 const s=await session(t);await seeded(s);const before=await get(s);
 await fs.rename(s.projectPath,`${s.projectPath}.held`);await fs.mkdir(s.projectPath);
 const failed=await cmd(s,'project.rename',{name:'Unsaved'});assert.equal(failed.response.status,500);assert.equal(failed.value.errors[0].code,'SAVE_FAILED');assert.deepEqual(await get(s),before);
 await fs.rmdir(s.projectPath);await fs.rename(`${s.projectPath}.held`,s.projectPath);
 const undo=await cmd(s,'history.undo');assert.equal(undo.value.project.tracks.length,0);
});

test('render cancellation is terminal',async t=>{
 const s=await session(t);await seeded(s);const state=await get(s);
 const response=await post(s,'/api/render',{expectedRevision:state.project.revision,durationSeconds:120});const job=await response.json();const cancelled=await post(s,`/api/jobs/${job.jobId}/cancel`,{});assert.equal((await cancelled.json()).status,'cancelled');assert.equal((await get(s,`/api/jobs/${job.jobId}`)).status,'cancelled');
 const missing=await fetch(s.url+`/api/jobs/${job.jobId}/audio.wav`);assert.equal(missing.status,409);
});

test('queries and render snapshots never observe an edit before its disk commit',async t=>{
 let release,entered;const barrier=new Promise(r=>{release=r;}),saving=new Promise(r=>{entered=r;});
 const s=await session(t,{persistProject:async(file,project)=>{entered();await barrier;await saveProject(file,project);}});
 const pending=cmd(s,'project.rename',{name:'Committed later'});await saving;
 const state=await get(s);assert.equal(state.project.revision,0);assert.notEqual(state.project.name,'Committed later');
 const render=await(await post(s,'/api/render',{expectedRevision:0,durationSeconds:.1})).json();assert.equal(render.revision,0);
 release();assert.equal((await pending).value.project.revision,1);assert.equal((await get(s)).project.name,'Committed later');
});

test('changed or missing source bytes fail render instead of silently using different media',async t=>{
 const s=await session(t),wav=encodeWav({sampleRate:48000,channels:[new Float32Array(4800)]});
 const imported=await(await fetch(s.url+'/api/import/wav?expectedRevision=0&name=source.wav',{method:'POST',headers:{'Content-Type':'audio/wav'},body:wav})).json();
 await fs.writeFile(path.join(s.dir,imported.project.assets[0].path),'changed source');
 const render=await(await post(s,'/api/render',{expectedRevision:1,durationSeconds:.1})).json();const job=await waitJob(s,render.jobId);
 assert.equal(job.status,'failed');assert.match(job.error.message,/content changed/);
});
