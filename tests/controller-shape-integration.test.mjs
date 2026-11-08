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
const lane=(controller=11,channel=0)=>({kind:'cc',channel,controller});
const raw=(id,tick,controller,value,channel=0,extra={})=>({id,tick,kind:'channel',status:0xb0+channel,data:[controller,value],...extra});
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
const ccEvents=(st,controller=11,channel=0)=>clip(st).events.filter(e=>e.status===0xb0+channel&&e.data[0]===controller).sort((a,b)=>a.tick-b.tick||a.order-b.order);
const pairs=events=>events.map(e=>[e.tick,e.data[1]]);
const stripRevision=p=>{p=structuredClone(p);delete p.revision;return p;};
async function save(s){const st=await get(s);return ok(await post(s,'/api/document/save',{expectedRevision:st.project.revision,expectedDocumentId:st.session.document.id}));}
async function midi(s,format=1){const r=await fetch(s.url+'/api/export/midi?format='+format);assert.equal(r.status,200,await r.clone().text());return {bytes:Buffer.from(await r.arrayBuffer()),warning:r.headers.get('X-NewDAW-Loss-Report')};}
// Independent SMF wire decoder, including running status and variable payload sizes.
function decodeMidi(bytes){const b=Buffer.from(bytes);assert.equal(b.toString('ascii',0,4),'MThd');let p=8+b.readUInt32BE(4);const tracks=[];for(let ti=0;ti<b.readUInt16BE(10);ti++){assert.equal(b.toString('ascii',p,p+4),'MTrk');const stop=p+8+b.readUInt32BE(p+4);p+=8;let tick=0,running=0;const rows=[],number=()=>{let n=0,x,count=0;do{assert.ok(p<stop);x=b[p++];n=n*128+(x&127);assert.ok(++count<=4);}while(x&128);return n;};while(p<stop){tick+=number();let status=b[p];if(status&128)p++;else{assert.ok(running);status=running;}let metaType,length;if(status===255){running=0;metaType=b[p++];length=number();}else if(status===240||status===247){running=0;length=number();}else{running=status;length=[12,13].includes(status>>4)?1:2;}assert.ok(p+length<=stop);rows.push({tick,status,...(metaType===undefined?{}:{metaType}),data:[...b.subarray(p,p+length)]});p+=length;}assert.equal(p,stop);tracks.push(rows);}assert.equal(p,b.length);return {format:b.readUInt16BE(8),ppq:b.readUInt16BE(12),tracks};}
const wireCC=(wire,controller=11,channel=0)=>decodeMidi(wire).tracks.flat().filter(e=>e.status===0xb0+channel&&e.data[0]===controller);
function valueAt(events,tick){let result;for(const event of events)if(event.tick<=tick)result=event.data[1];return result;}
// Independent stereo PCM16 RIFF reader; no production renderer/curve evaluator is an oracle.
function decodeWav(bytes){const b=Buffer.from(bytes);assert.equal(b.toString('ascii',0,4),'RIFF');assert.equal(b.toString('ascii',8,12),'WAVE');let sr,channels,bits,data;for(let p=12;p+8<=b.length;){const size=b.readUInt32LE(p+4);assert.ok(p+8+size<=b.length);const name=b.toString('ascii',p,p+4);if(name==='fmt '){assert.equal(b.readUInt16LE(p+8),1);channels=b.readUInt16LE(p+10);sr=b.readUInt32LE(p+12);bits=b.readUInt16LE(p+22);}if(name==='data')data=b.subarray(p+8,p+8+size);p+=8+size+(size&1);}assert.equal(channels,2);assert.equal(bits,16);assert.ok(data);const samples=[new Float64Array(data.length/4),new Float64Array(data.length/4)];for(let i=0;i<samples[0].length;i++){samples[0][i]=data.readInt16LE(i*4)/32768;samples[1][i]=data.readInt16LE(i*4+2)/32768;}return {sampleRate:sr,frames:samples[0].length,samples};}
function rms(wav,from,to,ch=0){let sum=0;const a=Math.round(from*wav.sampleRate),b=Math.round(to*wav.sampleRate);assert.ok(b>a&&b<=wav.frames);for(let i=a;i<b;i++)sum+=wav.samples[ch][i]**2;return Math.sqrt(sum/(b-a));}
function near(a,b,tolerance,label){assert.ok(Math.abs(a-b)<=tolerance,`${label}: ${a} expected ${b} ± ${tolerance}`);}
async function render(s){const st=await get(s);let job=ok(await post(s,'/api/render',{expectedRevision:st.project.revision,durationSeconds:1.5}),202);const deadline=Date.now()+15000;while(job.status==='running'){assert.ok(Date.now()<deadline);await new Promise(r=>setTimeout(r,10));job=await get(s,'/api/jobs/'+job.jobId);}assert.equal(job.status,'completed',JSON.stringify(job.error));const r=await fetch(s.url+job.url);assert.equal(r.status,200);const bytes=Buffer.from(await r.arrayBuffer());return {job,bytes,wav:decodeWav(bytes)};}

