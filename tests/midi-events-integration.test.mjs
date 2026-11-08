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
async function fixture(t,options={}){
 const directory=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'newdaw-midi-http-'))),initialPath=path.join(directory,'Events.newdaw.json'),recentPath=path.join(directory,'recent.json');
 await fs.writeFile(initialPath,JSON.stringify(createProject({name:'MIDI interchange',sampleRate:8000}),null,2)+'\n');let server;
 t.after(async()=>{await server?.close();await fs.rm(directory,{recursive:true,force:true});});
 const open=projectPath=>startServer({projectPath,recentPath,port:0,demo:false,quiet:true,backupPollMs:60000,...options});server=await open(initialPath);
 return {directory,initialPath,get url(){return server.url;},async reopen(){const filename=(await get(this)).session.document.projectPath;await server.close();server=await open(filename);}};
}
async function get(s,route='/api/state'){const r=await fetch(s.url+route);assert.equal(r.status,200,await r.clone().text());return r.json();}
async function post(s,route,input,{documentId}={}){documentId??=(await get(s)).session.document.id;const r=await fetch(s.url+route,{method:'POST',headers:{'Content-Type':'application/json','X-Newdaw-Document':documentId},body:JSON.stringify(input)});return {status:r.status,body:await r.json()};}
function ok(r,status=200){assert.equal(r.status,status,JSON.stringify({status:r.body.status,errors:r.body.errors}));return r.body;}
function error(r,status,code){assert.equal(r.status,status,JSON.stringify({status:r.body.status,errors:r.body.errors}));assert.equal(r.body.applied,false);if(code)assert.equal(r.body.errors[0].code,code,JSON.stringify({status:r.body.status,errors:r.body.errors}));return r.body;}
async function command(s,name,args={},extra={},options={}){const st=await get(s);return post(s,'/api/command',{command:name,arguments:args,expectedRevision:st.project.revision,...extra},options);}
async function doc(s,route,args={}){const st=await get(s);return post(s,'/api/document/'+route,{expectedRevision:st.project.revision,expectedDocumentId:st.session.document.id,...args});}
async function cli(s,...args){return JSON.parse((await exec(process.execPath,['src/cli.mjs',...args,'--url',s.url],{cwd:root,timeout:15000})).stdout);}
async function upload(s,bytes=source(),extras={}){const st=await get(s),r=await fetch(`${s.url}/api/import/midi?name=Source.mid&expectedRevision=${extras.revision??st.project.revision}${extras.query??''}`,{method:'POST',headers:{'Content-Type':'audio/midi','X-Newdaw-Document':extras.documentId??st.session.document.id},body:bytes});return {status:r.status,body:await r.json()};}
async function output(s,format=1){const r=await fetch(s.url+'/api/export/midi?format='+format);assert.equal(r.status,200,await r.clone().text());assert.equal(r.headers.get('X-NewDAW-MIDI-Format'),String(format));return {wire:decode(new Uint8Array(await r.arrayBuffer())),loss:r.headers.get('X-NewDAW-Loss-Report')};}
const first=state=>state.project.clips[0];
const noRevision=project=>{const copy=structuredClone(project);delete copy.revision;return copy;};
const vlq=n=>{const result=[n&127];while((n=Math.floor(n/128)))result.unshift((n&127)|128);return result;};
const event=(tick,...bytes)=>({tick,bytes});
const payload=(tick,status,data,type)=>event(tick,status,...(type===undefined?[]:[type]),...vlq(data.length),...data);
const end=tick=>event(tick,255,47,0);
function smf(tracks,format=tracks.length===1?0:1,ppq=960){
 const header=Buffer.from([77,84,104,100,0,0,0,6,0,format,tracks.length>>8,tracks.length&255,ppq>>8,ppq&255]),parts=[header];
 for(const rows of tracks){let last=0;const bytes=[];for(const row of rows){bytes.push(...vlq(row.tick-last),...row.bytes);last=row.tick;}const chunk=Buffer.alloc(8);chunk.write('MTrk');chunk.writeUInt32BE(bytes.length,4);parts.push(chunk,Buffer.from(bytes));}return Buffer.concat(parts);
}
// Deliberately independent of parseMidi/writeMidi/core helper code: inspect wire bytes.
function decode(input){
 const b=Buffer.from(input);assert.equal(b.toString('ascii',0,4),'MThd');let p=8+b.readUInt32BE(4);const tracks=[];
 for(let ti=0;ti<b.readUInt16BE(10);ti++){
  assert.equal(b.toString('ascii',p,p+4),'MTrk');const stop=p+8+b.readUInt32BE(p+4);p+=8;let tick=0,running=0;const rows=[];
  const number=()=>{let n=0,c=0,x;do{assert.ok(p<stop);x=b[p++];n=n*128+(x&127);assert.ok(++c<=4);}while(x&128);return n;};
  while(p<stop){tick+=number();let status=b[p];if(status&128)p++;else{assert.ok(running);status=running;}let metaType,length;if(status===255){running=0;metaType=b[p++];length=number();}else if(status===240||status===247){running=0;length=number();}else{assert.ok(status>=128&&status<240);running=status;length=[12,13].includes(status>>4)?1:2;}assert.ok(p+length<=stop);rows.push({tick,status,...(metaType===undefined?{}:{metaType}),data:[...b.subarray(p,p+length)]});p+=length;}
  assert.equal(p,stop);tracks.push(rows);
 }assert.equal(p,b.length);return {format:b.readUInt16BE(8),ppq:b.readUInt16BE(12),tracks};
}
const retained=rows=>rows.filter(e=>e.status!==255||![3,47,81,88].includes(e.metaType));
const sourceRows=()=>[
 event(0,0xb0,0,4),event(0,0xb0,32,2),event(0,0xc0,53),event(0,0x90,60,101),
 event(0,0xb0,64,127),event(120,0xa0,60,91),event(120,0xa0,64,17),event(120,0xd0,31),
 event(240,0xe0,0,0),event(240,0xe0,0,64),event(240,0xe0,127,127),
 payload(240,0xf0,[0x7d,1,0xf7]),payload(240,0xf7,[0x90,0x40,0x7f]),
 event(480,0x90,64,99),event(480,0x80,60,73),event(480,0x8f,62,41),
 event(960,0x90,64,0),event(960,0xb0,64,0),payload(960,255,[255,128,0],5),end(1200)
];
const source=()=>smf([sourceRows()]);

