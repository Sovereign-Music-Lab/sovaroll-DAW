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
const clip=st=>st.project.clips.find(c=>c.id==='clip');
async function midi(s,format=1){const r=await fetch(s.url+'/api/export/midi?format='+format);assert.equal(r.status,200,await r.clone().text());return {bytes:Buffer.from(await r.arrayBuffer()),warning:r.headers.get('X-NewDAW-Loss-Report')};}
// Independent SMF wire decoder, including running status and variable payload sizes.
function decodeMidi(bytes){const b=Buffer.from(bytes);assert.equal(b.toString('ascii',0,4),'MThd');let p=8+b.readUInt32BE(4);const tracks=[];for(let ti=0;ti<b.readUInt16BE(10);ti++){assert.equal(b.toString('ascii',p,p+4),'MTrk');const stop=p+8+b.readUInt32BE(p+4);p+=8;let tick=0,running=0;const rows=[],number=()=>{let n=0,x,count=0;do{assert.ok(p<stop);x=b[p++];n=n*128+(x&127);assert.ok(++count<=4);}while(x&128);return n;};while(p<stop){tick+=number();let status=b[p];if(status&128)p++;else{assert.ok(running);status=running;}let metaType,length;if(status===255){running=0;metaType=b[p++];length=number();}else if(status===240||status===247){running=0;length=number();}else{running=status;length=[12,13].includes(status>>4)?1:2;}assert.ok(p+length<=stop);rows.push({tick,status,...(metaType===undefined?{}:{metaType}),data:[...b.subarray(p,p+length)]});p+=length;}assert.equal(p,stop);tracks.push(rows);}assert.equal(p,b.length);return {format:b.readUInt16BE(8),ppq:b.readUInt16BE(12),tracks};}
// Independent stereo PCM16 RIFF reader; no production renderer/curve evaluator is an oracle.
function decodeWav(bytes){const b=Buffer.from(bytes);assert.equal(b.toString('ascii',0,4),'RIFF');assert.equal(b.toString('ascii',8,12),'WAVE');let sr,channels,bits,data;for(let p=12;p+8<=b.length;){const size=b.readUInt32LE(p+4);assert.ok(p+8+size<=b.length);const name=b.toString('ascii',p,p+4);if(name==='fmt '){assert.equal(b.readUInt16LE(p+8),1);channels=b.readUInt16LE(p+10);sr=b.readUInt32LE(p+12);bits=b.readUInt16LE(p+22);}if(name==='data')data=b.subarray(p+8,p+8+size);p+=8+size+(size&1);}assert.equal(channels,2);assert.equal(bits,16);assert.ok(data);const samples=[new Float64Array(data.length/4),new Float64Array(data.length/4)];for(let i=0;i<samples[0].length;i++){samples[0][i]=data.readInt16LE(i*4)/32768;samples[1][i]=data.readInt16LE(i*4+2)/32768;}return {sampleRate:sr,frames:samples[0].length,samples};}
async function render(s){const st=await get(s);let job=ok(await post(s,'/api/render',{expectedRevision:st.project.revision,durationSeconds:1.5}),202);const deadline=Date.now()+15000;while(job.status==='running'){assert.ok(Date.now()<deadline);await new Promise(r=>setTimeout(r,10));job=await get(s,'/api/jobs/'+job.jobId);}assert.equal(job.status,'completed',JSON.stringify(job.error));const r=await fetch(s.url+job.url);assert.equal(r.status,200);const bytes=Buffer.from(await r.arrayBuffer());return {job,bytes,wav:decodeWav(bytes)};}

