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
import { encodeWav, decodeWav } from '../src/media/wav.mjs';
import { collectProject, recoverProject, assetInventory, createProjectBundle, readVerifiedAsset } from '../src/project-files.mjs';
import { createDirectoryAtomically } from '../src/storage.mjs';
import { startServer } from '../src/server.mjs';

const exec=promisify(execFile),root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function temporary(t) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'newdaw-files-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;
}
async function fixture(t) {
  const dir=await temporary(t),source=path.join(dir,'source');await fs.mkdir(source);
  const samples=Float32Array.from({length:800},(_,i)=>0.2*Math.sin(2*Math.PI*220*i/8000));
  const wav=Buffer.from(encodeWav({sampleRate:8000,channels:[samples]})),hash=sha(wav);
  const asset={id:'asset-source',name:'소스.wav',path:`assets/${hash}.wav`,sha256:hash,sampleRate:8000,channels:1,frames:800};
  const engine=new Engine(createProject({name:'Source session',sampleRate:8000}));
  const result=engine.execute({command:'batch',arguments:{commands:[
    {command:'asset.add',arguments:{asset}},
    {command:'track.add',arguments:{id:'track-audio',type:'audio',name:'Source'}},
    {command:'clip.add',arguments:{id:'clip-audio',trackId:'track-audio',type:'audio',name:'Audio',assetId:asset.id,startSample:0,offsetFrames:0,lengthFrames:800,gainDb:0}}
  ]}});
  assert.equal(result.status,'applied',JSON.stringify(result));
  const project=engine.project,input=path.join(source,'original.newdaw.json');
  await fs.mkdir(path.join(source,'assets'));await fs.writeFile(path.join(source,asset.path),wav);
  await fs.writeFile(input,JSON.stringify(project,null,2)+'\n');
  return {dir,source,input,project,asset,wav};
}
async function cli(...args) {return exec(process.execPath,['src/cli.mjs',...args],{cwd:root});}
function zipEntries(bytes) {
  const entries=new Map();let cursor=0;
  while(bytes.readUInt32LE(cursor)===0x04034b50) {
    assert.equal(bytes.readUInt16LE(cursor+8),0,'Stored ZIP method');
    const size=bytes.readUInt32LE(cursor+18),nameSize=bytes.readUInt16LE(cursor+26),extra=bytes.readUInt16LE(cursor+28);
    const name=bytes.subarray(cursor+30,cursor+30+nameSize).toString('utf8');
    const start=cursor+30+nameSize+extra,data=bytes.subarray(start,start+size);
    // Independent bit-at-a-time reference verifies the table-based ZIP encoder.
    let crc=0xffffffff;
    for(const byte of data){crc^=byte;for(let i=0;i<8;i++)crc=(crc&1)?(crc>>>1)^0xedb88320:crc>>>1;}
    assert.equal((crc^0xffffffff)>>>0,bytes.readUInt32LE(cursor+14),'ZIP CRC32');
    assert.ok(!name.startsWith('/')&&!name.split('/').includes('..'));
    entries.set(name,data);cursor=start+size;
  }
  assert.equal(bytes.readUInt32LE(cursor),0x02014b50,'Central directory');
  assert.equal(bytes.readUInt32LE(bytes.length-22),0x06054b50,'End of central directory');
  assert.equal(bytes.readUInt16LE(bytes.length-12),entries.size);
  assert.equal(bytes.readUInt32LE(bytes.length-6),cursor);
  return entries;
}

test('collect retains IDs/revision and source bytes, records provenance and leaves source lock alone',async t=>{
  const s=await fixture(t),destination=path.join(s.dir,'collected');
  const before=await fs.readFile(s.input),lock=`${s.input}.lock`;await fs.writeFile(lock,'active-session-lock');
  const result=await collectProject(s.input,destination);
  assert.equal(result.status,'collected');assert.equal(result.revision,s.project.revision);
  const collected=JSON.parse(await fs.readFile(result.projectFile,'utf8'));
  assert.deepEqual(collected,s.project);
  assert.deepEqual(await fs.readFile(path.join(destination,s.asset.path)),s.wav);
  assert.deepEqual(await fs.readFile(s.input),before);assert.deepEqual(await fs.readFile(path.join(s.source,s.asset.path)),s.wav);
  assert.equal(await fs.readFile(lock,'utf8'),'active-session-lock');
  const manifest=JSON.parse(await fs.readFile(path.join(destination,'manifest.json'),'utf8'));
  assert.equal(manifest.source.projectSha256,sha(before));assert.equal(manifest.project.sha256,sha(await fs.readFile(result.projectFile)));
  assert.equal(manifest.project.id,s.project.id);assert.equal(manifest.assets[0].sha256,s.asset.sha256);
  assert.deepEqual((await fs.readdir(s.dir)).sort(),['collected','source']);
});

