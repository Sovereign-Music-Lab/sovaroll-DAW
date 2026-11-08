import test from 'node:test';
import assert from 'node:assert/strict';
import {Engine,createProject,validateProject} from '../src/core/engine.mjs';
import {compileMidiStreams} from '../src/media/midi-stream.mjs';
import {writeMidi,parseMidi} from '../src/media/midi.mjs';
import {renderProject,projectDurationSeconds} from '../src/media/render.mjs';
const run=(e,command,args={},extra={})=>{const r=e.execute({command,arguments:args,expectedRevision:e.project.revision,...extra});assert.notEqual(r.status,'error',JSON.stringify(r.errors));return r;};
const note=(id,startTick,durationTicks=120,extra={})=>({id,pitch:60,startTick,durationTicks,velocity:90,channel:0,...extra});
const cc=(id,tick,value,controller=11,extra={})=>({id,tick,kind:'channel',status:176,data:[controller,value],...extra});
function fixture({notes=[note('n',480)],events=[],lengthTicks=1920}={}){const e=new Engine(createProject({sampleRate:8000}));run(e,'track.add',{id:'t',type:'midi',name:'Source'});run(e,'clip.add',{id:'c',trackId:'t',type:'midi',name:'Source part',lengthTicks,notes,events});return e;}
const merge=(e,args={},extra={})=>run(e,'midi.mergeLoop',{leftTick:480,rightTick:960,...args},extra);
const resultClip=(e,r)=>e.project.clips.find(c=>c.id===r.changes.merge.clipId);
const wire=(p,ids)=>compileMidiStreams(p,{trackIds:ids}).tracks.flatMap(t=>t.events.map(x=>[x.tick,x.status,...x.data]));