const args=(extra={})=>({clipId:'clip',field:'releaseVelocity',kind:'triangle',startTick:0,endTick:1920,startValue:0,endValue:100,periodTicks:1920,...extra});
const notes=[0,333,960,1440,1920].map((startTick,i)=>({id:'n'+i,startTick,durationTicks:120,pitch:60+i,velocity:70,channel:0,releaseVelocity:0,noteOffEncoding:'zeroVelocityNoteOn'}));
test('Note shapes HTTP CLI: shared discovery values export and persistent Undo Redo survive restart',async t=>{
 const s=await fixture(t);await seed(s,{notes});const before=await get(s),wire=(await midi(s)).bytes;
 const result=await cli(s,'command','midi.notes.shape',JSON.stringify(args()));assert.equal(result.changes.noteShape.updatedNoteCount,3);const after=await get(s),changed=(await midi(s)).bytes;assert.deepEqual(clip(after).notes.map(n=>n.releaseVelocity),[0,35,100,50,0]);assert.deepEqual(clip(after).notes.map(n=>n.startTick),[0,333,960,1440,1920]);assert.equal(after.capabilities.noteShapeCommand,true);assert.notDeepEqual(changed,wire);const offs=decodeMidi(changed).tracks.flat().filter(e=>(e.status>>4)===8||(e.status>>4)===9&&e.data[1]===0);assert.deepEqual(offs.map(e=>e.data[1]),[0,35,100,50,0]);assert.deepEqual(offs.map(e=>e.status>>4),[9,8,8,8,9]);
 await s.reopen();assert.deepEqual(clip(await get(s)),clip(after));assert.deepEqual((await midi(s)).bytes,changed);ok(await command(s,'history.undo'));assert.deepEqual(clip(await get(s)),clip(before));assert.deepEqual((await midi(s)).bytes,wire);ok(await command(s,'history.redo'));assert.deepEqual(clip(await get(s)),clip(after));
});
test('Note shapes HTTP CLI: dry-run stale revision document and timing reject without writes',async t=>{
 const s=await fixture(t);await seed(s,{notes});const before=await get(s),disk=await fs.readFile(s.projectPath);const dry=ok(await command(s,'midi.notes.shape',args(),{dryRun:true}));assert.equal(dry.applied,false);assert.equal(dry.changes.noteShape.updatedNoteCount,3);
 rejected(await command(s,'midi.notes.shape',args(),{expectedRevision:before.project.revision-1}),409);rejected(await command(s,'midi.notes.shape',args(),{},'missing'),409);const tp=await get(s,'/api/workspace/timing-settings');rejected(await command(s,'midi.notes.shape',args(),{expectedTimingRevision:tp.settings.revision+1,expectedTimingFingerprint:tp.fingerprint}),409);
 assert.deepEqual((await get(s)).project,before.project);assert.deepEqual((await get(s)).historyView,before.historyView);assert.deepEqual(await fs.readFile(s.projectPath),disk);
});
test('Note shapes HTTP CLI: persistence failure and invalid batch restore note encoding and history',async t=>{
 let fail=false;const s=await fixture(t,{persistProject:async(f,p)=>{if(fail)throw Error('note shape injected failure');return saveProject(f,p);}});await seed(s,{notes});const before=await get(s),disk=await fs.readFile(s.projectPath),wire=(await midi(s)).bytes;fail=true;const result=await command(s,'midi.notes.shape',args());assert.equal(result.status,500);assert.equal(result.body.errors[0].code,'SAVE_FAILED');fail=false;
 rejected(await command(s,'batch',{commands:[{command:'midi.notes.shape',arguments:args()},{command:'midi.notes.shape',arguments:args({selectedNoteIds:['missing']})}]}));assert.deepEqual((await get(s)).project,before.project);assert.deepEqual((await get(s)).historyView,before.historyView);assert.deepEqual(await fs.readFile(s.projectPath),disk);assert.deepEqual((await midi(s)).bytes,wire);
});
test('Note shapes HTTP CLI: rendered velocity changes and release-only render remains exact',async t=>{
 const s=await fixture(t);await seed(s,{notes});const before=await render(s);ok(await command(s,'midi.notes.shape',args({field:'velocity',kind:'line',periodTicks:undefined,startValue:10,endValue:120})));const velocity=await render(s);assert.notDeepEqual(velocity.bytes,before.bytes);ok(await command(s,'midi.notes.shape',args()));const release=await render(s);assert.deepEqual(release.bytes,velocity.bytes);
});
