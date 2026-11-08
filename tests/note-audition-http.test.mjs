import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {createProject} from '../src/core/engine.mjs';
import {startServer} from '../src/server.mjs';
import {saveProject} from '../src/storage.mjs';
import {decodeWav} from '../src/media/wav.mjs';

const exec=promisify(execFile),root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
async function fixture(t,options={}) {
 const directory=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'newdaw-lanes-http-'))),projectPath=path.join(directory,'Controllers.json');
 await fs.writeFile(projectPath,JSON.stringify(createProject({name:'Controller command integration',sampleRate:8000}),null,2)+'\n');let server;
 const open=()=>startServer({projectPath,recentPath:path.join(directory,'recent.json'),port:0,demo:false,quiet:true,backupPollMs:60000,...options});
 t.after(async()=>{await server?.close();await fs.rm(directory,{recursive:true,force:true});});server=await open();
 return {directory,projectPath,get url(){return server.url;},async reopen(){await server.close();server=await open();}};
}
async function get(s,route='/api/state'){const r=await fetch(s.url+route);assert.equal(r.status,200,await r.clone().text());return r.json();}
async function post(s,route,body,documentId){documentId??=(await get(s)).session.document.id;const r=await fetch(s.url+route,{method:'POST',headers:{'Content-Type':'application/json','X-Newdaw-Document':documentId},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};}
function ok(r,status=200){assert.equal(r.status,status,JSON.stringify({status:r.body.status,errors:r.body.errors}));return r.body;}
function rejected(r,status){if(status)assert.equal(r.status,status,JSON.stringify(r.body.errors));else assert.ok([409,422].includes(r.status),JSON.stringify(r.body.errors));assert.equal(r.body.applied,false);return r.body;}
async function command(s,name,args={},extra={},documentId){const st=await get(s);return post(s,'/api/command',{command:name,arguments:args,expectedRevision:st.project.revision,...extra},documentId);}
async function cli(s,...args){return JSON.parse((await exec(process.execPath,['src/cli.mjs',...args,'--url',s.url],{cwd:root,timeout:20000})).stdout);}
async function seed(s,{events=[],notes=[{id:'note',startTick:0,durationTicks:1920,pitch:69,velocity:100,channel:0}],lengthTicks=2880}={}){
 ok(await command(s,'batch',{commands:[{command:'track.add',arguments:{id:'track',type:'midi',name:'Controller synth',instrument:'sine'}},{command:'clip.add',arguments:{id:'clip',trackId:'track',type:'midi',startTick:0,lengthTicks,notes,events:events.map((event,index)=>({order:index,...event}))}}]}));
}

test('Audition HTTP produces bounded stereo WAV without modifying project disk or history',async t=>{
 const s=await fixture(t);
 ok(await command(s,'track.add',{id:'t',type:'midi',instrument:'sine'}));
 ok(await command(s,'clip.add',{id:'c',type:'midi',trackId:'t',startTick:1200000,lengthTicks:1920,notes:[{id:'n',startTick:0,durationTicks:960,pitch:69,velocity:50}]}));
 const before=await get(s),disk=await fs.readFile(s.projectPath);
 const request=async(extra={},documentId=before.session.document.id)=>fetch(s.url+'/api/midi/audition',{method:'POST',headers:{'Content-Type':'application/json','X-Newdaw-Document':documentId},body:JSON.stringify({expectedRevision:before.project.revision,clipId:'c',updates:[{noteId:'n',value:100}],...extra})});
 const r=await request();assert.equal(r.status,200,await r.clone().text());assert.equal(r.headers.get('content-type'),'audio/wav');const wav=decodeWav(Buffer.from(await r.arrayBuffer()));assert.equal(wav.frames,2800);assert.equal(wav.channels.length,2);assert.ok(wav.channels[0].some(x=>Math.abs(x)>.01));
 for(const [extra,status] of [[{expectedRevision:0},409],[{durationSeconds:3},422],[{updates:[{noteId:'missing',value:100}]},422],[{unexpected:true},422]])assert.equal((await request(extra)).status,status);
 assert.equal((await request({},'wrong-document')).status,409);
 const after=await get(s);assert.deepEqual(after.project,before.project);assert.deepEqual(after.historyView,before.historyView);assert.deepEqual(await fs.readFile(s.projectPath),disk);
 ok(await command(s,'track.update',{trackId:'t',mute:true}));
 const muted=await get(s),silent=await request({expectedRevision:muted.project.revision});assert.equal(silent.status,200);assert.equal((await silent.json()).silent,true);
});

test('Audition CLI uses byte-identical HTTP audio with no source edit and refuses stale or existing output',async t=>{
 const s=await fixture(t);await seed(s);const before=await get(s),disk=await fs.readFile(s.projectPath),input={clipId:'clip',updates:[{noteId:'note',value:45}]},output=path.join(s.directory,'preview.wav');
 const response=await fetch(s.url+'/api/midi/audition',{method:'POST',headers:{'Content-Type':'application/json','X-Newdaw-Document':before.session.document.id},body:JSON.stringify({...input,expectedRevision:before.project.revision,durationSeconds:.2})});assert.equal(response.status,200);const bytes=Buffer.from(await response.arrayBuffer());
 const result=await cli(s,'audition',output,JSON.stringify(input),'--duration','.2');assert.equal(result.written,true);assert.equal(result.revision,before.project.revision);assert.deepEqual(await fs.readFile(output),bytes);assert.equal(decodeWav(bytes).frames,1600);
 await assert.rejects(cli(s,'audition',output,JSON.stringify(input)),/Output exists/);assert.deepEqual(await fs.readFile(output),bytes);
 const stale=path.join(s.directory,'stale.wav');await assert.rejects(cli(s,'audition',stale,JSON.stringify(input),'--revision','0'),/REVISION_CONFLICT/);await assert.rejects(fs.access(stale));
 await cli(s,'audition',output,JSON.stringify(input),'--duration','.2','--force');assert.deepEqual(await fs.readFile(output),bytes);
 assert.deepEqual((await get(s)).project,before.project);assert.deepEqual((await get(s)).historyView,before.historyView);assert.deepEqual(await fs.readFile(s.projectPath),disk);
});
test('Audition CLI muted targets create no file and malformed requests cannot overwrite outputs',async t=>{
 const s=await fixture(t);await seed(s);const input={clipId:'clip',updates:[{noteId:'note',value:90}]},output=path.join(s.directory,'muted.wav');
 ok(await command(s,'track.update',{trackId:'track',mute:true}));const result=await cli(s,'audition',output,JSON.stringify(input));assert.equal(result.silent,true);assert.equal(result.written,false);await assert.rejects(fs.access(output));
 await fs.writeFile(output,'keep');for(const args of [[JSON.stringify({...input,unknown:true})],[JSON.stringify(input),'--duration','9'],[JSON.stringify(input),'--tail','.1'],[JSON.stringify(input),'--dry-run']]){await assert.rejects(cli(s,'audition',output,...args,'--force'));assert.equal(await fs.readFile(output,'utf8'),'keep');}
});
