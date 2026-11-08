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
 const directory=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'newdaw-playback-http-'))),projectPath=path.join(directory,'Playback.json');
 await fs.writeFile(projectPath,JSON.stringify(createProject({name:'Measured MIDI playback',sampleRate:8000}),null,2)+'\n');
 let server;const open=()=>startServer({projectPath,recentPath:path.join(directory,'recent.json'),port:0,demo:false,quiet:true,backupPollMs:60000,...options});
 t.after(async()=>{await server?.close();await fs.rm(directory,{recursive:true,force:true});});server=await open();
 return {directory,projectPath,get url(){return server.url;},async reopen(){await server.close();server=await open();}};
}
async function get(s,route='/api/state') {const r=await fetch(s.url+route);assert.equal(r.status,200,await r.clone().text());return r.json();}
async function post(s,route,body,documentId) {documentId??=(await get(s)).session.document.id;const r=await fetch(s.url+route,{method:'POST',headers:{'Content-Type':'application/json','X-Newdaw-Document':documentId},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};}
function ok(r,status=200){assert.equal(r.status,status,JSON.stringify({status:r.body.status,errors:r.body.errors}));return r.body;}
async function command(s,command,args={},extra={}) {const st=await get(s);return post(s,'/api/command',{command,arguments:args,expectedRevision:st.project.revision,...extra});}
async function cli(s,...args) {return JSON.parse((await exec(process.execPath,['src/cli.mjs',...args,'--url',s.url],{cwd:root,timeout:20000})).stdout);}
const cc=(tick,controller,value,channel=0)=>({tick,kind:'channel',status:0xb0+channel,data:[controller,value]});
const bend=(tick,lsb,msb,channel=0)=>({tick,kind:'channel',status:0xe0+channel,data:[lsb,msb]});
const note=(id='note',channel=0,extra={})=>({id,startTick:0,durationTicks:2304,pitch:69,velocity:100,channel,...extra});
async function seed(s,{events=[],notes=[note()],pan=0,lengthTicks=2880}={}) {
 return ok(await command(s,'batch',{commands:[
  {command:'track.add',arguments:{id:'track',type:'midi',name:'Sine measurement',instrument:'sine'}},
  {command:'track.update',arguments:{trackId:'track',gainDb:0,pan}},
  {command:'clip.add',arguments:{id:'clip',trackId:'track',type:'midi',startTick:0,lengthTicks,notes,events:events.map((event,index)=>({id:`event-${index}`,order:index,...event}))}}
 ]}));
}
async function startRender(s,options={durationSeconds:1.5}) {const state=await get(s);return ok(await post(s,'/api/render',{expectedRevision:state.project.revision,...options}),202);}
async function finishRender(s,started) {
 let job=started;const deadline=Date.now()+15000;
 while(job.status==='running'){assert.ok(Date.now()<deadline,'render worker did not finish');await new Promise(resolve=>setTimeout(resolve,10));job=await get(s,'/api/jobs/'+job.jobId);}
 assert.equal(job.status,'completed',JSON.stringify(job.error));const response=await fetch(s.url+job.url);assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/audio\/wav/);const bytes=Buffer.from(await response.arrayBuffer());return {job,bytes,wav:readWav(bytes)};
}
async function render(s,options) {return finishRender(s,await startRender(s,options));}
// Independent RIFF/PCM16 reader: no production WAV decoder or render math is imported.
function readWav(bytes) {
 const b=Buffer.from(bytes);assert.equal(b.toString('ascii',0,4),'RIFF');assert.equal(b.toString('ascii',8,12),'WAVE');assert.equal(b.readUInt32LE(4)+8,b.length);
 let format,data;for(let p=12;p+8<=b.length;){const size=b.readUInt32LE(p+4),name=b.toString('ascii',p,p+4);assert.ok(p+8+size<=b.length);if(name==='fmt ')format={encoding:b.readUInt16LE(p+8),channels:b.readUInt16LE(p+10),sampleRate:b.readUInt32LE(p+12),bits:b.readUInt16LE(p+22)};if(name==='data')data=b.subarray(p+8,p+8+size);p+=8+size+(size&1);}
 assert.deepEqual([format.encoding,format.channels,format.bits],[1,2,16]);assert.ok(data);const frames=data.length/4;assert.ok(Number.isInteger(frames));const channels=[new Float64Array(frames),new Float64Array(frames)];for(let i=0;i<frames;i++){channels[0][i]=data.readInt16LE(i*4)/32768;channels[1][i]=data.readInt16LE(i*4+2)/32768;}return {...format,frames,channels};
}
function rms(wav,from,to,channel=0) {const a=Math.round(from*wav.sampleRate),b=Math.round(to*wav.sampleRate);assert.ok(b<=wav.frames&&b>a);let sum=0;for(let i=a;i<b;i++)sum+=wav.channels[channel][i]**2;return Math.sqrt(sum/(b-a));}
function near(actual,expected,tolerance,label) {assert.ok(Math.abs(actual-expected)<=tolerance,`${label}: ${actual} expected ${expected} ± ${tolerance}`);}
function silent(wav,from,to,channel=0) {assert.equal(rms(wav,from,to,channel),0,`expected silence ${from}..${to}, channel ${channel}`);}
function audible(wav,from,to,channel=0) {assert.ok(rms(wav,from,to,channel)>.003,`expected measurable sound ${from}..${to}, channel ${channel}`);}
// Estimate pitch from interpolated positive zero crossings, independent of oscillator phase.
function frequency(wav,from,to,channel=0) {const x=wav.channels[channel],crossings=[];for(let i=Math.ceil(from*wav.sampleRate)+1;i<Math.floor(to*wav.sampleRate);i++)if(x[i-1]<=0&&x[i]>0)crossings.push(i-1-x[i-1]/(x[i]-x[i-1]));assert.ok(crossings.length>=8,'not enough waveform periods');return (crossings.length-1)*wav.sampleRate/(crossings.at(-1)-crossings[0]);}
async function midi(s,format=1) {const r=await fetch(s.url+'/api/export/midi?format='+format);assert.equal(r.status,200);return Buffer.from(await r.arrayBuffer());}