test('MIDI Merge: left inclusive right exclusive selection creates a new MIDI track and preserves source identities',()=>{
 const e=fixture({notes:[note('before',479),note('left',480),note('last',959),note('right',960)],events:[cc('a',479,20),cc('b',480,40),cc('d',960,90)]}),before=e.project,r=merge(e),c=resultClip(e,r);
 assert.equal(e.project.tracks.length,2);assert.equal(c.startTick,480);assert.equal(c.lengthTicks,480);assert.deepEqual(c.notes.map(n=>n.startTick),[0,479]);assert.deepEqual(c.events.map(x=>x.data[1]),[40]);assert.deepEqual(e.project.clips[0],before.clips[0]);assert.ok(c.notes.every(n=>!before.clips[0].notes.some(o=>o.id===n.id)));assert.equal(r.changes.merge.newTrack,true);
});
test('MIDI Merge: note tails remain full beyond nominal part end in model SMF0 SMF1 and audible render duration',()=>{
 const e=fixture({notes:[note('long',900,900,{releaseVelocity:47})]}),r=merge(e),c=resultClip(e,r);assert.equal(c.lengthTicks,480);assert.equal(c.allowNoteTails,true);assert.equal(c.notes[0].durationTicks,900);
 const p=e.project;p.tracks=p.tracks.filter(t=>t.id===c.trackId);p.clips=[c];validateProject(p);assert.equal(projectDurationSeconds(p),1800/1920);
 for(const format of [0,1]){const parsed=parseMidi(writeMidi(p,{format}));const n=parsed.tracks.flatMap(t=>t.notes)[0];assert.equal(n.startTick,900);assert.equal(n.durationTicks,900);assert.equal(n.releaseVelocity,47);}
 const audio=renderProject(p);assert.ok(audio.channels[0].slice(7000,7400).some(n=>Math.abs(n)>.0001));
});
test('MIDI Merge: first selected MIDI destination is used independently of source selection',()=>{
 const e=fixture();run(e,'track.add',{id:'second',type:'midi'});run(e,'track.add',{id:'third',type:'midi'});const r=merge(e,{selectedTrackIds:['third','second']});assert.equal(r.changes.merge.trackId,'third');assert.equal(e.project.tracks.length,3);assert.equal(resultClip(e,r).notes.length,1);
});
test('MIDI Merge: track mute part mute and global solo exclude source material without deleting it',()=>{
 const e=fixture();run(e,'track.add',{id:'t2',type:'midi'});run(e,'clip.add',{id:'c2',trackId:'t2',type:'midi',lengthTicks:1920,notes:[note('n2',600)]});run(e,'clip.add',{id:'muted',trackId:'t',type:'midi',mute:true,lengthTicks:1920,notes:[note('m',500)]});run(e,'track.update',{trackId:'t2',mute:true});let r=merge(e);assert.equal(resultClip(e,r).notes.length,1);run(e,'history.undo');run(e,'track.update',{trackId:'t2',mute:false,solo:true});r=merge(e);assert.equal(resultClip(e,r).notes[0].startTick,120);assert.equal(resultClip(e,r).notes.length,1);assert.equal(e.project.clips.find(c=>c.id==='muted').notes.length,1);
});
test('MIDI part mute: legacy and stateful offline paths silence muted notes while preserving source export',()=>{
 for(const events of [[],[cc('vol',0,90,7)]]){const e=fixture({events});run(e,'clip.update',{clipId:'c',mute:true});const audio=renderProject(e.project);assert.ok(audio.channels[0].every(n=>n===0));assert.equal(parseMidi(writeMidi(e.project)).tracks.flatMap(t=>t.notes).length,1);run(e,'history.undo');assert.ok(renderProject(e.project).channels[0].some(n=>Math.abs(n)>.001));}
});
test('MIDI Merge: Include Inserts applies track and part modifiers while off preserves delay and initial state',()=>{
 const e=fixture();run(e,'midi.modifiers.set',{trackId:'t',settings:{transpose:7,lengthRatio:{numerator:2,denominator:1}}});run(e,'midi.partModifiers.set',{clipId:'c',settings:{transpose:5}});run(e,'midi.trackParameters.set',{trackId:'t',settings:{delayMs:50,program:4}});
 let r=merge(e,{includeChase:true}),c=resultClip(e,r);assert.equal(c.notes[0].pitch,72);assert.equal(c.notes[0].startTick,96);assert.equal(c.notes[0].durationTicks,240);assert.equal(c.events[0].status,192);run(e,'history.undo');r=merge(e,{includeInserts:false});c=resultClip(e,r);assert.equal(c.notes[0].pitch,60);assert.equal(c.notes[0].startTick,96);assert.equal(c.notes[0].durationTicks,120);assert.equal(e.project.tracks[0].midiModifiers.transpose,7);
});
test('MIDI Merge: output onset policy handles modifiers moving notes into and out of locators',()=>{
 const e=fixture({notes:[note('before',450),note('inside',940)]});run(e,'midi.trackParameters.set',{trackId:'t',settings:{delayMs:50}});const c=resultClip(e,merge(e));assert.equal(c.notes.length,1);assert.equal(c.notes[0].startTick,66);assert.equal(c.notes[0].durationTicks,120);
});
test('MIDI Merge: Chase reconstructs program bank RPN reset and independent channel state before left',()=>{
 const e=fixture({events:[cc('bank',0,2,0),{id:'patch',tick:1,kind:'channel',status:192,data:[5]},cc('rpn1',2,0,101),cc('rpn2',3,0,100),cc('range',4,12,6),cc('increment',5,0,96),cc('old',10,10),cc('new',100,80),cc('other',101,50,11,{status:177}),cc('at',480,90)]});const r=merge(e,{includeChase:true}),c=resultClip(e,r);assert.equal(r.changes.merge.chasedEventCount,8);assert.deepEqual(c.events.map(x=>[x.status,...x.data]),[[176,0,2],[192,5],[176,101,0],[176,100,0],[176,6,12],[176,96,0],[176,11,80],[177,11,50],[176,11,90]]);assert.ok(c.events.every(x=>x.tick===0));assert.ok(c.events.at(-1).order<c.notes[0].onOrder);
});
test('MIDI Merge: Chase excludes held notes SysEx metadata and future state with explicit boundary warnings',()=>{
 const e=fixture({notes:[note('held',0,800),note('inside',600)],events:[{id:'sx',tick:0,kind:'sysex',status:240,data:[1,247]},{id:'text',tick:10,kind:'meta',status:255,metaType:1,data:[65]},cc('later',1100,100)]});const r=merge(e,{includeChase:true,chaseOptions:{notes:false,sysex:false}}),c=resultClip(e,r);assert.equal(c.notes.length,1);assert.equal(c.events.length,0);assert.ok(r.changes.warnings.some(x=>x.code==='MIDI_MERGE_CHASE_SCOPE'));
});
test('MIDI Merge: same tick order across sources and original release encoding is retained in merged wire',()=>{
 const e=fixture({notes:[note('a',480,120,{onOrder:2,offOrder:8,channel:2,noteOffEncoding:'zeroVelocityNoteOn',releaseVelocity:0})],events:[cc('aCC',480,80,11,{order:1})]});run(e,'track.add',{id:'t2',type:'midi'});run(e,'clip.add',{id:'c2',trackId:'t2',type:'midi',lengthTicks:1920,notes:[note('b',480,120,{onOrder:1,offOrder:9,pitch:67,channel:3})],events:[cc('bCC',480,40,11,{order:2,status:179})]});const r=merge(e),c=resultClip(e,r);assert.deepEqual(wire(e.project,[c.trackId]).slice(0,4),[[480,176,11,80],[480,146,60,90],[480,147,67,90],[480,179,11,40]]);assert.equal(c.notes[0].noteOffEncoding,'zeroVelocityNoteOn');assert.deepEqual(wire(e.project,[c.trackId]).at(-2),[600,146,60,0]);
});
test('MIDI Merge: editable curves become actual identical sampled messages in the new part',()=>{
 const e=fixture({events:[cc('a',0,10,11,{curve:{type:'ramp'}}),cc('b',1440,110)]});const expected=wire(e.project,['t']).filter(x=>x[0]>=480&&x[0]<960);const r=merge(e),c=resultClip(e,r);assert.ok(c.events.length>25);assert.ok(c.events.every(e=>!e.curve));assert.deepEqual(wire(e.project,[c.trackId]),expected);assert.ok(e.project.clips[0].events[0].curve);
});
test('MIDI Merge: Erase Destination deletes only onset-selected pairs and preserves outside tails and raw boundary',()=>{
 const e=fixture({notes:[note('outside',100,1500),note('inside',600,900),note('right',960)],events:[cc('left',479,20),cc('middle',480,40),cc('rightCC',960,80)]});const before=e.project,r=merge(e,{selectedTrackIds:['t'],eraseDestination:true}),p=e.project,merged=resultClip(e,r),outside=p.clips.filter(c=>c.id!==merged.id);assert.equal(outside.length,2);assert.deepEqual(outside.flatMap(c=>c.notes).map(n=>n.id),['outside','right']);assert.equal(outside[0].notes[0].durationTicks,1500);assert.equal(outside[0].allowNoteTails,true);assert.equal(merged.notes.length,1);assert.ok(r.changes.removed.includes('inside'));assert.equal(outside.flatMap(c=>c.events).some(e=>e.id==='middle'),false);assert.ok(outside.flatMap(c=>c.events).some(e=>e.id==='rightCC'));run(e,'history.undo');assert.deepEqual(e.project.clips,before.clips);run(e,'history.redo');assert.deepEqual(e.project.clips,p.clips);
});
test('MIDI Merge: Erase full source part leaves only merged part and preserves right-exclusive end metadata',()=>{
 const e=fixture({notes:[note('n',480)],events:[{id:'end',tick:1920,kind:'meta',status:255,metaType:1,data:[65]}]});const r=merge(e,{leftTick:0,rightTick:1920,selectedTrackIds:['t'],eraseDestination:true}),c=resultClip(e,r);assert.equal(c.lengthTicks,1920);assert.equal(c.events.length,0);const edge=e.project.clips.find(x=>x.id!==c.id);assert.equal(edge.startTick,1920);assert.equal(edge.events[0].id,'end');assert.equal(edge.events[0].tick,0);
});
test('MIDI Merge: erasing interior of a Bezier preserves outside sampled wire and editable curve windows',()=>{
 const e=fixture({notes:[],events:[cc('a',0,10,11,{curve:{type:'bezier',handles:[{x:.25,value:110},{x:.75,value:0}]}}),cc('b',1920,100)]});const expected=wire(e.project,['t']).filter(x=>x[0]<480||x[0]>=960),r=merge(e,{selectedTrackIds:['t'],eraseDestination:true}),p=e.project;p.clips=p.clips.filter(c=>c.id!==r.changes.merge.clipId);assert.deepEqual(wire(p,['t']),expected);assert.ok(p.clips.some(c=>c.events.some(e=>e.curve?.window)));validateProject(p);
});
test('MIDI Merge: destination settings remain active and report reset guidance without modifying unrelated parts',()=>{
 const e=fixture();run(e,'midi.modifiers.set',{trackId:'t',settings:{transpose:12}});const settings=e.project.tracks[0].midiModifiers,r=merge(e,{selectedTrackIds:['t'],eraseDestination:true});assert.deepEqual(e.project.tracks[0].midiModifiers,settings);assert.equal(resultClip(e,r).notes[0].pitch,72);assert.ok(r.changes.warnings.some(x=>x.code==='MIDI_MERGE_RESET_DESTINATION'));
});
test('MIDI Merge: invalid locator target unsupported options and later batch failure leave model and history atomic',()=>{
 const e=fixture(),before=e.checkpoint();for(const args of [{leftTick:960,rightTick:480},{leftTick:480,rightTick:480},{selectedTrackIds:['missing']},{selectedTrackIds:['t','t']},{includeSends:true},{convertVst3:true}]){const r=e.execute({command:'midi.mergeLoop',arguments:{leftTick:480,rightTick:960,...args}});assert.equal(r.status,'error');assert.deepEqual(e.checkpoint(),before);}
 const r=e.execute({command:'batch',arguments:{commands:[{command:'midi.mergeLoop',arguments:{leftTick:480,rightTick:960}},{command:'clip.remove',arguments:{clipId:'missing'}}]}});assert.equal(r.status,'error');assert.deepEqual(e.checkpoint(),before);
});
test('MIDI Merge: dry-run stale revision and single-step undo redo preserve entire prior state',()=>{
 const e=fixture(),before=e.checkpoint();merge(e,{eraseDestination:true,selectedTrackIds:['t']},{dryRun:true});assert.deepEqual(e.checkpoint(),before);const r=e.execute({command:'midi.mergeLoop',arguments:{leftTick:0,rightTick:960},expectedRevision:0});assert.equal(r.errors[0].code,'REVISION_CONFLICT');assert.deepEqual(e.checkpoint(),before);merge(e);const after=e.project;assert.equal(after.revision,before.project.revision+1);run(e,'history.undo');assert.deepEqual(e.project.clips,before.project.clips);assert.deepEqual(e.project.tracks,before.project.tracks);run(e,'history.redo');assert.deepEqual(e.project.clips,after.clips);
});
test('MIDI Merge: empty interval produces a real empty locator-sized part without phantom notes',()=>{
 const e=fixture(),r=merge(e,{leftTick:3000,rightTick:4000}),c=resultClip(e,r);assert.equal(c.notes.length,0);assert.equal(c.events.length,0);assert.equal(c.startTick,3000);assert.equal(c.lengthTicks,1000);
});
test('MIDI note tails: explicit opt-in is required and duplicate split move preserve complete tail lengths',()=>{
 const e=fixture({notes:[note('long',900,900)]}),r=merge(e),c=resultClip(e,r);run(e,'clip.duplicate',{clipId:c.id,count:1});const copy=e.project.clips.at(-1);assert.equal(copy.notes[0].durationTicks,900);run(e,'clip.split',{clipId:c.id,atTick:800});const pieces=e.project.clips.filter(p=>p.trackId===c.trackId&&p.id!==copy.id);assert.equal(pieces.flatMap(p=>p.notes).find(n=>n.id===c.notes[0].id).durationTicks,900);const before=e.checkpoint();const invalid=e.execute({command:'clip.update',arguments:{clipId:copy.id,allowNoteTails:false}});assert.equal(invalid.status,'error');assert.deepEqual(e.checkpoint(),before);
});
test('MIDI Merge: near-safe-integer overflow and wrong media destination are rejected before any commit',()=>{
 const e=fixture();run(e,'track.add',{id:'audio',type:'audio'});const before=e.checkpoint();const bad=e.execute({command:'midi.mergeLoop',arguments:{leftTick:0,rightTick:960,selectedTrackIds:['audio']}});assert.equal(bad.errors[0].code,'TYPE_MISMATCH');assert.deepEqual(e.checkpoint(),before);const overflow=e.execute({command:'clip.add',arguments:{trackId:'t',type:'midi',startTick:Number.MAX_SAFE_INTEGER-2,lengthTicks:1,allowNoteTails:true,notes:[note('overflow',0,10)]}});assert.equal(overflow.status,'error');assert.deepEqual(e.checkpoint(),before);
});

