import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine, createProject } from '../src/core/engine.mjs';
import { noteControllerSelection } from '../src/media/midi-controllers-query.mjs';
import { writeMidi } from '../src/media/midi.mjs';
const lane={kind:'cc',channel:0,controller:11};
const cc=(id,tick,value,order=0,channel=0,controller=11)=>({id,tick,order,kind:'channel',status:176|channel,data:[controller,value]});
function setup({events=[],notes=[],length=1920}={}){const engine=new Engine(createProject());ok(engine,'track.add',{id:'track',type:'midi'});ok(engine,'clip.add',{id:'clip',trackId:'track',type:'midi',lengthTicks:length,notes,events});return engine;}
function ok(engine,command,args={}){const result=engine.execute({command,arguments:args});assert.equal(result.status,'applied',JSON.stringify(result.errors));return result;}
const clip=engine=>engine.project.clips.find(c=>c.id==='clip');
const unchanged=(engine,command,args,code)=>{const p=engine.project,h=engine.exportHistory(),result=engine.execute({command,arguments:args});assert.equal(result.status,'error');if(code)assert.equal(result.errors[0].code,code);assert.deepEqual(engine.project,p);assert.deepEqual(engine.exportHistory(),h);return result;};

test('controller draw replaces duplicate destination knots while preserving unrelated channels and exact notes',()=>{
 const e=setup({events:[cc('old-a',100,10,1),cc('old-b',100,20,2),cc('other',100,55,3,1),{id:'opaque',tick:100,order:4,kind:'sysex',status:240,data:[125,247]}],notes:[{id:'n',startTick:100,durationTicks:120,pitch:60,velocity:90}]});const before=clip(e).notes;
 const r=ok(e,'midi.controllers.draw',{clipId:'clip',lane,points:[{tick:100,value:63},{tick:200,value:127}]});assert.equal(clip(e).events.filter(x=>x.status===176&&x.tick===100).length,1);assert.equal(clip(e).events.find(x=>x.id==='old-b').data[1],63);assert.ok(r.changes.removed.includes('old-a'));assert.equal(clip(e).events.find(x=>x.id==='other').data[1],55);assert.deepEqual(clip(e).notes,before);assert.deepEqual(clip(e).events.find(x=>x.id==='opaque').data,[125,247]);
 ok(e,'history.undo');assert.equal(clip(e).events.length,4);ok(e,'history.redo');assert.equal(clip(e).events.find(x=>x.id==='old-b').data[1],63);
});

test('discrete controller Line includes its last endpoint and uses integer half-up values independently of Ramp',()=>{
 const e=setup({events:[cc('outside',1,99),cc('inside',7,42)]});ok(e,'midi.controllers.line',{clipId:'clip',lane,startTick:5,endTick:10,startValue:0,endValue:3,stepTicks:3});assert.deepEqual(clip(e).events.filter(x=>x.tick>=5).map(x=>[x.tick,x.data[1]]),[[5,0],[8,2],[10,3]]);assert.ok(clip(e).events.every(x=>!x.curve));assert.equal(clip(e).events.find(x=>x.id==='outside').data[1],99);
 ok(e,'midi.controllers.line',{clipId:'clip',lane,startTick:20,endTick:22,startValue:1,endValue:0,stepTicks:1});assert.equal(clip(e).events.find(x=>x.tick===21).data[1],1);
 unchanged(e,'midi.controllers.line',{clipId:'clip',lane,startTick:10,endTick:10,startValue:0,endValue:1,stepTicks:1},'INVALID_CONTROLLER_RANGE');
});

test('controller edit validation is atomic for duplicate ticks, wrong value width, unsupported curves and foreign event IDs',()=>{
 const e=setup({events:[cc('point',10,20),{id:'patch',tick:20,order:0,kind:'channel',status:192,data:[5]}]});
 unchanged(e,'midi.controllers.draw',{clipId:'clip',lane,points:[{tick:20,value:1},{tick:20,value:2}]},'DUPLICATE_POINT_TIME');
 unchanged(e,'midi.controllers.draw',{clipId:'clip',lane,points:[{tick:20,value:128}]},'CONTROLLER_VALUE_OUT_OF_BOUNDS');
 unchanged(e,'midi.controllers.curve',{clipId:'clip',eventIds:['patch'],curve:{type:'ramp'}},'CURVE_NOT_SUPPORTED');
 unchanged(e,'midi.controllers.move',{clipId:'clip',eventIds:['missing'],deltaTick:1},'NOT_FOUND');
 unchanged(e,'midi.controllers.curve',{clipId:'clip',eventIds:['point'],curve:{type:'bezier',handles:[{x:.8,value:128},{x:.2,value:20}]}},'INVALID_MIDI_CURVE');
 const before=e.project;const dry=e.execute({command:'midi.controllers.draw',arguments:{clipId:'clip',lane,points:[{tick:20,value:100}]},dryRun:true});assert.equal(dry.status,'validated');assert.deepEqual(e.project,before);
});

