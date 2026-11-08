import test from 'node:test';
import assert from 'node:assert/strict';
import {Engine,createProject,getCommandCatalog} from '../src/core/engine.mjs';
import {controllerValue,materializeMidiCurves,setMidiControllerValues} from '../src/media/midi-curves.mjs';
import {writeMidi} from '../src/media/midi.mjs';
const cc=(id,tick,value,order=0,controller=11,channel=0)=>({id,tick,order,kind:'channel',status:176|channel,data:[controller,value]});
const notes=[{id:'note',startTick:0,durationTicks:100,pitch:60,velocity:90}];
const setup=(events,{length=1920,noteList=notes}={})=>{const e=new Engine(createProject());ok(e,'track.add',{id:'track',type:'midi'});ok(e,'clip.add',{id:'clip',trackId:'track',type:'midi',lengthTicks:length,notes:noteList,events});return e;};
function ok(e,command,args={}){const r=e.execute({command,arguments:args});assert.equal(r.status,'applied',JSON.stringify(r.errors));return r;}
const get=(e,id='clip')=>e.project.clips.find(c=>c.id===id);
const update=(e,updates,clipId='clip')=>ok(e,'midi.controllers.setValues',{clipId,updates});
const identity=c=>c.events.map(({id,tick,order,kind,status,data})=>({id,tick,order,kind,status,key:(status>>4===11||status>>4===10)?data[0]:undefined}));
function rejected(e,updates,code){const p=e.project,h=e.exportHistory(),r=e.execute({command:'midi.controllers.setValues',arguments:{clipId:'clip',updates}});assert.equal(r.status,'error');assert.equal(r.errors[0].code,code);assert.deepEqual(e.project,p);assert.deepEqual(e.exportHistory(),h);}

test('setValues preserves raw identities, duplicate times, source order, notes and unrelated lanes',()=>{
 const e=setup([cc('a',100,10,1),cc('b',100,20,2),cc('othercc',100,44,3,7),cc('otherch',100,66,4,11,1),{id:'sx',tick:100,order:5,kind:'sysex',status:240,data:[125,247]}]),before=get(e),revision=e.project.revision;
 const r=update(e,[{eventId:'a',value:42},{eventId:'b',value:84}]);assert.deepEqual(identity(get(e)),identity(before));assert.deepEqual(get(e).notes,before.notes);assert.deepEqual(get(e).events.slice(2),before.events.slice(2));assert.deepEqual(get(e).events.slice(0,2).map(controllerValue),[42,84]);assert.deepEqual(r.changes.created,[]);assert.deepEqual(r.changes.removed,[]);assert.equal(e.project.revision,revision+1);
 ok(e,'history.undo');assert.deepEqual(get(e),before);ok(e,'history.redo');assert.equal(controllerValue(get(e).events[1]),84);
});

test('setValues handles 14-bit bend, pressure and program without changing event classes or poly keys',()=>{
 const events=[{id:'pb',tick:0,order:0,kind:'channel',status:0xef,data:[0,64]},{id:'pressure',tick:0,order:1,kind:'channel',status:0xd2,data:[50]},{id:'poly',tick:0,order:2,kind:'channel',status:0xa3,data:[61,40]},{id:'program',tick:0,order:3,kind:'channel',status:0xc4,data:[2]}],e=setup(events),before=identity(get(e));
 update(e,[{eventId:'pb',value:16383},{eventId:'pressure',value:127},{eventId:'poly',value:0},{eventId:'program',value:67}]);assert.deepEqual(identity(get(e)),before);assert.deepEqual(get(e).events.map(x=>x.data),[[127,127],[127],[61,0],[67]]);
});

test('invalid value, unknown ID, duplicate IDs and opaque events reject the entire setValues transaction',()=>{
 const e=setup([cc('a',0,30),{id:'sx',tick:1,order:1,kind:'sysex',status:240,data:[1]}]);
 rejected(e,[{eventId:'a',value:128}],'CONTROLLER_VALUE_OUT_OF_BOUNDS');rejected(e,[{eventId:'a',value:31},{eventId:'missing',value:32}],'NOT_FOUND');rejected(e,[{eventId:'a',value:31},{eventId:'a',value:32}],'DUPLICATE_EVENT_ID');rejected(e,[{eventId:'a',value:31},{eventId:'sx',value:32}],'TYPE_MISMATCH');
 for(const updates of [[],[{eventId:'a',value:-1}],[{eventId:'a',value:1.5}],[{eventId:'a',value:16384}]]){const before=e.project;assert.equal(e.execute({command:'midi.controllers.setValues',arguments:{clipId:'clip',updates}}).status,'error');assert.deepEqual(e.project,before);}
});