// These are transport/persistence acceptance tests, not claims of controller synth playback.
test('HTTP SMF import/export preserves raw channel states, packets, metadata and release velocity in source order',async t=>{
 const s=await fixture(t),imported=ok(await upload(s)),clip=first(imported);assert.equal(clip.notes.length,2);assert.ok(clip.events.length>10);assert.equal(clip.notes[0].releaseVelocity,73);assert.equal(clip.notes[1].noteOffEncoding,'zeroVelocityNoteOn');assert.equal(clip.notes[1].releaseVelocity,0);
 assert.ok(imported.warnings.some(x=>x.includes('program changes, pressure, SysEx and unsupported controllers remain preservation-only')));assert.equal(imported.capabilities.midiEvents,true);assert.deepEqual(imported.capabilities.midiFormats,[0,1]);
 const exported=await output(s);assert.equal(exported.wire.format,1);assert.equal(exported.wire.ppq,960);assert.deepEqual(retained(exported.wire.tracks[1]),retained(decode(source()).tracks[0]));assert.match(exported.loss,/release velocity/);assert.equal(exported.wire.tracks[1].at(-1).tick,clip.lengthTicks);
});

test('HTTP format 0 merges source tracks deterministically and format 1 keeps independent event-only tracks',async t=>{
 const s=await fixture(t),second=[event(0,0xbf,11,80),event(0,0xcf,7),event(960,0xdf,55),end(1920)],bytes=smf([sourceRows(),second]);ok(await upload(s,bytes));
 const one=(await output(s,1)).wire;assert.equal(one.tracks.length,3);assert.deepEqual(retained(one.tracks[1]),retained(decode(bytes).tracks[0]));assert.deepEqual(retained(one.tracks[2]),retained(decode(bytes).tracks[1]));
 const zero=await output(s,0);assert.equal(zero.wire.tracks.length,1);assert.match(zero.loss,/merges tracks/);const expected=decode(bytes).tracks.flatMap((rows,track)=>retained(rows).map((x,index)=>({...x,track,index}))).sort((a,b)=>a.tick-b.tick||a.track-b.track||a.index-b.index).map(({track,index,...x})=>x);assert.deepEqual(retained(zero.wire.tracks[0]),expected);
});