test('CLI collect dry-run checks hashes but writes no directories, locks or sidecars',async t=>{
  const s=await fixture(t),destination=path.join(s.dir,'dry');
  const before=await fs.readdir(s.dir);
  const {stdout}=await cli('collect',s.input,destination,'--dry-run');
  assert.equal(JSON.parse(stdout).status,'validated');assert.deepEqual(await fs.readdir(s.dir),before);
  assert.equal((await fs.readdir(s.source)).some(name=>name.endsWith('.lock')),false);
  await fs.writeFile(path.join(s.source,s.asset.path),'changed');
  await assert.rejects(cli('collect',s.input,destination,'--dry-run'),e=>/ASSET_CHANGED/.test(e.stderr));
  assert.deepEqual(await fs.readdir(s.dir),before);
});

test('moved collected directory renders with original source location unavailable',async t=>{
  const s=await fixture(t),destination=path.join(s.dir,'collected');
  const {stdout}=await cli('collect',s.input,destination);const result=JSON.parse(stdout);
  const moved=path.join(s.dir,'moved');await fs.rename(destination,moved);await fs.rename(s.source,path.join(s.dir,'source-unavailable'));
  const output=path.join(s.dir,'offline.wav');
  await cli('offline-render',path.join(moved,path.basename(result.projectFile)),output,'--tail','0');
  const rendered=decodeWav(await fs.readFile(output));
  assert.equal(rendered.frames,800);assert.ok(rendered.channels[0].some(value=>Math.abs(value)>0.01));
});

test('missing/changed assets abort collection and remove staging/reservation files',async t=>{
  const s=await fixture(t),destination=path.join(s.dir,'broken');
  await fs.writeFile(path.join(s.source,s.asset.path),'modified');
  await assert.rejects(collectProject(s.input,destination),e=>e.code==='ASSET_CHANGED');
  assert.deepEqual(await fs.readdir(s.dir),['source']);
  await fs.rm(path.join(s.source,s.asset.path));
  await assert.rejects(collectProject(s.input,destination),e=>e.code==='ASSET_MISSING');
  assert.deepEqual(await fs.readdir(s.dir),['source']);
  await assert.rejects(createDirectoryAtomically(destination,async temporary=>{
    await fs.writeFile(path.join(temporary,'partial'),'partial');throw new Error('injected failure');
  }),/injected failure/);
  assert.deepEqual(await fs.readdir(s.dir),['source']);
});

test('collect never replaces existing files, directories or symlinks; concurrent collectors have one winner',async t=>{
  const s=await fixture(t),destination=path.join(s.dir,'target');await fs.mkdir(destination);
  await assert.rejects(collectProject(s.input,destination),e=>e.code==='OUTPUT_EXISTS');
  await fs.writeFile(path.join(destination,'keep'),'important');
  await assert.rejects(collectProject(s.input,destination));assert.equal(await fs.readFile(path.join(destination,'keep'),'utf8'),'important');
  const link=path.join(s.dir,'link');await fs.symlink(destination,link);
  await assert.rejects(collectProject(s.input,link),e=>e.code==='OUTPUT_EXISTS');
  const race=path.join(s.dir,'race');
  const attempts=await Promise.allSettled([collectProject(s.input,race),collectProject(s.input,race)]);
  assert.equal(attempts.filter(value=>value.status==='fulfilled').length,1);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(race,path.basename(s.input)),'utf8')),s.project);
  assert.equal((await fs.readdir(s.dir)).some(name=>name.includes('.collect-')||name.endsWith('.newdaw-collect.lock')),false);
});