// ppq=960, 120 BPM: 480 ticks = .25 seconds. Expectations concern measured audio,
// not claims of hardware MIDI routing, seek chasing, recording or external plugins.
test('HTTP preview WAV applies CC7 and CC11 multiplicatively to sounding notes and zero volume is silent',async t=>{
 const s=await fixture(t);await seed(s,{events:[cc(480,7,64),cc(960,11,32),cc(1440,7,0)]});const {wav,job}=await render(s),full=rms(wav,.05,.15),volume=rms(wav,.3,.4),expression=rms(wav,.55,.65);audible(wav,.05,.15);near(volume/full,64/127,.002,'CC7 amplitude ratio');near(expression/volume,32/127,.002,'CC11 amplitude ratio');silent(wav,.8,.9);assert.equal(wav.sampleRate,8000);assert.equal(wav.frames,12000);assert.equal(job.stats.frames,wav.frames);assert.equal(job.stats.clippedSamples,0);assert.ok(!job.stats.warnings.some(w=>/not interpreted by the built-in oscillator/.test(w)));
});

test('HTTP preview WAV places CC10 center equally and hard pans exactly, then combines track pan with channel pan',async t=>{
 const s=await fixture(t);await seed(s,{events:[cc(0,10,0),cc(480,10,64),cc(960,10,127)]});let {wav}=await render(s);audible(wav,.05,.15,0);silent(wav,.05,.15,1);near(rms(wav,.3,.4,0),rms(wav,.3,.4,1),1/32768,'center balance');silent(wav,.55,.65,0);audible(wav,.55,.65,1);
 ok(await command(s,'track.update',{trackId:'track',pan:-1}));({wav}=await render(s));silent(wav,.3,.4,1);near(rms(wav,.55,.65,0),rms(wav,.55,.65,1),1/32768,'right channel pan plus hard-left track pan gives center');
});

test('HTTP render measures 14-bit pitch bend and RPN 0 bend sensitivity without changing note pitches',async t=>{
 const s=await fixture(t);await seed(s,{events:[bend(480,0,0),bend(960,0,64),cc(1440,101,0),cc(1440,100,0),cc(1440,6,12),cc(1440,38,0),bend(1440,0,0)]});const before=(await get(s)).project,{wav}=await render(s);near(frequency(wav,.05,.2),440,.15,'A4 before bend');near(frequency(wav,.3,.45),440*2**(-2/12),.15,'default two-semitone bend');near(frequency(wav,.55,.7),440,.15,'center bend');near(frequency(wav,.8,1),220,.15,'RPN octave range');assert.deepEqual((await get(s)).project,before);
});