test('HTTP event-only import retains CC release, SysEx and opaque metadata without requiring notes',async t=>{
 const s=await fixture(t),bytes=smf([[event(0,0xb0,64,127),event(5000,0xb0,64,0),end(5000)],[payload(0,0xf7,[0xff,0xf8]),end(960)],[payload(0,255,[0,127,255],0x7f),end(960)]]);const result=ok(await upload(s,bytes));assert.equal(result.project.clips.length,3);assert.ok(result.project.clips.every(c=>c.notes.length===0));assert.ok(result.project.clips[0].lengthTicks>=5000);const exported=(await output(s)).wire;for(let i=0;i<3;i++)assert.deepEqual(retained(exported.tracks[i+1]),retained(decode(bytes).tracks[i]));
});

test('real CLI imports MIDI, edits a raw event and exports both formats with an explicit loss report',async t=>{
 const s=await fixture(t),filename=path.join(s.directory,'fixture.mid');await fs.writeFile(filename,source());const imported=await cli(s,'import',filename);assert.equal(imported.applied,true);const st=await get(s),clip=first(st),cc=clip.events.find(e=>e.status===0xb0&&e.data[0]===64);
 const changed=await cli(s,'command','midi.events.update',JSON.stringify({clipId:clip.id,eventId:cc.id,data:[64,63]}));assert.equal(changed.applied,true);
 for(const format of [0,1]){const out=path.join(s.directory,`out-${format}.mid`),report=await cli(s,'export-midi',out,'--midi-format',String(format));assert.equal(report.midiFormat,format);assert.ok(report.warnings[0].includes('stored channel'));const wire=decode(await fs.readFile(out));assert.equal(wire.format,format);assert.ok(wire.tracks.flatMap(retained).some(e=>e.status===0xb0&&e.data[0]===64&&e.data[1]===63));}
});

test('raw MIDI add update remove share CLI/HTTP history and emit committed SSE snapshots',async t=>{
 const s=await fixture(t);ok(await upload(s));const clip=first(await get(s)),response=await fetch(s.url+'/api/events'),reader=response.body.getReader();t.after(()=>reader.cancel().catch(()=>{}));await reader.read();
 const eventValue={id:'added-cc',tick:500,kind:'channel',status:0xb3,data:[11,70]};const added=await cli(s,'command','midi.events.add',JSON.stringify({clipId:clip.id,events:[eventValue]}));assert.equal(added.applied,true);const text=new TextDecoder().decode((await reader.read()).value);assert.match(text,/added-cc/);assert.match(text,/"data":\[11,70\]/);await reader.cancel();
 const initial=first(await get(s)).events.find(e=>e.id==='added-cc');assert.ok(Number.isSafeInteger(initial.order));ok(await command(s,'midi.events.update',{clipId:clip.id,eventId:initial.id,channel:15,tick:600,data:[11,90]}));let actual=first(await get(s)).events.find(e=>e.id===initial.id);assert.equal(actual.status,0xbf);assert.equal(actual.tick,600);assert.deepEqual(actual.data,[11,90]);
 ok(await command(s,'midi.events.remove',{clipId:clip.id,eventIds:[initial.id]}));assert.ok(!first(await get(s)).events.some(e=>e.id===initial.id));ok(await command(s,'history.undo'));assert.deepEqual(first(await get(s)).events.find(e=>e.id===initial.id),actual);ok(await command(s,'history.redo'));assert.ok(!first(await get(s)).events.some(e=>e.id===initial.id));
});

test('raw MIDI dry run and failing batch leave bytes, source order, revision and history unchanged',async t=>{
 const s=await fixture(t);ok(await upload(s));const before=await get(s),clip=first(before),disk=await fs.readFile(s.initialPath),eventValue={id:'dry-event',tick:300,kind:'channel',status:0xd2,data:[10]};
 assert.equal(ok(await command(s,'midi.events.add',{clipId:clip.id,events:[eventValue]},{dryRun:true})).applied,false);
 error(await command(s,'batch',{commands:[{command:'midi.events.add',arguments:{clipId:clip.id,events:[eventValue]}},{command:'midi.events.remove',arguments:{clipId:clip.id,eventIds:['missing-event']}}]}),422);
 const after=await get(s);assert.deepEqual(after.project,before.project);assert.deepEqual(after.historyView,before.historyView);assert.deepEqual(await fs.readFile(s.initialPath),disk);
});

