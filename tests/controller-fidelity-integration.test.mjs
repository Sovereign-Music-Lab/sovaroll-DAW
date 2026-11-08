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
 const directory=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'newdaw-fidelity-http-'))),projectPath=path.join(directory,'ControllerValues.json');
 await fs.writeFile(projectPath,JSON.stringify(createProject({name:'Existing controller values',sampleRate:8000}),null,2)+'\n');let server;
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


const setValues=(s,updates,extra={},documentId)=>command(s,'midi.controllers.setValues',{clipId:'clip',updates},extra,documentId);
const eventValue=e=>e.status>>4===14?e.data[0]+128*e.data[1]:e.data.at(-1);
function sourceShape(events){return events.map(({data,curve,...event})=>({...event,payloadIdentity:event.kind==='channel'&&[10,11].includes(event.status>>4)?data[0]:null}));}
const channelRows=bytes=>decodeMidi(bytes).tracks.flat().filter(e=>e.status<240);
function frequency(wav,from,to,ch=0){const x=wav.samples[ch],crossings=[];for(let i=Math.ceil(from*wav.sampleRate)+1;i<Math.floor(to*wav.sampleRate);i++)if(x[i-1]<=0&&x[i]>0)crossings.push(i-1-x[i-1]/(x[i]-x[i-1]));assert.ok(crossings.length>=8);return(crossings.length-1)*wav.sampleRate/(crossings.at(-1)-crossings[0]);}
const mixed=()=>[raw('cc',0,11,127),raw('other-channel',0,11,55,1),{id:'bend',tick:240,kind:'channel',status:0xe0,data:[0,64]},{id:'channel-pressure',tick:300,kind:'channel',status:0xd2,data:[20]},{id:'poly-60',tick:360,kind:'channel',status:0xa3,data:[60,30]},{id:'poly-61',tick:360,kind:'channel',status:0xa3,data:[61,40]},{id:'program',tick:420,kind:'channel',status:0xc4,data:[5]},{id:'packet',tick:480,kind:'sysex',status:240,data:[125,1,247]},{id:'text',tick:500,kind:'meta',status:255,metaType:1,data:[84,101,120,116]}];

 test('HTTP existing controller values change only amounts while IDs ticks orders lane identity notes and opaque payloads stay intact',async t=>{
 const s=await fixture(t);await seed(s,{events:mixed()});const before=await get(s),updates=[{eventId:'cc',value:64},{eventId:'bend',value:16383},{eventId:'channel-pressure',value:90},{eventId:'poly-60',value:100},{eventId:'program',value:17}],result=ok(await setValues(s,updates)),after=await get(s);assert.deepEqual(result.changes.created,[]);assert.deepEqual(result.changes.removed,[]);assert.deepEqual(sourceShape(clip(after).events),sourceShape(clip(before).events));assert.deepEqual(clip(after).notes,clip(before).notes);for(const event of clip(before).events){const change=updates.find(x=>x.eventId===event.id),actual=clip(after).events.find(x=>x.id===event.id);if(change)assert.equal(eventValue(actual),change.value);else assert.deepEqual(actual,event);}assert.equal(after.project.revision,before.project.revision+1);
 });

 test('existing value updates preserve same-tick duplicate raw messages and their independent source ordering in SMF0 and SMF1',async t=>{
 const s=await fixture(t);await seed(s,{events:[raw('first',240,11,10),raw('last',240,11,20),raw('foreign',240,11,99,1)]});const before=await get(s);ok(await setValues(s,[{eventId:'first',value:40},{eventId:'last',value:70}]));const after=await get(s);assert.deepEqual(sourceShape(clip(after).events),sourceShape(clip(before).events));for(const format of [0,1]){const rows=wireCC((await midi(s,format)).bytes);assert.deepEqual(pairs(rows),[[240,40],[240,70]]);assert.deepEqual(pairs(wireCC((await midi(s,format)).bytes,11,1)),[[240,99]]);}assert.equal(clip(after).events.length,3);
 });

 test('real CLI and HTTP setValues produce identical edited sources MIDI bytes and rendered WAV',async t=>{
 const a=await fixture(t),b=await fixture(t);await seed(a,{events:[raw('expression',0,11,127),raw('pan',0,10,64)]});await seed(b,{events:[raw('expression',0,11,127),raw('pan',0,10,64)]});const args={clipId:'clip',updates:[{eventId:'expression',value:64},{eventId:'pan',value:0}]};ok(await command(a,'midi.controllers.setValues',args));assert.equal((await cli(b,'command','midi.controllers.setValues',JSON.stringify(args))).applied,true);assert.deepEqual(clip(await get(a)),clip(await get(b)));assert.deepEqual((await midi(a)).bytes,(await midi(b)).bytes);const ar=await render(a),br=await render(b);assert.deepEqual(ar.bytes,br.bytes);const target=path.join(b.directory,'values.wav'),report=await cli(b,'render',target,'--duration','1.5');assert.equal(report.status,'completed');assert.deepEqual(await fs.readFile(target),ar.bytes);
 });

 test('existing CC amount edits change independently measured PCM gain and pan without moving source events',async t=>{
 const s=await fixture(t);await seed(s,{events:[raw('expression',0,11,127),raw('pan',0,10,64)]});const before=await get(s),base=await render(s);ok(await setValues(s,[{eventId:'expression',value:64}]));const quieter=await render(s);near(rms(quieter.wav,.15,.35)/rms(base.wav,.15,.35),64/127,.001,'linear CC11 amplitude');ok(await setValues(s,[{eventId:'pan',value:0}]));const left=await render(s);assert.equal(rms(left.wav,.15,.35,1),0);near(rms(left.wav,.15,.35)/rms(quieter.wav,.15,.35),Math.SQRT2,.002,'equal-power center to left');assert.deepEqual(sourceShape(clip(await get(s)).events),sourceShape(clip(before).events));
 });

 test('existing 14-bit bend values carry across bytes and change actual WAV frequency at both signed endpoints',async t=>{
 const s=await fixture(t);await seed(s,{events:[{id:'bend',tick:0,kind:'channel',status:0xe0,data:[0,64]}]});near(frequency((await render(s)).wav,.1,.3),440,.15,'center');for(const [value,data]of [[16383,[127,127]],[0,[0,0]],[128,[0,1]]]){ok(await setValues(s,[{eventId:'bend',value}]));assert.deepEqual(clip(await get(s)).events[0].data,data);const wave=await render(s);near(frequency(wave.wav,.1,.3),440*2**(((value-8192)/8192*2)/12),.15,'14-bit bend endpoint');assert.deepEqual(channelRows((await midi(s)).bytes).find(e=>e.status===0xe0).data,data);}
 });

 test('pressure and program amount edits retain explicit unsupported timbre warnings and do not pretend to alter oscillator samples',async t=>{
 const s=await fixture(t);await seed(s,{events:[{id:'pressure',tick:0,kind:'channel',status:0xd0,data:[1]},{id:'poly',tick:0,kind:'channel',status:0xa0,data:[69,2]},{id:'program',tick:0,kind:'channel',status:0xc0,data:[3]}]});const before=await render(s);ok(await setValues(s,[{eventId:'pressure',value:127},{eventId:'poly',value:100},{eventId:'program',value:127}]));const after=await render(s);assert.deepEqual(after.bytes,before.bytes);assert.match(after.job.stats.warnings.join(' '),/pressure/i);assert.match(after.job.stats.warnings.join(' '),/program/i);assert.deepEqual(channelRows((await midi(s)).bytes).filter(e=>[0xa0,0xc0,0xd0].includes(e.status)).map(e=>e.data),[[127],[69,100],[127]]);
 });

 test('setValues rejects invalid IDs duplicates kinds immutable fields and 7-bit or 14-bit overflow atomically',async t=>{
 const s=await fixture(t);await seed(s,{events:mixed()});const before=await get(s),disk=await fs.readFile(s.projectPath),wire=(await midi(s)).bytes;for(const updates of [[],[{eventId:'cc',value:1},{eventId:'cc',value:2}],[{eventId:'missing',value:1}],[{eventId:'packet',value:1}],[{eventId:'text',value:1}],[{eventId:'note',value:1}],[{eventId:'cc',value:128}],[{eventId:'bend',value:16384}],[{eventId:'cc',value:-1}],[{eventId:'cc',value:1.5}],[{eventId:'cc',value:40,tick:10}],[{eventId:'cc',value:20},{eventId:'poly-60',value:500}]])rejected(await setValues(s,updates));assert.deepEqual((await get(s)).project,before.project);assert.deepEqual((await get(s)).historyView,before.historyView);assert.deepEqual(await fs.readFile(s.projectPath),disk);assert.deepEqual((await midi(s)).bytes,wire);
 });

 test('setValues dry run and later failing batch preserve file bytes undo history MIDI output and actual audio',async t=>{
 const s=await fixture(t);await seed(s,{events:[raw('expression',0,11,127)]});const before=await get(s),disk=await fs.readFile(s.projectPath),wire=(await midi(s)).bytes,audio=(await render(s)).bytes;assert.equal(ok(await setValues(s,[{eventId:'expression',value:0}],{dryRun:true})).applied,false);rejected(await command(s,'batch',{commands:[{command:'midi.controllers.setValues',arguments:{clipId:'clip',updates:[{eventId:'expression',value:0}]}},{command:'midi.events.remove',arguments:{clipId:'clip',eventIds:['absent']}}]}));assert.deepEqual((await get(s)).project,before.project);assert.deepEqual((await get(s)).historyView,before.historyView);assert.deepEqual(await fs.readFile(s.projectPath),disk);assert.deepEqual((await midi(s)).bytes,wire);assert.deepEqual((await render(s)).bytes,audio);
 });

 test('failed persistence rolls back existing controller values and retained split geometry without false source mutation',async t=>{
 let fail=false;const s=await fixture(t,{persistProject:async(filename,project)=>{if(fail)throw Error('injected setValues save failure');return saveProject(filename,project);}});await seed(s,{events:[raw('a',0,11,0,0,{curve:{type:'ramp'}}),raw('b',1920,11,127)],lengthTicks:1920});ok(await command(s,'clip.split',{clipId:'clip',atTick:701}));const before=await get(s),disk=await fs.readFile(s.projectPath),wire=(await midi(s)).bytes,audio=(await render(s)).bytes;fail=true;const r=await setValues(s,[{eventId:'a',value:80}]);assert.equal(r.status,500);assert.equal(r.body.errors[0].code,'SAVE_FAILED');assert.deepEqual((await get(s)).project,before.project);assert.deepEqual((await get(s)).historyView,before.historyView);assert.deepEqual(await fs.readFile(s.projectPath),disk);assert.deepEqual((await midi(s)).bytes,wire);assert.deepEqual((await render(s)).bytes,audio);fail=false;
 });

 test('one existing-value gesture emits one committed SSE revision and one undo entry while stale guards reject mutation',async t=>{
 const s=await fixture(t);await seed(s,{events:[raw('a',0,11,127),raw('b',960,11,100)]});const before=await get(s),response=await fetch(s.url+'/api/events'),reader=response.body.getReader();t.after(()=>reader.cancel().catch(()=>{}));await reader.read();ok(await setValues(s,[{eventId:'a',value:20},{eventId:'b',value:40}]));const text=new TextDecoder().decode((await reader.read()).value);await reader.cancel();assert.match(text,/"data":\[11,40\]/);const after=await get(s);assert.equal(after.project.revision,before.project.revision+1);assert.equal(after.historyView.entries.length,before.historyView.entries.length+1);const stale=await setValues(s,[{eventId:'a',value:30}],{expectedRevision:before.project.revision});assert.equal(stale.status,409);assert.equal(stale.body.errors[0].code,'REVISION_CONFLICT');const oldDoc=await setValues(s,[{eventId:'a',value:30}],{},'stale-document');assert.equal(oldDoc.status,409);assert.equal(oldDoc.body.errors[0].code,'DOCUMENT_CONFLICT');assert.deepEqual((await get(s)).project,after.project);ok(await command(s,'history.undo'));assert.deepEqual(stripRevision((await get(s)).project),stripRevision(before.project));ok(await command(s,'history.redo'));assert.deepEqual(stripRevision((await get(s)).project),stripRevision(after.project));
 });

 test('existing amount edits survive explicit Save restart and persistent undo redo with deterministic SMF and PCM',async t=>{
 const s=await fixture(t);await seed(s,{events:[raw('a',0,11,127),raw('b',960,11,100)]});const original=(await midi(s)).bytes;ok(await setValues(s,[{eventId:'a',value:32},{eventId:'b',value:64}]));await save(s);const before=await get(s),disk=await fs.readFile(s.projectPath),wire=(await midi(s)).bytes,audio=(await render(s)).bytes;await s.reopen();assert.deepEqual((await get(s)).project,before.project);assert.deepEqual((await get(s)).historyView,before.historyView);assert.deepEqual(await fs.readFile(s.projectPath),disk);assert.deepEqual((await midi(s)).bytes,wire);assert.deepEqual((await render(s)).bytes,audio);ok(await command(s,'history.undo'));assert.deepEqual((await midi(s)).bytes,original);ok(await command(s,'history.redo'));assert.deepEqual((await midi(s)).bytes,wire);assert.deepEqual((await render(s)).bytes,audio);
 });

 test('editing a split window without its local endpoint never inserts a raw point and preserves unrelated fragment geometry',async t=>{
 const s=await fixture(t);await seed(s,{events:[raw('a',0,11,0,0,{curve:{type:'ramp'}}),raw('b',1920,11,127)],lengthTicks:1920});ok(await command(s,'clip.split',{clipId:'clip',atTick:701}));const before=await get(s),left=clip(before),right=before.project.clips.find(c=>c.id!=='clip');assert.equal(left.events.length,1);assert.ok(left.events[0].curve.window);const r=ok(await setValues(s,[{eventId:'a',value:100}])),after=await get(s);assert.deepEqual(r.changes.created,[]);assert.deepEqual(r.changes.removed,[]);assert.deepEqual(sourceShape(clip(after).events),sourceShape(left.events));assert.equal(clip(after).events.length,1);assert.equal(eventValue(clip(after).events[0]),100);assert.deepEqual(after.project.clips.find(c=>c.id===right.id),right);assert.match(JSON.stringify(r.changes.warnings),/rebas/i);const rows=wireCC((await midi(s)).bytes);assert.equal(valueAt(rows,0),100);assert.equal(valueAt(rows,350),73,'local 100 to rounded original boundary 46 at701 gives independent midpoint');assert.ok(rms((await render(s)).wav,.05,.15)>.01);ok(await command(s,'history.undo'));assert.deepEqual(stripRevision((await get(s)).project),stripRevision(before.project));
 });

 test('same-value edits leave all source window bytes counts and exported MIDI unchanged without a rebase warning',async t=>{
 const s=await fixture(t);await seed(s,{events:[raw('a',0,11,0,0,{curve:{type:'bezier',handles:[{x:1/3,value:0},{x:2/3,value:0}]}}),raw('b',1920,11,127)],lengthTicks:1920});ok(await command(s,'clip.split',{clipId:'clip',atTick:701}));const before=await get(s),wire=(await midi(s)).bytes,audio=(await render(s)).bytes;const r=ok(await setValues(s,[{eventId:'a',value:0}]));assert.deepEqual(clip(await get(s)),clip(before));assert.deepEqual(r.changes.created,[]);assert.deepEqual(r.changes.removed,[]);assert.ok(!r.changes.warnings?.length);assert.deepEqual((await midi(s)).bytes,wire);assert.deepEqual((await render(s)).bytes,audio);
 });

 test('simultaneous edits of a virtual split anchor and its endpoint keep count and yield a locally expected linear curve',async t=>{
 const s=await fixture(t);await seed(s,{events:[raw('a',0,11,0,0,{curve:{type:'ramp'}}),raw('b',1920,11,127)],lengthTicks:1920});ok(await command(s,'clip.split',{clipId:'clip',atTick:701}));const before=await get(s),right=before.project.clips.find(c=>c.id!=='clip'),anchor=right.events.find(e=>e.tick===0),end=right.events.find(e=>e.id==='b');const r=ok(await command(s,'midi.controllers.setValues',{clipId:right.id,updates:[{eventId:anchor.id,value:70},{eventId:end.id,value:80}]}));const after=(await get(s)).project.clips.find(c=>c.id===right.id);assert.deepEqual(sourceShape(after.events),sourceShape(right.events));assert.equal(after.events.length,right.events.length);assert.deepEqual(r.changes.created,[]);assert.deepEqual(r.changes.removed,[]);const rows=wireCC((await midi(s)).bytes);assert.equal(valueAt(rows,701),70);assert.equal(valueAt(rows,1310),75);assert.equal(valueAt(rows,1920),80);assert.deepEqual(clip(await get(s)),clip(before));
 });

 test('existing-value edits survive real MIDI export and import without losing raw channel order or note release encoding',async t=>{
 const a=await fixture(t),b=await fixture(t);await seed(a,{events:mixed(),notes:[{id:'note',startTick:0,durationTicks:1920,pitch:69,velocity:100,channel:0,releaseVelocity:47}]});ok(await setValues(a,[{eventId:'cc',value:64},{eventId:'bend',value:9000},{eventId:'poly-60',value:80}]));const source=(await midi(a,1)).bytes,state=await get(b),r=await fetch(b.url+`/api/import/midi?name=Values.mid&expectedRevision=${state.project.revision}`,{method:'POST',headers:{'Content-Type':'audio/midi','X-Newdaw-Document':state.session.document.id},body:source});assert.equal(r.status,200,await r.clone().text());for(const format of [0,1])assert.deepEqual(channelRows((await midi(b,format)).bytes),channelRows(source));assert.equal((await get(b)).project.clips.flatMap(c=>c.notes??[])[0].releaseVelocity,47);
 });

 test('clipboard paste replaces matching destinations but preserves every incoming simultaneous message and project-time offsets',async t=>{
 const s=await fixture(t);await seed(s,{events:[raw('old1',240,11,1),raw('old2',240,11,2),raw('other-cc',240,7,99),raw('other-channel',240,11,88,1),raw('outside',800,11,90)]});
 ok(await command(s,'clip.move',{clipId:'clip',startTick:480}));
 const before=await get(s),args={clipId:'clip',lane:lane(11,0),atTick:240,events:[{tick:0,value:40},{tick:0,value:20},{tick:120,value:80}]};
 assert.equal((await cli(s,'command','midi.controllers.paste',JSON.stringify(args))).applied,true);
 const after=await get(s);assert.deepEqual(clip(after).notes,clip(before).notes);
 for(const id of ['other-cc','other-channel','outside'])assert.deepEqual(clip(after).events.find(e=>e.id===id),clip(before).events.find(e=>e.id===id));
 assert.deepEqual(pairs(ccEvents(after)),[[240,40],[240,20],[360,80],[800,90]]);
 assert.equal(clip(after).events.filter(e=>e.tick===240&&e.status===0xb0&&e.data[0]===11).length,2);
 for(const format of [0,1])assert.deepEqual(pairs(wireCC((await midi(s,format)).bytes)),[[720,40],[720,20],[840,80],[1280,90]]);
 const bytes=(await midi(s)).bytes;await save(s);await s.reopen();assert.deepEqual((await midi(s)).bytes,bytes);
 ok(await command(s,'history.undo'));assert.deepEqual(stripRevision((await get(s)).project),stripRevision(before.project));
 });