test('recover validates .bak and preserves a damaged source, backup and lock',async t=>{
  const s=await fixture(t),backup=await fs.readFile(s.input);await fs.writeFile(`${s.input}.bak`,backup);
  await fs.writeFile(s.input,'damaged original');await fs.writeFile(`${s.input}.lock`,'unchanged lock');
  const output=path.join(s.source,'recovered.newdaw.json');
  const dry=JSON.parse((await cli('recover',s.input,'--output',output,'--dry-run')).stdout);
  assert.equal(dry.status,'validated');await assert.rejects(fs.access(output));
  const result=JSON.parse((await cli('recover',s.input,'--output',output)).stdout);
  assert.equal(result.status,'recovered');assert.equal(result.assetsCollected,false);
  assert.deepEqual(JSON.parse(await fs.readFile(output,'utf8')),s.project);
  assert.equal(await fs.readFile(s.input,'utf8'),'damaged original');assert.deepEqual(await fs.readFile(`${s.input}.bak`),backup);
  assert.equal(await fs.readFile(`${s.input}.lock`,'utf8'),'unchanged lock');
  assert.equal(JSON.parse(await fs.readFile(`${output}.recovery.json`,'utf8')).source.kind,'backup');
  await assert.rejects(recoverProject(s.input,{output}),e=>e.code==='OUTPUT_EXISTS');
  await assert.rejects(recoverProject(s.input,{output:s.input}),e=>e.code==='RECOVERY_SOURCE_OVERWRITE');
});

test('recovery into a new directory collects verified assets and an invalid backup writes nothing',async t=>{
  const s=await fixture(t);await fs.copyFile(s.input,`${s.input}.bak`);
  const destination=path.join(s.dir,'recovery'),output=path.join(destination,'restored.newdaw.json');
  const result=await recoverProject(s.input,{output});assert.equal(result.assetsCollected,true);
  assert.deepEqual(await fs.readFile(path.join(destination,s.asset.path)),s.wav);
  assert.deepEqual(JSON.parse(await fs.readFile(output,'utf8')),s.project);
  const existing=path.join(s.dir,'existing');await fs.mkdir(existing);
  await assert.rejects(recoverProject(s.input,{output:path.join(existing,'another.json')}),e=>e.code==='OUTPUT_EXISTS');
  await fs.writeFile(`${s.input}.bak`,'bad JSON');
  await assert.rejects(recoverProject(s.input,{output:path.join(s.dir,'invalid','out.json')}),e=>e.code==='INVALID_PROJECT_JSON');
  await assert.rejects(fs.access(path.join(s.dir,'invalid')));
});

test('asset inventory distinguishes references, changed bytes, missing files and unsafe symlinks',async t=>{
  const s=await fixture(t);
  const ready=await assetInventory(s.project,s.source);
  assert.equal(ready.projectRevision,s.project.revision);assert.equal(ready.assets[0].referenceCount,1);
  assert.deepEqual(ready.assets[0].users,[{clipId:'clip-audio',trackId:'track-audio',clipName:'Audio'}]);
  assert.equal(ready.assets[0].status,'ready');assert.equal(ready.assets[0].bytes,s.wav.length);
  await fs.writeFile(path.join(s.source,s.asset.path),'changed');
  const changed=(await assetInventory(s.project,s.source)).assets[0];assert.equal(changed.available,true);assert.equal(changed.hashValid,false);assert.equal(changed.status,'changed');
  await fs.rm(path.join(s.source,s.asset.path));
  assert.equal((await assetInventory(s.project,s.source)).assets[0].status,'missing');
  const outside=path.join(s.dir,'outside.wav');await fs.writeFile(outside,s.wav);await fs.symlink(outside,path.join(s.source,s.asset.path));
  assert.equal((await assetInventory(s.project,s.source)).assets[0].status,'unsafe');
  await assert.rejects(readVerifiedAsset(s.source,s.asset),e=>e.code==='UNSAFE_ASSET');
});

