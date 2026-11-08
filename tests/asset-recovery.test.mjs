import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createProject, Engine } from '../src/core/engine.mjs';
import { restoreAsset } from '../src/project-files.mjs';
import { encodeWav } from '../src/media/wav.mjs';
import { saveProject } from '../src/storage.mjs';
import { startServer } from '../src/server.mjs';

const exec=promisify(execFile),root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function fixture(t) {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'newdaw-repair-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const wav=Buffer.from(encodeWav({sampleRate:8000,channels:[Float32Array.from({length:800},(_,i)=>0.2*Math.sin(2*Math.PI*220*i/8000))]}));
  const sha256=hash(wav),asset={id:'asset-original',name:'Original.wav',path:`assets/${sha256}.wav`,sha256,sampleRate:8000,channels:1,frames:800};
  const engine=new Engine(createProject({name:'Repair test',sampleRate:8000}));
  const result=engine.execute({command:'batch',arguments:{commands:[
    {command:'asset.add',arguments:{asset}},
    {command:'track.add',arguments:{id:'track-original',type:'audio',name:'Source'}},
    {command:'clip.add',arguments:{id:'clip-original',trackId:'track-original',type:'audio',assetId:asset.id,startSample:0,offsetFrames:0,lengthFrames:800}}
  ]}});assert.equal(result.status,'applied',JSON.stringify(result));
  const project=engine.project,projectPath=path.join(directory,'session.newdaw.json'),filename=path.join(directory,asset.path),candidate=path.join(directory,'chosen-source.wav');
  await fs.mkdir(path.join(directory,'assets'));await fs.writeFile(filename,wav);await fs.writeFile(candidate,wav);
  await fs.writeFile(projectPath,JSON.stringify(project,null,2)+'\n');
  return {directory,projectPath,project,asset,filename,candidate,wav};
}
async function session(t,options={}) {
  const s=await fixture(t),server=await startServer({projectPath:s.projectPath,port:0,quiet:true,...options});
  t.after(()=>server.close());return {...s,...server};
}
async function state(s) {return (await fetch(s.url+'/api/state')).json();}
async function restore(s,{bytes=s.wav,id=s.asset.id,revision=s.project.revision,dryRun,headers={}}={}) {
  return fetch(`${s.url}/api/assets/${encodeURIComponent(id)}/restore?expectedRevision=${revision}${dryRun===undefined?'':`&dryRun=${dryRun}`}`,
    {method:'POST',headers:{'Content-Type':'audio/wav',...headers},body:bytes});
}
async function jsonPost(s,route,value) {
  return fetch(s.url+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
}
async function waitJob(s,id) {
  for(let i=0;i<200;i++) {
    const job=await(await fetch(s.url+`/api/jobs/${id}`)).json();
    if(job.status!=='running')return job;
    await new Promise(resolve=>setTimeout(resolve,10));
  }
  throw new Error('Render worker did not finish');
}
function parseEvent(chunk) {
  const line=new TextDecoder().decode(chunk).split('\n').find(line=>line.startsWith('data: '));
  assert.ok(line);return JSON.parse(line.slice(6));
}

test('exact source restores a missing managed file without changing source/project bytes',async t=>{
  const s=await fixture(t),before=await fs.readFile(s.projectPath);await fs.rm(s.filename);
  const result=await restoreAsset(s.directory,s.asset,s.wav);
  assert.equal(result.status,'restored');assert.equal(result.applied,true);assert.equal(result.projectChanged,false);
  assert.equal(result.plannedAction,'restore');assert.equal(result.preservedDamagedCopy,null);assert.equal(result.asset.hashValid,true);
  assert.deepEqual(await fs.readFile(s.filename),s.wav);assert.deepEqual(await fs.readFile(s.projectPath),before);
  assert.deepEqual(await fs.readFile(s.candidate),s.wav);
});

test('dry-run validates missing/changed plans without creating directories or preserved copies',async t=>{
  const s=await fixture(t);await fs.rm(path.join(s.directory,'assets'),{recursive:true});
  const before=await fs.readdir(s.directory);
  const missing=await restoreAsset(s.directory,s.asset,s.wav,{dryRun:true});
  assert.equal(missing.status,'validated');assert.equal(missing.applied,false);assert.equal(missing.asset.status,'missing');
  assert.equal(missing.candidate.verified,true);assert.deepEqual(await fs.readdir(s.directory),before);
  await restoreAsset(s.directory,s.asset,s.wav);
  await fs.writeFile(s.filename,'damaged');
  const changed=await restoreAsset(s.directory,s.asset,s.wav,{dryRun:true});
  assert.equal(changed.plannedAction,'replace-damaged');assert.equal(changed.asset.hashValid,false);
  assert.equal(await fs.readFile(s.filename,'utf8'),'damaged');await assert.rejects(fs.access(path.join(s.directory,'recovery')));
});

test('mismatched source and inconsistent metadata are rejected before any repair',async t=>{
  const s=await fixture(t),wrong=Buffer.from(s.wav);wrong[wrong.length-1]^=1;
  await fs.rm(s.filename);const before=await fs.readdir(s.directory);
  await assert.rejects(restoreAsset(s.directory,s.asset,wrong),e=>e.code==='ASSET_HASH_MISMATCH');
  await assert.rejects(restoreAsset(s.directory,{...s.asset,frames:799},s.wav),e=>e.code==='ASSET_METADATA_MISMATCH');
  assert.deepEqual(await fs.readdir(s.directory),before);await assert.rejects(fs.access(s.filename));
});

test('healthy assets are idempotent and concurrent restores only apply once',async t=>{
  const s=await fixture(t),before=await fs.stat(s.filename);
  const healthy=await restoreAsset(s.directory,s.asset,s.wav);assert.equal(healthy.status,'unchanged');assert.equal(healthy.applied,false);
  assert.equal((await fs.stat(s.filename)).ino,before.ino);assert.equal((await fs.stat(s.filename)).mtimeMs,before.mtimeMs);
  await fs.rm(s.filename);
  const results=await Promise.all(Array.from({length:3},()=>restoreAsset(s.directory,s.asset,s.wav)));
  assert.equal(results.filter(result=>result.applied).length,1);assert.equal(results.filter(result=>result.status==='unchanged').length,2);
  assert.deepEqual(await fs.readFile(s.filename),s.wav);
});

test('changed existing bytes are fully preserved before atomic replacement',async t=>{
  const s=await fixture(t),damaged=Buffer.from('damaged data that must remain recoverable');await fs.writeFile(s.filename,damaged);
  const result=await restoreAsset(s.directory,s.asset,s.wav);
  assert.equal(result.plannedAction,'replace-damaged');assert.equal(result.status,'restored');
  assert.match(result.preservedDamagedCopy.path,/^recovery\/[a-f0-9]{64}-[a-f0-9-]+\.damaged\.wav$/);
  assert.equal(result.preservedDamagedCopy.sha256,hash(damaged));assert.equal(result.preservedDamagedCopy.bytes,damaged.length);
  assert.deepEqual(await fs.readFile(path.join(s.directory,result.preservedDamagedCopy.path)),damaged);
  assert.deepEqual(await fs.readFile(s.filename),s.wav);
  const unchanged=await restoreAsset(s.directory,s.asset,s.wav);assert.equal(unchanged.status,'unchanged');
  assert.equal((await fs.readdir(path.join(s.directory,'recovery'))).length,1);
});

test('symlinked targets, stores and preservation directories are refused without following them',async t=>{
  const s=await fixture(t),external=path.join(s.directory,'outside.wav');await fs.writeFile(external,s.wav);
  await fs.rm(s.filename);await fs.symlink(external,s.filename);
  await assert.rejects(restoreAsset(s.directory,s.asset,s.wav),e=>e.code==='UNSAFE_ASSET');
  assert.equal((await fs.lstat(s.filename)).isSymbolicLink(),true);assert.deepEqual(await fs.readFile(external),s.wav);
  await fs.rm(s.filename);await fs.rmdir(path.join(s.directory,'assets'));
  const outsideStore=path.join(s.directory,'outside-store');await fs.mkdir(outsideStore);await fs.symlink(outsideStore,path.join(s.directory,'assets'));
  await assert.rejects(restoreAsset(s.directory,s.asset,s.wav),e=>e.code==='UNSAFE_ASSET');assert.deepEqual(await fs.readdir(outsideStore),[]);
  await fs.rm(path.join(s.directory,'assets'));await fs.mkdir(path.join(s.directory,'assets'));await fs.writeFile(s.filename,'damaged');
  await fs.symlink(outsideStore,path.join(s.directory,'recovery'));
  await assert.rejects(restoreAsset(s.directory,s.asset,s.wav,{dryRun:true}),e=>e.code==='UNSAFE_ASSET');
  await assert.rejects(restoreAsset(s.directory,s.asset,s.wav),e=>e.code==='UNSAFE_ASSET');
  assert.equal(await fs.readFile(s.filename,'utf8'),'damaged');assert.deepEqual(await fs.readdir(outsideStore),[]);
});

test('HTTP repair keeps project/history/lock unchanged and emits a same-project-revision media snapshot',async t=>{
  const s=await session(t),before=await state(s),projectBytes=await fs.readFile(s.projectPath),lock=await fs.readFile(`${s.projectPath}.lock`);
  assert.equal(before.mediaRevision,0);
  const stream=await fetch(s.url+'/api/events'),reader=stream.body.getReader();t.after(()=>reader.cancel());
  assert.equal(parseEvent((await reader.read()).value).mediaRevision,0);
  await fs.rm(s.filename);
  const response=await restore(s),result=await response.json();assert.equal(response.status,200);
  assert.equal(result.mediaRevision,1);assert.equal(result.projectRevision,before.project.revision);assert.equal(result.sequence,before.sequence+1);
  const event=parseEvent((await reader.read()).value);assert.equal(event.mediaRevision,1);assert.deepEqual(event.project,before.project);
  assert.deepEqual(event.history,before.history);await reader.cancel();
  const after=await state(s);assert.deepEqual(after.project,before.project);assert.deepEqual(after.history,before.history);
  assert.deepEqual(await fs.readFile(s.projectPath),projectBytes);assert.deepEqual(await fs.readFile(`${s.projectPath}.lock`),lock);
  const unchanged=await(await restore(s)).json();assert.equal(unchanged.status,'unchanged');assert.equal(unchanged.mediaRevision,1);assert.equal(unchanged.sequence,result.sequence);
  const inventory=await(await fetch(s.url+'/api/assets')).json();assert.equal(inventory.mediaRevision,1);assert.equal(inventory.assets[0].hashValid,true);
});

test('HTTP stale, wrong hash, invalid input and foreign origin cannot change media',async t=>{
  const s=await session(t);await fs.rm(s.filename);const before=await state(s);
  let response=await restore(s,{revision:s.project.revision+1});assert.equal(response.status,409);assert.equal((await response.json()).errors[0].code,'REVISION_CONFLICT');
  response=await restore(s,{bytes:Buffer.from('wrong')});assert.equal(response.status,422);assert.equal((await response.json()).errors[0].code,'ASSET_HASH_MISMATCH');
  response=await restore(s,{headers:{Origin:'https://foreign.example'}});assert.equal(response.status,403);
  response=await restore(s,{dryRun:'1'});assert.equal(response.status,400);
  response=await restore(s,{id:'unknown'});assert.equal(response.status,404);
  response=await fetch(`${s.url}/api/assets/${s.asset.id}/restore`,{method:'POST',headers:{'Content-Type':'audio/wav'},body:s.wav});assert.equal(response.status,400);
  response=await restore(s,{headers:{'Content-Type':'application/json'},bytes:Buffer.from('{"path":"/outside/file.wav"}')});assert.equal(response.status,415);
  assert.deepEqual(await state(s),before);await assert.rejects(fs.access(s.filename));
});

test('HTTP dry-run writes nothing; changed-file repair returns only a relative preservation path',async t=>{
  const s=await session(t),damaged=Buffer.from('changed bytes');await fs.writeFile(s.filename,damaged);const before=await state(s);
  let response=await restore(s,{dryRun:'true'}),result=await response.json();assert.equal(response.status,200);
  assert.equal(result.status,'validated');assert.equal(result.plannedAction,'replace-damaged');assert.equal(result.asset.hashValid,false);
  assert.deepEqual(await state(s),before);await assert.rejects(fs.access(path.join(s.directory,'recovery')));
  response=await restore(s);result=await response.json();assert.equal(response.status,200);assert.equal(result.mediaRevision,1);
  assert.ok(!path.isAbsolute(result.preservedDamagedCopy.path));assert.equal(JSON.stringify(result).includes(s.directory),false);
  assert.deepEqual(await fs.readFile(path.join(s.directory,result.preservedDamagedCopy.path)),damaged);
  const waveform=await fetch(s.url+`/api/assets/${s.asset.id}/waveform`);assert.equal(waveform.status,200);assert.ok((await waveform.json()).peaks.some(value=>value>0));
});

test('concurrent HTTP restores serialize, increment mediaRevision once and preserve one damaged copy',async t=>{
  const s=await session(t);await fs.writeFile(s.filename,'bad');
  const results=await Promise.all(Array.from({length:3},async()=>{const response=await restore(s);assert.equal(response.status,200);return response.json();}));
  assert.equal(results.filter(result=>result.applied).length,1);assert.equal(results.filter(result=>result.status==='unchanged').length,2);
  assert.ok(results.every(result=>result.mediaRevision===1));assert.equal((await fs.readdir(path.join(s.directory,'recovery'))).length,1);
  assert.equal((await state(s)).project.revision,s.project.revision);
});

test('repair revision validation happens after an earlier project edit commits in the shared queue',async t=>{
  let entered,release;const saving=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;});
  const s=await session(t,{persistProject:async(file,project)=>{entered();await gate;await saveProject(file,project);}});await fs.rm(s.filename);
  const mutation=jsonPost(s,'/api/command',{command:'project.rename',arguments:{name:'New project state'},expectedRevision:s.project.revision});
  await saving;
  const repair=restore(s);await new Promise(resolve=>setTimeout(resolve,25));await assert.rejects(fs.access(s.filename));
  release();assert.equal((await mutation).status,200);
  const rejected=await repair;assert.equal(rejected.status,409);assert.equal((await rejected.json()).errors[0].code,'REVISION_CONFLICT');
  assert.equal((await state(s)).mediaRevision,0);await assert.rejects(fs.access(s.filename));
});