test('MIDI event schema rejects immutable kinds, invalid payloads, managed meta and same-tick source-order collisions atomically',async t=>{
 const s=await fixture(t);ok(await upload(s));const before=await get(s),clip=first(before),raw=clip.events[0];
 for(const args of [{eventId:raw.id,status:0xc0},{eventId:raw.id,kind:'sysex'},{eventId:raw.id,data:[64,128]},{eventId:raw.id,tick:clip.lengthTicks+1},{eventId:raw.id,tick:clip.notes[0].startTick,order:clip.notes[0].onOrder}])error(await command(s,'midi.events.update',{clipId:clip.id,...args}),Object.hasOwn(args,'order')?409:422);
 for(const eventValue of [{kind:'channel',status:0x90,data:[60,1]},{kind:'channel',status:0xc0,data:[1,2]},{kind:'meta',status:255,metaType:81,data:[7,161,32]},{kind:'sysex',status:241,data:[]}])error(await command(s,'midi.events.add',{clipId:clip.id,events:[{tick:10,...eventValue}]}),422);
 const after=await get(s);assert.deepEqual(after.project,before.project);assert.deepEqual(after.historyView,before.historyView);
});

test('note release editing reaches MIDI bytes and rejects nonzero release with zero-note-on encoding',async t=>{
 const s=await fixture(t);ok(await upload(s));const clip=first(await get(s)),note=clip.notes[0],zero=clip.notes[1];ok(await command(s,'midi.notes.update',{clipId:clip.id,noteId:note.id,releaseVelocity:127}));
 assert.ok((await output(s)).wire.tracks.flatMap(retained).some(e=>e.status===0x80&&e.data[0]===60&&e.data[1]===127));const before=await get(s);error(await command(s,'midi.notes.update',{clipId:clip.id,noteId:zero.id,releaseVelocity:1}),422,'INVALID_NOTE_RELEASE');assert.deepEqual((await get(s)).project,before.project);
 ok(await command(s,'midi.notes.update',{clipId:clip.id,noteId:zero.id,noteOffEncoding:'noteOff',releaseVelocity:42}));assert.ok((await output(s)).wire.tracks.flatMap(retained).some(e=>e.status===0x80&&e.data[0]===64&&e.data[1]===42));
});

test('saving and restarting preserve raw MIDI and release fields together with persistent undo redo',async t=>{
 const s=await fixture(t);ok(await upload(s));const clip=first(await get(s)),raw=clip.events[0];ok(await command(s,'midi.events.update',{clipId:clip.id,eventId:raw.id,data:[0,9]}));ok(await doc(s,'save'));const before=await get(s),wire=(await output(s)).wire;assert.equal(before.session.document.dirty,false);await s.reopen();const resumed=await get(s);assert.deepEqual(resumed.project,before.project);assert.deepEqual(resumed.historyView,before.historyView);assert.deepEqual((await output(s)).wire,wire);
 ok(await command(s,'history.undo'));assert.deepEqual(first(await get(s)).events.find(e=>e.id===raw.id).data,raw.data);ok(await command(s,'history.redo'));assert.deepEqual(noRevision((await get(s)).project),noRevision(before.project));
});

test('Save New Version preserves raw MIDI and history while activating a separate persisted project file',async t=>{
 const s=await fixture(t);ok(await upload(s));const before=await get(s),oldBytes=await fs.readFile(s.initialPath),wire=(await output(s)).wire;ok(await doc(s,'save-as',{mode:'version'}));const after=await get(s);assert.notEqual(after.session.document.projectPath,s.initialPath);assert.deepEqual(after.project.clips,before.project.clips);assert.deepEqual(await fs.readFile(s.initialPath),oldBytes);assert.deepEqual((await output(s)).wire,wire);assert.equal(after.history.canUndo,true);await s.reopen();assert.deepEqual((await get(s)).project,after.project);assert.deepEqual((await output(s)).wire,wire);
});