test('MIDI Merge: chased RPN increments controller reset pitch bend and curve samples reproduce interval PCM',()=>{
 const e=fixture({notes:[note('n',500,300)],events:[cc('s1',0,0,101),cc('s2',1,0,100),cc('range',2,2,6),cc('inc',3,0,96),{id:'pb',tick:10,kind:'channel',status:224,data:[0,96]},cc('volume',20,100,7),cc('expression',30,40),cc('reset',40,0,121),{id:'pb2',tick:50,kind:'channel',status:224,data:[0,80]},cc('a',100,20,11,{curve:{type:'ramp'}}),cc('b',960,100)]});const original=e.project,expected=renderProject(original, new Map(),{durationSeconds:.5}),r=merge(e,{includeChase:true}),p=e.project;p.tracks=p.tracks.filter(t=>t.id===r.changes.merge.trackId);p.clips=[resultClip(e,r)];const actual=renderProject(p,new Map(),{durationSeconds:.5});assert.deepEqual(actual.channels,expected.channels);assert.ok(actual.channels[0].some(x=>Math.abs(x)>.001));
});
test('MIDI Merge: excessive accumulated raw payload rejects copy and erase is rolled back atomically',()=>{
 const e=fixture({events:[{id:'blob',tick:500,kind:'meta',status:255,metaType:1,data:Array(1024*1024).fill(65)},{id:'blob2',tick:501,kind:'meta',status:255,metaType:1,data:Array(1024*1024).fill(66)},{id:'blob3',tick:502,kind:'meta',status:255,metaType:1,data:[67]}]});const before=e.checkpoint();const r=e.execute({command:'midi.mergeLoop',arguments:{leftTick:480,rightTick:960}});assert.equal(r.status,'error');assert.deepEqual(e.checkpoint(),before);const good=merge(e,{selectedTrackIds:['t'],eraseDestination:true});assert.equal(resultClip(e,good).events.length,3);
});
test('MIDI Merge: erase starts at the prior part end without losing an outside note or preserving boundary CC',()=>{
 const e=fixture({notes:[note('n',100,300)],events:[cc('boundary',480,60)],lengthTicks:480});const r=merge(e,{selectedTrackIds:['t'],eraseDestination:true}),old=e.project.clips.find(c=>c.id==='c');assert.equal(old.notes.length,1);assert.equal(old.events.length,0);assert.equal(resultClip(e,r).events.length,1);
});

test('MIDI Merge: large outside-note preservation avoids argument-stack overflow while erasing an empty interval',()=>{
 const e=fixture({notes:Array.from({length:130000},(_,i)=>note('large-'+i,0,120)),lengthTicks:1920});const r=merge(e,{selectedTrackIds:['t'],eraseDestination:true});assert.equal(resultClip(e,r).notes.length,0);assert.equal(e.project.clips.find(c=>c.id==='c').notes.length,130000);assert.equal(r.changes.updated.length,130001);
});
test('MIDI Merge: Bezier split-window sampling uses exactly the same messages in Merge and SMF',()=>{
 const e=fixture({notes:[],events:[cc('a',0,10,11,{curve:{type:'bezier',handles:[{x:.3,value:120},{x:.8,value:5}]}}),cc('b',1920,100)]});run(e,'clip.split',{clipId:'c',atTick:333});const expected=wire(e.project,['t']).filter(x=>x[0]>=480&&x[0]<960),r=merge(e),c=resultClip(e,r);assert.deepEqual(wire(e.project,[c.trackId]),expected);assert.ok(c.events.every(e=>!e.curve));
});