test('setValues command discovery, dry run and revision guard share normal engine validation',()=>{
 const e=setup([cc('a',100,0)]),p=e.project,h=e.exportHistory();assert.ok(getCommandCatalog().some(c=>c.name==='midi.controllers.setValues'||c.command==='midi.controllers.setValues'));
 const args={clipId:'clip',updates:[{eventId:'a',value:96}]};assert.equal(e.execute({command:'midi.controllers.setValues',arguments:args,dryRun:true}).status,'validated');assert.deepEqual(e.project,p);assert.deepEqual(e.exportHistory(),h);
 const stale=e.execute({command:'midi.controllers.setValues',arguments:args,expectedRevision:p.revision-1});assert.equal(stale.status,'error');assert.deepEqual(e.project,p);
});

test('ordinary Bezier handles remain absolute while an edited endpoint changes the sampled signal',()=>{
 const shape={type:'bezier',handles:[{x:1/3,value:0},{x:2/3,value:0}]},e=setup([{...cc('start',0,0),curve:shape},cc('end',100,100,1)]);
 update(e,[{eventId:'end',value:80}]);assert.deepEqual(get(e).events[0].curve,shape);const sampled=materializeMidiCurves(get(e)).events;assert.equal(controllerValue(sampled.find(x=>x.tick===50)),10);assert.equal(get(e).events.length,2);
});

test('editing a terminal split-window value keeps event count without inventing a clip-end knot',()=>{
 const e=setup([{...cc('start',0,0),curve:{type:'ramp'}},cc('end',1920,127,1)]);ok(e,'clip.split',{clipId:'clip',atTick:701});const before=get(e),bytes=writeMidi(e.project),h=e.exportHistory();assert.equal(before.events.length,1);const r=update(e,[{eventId:'start',value:50}]);const after=get(e);
 assert.deepEqual(identity(after),identity(before));assert.equal(after.events.length,1);assert.equal(after.events[0].curve.window.startTick,0);assert.equal(after.events[0].curve.window.endTick,701);assert.equal(after.events[0].curve.window.startValue,50);assert.equal(after.events[0].curve.window.endValue,46);assert.equal(after.events[0].curve.window.emitStart,'raw');assert.deepEqual(r.changes.created,[]);assert.ok(r.changes.warnings.some(w=>w.code==='MIDI_CURVE_VALUES_REBASED'));materializeMidiCurves(after);
 ok(e,'history.undo');assert.deepEqual(writeMidi(e.project),bytes);assert.deepEqual(get(e),before);assert.equal(e.exportHistory().cursor,h.cursor);
});

test('editing an incoming split window endpoint preserves all raw point identities and unrelated curves',()=>{
 const shape={type:'bezier',handles:[{x:1/3,value:127},{x:2/3,value:0}]},e=setup([{...cc('start',0,0),curve:shape},cc('end',1920,127,1),{...cc('other',0,20,2,7),curve:{type:'ramp'}},cc('otherend',1920,80,3,7)]);const result=ok(e,'clip.split',{clipId:'clip',atTick:701}),rightId=result.changes.split.rightClipId,before=get(e,rightId),anchor=before.events.find(x=>x.data[0]===11&&x.curve);
 update(e,[{eventId:'end',value:60}],rightId);const after=get(e,rightId);assert.deepEqual(identity(after),identity(before));assert.deepEqual(after.events.filter(x=>x.data[0]===7),before.events.filter(x=>x.data[0]===7));assert.equal(after.events.find(x=>x.id===anchor.id).curve.window,undefined);assert.equal(controllerValue(after.events.find(x=>x.id==='end')),60);materializeMidiCurves(after);
});

test('simultaneous split-window start and end edits derive local handles before changing either value',()=>{
 const e=setup([{...cc('start',0,0),curve:{type:'bezier',handles:[{x:.2,value:127},{x:.8,value:0}]}},cc('end',1920,127,1)]),r=ok(e,'clip.split',{clipId:'clip',atTick:701}),id=r.changes.split.rightClipId,before=get(e,id),anchor=before.events.find(x=>x.curve),reversed=new Engine(e.project);
 const a=[{eventId:anchor.id,value:80},{eventId:'end',value:40}];update(e,a,id);update(reversed,[...a].reverse(),id);assert.deepEqual(get(e,id),get(reversed,id));assert.deepEqual(identity(get(e,id)),identity(before));materializeMidiCurves(get(e,id));
});

test('unchanged values do not normalize split windows or turn suppressed anchors into explicit messages',()=>{
 const e=setup([{...cc('start',0,0),curve:{type:'ramp'}},cc('end',1920,127,1)]),r=ok(e,'clip.split',{clipId:'clip',atTick:701}),id=r.changes.split.rightClipId,before=get(e,id),anchor=before.events.find(x=>x.curve),bytes=writeMidi(e.project);
 const changed=update(e,[{eventId:anchor.id,value:controllerValue(anchor)}],id);assert.deepEqual(get(e,id),before);assert.deepEqual(writeMidi(e.project),bytes);assert.deepEqual(changed.changes.updated,[]);assert.deepEqual(changed.changes.created,[]);
});