test('MIDI controller playback stays channel-local within a track and does not alter another track on the same channel',async t=>{
 const s=await fixture(t);await seed(s,{notes:[note('left',0),note('right',1,{pitch:81})],events:[cc(0,10,0,0),cc(0,10,127,1),cc(960,7,0,0)]});let {wav}=await render(s);near(frequency(wav,.1,.2,0),440,.15,'channel 0 left');near(frequency(wav,.1,.2,1),880,.15,'channel 1 right');silent(wav,.6,.8,0);near(frequency(wav,.6,.8,1),880,.15,'channel 1 survives channel 0 mute');
 ok(await command(s,'batch',{commands:[{command:'track.add',arguments:{id:'independent',name:'Independent endpoint',type:'midi',instrument:'sine'}},{command:'track.update',arguments:{trackId:'independent',pan:-1}},{command:'clip.add',arguments:{id:'independent-clip',trackId:'independent',type:'midi',startTick:0,lengthTicks:2880,notes:[note('independent-note',0,{pitch:57})]}}]}));({wav}=await render(s));near(frequency(wav,.6,.8,0),220,.15,'separate track channel 0 remains audible');
});

test('HTTP CC64 distinguishes pedal value 63 from 64 and releases sustained sound without lengthening stored notes',async t=>{
 const s=await fixture(t);await seed(s,{notes:[note('note',0,{durationTicks:480})],events:[cc(0,64,63),cc(1920,64,0)]});let {wav}=await render(s);silent(wav,.4,.8);ok(await command(s,'midi.events.update',{clipId:'clip',eventId:'event-0',data:[64,64]}));const before=(await get(s)).project;({wav}=await render(s));audible(wav,.4,.8);silent(wav,1.1,1.3);assert.equal(before.clips[0].notes[0].durationTicks,480);assert.deepEqual((await get(s)).project,before);
});

test('HTTP renders CC123 through sustain while CC120 immediately kills sound even with the pedal held',async t=>{
 const s=await fixture(t);await seed(s,{events:[cc(0,64,127),cc(960,123,0),cc(1920,64,0)]});let {wav}=await render(s);audible(wav,.6,.9);silent(wav,1.1,1.3);ok(await command(s,'midi.events.update',{clipId:'clip',eventId:'event-1',data:[120,0]}));({wav}=await render(s));audible(wav,.2,.4);silent(wav,.501,.9);
});

test('HTTP CC121 resets expression and bend while preserving volume pan and bend range, and releases pedal-held notes',async t=>{
 const s=await fixture(t);await seed(s,{notes:[note('long'),note('held',1,{durationTicks:480,pitch:57})],events:[cc(0,10,0),cc(0,7,64),cc(0,11,32),cc(0,101,0),cc(0,100,0),cc(0,6,12),bend(0,0,0),cc(0,10,127,1),cc(0,64,127,1),cc(960,121,0),cc(960,121,0,1),bend(1440,0,0)]});const {wav}=await render(s);near(frequency(wav,.1,.2,0),220,.15,'pre-reset octave bend');near(frequency(wav,.6,.7,0),440,.15,'reset bend center');near(rms(wav,.6,.7,0)/rms(wav,.1,.2,0),127/32,.015,'reset expression to full');near(frequency(wav,.8,1,0),220,.15,'reset preserves RPN sensitivity');audible(wav,.3,.4,1);silent(wav,.6,.7,1);
});

test('unsupported program pressure SysEx and release timbre are disclosed while supported volume still affects the WAV',async t=>{
 const s=await fixture(t);await seed(s,{notes:[note('note',0,{releaseVelocity:99})],events:[cc(480,7,0),{tick:0,kind:'channel',status:0xc0,data:[40]},{tick:0,kind:'channel',status:0xd0,data:[64]},{tick:0,kind:'channel',status:0xa0,data:[69,50]},{tick:0,kind:'sysex',status:0xf0,data:[0x7d,1,0xf7]}]});const {wav,job}=await render(s),warnings=job.stats.warnings.join('\n');audible(wav,.1,.2);silent(wav,.3,.9);assert.match(warnings,/program/i);assert.match(warnings,/pressure/i);assert.match(warnings,/SysEx/i);assert.match(warnings,/release velocity/i);
});

test('a render job freezes MIDI controller state before later edits and reports stale audio without using the new volume',async t=>{
 const s=await fixture(t);await seed(s,{events:[cc(0,7,127)]});const before=await get(s),started=await startRender(s);ok(await command(s,'midi.events.update',{clipId:'clip',eventId:'event-0',data:[7,0]}));const frozen=await finishRender(s,started);assert.equal(frozen.job.revision,before.project.revision);assert.equal(frozen.job.stale,true);audible(frozen.wav,.1,1);const current=await render(s);silent(current.wav,.1,1);assert.equal(current.job.stale,false);assert.equal(current.job.revision,(await get(s)).project.revision);
});