test('controller copy preserves class but allows CC-number conversion and replaces only destination-lane collisions',()=>{
 const e=setup({events:[cc('source',0,61),cc('dest',100,30,0,1,7),cc('keep',100,22,1,0,1)]});const r=ok(e,'midi.controllers.move',{clipId:'clip',eventIds:['source'],deltaTick:100,copy:true,targetLane:{kind:'cc',channel:1,controller:7}});assert.ok(clip(e).events.some(x=>x.id==='source'));assert.ok(!clip(e).events.some(x=>x.id==='dest'));const copied=clip(e).events.find(x=>r.changes.created.includes(x.id));assert.equal(copied.status,177);assert.deepEqual(copied.data,[7,61]);assert.equal(copied.tick,100);assert.equal(clip(e).events.find(x=>x.id==='keep').data[1],22);
 unchanged(e,'midi.controllers.move',{clipId:'clip',eventIds:['source'],deltaTick:1,targetLane:{kind:'pitchBend',channel:0}},'CONTROLLER_TYPE_MISMATCH');
});

test('moving controller points resolves explicit order collisions without altering unrelated note order',()=>{
 const e=setup({events:[cc('point',10,80,2)],notes:[{id:'note',startTick:100,durationTicks:200,pitch:60,velocity:90,onOrder:2,offOrder:3}]});const r=ok(e,'midi.controllers.move',{clipId:'clip',eventIds:['point'],deltaTick:90});assert.notEqual(clip(e).events[0].order,2);assert.equal(clip(e).notes[0].onOrder,2);assert.deepEqual(r.changes.orderReassignedIds,['point']);
});

test('paste creates actual Step when the clipboard has no curve and keeps an outgoing pasted Bezier shape',()=>{
 const e=setup({events:[{...cc('old',100,10),curve:{type:'ramp'}},cc('end',200,127)]});ok(e,'midi.controllers.paste',{clipId:'clip',lane,atTick:100,events:[{tick:0,value:30}]});assert.equal(clip(e).events.find(x=>x.tick===100).curve,undefined);
 const shape={type:'bezier',handles:[{x:.2,value:120},{x:.8,value:0}]};ok(e,'midi.controllers.paste',{clipId:'clip',lane,atTick:300,events:[{tick:0,value:20,curve:shape},{tick:300,value:100}]});assert.deepEqual(clip(e).events.find(x=>x.tick===300).curve,shape);
});

test('draw value replacement retains the selected knot outgoing shape while assigning the incoming new-event mode',()=>{
 const shape={type:'bezier',handles:[{x:.25,value:100},{x:.75,value:30}]},e=setup({events:[cc('prior',0,0),{...cc('middle',100,50),curve:shape},cc('end',200,100)]});ok(e,'midi.controllers.draw',{clipId:'clip',lane,points:[{tick:100,value:60}],curve:{type:'ramp'}});assert.deepEqual(clip(e).events.find(x=>x.id==='prior').curve,{type:'ramp'});assert.deepEqual(clip(e).events.find(x=>x.id==='middle').curve,shape);assert.equal(clip(e).events.find(x=>x.id==='middle').data[1],60);
});

test('track pitchbend grid links ranges without changing MIDI bytes and invalid grid requests leave state intact',()=>{
 const e=setup({events:[{id:'bend',tick:10,order:0,kind:'channel',status:224,data:[127,127]}]}),before=writeMidi(e.project);ok(e,'midi.pitchBendGrid.set',{trackId:'track',enabled:true,up:12,snap:true});assert.deepEqual(e.project.tracks[0].pitchBendGrid,{enabled:true,up:12,down:12,linked:true,snap:true});assert.deepEqual(writeMidi(e.project),before);
 ok(e,'midi.pitchBendGrid.set',{trackId:'track',linked:false,down:3});assert.equal(e.project.tracks[0].pitchBendGrid.up,12);assert.equal(e.project.tracks[0].pitchBendGrid.down,3);
 unchanged(e,'midi.pitchBendGrid.set',{trackId:'track',linked:true,up:12,down:3},'GRID_RANGE_CONFLICT');unchanged(e,'midi.pitchBendGrid.set',{trackId:'track',up:97},'VALIDATION_ERROR');
});

