import test from 'node:test';
import assert from 'node:assert/strict';
import {Engine,createProject} from '../src/core/engine.mjs';
import {writeMidi} from '../src/media/midi.mjs';
import {renderProject} from '../src/media/render.mjs';
import {materializeMidiCurves} from '../src/media/midi-curves.mjs';
import {compileControllerPaint} from '../src/media/controller-paint.mjs';
const lane={kind:'cc',channel:0,controller:11},cc=(id,tick,value,extra={})=>({id,tick,kind:'channel',status:176,data:[11,value],...extra});
function fixture(events=[],lengthTicks=1920){const e=new Engine(createProject({sampleRate:8000}));ok(e,'track.add',{id:'t',type:'midi',instrument:'sine'});ok(e,'clip.add',{id:'c',trackId:'t',type:'midi',lengthTicks,notes:[{id:'n',startTick:0,durationTicks:lengthTicks,pitch:69,velocity:100,channel:0}],events:events.map((p,order)=>({order,...p}))});return e;}
function ok(e,command,args={}){const r=e.execute({command,arguments:args});assert.equal(r.status,'applied',JSON.stringify(r));return r;}
const clip=e=>e.project.clips[0],args=(extra={})=>({clipId:'c',lane,kind:'triangle',startTick:240,endTick:1200,startValue:0,endValue:120,periodTicks:960,density:{mode:'ticks',stepTicks:240},...extra});
const stateAt=(c,tick)=>{let value;for(const e of materializeMidiCurves(c).events.filter(e=>e.status===176&&e.data[0]===11).sort((a,b)=>a.tick-b.tick||(a.order??0)-(b.order??0)))if(e.tick<=tick)value=e.data[1];return value;};
function rejected(e,a,code){const before=structuredClone(e.project),history=e.exportHistory(),r=e.execute({command:'midi.controllers.shape',arguments:a});assert.equal(r.status,'error',JSON.stringify(a));if(code)assert.equal(r.errors[0].code,code);assert.deepEqual(e.project,before);assert.deepEqual(e.exportHistory(),history);}