test('real CLI render and headless offline-render agree with HTTP on pitch sustain pan and exact PCM bytes',async t=>{
 const s=await fixture(t);await seed(s,{notes:[note('note',0,{durationTicks:480})],events:[cc(0,10,127),cc(0,64,127),bend(0,0,0),cc(1920,64,0)]});const api=await render(s),online=path.join(s.directory,'online.wav'),offline=path.join(s.directory,'offline.wav'),onlineReport=await cli(s,'render',online,'--duration','1.5');const offlineReport=JSON.parse((await exec(process.execPath,['src/cli.mjs','offline-render',s.projectPath,offline,'--duration','1.5'],{cwd:root,timeout:20000})).stdout);assert.equal(onlineReport.status,'completed');assert.equal(offlineReport.status,'completed');assert.deepEqual(await fs.readFile(online),api.bytes);assert.deepEqual(await fs.readFile(offline),api.bytes);const wav=readWav(await fs.readFile(offline));silent(wav,.1,.9,0);audible(wav,.4,.8,1);near(frequency(wav,.4,.8,1),440*2**(-2/12),.15,'CLI pitch bend');silent(wav,1.1,1.3,1);assert.deepEqual(JSON.parse(await fs.readFile(online+'.render.json')).stats,api.job.stats);assert.deepEqual(JSON.parse(await fs.readFile(offline+'.render.json')).stats,api.job.stats);
});

test('save and server restart preserve controller source bytes, rendered audio and persistent undo redo',async t=>{
 const s=await fixture(t);await seed(s,{events:[cc(0,7,64),cc(0,64,127),cc(1920,64,0)],notes:[note('note',0,{durationTicks:480,releaseVelocity:44})]});ok(await command(s,'midi.events.update',{clipId:'clip',eventId:'event-0',data:[7,32]}));const st=await get(s);ok(await post(s,'/api/document/save',{expectedRevision:st.project.revision,expectedDocumentId:st.session.document.id}));const before=await get(s),wire=await midi(s),audio=await render(s),disk=await fs.readFile(s.projectPath);await s.reopen();const after=await get(s);assert.deepEqual(after.project,before.project);assert.deepEqual(after.historyView,before.historyView);assert.deepEqual(await fs.readFile(s.projectPath),disk);assert.deepEqual(await midi(s),wire);assert.deepEqual((await render(s)).bytes,audio.bytes);ok(await command(s,'history.undo'));const undo=await render(s);near(rms(undo.wav,.4,.8)/rms(audio.wav,.4,.8),2,.01,'undo controller volume');ok(await command(s,'history.redo'));assert.deepEqual((await render(s)).bytes,audio.bytes);
});

test('failed controller persistence and dry run cannot change the audible snapshot or saved MIDI stream',async t=>{
 let fail=false;const s=await fixture(t,{persistProject:async(filename,project)=>{if(fail)throw Error('injected playback edit save failure');return saveProject(filename,project);}});await seed(s,{events:[cc(0,7,64)]});const before=await get(s),disk=await fs.readFile(s.projectPath),wire=await midi(s),audio=await render(s);assert.equal(ok(await command(s,'midi.events.update',{clipId:'clip',eventId:'event-0',data:[7,0]},{dryRun:true})).applied,false);fail=true;const failed=await command(s,'midi.events.update',{clipId:'clip',eventId:'event-0',data:[7,0]});assert.equal(failed.status,500);assert.equal(failed.body.errors[0].code,'SAVE_FAILED');assert.deepEqual((await get(s)).project,before.project);assert.deepEqual((await get(s)).historyView,before.historyView);assert.deepEqual(await fs.readFile(s.projectPath),disk);assert.deepEqual(await midi(s),wire);assert.deepEqual((await render(s)).bytes,audio.bytes);fail=false;
});