test('render jobs capture mediaRevision, become stale after repair, and failed missing-media renders can retry',async t=>{
  const s=await session(t);
  const render=async()=>{const response=await jsonPost(s,'/api/render',{expectedRevision:s.project.revision,durationSeconds:0.1});assert.equal(response.status,202);return response.json();};
  const first=await waitJob(s,(await render()).jobId);assert.equal(first.status,'completed');assert.equal(first.mediaRevision,0);assert.equal(first.stale,false);
  await fs.writeFile(s.filename,'changed');assert.equal((await restore(s)).status,200);
  const old=await(await fetch(s.url+`/api/jobs/${first.jobId}`)).json();assert.equal(old.mediaRevision,0);assert.equal(old.stale,true);
  const repaired=await waitJob(s,(await render()).jobId);assert.equal(repaired.status,'completed');assert.equal(repaired.mediaRevision,1);assert.equal(repaired.stale,false);
  await fs.rm(s.filename);
  const missing=await waitJob(s,(await render()).jobId);assert.equal(missing.status,'failed');assert.equal(missing.mediaRevision,1);
  assert.equal((await(await restore(s)).json()).mediaRevision,2);
  const retry=await waitJob(s,(await render()).jobId);assert.equal(retry.status,'completed');assert.equal(retry.mediaRevision,2);assert.equal(retry.stale,false);
});

test('CLI restore uploads only selected bytes, supports dry-run and refuses symlink sources',async t=>{
  const s=await session(t);await fs.rm(s.filename);
  const command=async extra=>JSON.parse((await exec(process.execPath,['src/cli.mjs','restore-asset',s.asset.id,s.candidate,'--url',s.url,...extra],{cwd:root})).stdout);
  const dry=await command(['--dry-run']);assert.equal(dry.status,'validated');assert.equal(dry.mediaRevision,0);await assert.rejects(fs.access(s.filename));
  const restored=await command([]);assert.equal(restored.status,'restored');assert.equal(restored.projectRevision,s.project.revision);
  assert.deepEqual(await fs.readFile(s.candidate),s.wav);
  const link=path.join(s.directory,'candidate-link.wav');await fs.symlink(s.candidate,link);
  await assert.rejects(exec(process.execPath,['src/cli.mjs','restore-asset',s.asset.id,link,'--url',s.url],{cwd:root}),e=>/symbolic link/.test(e.stderr));
});