test('track and clip duplication preserve payload/order with new IDs and independent edits',async t=>{
 const s=await fixture(t);ok(await upload(s));const before=await get(s),clip=first(before);ok(await command(s,'track.duplicate',{trackId:clip.trackId,newTrackId:'copy-track'}));let state=await get(s),copy=state.project.clips.find(c=>c.trackId==='copy-track');const strip=values=>values.map(({id,...x})=>x);assert.deepEqual(strip(copy.events),strip(clip.events));assert.deepEqual(strip(copy.notes),strip(clip.notes));assert.ok(copy.events.every(e=>!clip.events.some(x=>x.id===e.id)));
 ok(await command(s,'midi.events.update',{clipId:copy.id,eventId:copy.events[0].id,data:[0,99]}));assert.deepEqual(first(await get(s)).events,clip.events);
 ok(await command(s,'clip.duplicate',{clipId:clip.id,count:1}));state=await get(s);const repeated=state.project.clips.find(c=>c.id!==clip.id&&c.trackId===clip.trackId);assert.deepEqual(strip(repeated.events),strip(clip.events));assert.equal(repeated.startTick,clip.startTick+clip.lengthTicks);assert.equal(new Set(state.project.clips.flatMap(c=>[...c.notes,...(c.events??[])].map(x=>x.id))).size,state.project.clips.reduce((n,c)=>n+c.notes.length+(c.events?.length??0),0));
});

test('clip split partitions boundary MIDI events without losing cross-clip source order and undo reconstructs the source',async t=>{
 const s=await fixture(t);ok(await upload(s));const before=await get(s),clip=first(before),original=(await output(s)).wire;const split=ok(await command(s,'clip.split',{clipId:clip.id,atTick:480}));assert.ok(split.warnings?.length||split.changes?.warnings?.length,'split should disclose controller chase limitation');const state=await get(s),left=state.project.clips.find(c=>c.id===clip.id),right=state.project.clips.find(c=>c.id!==clip.id);assert.ok(left.events.every(e=>e.tick<480));for(const e of clip.events.filter(e=>e.tick>=480)){const r=right.events.find(x=>x.id===e.id);assert.deepEqual(r,{...e,tick:e.tick-480});}assert.deepEqual((await output(s)).wire,original);ok(await command(s,'history.undo'));assert.deepEqual(noRevision((await get(s)).project),noRevision(before.project));
});

test('clip move offsets raw events exactly once and shortening cannot silently discard an out-of-range event',async t=>{
 const s=await fixture(t);ok(await upload(s));const clip=first(await get(s)),before=(await output(s)).wire;ok(await command(s,'clip.move',{clipId:clip.id,startTick:240}));const moved=first(await get(s));assert.deepEqual(moved.events,clip.events);assert.deepEqual(retained((await output(s)).wire.tracks[1]),retained(before.tracks[1]).map(e=>({...e,tick:e.tick+240})));
 ok(await command(s,'midi.events.add',{clipId:clip.id,events:[{tick:1500,kind:'channel',status:0xb0,data:[11,0]}]}));const state=await get(s);error(await command(s,'clip.update',{clipId:clip.id,lengthTicks:1000}),422,'MIDI_EVENT_OUT_OF_BOUNDS');assert.deepEqual((await get(s)).project,state.project);
});

test('failed MIDI event persistence rolls back project, history and export without a false commit',async t=>{
 let fail=false;const s=await fixture(t,{persistProject:async(filename,project)=>{if(fail)throw Error('injected MIDI commit failure');await saveProject(filename,project);}});ok(await upload(s));const before=await get(s),clip=first(before),disk=await fs.readFile(s.initialPath),wire=(await output(s)).wire;fail=true;error(await command(s,'midi.events.update',{clipId:clip.id,eventId:clip.events[0].id,data:[0,99]}),500,'SAVE_FAILED');assert.deepEqual((await get(s)).project,before.project);assert.deepEqual((await get(s)).historyView,before.historyView);assert.deepEqual(await fs.readFile(s.initialPath),disk);assert.deepEqual((await output(s)).wire,wire);fail=false;await s.reopen();assert.deepEqual((await get(s)).project,before.project);
});

test('stale revision and stale document tokens reject MIDI mutations and binary import',async t=>{
 const s=await fixture(t);ok(await upload(s));const before=await get(s),clip=first(before);ok(await command(s,'project.rename',{name:'New revision'}));error(await command(s,'midi.events.remove',{clipId:clip.id,eventIds:[clip.events[0].id]},{expectedRevision:before.project.revision}),409,'REVISION_CONFLICT');error(await upload(s,source(),{revision:before.project.revision}),409,'REVISION_CONFLICT');const current=await get(s);error(await command(s,'midi.events.remove',{clipId:clip.id,eventIds:[clip.events[0].id]},{},{documentId:'old-document'}),409,'DOCUMENT_CONFLICT');error(await upload(s,source(),{documentId:'old-document'}),409,'DOCUMENT_CONFLICT');assert.deepEqual((await get(s)).project,current.project);
});