const args=(extra={})=>({clipId:'clip',lane:lane(),kind:'triangle',startTick:240,endTick:1200,startValue:0,endValue:120,periodTicks:960,density:{mode:'ticks',stepTicks:240},...extra});
test('Shape HTTP CLI: catalog and all wave modes produce independent expected SMF samples',async t=>{
 const s=await fixture(t);await seed(s,{events:[raw('a',0,11,80),raw('offgrid',500,11,60),raw('other',600,7,33)]});assert.ok((await get(s,'/api/commands')).some(c=>c.command==='midi.controllers.shape'));
 const expected={parabola:[0,8,30,68,120],sine:[0,60,120,60,0],triangle:[0,60,120,60,0],square:[120,120,0,0,120]};
 for(const kind of Object.keys(expected)){const a=args({kind});if(kind==='parabola')delete a.periodTicks;const before=await get(s);ok(await command(s,'midi.controllers.shape',a));const snapshot=ccEvents(await get(s)).map(e=>({tick:e.tick,data:e.data,curve:e.curve}));for(const format of [0,1]){const rows=wireCC((await midi(s,format)).bytes);assert.deepEqual([240,480,720,960,1200].map(t=>valueAt(rows,t)),expected[kind]);assert.equal(valueAt(rows,239),80);assert.equal(valueAt(rows,1201),60);}
  ok(await command(s,'history.undo'));assert.deepEqual(stripRevision((await get(s)).project),stripRevision(before.project));await cli(s,'command','midi.controllers.shape',JSON.stringify(a));assert.deepEqual(ccEvents(await get(s)).map(e=>({tick:e.tick,data:e.data,curve:e.curve})),snapshot);ok(await command(s,'history.undo'));
 }
});
test('Shape HTTP CLI: Save restart and persistent Undo Redo preserve editable source SMF and audio',async t=>{
 const s=await fixture(t);await seed(s,{events:[raw('a',0,11,127)]});const before=await get(s),wire=(await midi(s)).bytes,audio=(await render(s)).bytes;
 ok(await command(s,'midi.controllers.shape',args({kind:'square',periodTicks:480})));await save(s);const changed=await get(s),changedWire=(await midi(s)).bytes,changedAudio=(await render(s)).bytes;assert.notDeepEqual(changedAudio,audio);await s.reopen();assert.deepEqual((await get(s)).project,changed.project);assert.deepEqual((await midi(s)).bytes,changedWire);assert.deepEqual((await render(s)).bytes,changedAudio);
 ok(await command(s,'history.undo'));assert.deepEqual(stripRevision((await get(s)).project),stripRevision(before.project));assert.deepEqual((await midi(s)).bytes,wire);assert.deepEqual((await render(s)).bytes,audio);ok(await command(s,'history.redo'));assert.deepEqual((await midi(s)).bytes,changedWire);
});
test('Shape HTTP CLI: dry-run stale document revision and timing reject without writes',async t=>{
 const s=await fixture(t);await seed(s);const before=await get(s),disk=await fs.readFile(s.projectPath);assert.equal((await cli(s,'command','midi.controllers.shape',JSON.stringify(args()),'--dry-run')).applied,false);
 rejected(await command(s,'midi.controllers.shape',args(),{expectedRevision:before.project.revision-1}),409);rejected(await command(s,'midi.controllers.shape',args(),{},'missing'),409);
 const p=await get(s,'/api/workspace/timing-settings');rejected(await command(s,'midi.controllers.shape',args(),{expectedTimingRevision:p.settings.revision+1,expectedTimingFingerprint:p.fingerprint}),409);
 assert.deepEqual((await get(s)).project,before.project);assert.deepEqual((await get(s)).historyView,before.historyView);assert.deepEqual(await fs.readFile(s.projectPath),disk);
});
test('Shape HTTP CLI: failed persistence and late invalid batch roll back generation and boundary guards',async t=>{
 let fail=false;const s=await fixture(t,{persistProject:async(f,p)=>{if(fail)throw Error('shape injected failure');return saveProject(f,p);}});await seed(s,{events:[raw('a',0,11,0,0,{curve:{type:'ramp'}}),raw('b',1920,11,127)]});const before=await get(s),disk=await fs.readFile(s.projectPath),wire=(await midi(s)).bytes;fail=true;const result=await command(s,'midi.controllers.shape',args());assert.equal(result.status,500);assert.equal(result.body.errors[0].code,'SAVE_FAILED');fail=false;
 rejected(await command(s,'batch',{commands:[{command:'midi.controllers.shape',arguments:args()},{command:'midi.controllers.shape',arguments:args({kind:'sine',duty:.5})}]}));assert.deepEqual((await get(s)).project,before.project);assert.deepEqual((await get(s)).historyView,before.historyView);assert.deepEqual(await fs.readFile(s.projectPath),disk);assert.deepEqual((await midi(s)).bytes,wire);
});
test('Shape HTTP CLI: Quantize Link uses explicit zoom and saved layout while Ramp preference does not distort Square',async t=>{
 const s=await fixture(t);await seed(s);await command(s,'tempo.set',{tempoMap:[{tick:0,bpm:120},{tick:960,bpm:60}]});await command(s,'project.timeDisplay',{options:{pianoMode:'time-linear'}});
 const p=await cli(s,'controller-settings');await cli(s,'controller-settings',JSON.stringify({expectedRevision:p.settings.revision,expectedFingerprint:p.fingerprint,newEventType:'ramp'}));const a=args({kind:'square',startTick:0,endTick:1920,density:{mode:'quantize-link',zoom:4}});const result=await cli(s,'command','midi.controllers.shape',JSON.stringify(a));assert.equal(result.changes.shape.pointCount,7);const xs=ccEvents(await get(s));assert.deepEqual(xs.map(e=>e.tick),[0,480,960,1200,1440,1680,1920]);assert.ok(xs.every(e=>!e.curve));
 const rows=wireCC((await midi(s)).bytes);assert.equal(valueAt(rows,479),120);assert.equal(valueAt(rows,480),0);assert.equal(valueAt(rows,960),120);
});