test('note-linked range selection has half-open channel/key boundaries and explicitly different extended-anchor policy',()=>{
 const e=setup({notes:[{id:'a',startTick:0,durationTicks:100,pitch:60,velocity:90},{id:'b',startTick:480,durationTicks:100,pitch:62,velocity:90},{id:'c',startTick:960,durationTicks:100,pitch:64,velocity:90},{id:'d',startTick:1440,durationTicks:100,pitch:65,velocity:90}],events:[cc('a-tail',300,70),cc('boundary',480,71),cc('c-tail',1200,72),cc('foreign',50,73,0,1),{id:'poly-a',tick:50,order:1,kind:'channel',status:160,data:[60,99]},{id:'poly-other',tick:50,order:2,kind:'channel',status:160,data:[70,99]},{id:'program',tick:50,order:3,kind:'channel',status:192,data:[5]}]});
 const n=noteControllerSelection(clip(e),{noteIds:['a','c'],mode:'noteRange'});assert.deepEqual(new Set(n.eventIds),new Set(['a-tail','c-tail','poly-a']));
 const x=noteControllerSelection(clip(e),{noteIds:['a','c'],mode:'extended',anchorNoteId:'c'});assert.deepEqual(new Set(x.eventIds),new Set(['c-tail','poly-a']));assert.throws(()=>noteControllerSelection(clip(e),{noteIds:['a'],mode:'extended'}),{code:'ANCHOR_REQUIRED'});
});

test('paired note copy transforms the selected pressure key and is one undo step while retaining source notes',()=>{
 const e=setup({notes:[{id:'n',startTick:100,durationTicks:100,pitch:60,velocity:80,onOrder:1,offOrder:2}],events:[{id:'poly',tick:120,order:0,kind:'channel',status:160,data:[60,90]},cc('cc',150,40)]}),before=e.project;
 const r=ok(e,'midi.notes.move',{clipId:'clip',noteIds:['n'],deltaTick:400,deltaPitch:12,copy:true,controllers:'noteRange'});assert.equal(clip(e).notes.length,2);assert.ok(clip(e).notes.some(n=>n.id==='n'&&n.pitch===60&&n.startTick===100));assert.ok(clip(e).notes.some(n=>n.id!=='n'&&n.pitch===72&&n.startTick===500));assert.ok(clip(e).events.some(x=>x.id!=='poly'&&x.status===160&&x.tick===520&&x.data[0]===72));assert.equal(r.changes.controllerSelection.eventIds.length,2);
 ok(e,'history.undo');assert.deepEqual(clip(e),before.clips[0]);
});

test('paired controller movement rejects an out-of-clip controller even when the selected notes would fit',()=>{
 const e=setup({notes:[{id:'n',startTick:0,durationTicks:100,pitch:60,velocity:80}],events:[cc('late',1900,80)]});unchanged(e,'midi.notes.move',{clipId:'clip',noteIds:['n'],deltaTick:50,controllers:'noteRange'},'MIDI_EVENT_OUT_OF_BOUNDS');
});

test('raw add and value edits rebase split-window geometry through the same transaction and undo restores exact MIDI',()=>{
 const e=setup({events:[{...cc('start',0,0),curve:{type:'ramp'}},cc('end',1920,127)]});const r=ok(e,'clip.split',{clipId:'clip',atTick:701}),rightId=r.changes.split.rightClipId,before=e.project,bytes=writeMidi(before);assert.ok(clip(e).events[0].curve.window);
 const edit=ok(e,'midi.events.add',{clipId:'clip',events:[cc('inserted',300,100,10)]});assert.equal(clip(e).events.find(x=>x.id==='start').curve.window,undefined);assert.ok(edit.changes.created.includes('inserted'));assert.ok(clip(e).events.some(x=>x.tick===701));ok(e,'history.undo');assert.deepEqual(writeMidi(e.project),bytes);
 const right=e.project.clips.find(c=>c.id===rightId),anchor=right.events.find(x=>x.curve?.window);ok(e,'midi.events.update',{clipId:rightId,eventId:anchor.id,data:[11,100]});assert.equal(e.project.clips.find(c=>c.id===rightId).events.find(x=>x.id===anchor.id).curve.window,undefined);
});

test('relative window clipboard paste preserves free geometry and explicitly retargets an occupied destination',()=>{
 const e=setup({events:[{...cc('start',0,0),curve:{type:'ramp'}},cc('end',1920,127)],length:3840});const r=ok(e,'clip.split',{clipId:'clip',atTick:701}),right=e.project.clips.find(c=>c.id===r.changes.split.rightClipId),anchor=right.events.find(x=>x.curve?.window);const relative=structuredClone(anchor.curve);
 const events=[{tick:0,value:anchor.data[1],curve:relative},{tick:1219,value:127}];
 ok(e,'midi.controllers.paste',{clipId:right.id,lane:{...lane,controller:7},atTick:100,events});const free=e.project.clips.find(c=>c.id===right.id).events.find(x=>x.tick===100&&x.data[0]===7);assert.equal(free.curve.window.startTick,relative.window.startTick+100);assert.equal(free.curve.window.endTick,relative.window.endTick+100);assert.deepEqual(e.project.clips.find(c=>c.id===right.id).events.filter(x=>x.data[0]===11),right.events);
 const result=ok(e,'midi.controllers.paste',{clipId:right.id,lane,atTick:100,events});const actual=e.project.clips.find(c=>c.id===right.id),pasted=actual.events.find(x=>x.tick===100&&x.data[0]===11);assert.equal(pasted.curve.type,'ramp');assert.equal(pasted.curve.window,undefined);assert.equal(actual.events.find(x=>x.tick===1219&&x.data[0]===11).data[1],127);assert.ok(result.changes.warnings.some(x=>x.code==='MIDI_CURVE_EDIT_RECONCILED'));
});