test('malformed and managed-meta-only MIDI imports fail before tempo or history changes',async t=>{
 const s=await fixture(t),before=await get(s),disk=await fs.readFile(s.initialPath);error(await upload(s,Buffer.from('not SMF')),422,'UNSUPPORTED_MIDI');error(await upload(s,smf([[payload(0,255,[9,39,192],81),end(960)]]),{query:'&midiTempo=preserve'}),422,'EMPTY_MIDI');assert.deepEqual((await get(s)).project,before.project);assert.deepEqual((await get(s)).historyView,before.historyView);assert.deepEqual(await fs.readFile(s.initialPath),disk);
});

test('format query and CLI format errors cannot overwrite outputs or alter a MIDI project',async t=>{
 const s=await fixture(t);ok(await upload(s));const before=await get(s);for(const query of ['format=2','format=0&format=1','format=','format=1&typo=1']){const response=await fetch(s.url+'/api/export/midi?'+query);assert.equal(response.status,422);assert.equal((await response.json()).errors[0].code,'INVALID_MIDI_FORMAT');}
 const destination=path.join(s.directory,'keep.mid');await fs.writeFile(destination,'original');await assert.rejects(cli(s,'export-midi',destination,'--midi-format','2'));await assert.rejects(cli(s,'state','--midi-format','0'));assert.equal(await fs.readFile(destination,'utf8'),'original');assert.deepEqual((await get(s)).project,before.project);
});

test('legacy note-only project reads and MIDI export preserve original JSON without materializing optional raw fields',async t=>{
 const s=await fixture(t);ok(await command(s,'batch',{commands:[{command:'track.add',arguments:{id:'old-track',type:'midi',name:'Legacy'}},{command:'clip.add',arguments:{id:'old-clip',trackId:'old-track',type:'midi',name:'Legacy notes',startTick:0,lengthTicks:960,notes:[{id:'old-note',startTick:0,durationTicks:480,pitch:60,velocity:100,channel:0}]}}]}));const before=await get(s),disk=await fs.readFile(s.initialPath);assert.equal(Object.hasOwn(first(before),'events'),false);assert.equal(Object.hasOwn(first(before).notes[0],'releaseVelocity'),false);const wire=(await output(s)).wire;assert.deepEqual(retained(wire.tracks[1]).map(e=>[e.tick,e.status,e.data]),[[0,0x90,[60,100]],[480,0x80,[60,0]]]);await s.reopen();assert.deepEqual((await get(s)).project,before.project);assert.deepEqual(await fs.readFile(s.initialPath),disk);
});

test('first Save publishes an Untitled MIDI document without changing raw fields, revision, history or stable workspace identity',async t=>{
 const s=await fixture(t),folder=path.join(s.directory,'Untitled MIDI');await fs.mkdir(folder);let workspace=await get(s,'/api/workspace');const plan=ok(await post(s,'/api/workspace/new/plan',{expectedWorkspaceRevision:workspace.revision,projectFolder:folder,sampleRate:8000,mode:'active'}));workspace=await get(s,'/api/workspace');ok(await post(s,'/api/workspace/new',{expectedWorkspaceRevision:workspace.revision,planId:plan.id,currentPolicy:'preserve'}));ok(await upload(s));const before=await get(s),wire=(await output(s)).wire,target=path.join(folder,'Saved MIDI.json');assert.equal(before.session.document.neverSaved,true);ok(await doc(s,'save',{outputPath:target}));const after=await get(s);assert.equal(after.session.document.neverSaved,false);assert.notEqual(after.session.document.id,before.session.document.id);assert.equal(after.workspace.activeId,before.workspace.activeId);assert.deepEqual(after.project,before.project);assert.deepEqual(after.historyView,before.historyView);assert.deepEqual(JSON.parse(await fs.readFile(target)),before.project);await s.reopen();assert.deepEqual((await get(s)).project,before.project);assert.deepEqual((await output(s)).wire,wire);
});