// A tiny independently authored SMF: source order, release velocity and opaque bytes
// must survive playback. This decoder intentionally does not call parseMidi/writeMidi.
const vlq=n=>{const result=[n&127];while((n=Math.floor(n/128)))result.unshift((n&127)|128);return result;};
function sourceMidi(){const events=[[0,[0xb0,64,127]],[0,[0xb0,10,127]],[0,[0xc0,42]],[0,[0x90,69,100]],[240,[0xe0,0,0]],[480,[0x80,69,67]],[600,[0xf0,3,0x7d,1,0xf7]],[1920,[0xb0,64,0]],[2880,[0xff,47,0]]];let last=0;const rows=[];for(const [tick,bytes]of events){rows.push(...vlq(tick-last),...bytes);last=tick;}const track=Buffer.alloc(8);track.write('MTrk');track.writeUInt32BE(rows.length,4);return Buffer.concat([Buffer.from([77,84,104,100,0,0,0,6,0,0,0,1,3,192]),track,Buffer.from(rows)]);}
function wireRows(bytes){const b=Buffer.from(bytes),all=[];assert.equal(b.toString('ascii',0,4),'MThd');let p=8+b.readUInt32BE(4);for(let t=0;t<b.readUInt16BE(10);t++){assert.equal(b.toString('ascii',p,p+4),'MTrk');const end=p+8+b.readUInt32BE(p+4);p+=8;let tick=0,running=0;const number=()=>{let n=0,x;do{x=b[p++];n=n*128+(x&127);}while(x&128);return n;};while(p<end){tick+=number();let status=b[p];if(status&128)p++;else status=running;let metaType,length;if(status===255){running=0;metaType=b[p++];length=number();}else if(status===240||status===247){running=0;length=number();}else{running=status;length=[12,13].includes(status>>4)?1:2;}assert.ok(p+length<=end);const data=[...b.subarray(p,p+length)];p+=length;if(status!==255||![3,47,81,88].includes(metaType))all.push({tick,status,...(metaType===undefined?{}:{metaType}),data});}assert.equal(p,end);}assert.equal(p,b.length);return all;}

test('imported SMF controllers change preview sound while playback leaves both format 0 and 1 source streams intact',async t=>{
 const s=await fixture(t),source=sourceMidi(),st=await get(s),response=await fetch(s.url+`/api/import/midi?name=Measured.mid&expectedRevision=${st.project.revision}`,{method:'POST',headers:{'Content-Type':'audio/midi','X-Newdaw-Document':st.session.document.id},body:source});assert.equal(response.status,200,await response.clone().text());const before=await get(s),streams=[await midi(s,0),await midi(s,1)],{wav,job}=await render(s);silent(wav,.1,.9,0);audible(wav,.4,.8,1);near(frequency(wav,.4,.8,1),440*2**(-2/12),.15,'imported bend');silent(wav,1.1,1.3,1);assert.match(job.stats.warnings.join('\n'),/program/i);for(const format of [0,1]){const after=await midi(s,format);assert.deepEqual(after,streams[format]);assert.deepEqual(wireRows(after),wireRows(source));}assert.deepEqual((await get(s)).project,before.project);assert.equal(before.project.clips[0].notes[0].releaseVelocity,67);
});

test('event-only controller clips remain silent and cannot leak channel state into a later independent render',async t=>{
 const s=await fixture(t);await seed(s,{notes:[],events:[cc(0,64,127),cc(0,7,0),bend(0,0,0)]});let result=await render(s);silent(result.wav,0,1.5);ok(await command(s,'midi.events.remove',{clipId:'clip',eventIds:['event-0','event-1','event-2']}));ok(await command(s,'midi.notes.add',{clipId:'clip',notes:[note()]}));result=await render(s);audible(result.wav,.1,.8);near(frequency(result.wav,.1,.2),440,.15,'new render uses default channel state');
});

test('render end releases a hanging pedal only in output, warns on truncation and never inserts source reset events',async t=>{
 const s=await fixture(t);await seed(s,{lengthTicks:1920,notes:[note('note',0,{durationTicks:480})],events:[cc(0,64,127)]});const before=await get(s),wire=await midi(s),full=await render(s,{tailSeconds:.2});audible(full.wav,.4,.9);silent(full.wav,1.1,1.2);assert.match(full.job.stats.warnings.join('\n'),/sustain|pedal/i);const cut=await render(s,{durationSeconds:.6});assert.equal(cut.wav.frames,4800);audible(cut.wav,.4,.59);assert.match(cut.job.stats.warnings.join('\n'),/cut|truncat/i);assert.deepEqual((await get(s)).project,before.project);assert.deepEqual(await midi(s),wire);assert.deepEqual((await render(s,{tailSeconds:.2})).bytes,full.bytes);
});

test('stale revision and document guards reject playback jobs before they can render a different project snapshot',async t=>{
 const s=await fixture(t);await seed(s,{events:[cc(0,7,64)]});const old=await get(s);ok(await command(s,'project.rename',{name:'Current snapshot'}));let result=await post(s,'/api/render',{expectedRevision:old.project.revision,durationSeconds:1.5});assert.equal(result.status,409);assert.equal(result.body.errors[0].code,'REVISION_CONFLICT');const current=await get(s);result=await post(s,'/api/render',{expectedRevision:current.project.revision,durationSeconds:1.5},'obsolete-document');assert.equal(result.status,409);assert.equal(result.body.errors[0].code,'DOCUMENT_CONFLICT');assert.deepEqual((await get(s)).project,current.project);assert.equal((await render(s)).job.revision,current.project.revision);
});