test('one changed same-tick window preserves every simultaneous message and changes no raw ordering',()=>{
 const shape={type:'ramp',window:{startTick:0,endTick:100,startValue:20,endValue:120,emitStart:'raw'}},e=setup([{...cc('first',0,20,0),curve:shape},cc('second',0,30,1),cc('end',100,120,2)]),before=get(e);
 update(e,[{eventId:'first',value:50}]);assert.deepEqual(identity(get(e)),identity(before));assert.equal(get(e).events[0].curve.window,undefined);assert.equal(get(e).events.length,3);assert.deepEqual(get(e).events.map(controllerValue),[50,30,120]);materializeMidiCurves(get(e));
});

test('failed batch restores all controller values, curve geometry, history and project revision',()=>{
 const e=setup([{...cc('start',0,0),curve:{type:'ramp'}},cc('end',1920,127,1)]);ok(e,'clip.split',{clipId:'clip',atTick:701});const p=e.project,h=e.exportHistory();const r=e.execute({command:'batch',arguments:{commands:[{command:'midi.controllers.setValues',arguments:{clipId:'clip',updates:[{eventId:'start',value:100}]}},{command:'midi.controllers.setValues',arguments:{clipId:'clip',updates:[{eventId:'missing',value:0}]}}]}});assert.equal(r.status,'error');assert.deepEqual(e.project,p);assert.deepEqual(e.exportHistory(),h);
});

test('pure value helper validates all IDs and ranges before changing any source event',()=>{
 const c={lengthTicks:100,events:[cc('a',0,0)],notes:[]},before=structuredClone(c);assert.throws(()=>setMidiControllerValues(c,[{eventId:'a',value:20},{eventId:'missing',value:10}]));assert.deepEqual(c,before);
});

test('large existing-only value stroke handles 100001 events without insertion, argument-stack overflow or ID loss',()=>{
 const count=100001,e=setup(Array.from({length:count},(_,i)=>cc(`e-${i}`,i,i%128,i)),{length:count+10,noteList:[]}),before=identity(get(e));update(e,Array.from({length:count},(_,i)=>({eventId:`e-${i}`,value:127-i%128})));const after=get(e);assert.deepEqual(identity(after),before);assert.equal(after.events.length,count);assert.equal(controllerValue(after.events.at(-1)),127-(count-1)%128);
});

test('clipboard same-tick points all survive in source order while replacing existing destination duplicates',()=>{
 const e=setup([cc('dest1',240,1,2),cc('dest2',240,2,4),cc('other',240,99,6,7),cc('outside',300,12,8)]),before=get(e),lane={kind:'cc',channel:0,controller:11};
 const r=ok(e,'midi.controllers.paste',{clipId:'clip',lane,atTick:240,events:[{tick:0,value:40},{tick:0,value:20,curve:{type:'ramp'}},{tick:120,value:80}]});const c=get(e),at=c.events.filter(x=>x.tick===240&&x.data[0]===11).sort((a,b)=>a.order-b.order);
 assert.deepEqual(at.map(controllerValue),[40,20]);assert.equal(at[0].id,'dest2');assert.equal(at[1].curve.type,'ramp');assert.ok(r.changes.removed.includes('dest1'));assert.deepEqual(c.events.find(x=>x.id==='other'),before.events.find(x=>x.id==='other'));assert.deepEqual(c.events.find(x=>x.id==='outside'),before.events.find(x=>x.id==='outside'));assert.equal(c.events.filter(x=>x.data[0]===11).length,4);materializeMidiCurves(c);ok(e,'history.undo');assert.deepEqual(get(e),before);
});

test('duplicate clipboard into an empty lane keeps every point but duplicate Draw still fails atomically',()=>{
 const e=setup([]),lane={kind:'pitchBend',channel:2};ok(e,'midi.controllers.paste',{clipId:'clip',lane,atTick:100,events:[{tick:0,value:16383},{tick:0,value:0},{tick:0,value:8192}]});const c=get(e);assert.equal(new Set(c.events.map(x=>x.id)).size,3);assert.deepEqual(c.events.map(controllerValue),[16383,0,8192]);assert.deepEqual(c.events.map(x=>x.tick),[100,100,100]);const before=e.project,r=e.execute({command:'midi.controllers.draw',arguments:{clipId:'clip',lane,points:[{tick:200,value:0},{tick:200,value:8192}]}});assert.equal(r.status,'error');assert.equal(r.errors[0].code,'DUPLICATE_POINT_TIME');assert.deepEqual(e.project,before);
});