test('Shape command: all four modes create discrete samples through the atomic common engine',()=>{
 for(const kind of ['parabola','sine','triangle','square']){const e=fixture();const a=args({kind});if(kind==='parabola')delete a.periodTicks;const before=e.project.revision,r=ok(e,'midi.controllers.shape',a);assert.equal(e.project.revision,before+1);assert.equal(r.changes.shape.kind,kind);assert.equal(r.changes.shape.pointCount,5);assert.deepEqual(clip(e).events.map(e=>e.tick),[240,480,720,960,1200]);assert.ok(clip(e).events.every(e=>!e.curve));}
});
test('Shape command: preserves outside integer values editable curves other lanes and raw events',()=>{
 const e=fixture([cc('a',0,0,{curve:{type:'bezier',handles:[{x:.2,value:120},{x:.8,value:20}]}}),cc('b',1600,120),cc('inside',500,55,{status:177}),{id:'raw',kind:'sysex',tick:500,status:240,data:[125,247]}]);
 const before=structuredClone(clip(e)),outside=Array.from({length:1921},(_,t)=>stateAt(before,t));ok(e,'midi.controllers.shape',args());const after=clip(e);assert.ok(after.events.some(e=>e.curve?.window));for(let t=0;t<=1920;t++)if(t<240||t>1200)assert.equal(stateAt(after,t),outside[t]);
 for(const id of ['inside','raw'])assert.deepEqual(after.events.find(e=>e.id===id),before.events.find(e=>e.id===id));assert.deepEqual(after.notes,before.notes);
});
test('Shape command: reverse span keeps generated phase and replaces all off-grid duplicates',()=>{
 const e=fixture([cc('first',0,10),cc('x',240,40),cc('y',240,60),cc('inside',500,50)]);ok(e,'midi.controllers.shape',args({startTick:1200,endTick:240,kind:'square',phase:.25}));const xs=clip(e).events;assert.ok(!xs.some(e=>e.id==='x'||e.id==='inside'));assert.equal(xs.find(e=>e.id==='y').data[1],120);assert.equal(xs.find(e=>e.tick===960).data[1],0);
});
test('Shape command: pitchbend poly key pressure and program event scopes remain isolated',()=>{
 const e=fixture([{id:'p61',kind:'channel',tick:600,status:160,data:[61,99]}]);
 ok(e,'midi.controllers.shape',args({lane:{kind:'pitchBend',channel:15},endValue:16383}));assert.deepEqual(clip(e).events.find(e=>e.tick===720&&e.status===239).data,[127,127]);
 ok(e,'midi.controllers.shape',args({lane:{kind:'polyPressure',channel:0,pitch:60}}));assert.deepEqual(clip(e).events.find(e=>e.id==='p61').data,[61,99]);
 ok(e,'midi.controllers.shape',args({lane:{kind:'channelPressure',channel:3}}));assert.ok(clip(e).events.some(e=>e.status===211&&e.data[0]===120));
 ok(e,'midi.controllers.shape',args({lane:{kind:'program',channel:0}}));assert.ok(clip(e).events.some(e=>e.status===192));rejected(e,args({lane:{kind:'program',channel:0},curve:{type:'ramp'}}),'CURVE_NOT_SUPPORTED');
});
test('Shape command: explicit curve is confined to generated range while default remains Step',()=>{
 const e=fixture([cc('a',0,30)]);ok(e,'midi.controllers.shape',args({curve:{type:'ramp'}}));assert.equal(clip(e).events.find(e=>e.tick===240).curve.type,'ramp');assert.equal(clip(e).events.find(e=>e.tick===1200).curve,undefined);assert.equal(stateAt(clip(e),1201),30);assert.equal(stateAt(clip(e),239),30);
});
test('Shape command: dry-run invalid arguments and a later failed batch child preserve history and state',()=>{
 const e=fixture([cc('a',0,20)]),before=structuredClone(e.project),history=e.exportHistory();const r=e.execute({command:'midi.controllers.shape',arguments:args(),dryRun:true});assert.equal(r.applied,false);assert.deepEqual(e.project,before);
 for(const a of [args({periodTicks:0}),args({endTick:3000}),args({endValue:128}),args({peak:2}),args({phase:Infinity}),args({kind:'sine',peak:.5}),args({density:{mode:'quantize-link',zoom:10001}})])rejected(e,a);
 const result=e.execute({command:'batch',arguments:{commands:[{command:'midi.controllers.shape',arguments:args()},{command:'midi.events.remove',arguments:{clipId:'c',eventIds:['missing']}}]}});assert.equal(result.status,'error');assert.deepEqual(e.project,before);assert.deepEqual(e.exportHistory(),history);
});
test('Shape command: generated points plus outside guards cannot exceed the event budget',()=>{
 const e=fixture([cc('a',0,20)],200001);rejected(e,args({kind:'square',startTick:1,endTick:200000,density:{mode:'ticks',stepTicks:1}}),'MIDI_EVENT_LIMIT');
});
test('Shape command: Undo Redo restore original source MIDI bytes and audible CC waveform',()=>{
 const e=fixture([cc('a',0,127)]),before=structuredClone(clip(e)),wire=writeMidi(e.project),pcm=renderProject(e.project);ok(e,'midi.controllers.shape',args({kind:'square',periodTicks:480}));const changed=structuredClone(clip(e)),after=renderProject(e.project);assert.notDeepEqual(after.channels[0],pcm.channels[0]);assert.deepEqual(after.channels[0].slice(0,900),pcm.channels[0].slice(0,900));// Controller boundaries split oscillator segments; float phase arithmetic can differ at ~1e-14.
 for(let i=5200;i<pcm.channels[0].length;i++)assert.ok(Math.abs(after.channels[0][i]-pcm.channels[0][i])<1e-10);
 ok(e,'history.undo');assert.deepEqual(clip(e),before);assert.deepEqual(writeMidi(e.project),wire);assert.deepEqual(renderProject(e.project).channels,pcm.channels);ok(e,'history.redo');assert.deepEqual(clip(e),changed);
});
test('Shape command: saved time-linear layout drives Quantize Link sampling without changing musical period',()=>{
 const e=fixture();ok(e,'tempo.set',{tempoMap:[{tick:0,bpm:120},{tick:960,bpm:60}]});ok(e,'project.timeDisplay',{options:{pianoMode:'time-linear'}});const r=ok(e,'midi.controllers.shape',args({startTick:0,endTick:1920,density:{mode:'quantize-link',zoom:4}}));assert.equal(r.changes.shape.mode,'time-linear');assert.equal(r.changes.shape.periodTicks,960);assert.deepEqual(clip(e).events.map(e=>e.tick),[0,480,960,1200,1440,1680,1920]);
});
