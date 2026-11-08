import test from 'node:test';
import assert from 'node:assert/strict';
import {Engine,createProject} from '../src/core/engine.mjs';
import {evaluateCurve} from '../src/media/midi-curves.mjs';
import {describeControllerSegment,bendControllerCurve} from '../src/media/controller-bend.mjs';
import {compileMidiStreams} from '../src/media/midi-stream.mjs';
import {renderProject} from '../src/media/render.mjs';
const cc=(id,tick,value,extra={})=>({id,tick,kind:'channel',status:176,data:[11,value],...extra});
const run=(e,command,args={},extra={})=>{const r=e.execute({command,arguments:args,expectedRevision:e.project.revision,...extra});assert.notEqual(r.status,'error',JSON.stringify(r.errors));return r;};
function fixture(events=[cc('a',0,20,{curve:{type:'ramp'}}),cc('b',1920,80)]){const e=new Engine(createProject({sampleRate:8000}));run(e,'track.add',{id:'t',type:'midi'});run(e,'clip.add',{id:'c',trackId:'t',type:'midi',lengthTicks:1920,notes:[{id:'n',pitch:60,velocity:90,channel:0,startTick:100,durationTicks:1500}],events});return e;}
const bend=(e,deltaValue=15,extra={})=>run(e,'midi.controllers.bend',{clipId:'c',eventId:'a',deltaValue},extra);
const midpoint=e=>{const c=e.project.clips[0];return evaluateCurve(c.events[0],c.events[1],960);};
const wire=e=>compileMidiStreams(e.project).tracks[0].events.map(x=>[x.tick,x.status,...x.data]);