test('ZIP bundle preserves a frozen project and hashes, deduplicates shared paths and enforces total size',async t=>{
  const s=await fixture(t),snapshot=structuredClone(s.project);
  snapshot.assets.push({...s.asset,id:'second-asset',name:'Same source'});
  const original=structuredClone(snapshot),pending=createProjectBundle(snapshot,s.source);
  snapshot.name='Later edit';snapshot.revision++;
  const bundle=await pending,entries=zipEntries(bundle.bytes);
  assert.equal(entries.size,3);assert.deepEqual(JSON.parse(entries.get('session.newdaw.json')),original);
  assert.deepEqual(entries.get(s.asset.path),s.wav);
  const manifest=JSON.parse(entries.get('manifest.json'));
  assert.equal(manifest.assets.length,2);assert.equal(manifest.project.sha256,sha(entries.get('session.newdaw.json')));
  assert.equal(manifest.source.kind,'http-snapshot');assert.equal(JSON.stringify(manifest).includes(s.source),false);
  await assert.rejects(createProjectBundle(s.project,s.source,{maxBytes:1024}),e=>e.code==='BUNDLE_TOO_LARGE');
});

test('system unzip independently validates and reads the generated project bundle',async t=>{
  const s=await fixture(t),archive=path.join(s.dir,'bundle.zip');
  const bundle=await createProjectBundle(s.project,s.source);await fs.writeFile(archive,bundle.bytes);
  try {
    const checked=await exec('/usr/bin/unzip',['-t',archive]);assert.match(checked.stdout,/No errors detected/);
    const extracted=await exec('/usr/bin/unzip',['-p',archive,'session.newdaw.json']);
    assert.deepEqual(JSON.parse(extracted.stdout),s.project);
    const audio=await exec('/usr/bin/unzip',['-p',archive,s.asset.path],{encoding:'buffer'});
    assert.deepEqual(audio.stdout,s.wav);
  } catch(e) {if(e.code==='ENOENT'){t.skip('/usr/bin/unzip is not installed');return;}throw e;}
});

test('media HTTP queries/downloads enforce origin, report integrity and never mutate project or lock',async t=>{
  const s=await fixture(t),server=await startServer({projectPath:s.input,port:0,quiet:true});
  t.after(()=>server.close());
  const before=await fs.readFile(s.input),lock=await fs.readFile(`${s.input}.lock`);
  let response=await fetch(server.url+'/api/assets');assert.equal(response.status,200);
  const inventory=await response.json();assert.equal(inventory.assets[0].hashValid,true);assert.equal(inventory.projectRevision,s.project.revision);
  assert.equal(JSON.parse((await cli('assets','--url',server.url)).stdout).assets[0].hashValid,true);
  response=await fetch(server.url+`/api/assets/${s.asset.id}/file`);assert.equal(response.status,200);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()),s.wav);assert.equal(response.headers.get('X-NewDAW-SHA256'),s.asset.sha256);
  response=await fetch(server.url+'/api/project/bundle');assert.equal(response.status,200);
  const entries=zipEntries(Buffer.from(await response.arrayBuffer()));assert.deepEqual(JSON.parse(entries.get('session.newdaw.json')),s.project);
  const cliBundle=path.join(s.dir,'live.zip'),cliResult=JSON.parse((await cli('export-bundle',cliBundle,'--url',server.url)).stdout);
  assert.equal(cliResult.projectRevision,s.project.revision);
  assert.deepEqual(JSON.parse(zipEntries(await fs.readFile(cliBundle)).get('session.newdaw.json')),s.project);
  response=await fetch(server.url+'/api/project/bundle?expectedRevision=999');assert.equal(response.status,409);
  for(const route of ['/api/assets',`/api/assets/${s.asset.id}/file`,'/api/project/bundle']) {
    assert.equal((await fetch(server.url+route,{headers:{Origin:'https://outside.example'}})).status,403);
  }
  await fs.writeFile(path.join(s.source,s.asset.path),'tampered');
  assert.equal((await fetch(server.url+`/api/assets/${s.asset.id}/file`)).status,422);
  assert.equal((await fetch(server.url+'/api/project/bundle')).status,422);
  assert.equal((await(await fetch(server.url+'/api/assets')).json()).assets[0].status,'changed');
  assert.deepEqual(await fs.readFile(s.input),before);assert.deepEqual(await fs.readFile(`${s.input}.lock`),lock);
});