test('note quantize transpose velocity and legato keep raw controller events independent and preserve release metadata',async t=>{
 const s=await fixture(t);ok(await upload(s));const before=await get(s),clip=first(before),release=clip.notes.map(n=>[n.id,n.releaseVelocity,n.noteOffEncoding,n.onOrder,n.offOrder]);
 for(const [name,args] of [['midi.notes.quantize',{gridTicks:200}],['midi.notes.transpose',{semitones:2}],['midi.notes.velocity',{mode:'set',value:80}],['midi.notes.legato',{gapTicks:20}]]){ok(await command(s,name,{clipId:clip.id,...args}));assert.deepEqual(first(await get(s)).events,clip.events);}
 assert.deepEqual(first(await get(s)).notes.map(n=>[n.id,n.releaseVelocity,n.noteOffEncoding,n.onOrder,n.offOrder]),release);for(let i=0;i<4;i++)ok(await command(s,'history.undo'));assert.deepEqual(noRevision((await get(s)).project),noRevision(before.project));
});

test('binary MIDI import commit failure rolls back tempo, tracks, events and history as one transaction',async t=>{
 let fail=true;const s=await fixture(t,{persistProject:async(filename,project)=>{if(fail)throw Error('injected MIDI import failure');await saveProject(filename,project);}}),before=await get(s),disk=await fs.readFile(s.initialPath);error(await upload(s),500,'SAVE_FAILED');const after=await get(s);assert.deepEqual(after.project,before.project);assert.deepEqual(after.historyView,before.historyView);assert.deepEqual(await fs.readFile(s.initialPath),disk);fail=false;ok(await upload(s));assert.deepEqual(retained((await output(s)).wire.tracks[1]),retained(decode(source()).tracks[0]));
});

test('explicit same-tick order edits change the exported stream predictably and undo restores the imported order',async t=>{
 const s=await fixture(t);ok(await upload(s));const clip=first(await get(s)),bank=clip.events[0],original=retained((await output(s)).wire.tracks[1]);ok(await command(s,'midi.events.update',{clipId:clip.id,eventId:bank.id,order:100}));const changed=retained((await output(s)).wire.tracks[1]),atZero=changed.filter(e=>e.tick===0);assert.deepEqual(atZero.at(-1),original[0]);assert.deepEqual(atZero.slice(0,-1),original.filter(e=>e.tick===0).slice(1));assert.deepEqual(changed.filter(e=>e.tick!==0),original.filter(e=>e.tick!==0));ok(await command(s,'history.undo'));assert.deepEqual(retained((await output(s)).wire.tracks[1]),original);
});

test('HTTP accepts a full 1 MiB raw SysEx payload beyond 2 MiB JSON and exports every byte after add and update',async t=>{
 const s=await fixture(t);ok(await upload(s));const clip=first(await get(s)),data=new Array(1024*1024).fill(255),input={clipId:clip.id,events:[{id:'large-sysex',tick:1000,kind:'sysex',status:0xf7,data}]};assert.ok(Buffer.byteLength(JSON.stringify(input))>2*1024*1024);ok(await command(s,'midi.events.add',input));let value=(await output(s)).wire.tracks[1].find(e=>e.tick===1000&&e.status===0xf7);assert.equal(value.data.length,data.length);assert.ok(value.data.every(x=>x===255));data.fill(254);ok(await command(s,'midi.events.update',{clipId:clip.id,eventId:'large-sysex',data}));value=(await output(s)).wire.tracks[1].find(e=>e.tick===1000&&e.status===0xf7);assert.equal(value.data.length,data.length);assert.ok(value.data.every(x=>x===254));assert.deepEqual(first(await get(s)).events.find(e=>e.id==='large-sysex').data,data);
});

test('HTTP clip duplication exports outgoing pedal release before the next independent clip pedal press at their shared boundary',async t=>{
 const s=await fixture(t),bytes=smf([[event(0,0xb0,64,127),event(3840,0xb0,64,0),end(3840)]]);ok(await upload(s,bytes));const clip=first(await get(s));assert.equal(clip.lengthTicks,3840);ok(await command(s,'clip.duplicate',{clipId:clip.id,count:1}));const rows=retained((await output(s)).wire.tracks[1]);assert.deepEqual(rows.map(e=>[e.tick,e.status,e.data]),[[0,0xb0,[64,127]],[3840,0xb0,[64,0]],[3840,0xb0,[64,127]],[7680,0xb0,[64,0]]]);await s.reopen();assert.deepEqual(retained((await output(s)).wire.tracks[1]),rows);
});