test('controller bend: direct Ramp midpoint displacement has an independent cubic value and preserves endpoints notes and orders',()=>{
 const e=fixture(),before=e.project;const r=bend(e,15),c=e.project.clips[0];assert.deepEqual(c.events[0].curve,{type:'bezier',handles:[{x:1/3,value:60},{x:2/3,value:80}]});assert.equal(midpoint(e),65);assert.deepEqual(c.events.map(({curve,...rest})=>rest),before.clips[0].events.map(({curve,...rest})=>rest));assert.deepEqual(c.notes,before.clips[0].notes);assert.equal(e.project.revision,before.revision+1);assert.deepEqual(r.changes.created,[]);
});
test('controller bend: downward displacement and existing asymmetric handle times keep the requested midpoint movement',()=>{
 const e=fixture();bend(e,-15);assert.equal(midpoint(e),35);run(e,'midi.controllers.curve',{clipId:'c',eventIds:['a'],curve:{type:'bezier',handles:[{x:.1,value:45},{x:.7,value:65}]}});const before=midpoint(e);bend(e,4);assert.ok(Math.abs(midpoint(e)-before-4)<1e-9);assert.deepEqual(e.project.clips[0].events[0].curve.handles.map(h=>h.x),[.1,.7]);
});
test('controller bend: saturation clamps controls while retaining bounded endpoints and the full curve domain',()=>{
 const e=fixture([cc('a',0,0,{curve:{type:'ramp'}}),cc('b',1920,127)]);bend(e,127);assert.equal(midpoint(e),111.125);const c=e.project.clips[0];for(let t=0;t<=1920;t+=7){const v=evaluateCurve(c.events[0],c.events[1],t);assert.ok(v>=0&&v<=127);}assert.equal(c.events[0].data[1],0);assert.equal(c.events[1].data[1],127);
});
test('controller bend: channels and 14-bit pitch bend remain independent',()=>{
 const e=fixture([cc('a',0,20,{curve:{type:'ramp'}}),cc('other',0,90,{status:177,curve:{type:'ramp'}}),cc('b',1920,80),cc('otherEnd',1920,10,{status:177}),{id:'pb',tick:0,kind:'channel',status:224,data:[0,64],curve:{type:'ramp'}},{id:'pbEnd',tick:1920,kind:'channel',status:224,data:[0,96]}]);const before=e.project.clips[0].events.filter(x=>['other','otherEnd'].includes(x.id));run(e,'midi.controllers.bend',{clipId:'c',eventId:'pb',deltaValue:1024});const c=e.project.clips[0],a=c.events.find(x=>x.id==='pb'),b=c.events.find(x=>x.id==='pbEnd');assert.ok(Math.abs(evaluateCurve(a,b,960)-11264)<1e-9);assert.deepEqual(c.events.filter(x=>['other','otherEnd'].includes(x.id)),before);assert.equal(c.events.find(x=>x.id==='a').curve.type,'ramp');
});
test('controller bend: Step final shadowed and unsupported events reject atomically',()=>{
 const e=fixture([cc('shadow',0,10,{curve:{type:'ramp'}}),cc('a',0,20),cc('b',1920,80),{id:'program',tick:10,kind:'channel',status:192,data:[3]}]),before=e.checkpoint();for(const eventId of ['shadow','a','b','program','missing']){const r=e.execute({command:'midi.controllers.bend',arguments:{clipId:'c',eventId,deltaValue:10}});assert.equal(r.status,'error');assert.deepEqual(e.checkpoint(),before);}run(e,'midi.controllers.curve',{clipId:'c',eventIds:['a'],curve:{type:'ramp'}});const checkpoint=e.checkpoint();for(const deltaValue of [128,NaN,Infinity]){const r=e.execute({command:'midi.controllers.bend',arguments:{clipId:'c',eventId:'a',deltaValue}});assert.equal(r.status,'error');assert.deepEqual(e.checkpoint(),checkpoint);}
});
test('controller bend: split windows rebase only on commit and preview matches persisted local curve',()=>{
 const e=fixture([cc('a',0,20,{curve:{type:'bezier',handles:[{x:.2,value:100},{x:.8,value:30}]}}),cc('b',1920,80)]);run(e,'clip.split',{clipId:'c',atTick:600});const before=e.project,first=before.clips[0],right=before.clips[1],event=right.events.find(x=>x.curve),next=right.events.find(x=>x.id==='b'),preview=bendControllerCurve(describeControllerSegment(right,event,next),8);run(e,'midi.controllers.bend',{clipId:right.id,eventId:event.id,deltaValue:8});const after=e.project;assert.deepEqual(after.clips[0],first);assert.deepEqual(after.clips[1].events.find(x=>x.id===event.id).curve,preview);assert.equal(after.clips[1].events.find(x=>x.id===event.id).curve.window,undefined);run(e,'history.undo');assert.deepEqual(e.project.clips,before.clips);
});
test('controller bend: window ending without a raw endpoint creates its precise endpoint atomically',()=>{
 const e=fixture();run(e,'clip.split',{clipId:'c',atTick:700});const first=e.project.clips[0],event=first.events[0],preview=bendControllerCurve(describeControllerSegment(first,event,undefined),10),r=run(e,'midi.controllers.bend',{clipId:'c',eventId:event.id,deltaValue:10});assert.equal(r.changes.created.length,1);const c=e.project.clips[0];assert.equal(c.events.at(-1).tick,700);assert.equal(c.events.at(-1).data[1],42);assert.deepEqual(c.events[0].curve,preview);
});
test('controller bend: dry run stale revision later batch failure undo and redo preserve geometry and sampled output',()=>{
 const e=fixture(),before=e.checkpoint(),bytes=wire(e);bend(e,15,{dryRun:true});assert.deepEqual(e.checkpoint(),before);const stale=e.execute({command:'midi.controllers.bend',arguments:{clipId:'c',eventId:'a',deltaValue:15},expectedRevision:0});assert.equal(stale.status,'error');const batch=e.execute({command:'batch',arguments:{commands:[{command:'midi.controllers.bend',arguments:{clipId:'c',eventId:'a',deltaValue:15}},{command:'clip.remove',arguments:{clipId:'missing'}}]}});assert.equal(batch.status,'error');assert.deepEqual(e.checkpoint(),before);bend(e);const after=e.project,changed=wire(e);assert.notDeepEqual(changed,bytes);run(e,'history.undo');assert.deepEqual(wire(e),bytes);run(e,'history.redo');assert.deepEqual(e.project.clips,after.clips);assert.deepEqual(wire(e),changed);
});
test('controller bend: shared sampled curve changes PCM and Freeze plus Merge preserve the new output',()=>{
 const e=fixture(),original=renderProject(e.project,new Map(),{durationSeconds:1.2}).channels;bend(e,15);const pcm=renderProject(e.project,new Map(),{durationSeconds:1.2}).channels,stream=wire(e);assert.notDeepEqual(pcm,original);run(e,'midi.mergeLoop',{leftTick:0,rightTick:1920,selectedTrackIds:['t'],eraseDestination:true});assert.deepEqual(wire(e),stream);assert.deepEqual(renderProject(e.project,new Map(),{durationSeconds:1.2}).channels,pcm);run(e,'history.undo');run(e,'midi.modifiers.freeze',{trackId:'t'});assert.deepEqual(wire(e),stream);assert.deepEqual(renderProject(e.project,new Map(),{durationSeconds:1.2}).channels,pcm);
});