test('large controller draw and move handle 130000 points without argument-stack failure or quadratic ID lookup',()=>{
 const count=130000,e=setup({length:count+10}),points=Array.from({length:count},(_,tick)=>({tick,value:tick%128}));ok(e,'midi.controllers.draw',{clipId:'clip',lane,points});const ids=clip(e).events.map(x=>x.id);assert.equal(ids.length,count);
 ok(e,'midi.controllers.move',{clipId:'clip',eventIds:ids,deltaTick:1});const after=clip(e);assert.equal(after.events.length,count);assert.equal(after.events[0].tick,1);assert.equal(after.events.at(-1).tick,count);assert.deepEqual(new Set(after.events.map(x=>x.id)),new Set(ids));
});


test('paired pressure transposition replaces the final key destination and preserves unrelated original-key data',()=>{
 const poly=(id,tick,pitch,value,order=0)=>({id,tick,order,kind:'channel',status:160,data:[pitch,value]});
 const e=setup({notes:[{id:'n',startTick:0,durationTicks:50,pitch:60,velocity:80},{id:'next',startTick:100,durationTicks:50,pitch:70,velocity:80}],events:[poly('source',50,60,30),poly('unrelated',150,60,40),poly('destination',150,65,50,1)]});
 const r=ok(e,'midi.notes.move',{clipId:'clip',noteIds:['n'],deltaTick:100,deltaPitch:5,controllers:'noteRange'});
 assert.ok(clip(e).events.some(x=>x.id==='unrelated'&&x.data[0]===60));assert.ok(!clip(e).events.some(x=>x.id==='destination'));assert.ok(r.changes.removed.includes('destination'));assert.deepEqual(clip(e).events.find(x=>x.id==='source').data,[65,30]);assert.equal(clip(e).events.find(x=>x.id==='source').tick,150);
});


test('paired moves preserve original controller-before-note order across vacated and occupied destination ticks',()=>{
 for(const selected of [true,false]){
  const e=setup({notes:[{id:'a',startTick:0,durationTicks:50,pitch:60,velocity:80,onOrder:10},{id:'b',startTick:100,durationTicks:50,pitch:62,velocity:80,onOrder:0}],events:[cc('before-note',0,50,0)]});
  ok(e,'midi.notes.move',{clipId:'clip',noteIds:selected?['a','b']:['a'],deltaTick:100,controllers:'noteRange'});
  const c=clip(e),event=c.events.find(x=>x.id==='before-note'),note=c.notes.find(x=>x.id==='a');assert.ok(event.order<note.onOrder);if(selected)assert.equal(event.order,0);else assert.equal(c.notes.find(x=>x.id==='b').onOrder,0);
 }
});

test('copying a split curve into a different CC preserves source geometry and translates only copied windows',()=>{
 const e=setup({events:[{...cc('a',0,0),curve:{type:'ramp'}},cc('b',1000,100)],length:1000});ok(e,'clip.split',{clipId:'clip',atTick:333});const source=structuredClone(clip(e).events),r=ok(e,'midi.controllers.move',{clipId:'clip',eventIds:['a'],deltaTick:0,copy:true,targetLane:{kind:'cc',channel:0,controller:7}});
 assert.deepEqual(clip(e).events.filter(x=>x.data[0]===11),source);const copied=clip(e).events.find(x=>r.changes.created.includes(x.id));assert.deepEqual(copied.curve.window,source[0].curve.window);assert.equal(copied.data[0],7);
});

test('zero-offset controller copy replaces the same-lane destination with a fresh ID rather than duplicating its message',()=>{
 const e=setup({events:[cc('source',0,77)]}),r=ok(e,'midi.controllers.move',{clipId:'clip',eventIds:['source'],deltaTick:0,copy:true});assert.equal(clip(e).events.length,1);assert.notEqual(clip(e).events[0].id,'source');assert.ok(r.changes.removed.includes('source'));assert.ok(r.changes.created.includes(clip(e).events[0].id));
});
