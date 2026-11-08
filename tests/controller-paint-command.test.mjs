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
const clip=e=>e.project.clips[0],args=(extra={})=>({clipId:'c',lane,startTick:300,endTick:700,points:[{tick:300,value:100},{tick:700,value:10}],...extra});
const stateAt=(c,tick)=>{let value;for(const e of materializeMidiCurves(c).events.filter(e=>e.status===176&&e.data[0]===11).sort((a,b)=>a.tick-b.tick||(a.order??0)-(b.order??0)))if(e.tick<=tick)value=e.data[1];return value;};
function rejected(e,a,code){const before=structuredClone(e.project),history=e.exportHistory(),r=e.execute({command:'midi.controllers.paint',arguments:a});assert.equal(r.status,'error',JSON.stringify(a));if(code)assert.equal(r.errors[0].code,code);assert.deepEqual(e.project,before);assert.deepEqual(e.exportHistory(),history);}

test('Paint command: covered range removes off-grid duplicates but preserves other channels CC opaque and notes',()=>{
 const e=fixture([cc('first',0,20),cc('old1',300,30),cc('old2',300,40),cc('inside',550,50),cc('later',900,80),cc('channel',500,60,{status:177}),cc('cc7',500,70,{data:[7,70]}),{id:'opaque',tick:500,kind:'sysex',status:240,data:[125,247]}]),before=structuredClone(clip(e));
 const r=ok(e,'midi.controllers.paint',args());assert.ok(r.changes.removed.includes('inside'));assert.ok(r.changes.removed.includes('old1'));assert.equal(clip(e).events.find(x=>x.id==='old2').data[1],100);assert.equal(r.changes.boundaryGuardIds.length,1);
 for(const id of ['channel','cc7','opaque','later','first'])assert.deepEqual(clip(e).events.find(x=>x.id===id),before.events.find(x=>x.id===id));assert.deepEqual(clip(e).notes,before.notes);assert.equal(stateAt(clip(e),701),50);
});
test('Paint command: Ramp guards retain all integer states outside the range and editable source geometry',()=>{
 const e=fixture([cc('a',0,0,{curve:{type:'ramp'}}),cc('b',1000,100)]),before=structuredClone(clip(e));const r=ok(e,'midi.controllers.paint',args());
 assert.equal(r.changes.boundaryGuardIds.length,2);assert.ok(clip(e).events.find(x=>x.id==='a').curve.window);
 for(let t=0;t<=1920;t++)if(t<300||t>700)assert.equal(stateAt(clip(e),t),stateAt(before,t),'tick '+t);
 assert.equal(stateAt(clip(e),500),100);assert.equal(stateAt(clip(e),700),10);assert.ok(clip(e).events.length<10);
});
test('Paint command: Bezier outside states survive with nontrivial source handles',()=>{
 const e=fixture([cc('a',0,0,{curve:{type:'bezier',handles:[{x:.2,value:90},{x:.8,value:10}]}}),cc('b',1000,100)]),before=structuredClone(clip(e));ok(e,'midi.controllers.paint',args({curve:{type:'ramp'}}));
 for(const t of [0,50,120,250,299,701,750,800,999,1000,1500])assert.equal(stateAt(clip(e),t),stateAt(before,t),'tick '+t);
 assert.equal(stateAt(clip(e),500),55);
});
test('Paint command: split source windows and emitStart policy remain editable outside the painted range',()=>{
 const e=fixture([cc('a',0,0,{curve:{type:'ramp'}}),cc('b',1000,100)]);const split=ok(e,'clip.split',{clipId:'c',atTick:250}),id=split.changes.split.rightClipId,c=e.project.clips.find(x=>x.id===id),before=structuredClone(c);
 ok(e,'midi.controllers.paint',args({clipId:id,startTick:100,endTick:400,points:[{tick:100,value:10},{tick:400,value:90}]}));const after=e.project.clips.find(x=>x.id===id);
 for(const t of [0,10,50,99,401,500,749,750,1000])assert.equal(stateAt(after,t),stateAt(before,t),'tick '+t);assert.ok(after.events.some(x=>x.curve?.window));
});
test('Paint command: existing adjacent boundaries are reused without duplicate guard points',()=>{
 const e=fixture([cc('a',299,30,{curve:{type:'ramp'}}),cc('b',701,70,{curve:{type:'ramp'}}),cc('end',1000,100)]),before=structuredClone(clip(e));const r=ok(e,'midi.controllers.paint',args());
 assert.equal(r.changes.boundaryGuardIds.length,0);assert.equal(clip(e).events.filter(x=>x.tick===299).length,1);assert.equal(clip(e).events.find(x=>x.id==='a').curve,undefined);assert.deepEqual(clip(e).events.find(x=>x.id==='b'),before.events.find(x=>x.id==='b'));
});
test('Paint command: sparse points get explicit range edges and a single-tick range is legal',()=>{
 const e=fixture([cc('a',0,20)]);const r=ok(e,'midi.controllers.paint',args({points:[{tick:500,value:60}]}));assert.equal(r.changes.paintEdgeIds.length,2);
 assert.deepEqual(clip(e).events.filter(x=>x.tick>=300&&x.tick<=700).map(x=>[x.tick,x.data[1]]),[[300,60],[500,60],[700,60]]);
 ok(e,'midi.controllers.paint',args({startTick:500,endTick:500,points:[{tick:500,value:10}]}));assert.equal(stateAt(clip(e),499),60);assert.equal(stateAt(clip(e),500),10);assert.equal(stateAt(clip(e),501),60);
});
test('Paint command: clip-edge replacement needs no invented guard beyond the clip',()=>{
 const e=fixture([cc('a',0,20)]);const r=ok(e,'midi.controllers.paint',args({startTick:0,endTick:1920,points:[{tick:0,value:50},{tick:1920,value:70}]}));assert.equal(r.changes.boundaryGuardIds.length,0);assert.equal(clip(e).events.length,2);
});
test('Paint command: unknown original lane state is reported instead of synthesizing a device default',()=>{
 const e=fixture([cc('later',1000,70)]);const r=ok(e,'midi.controllers.paint',args());assert.equal(r.changes.warnings[0].code,'CONTROLLER_PAINT_UNKNOWN_PRIOR_STATE');assert.equal(r.changes.boundaryGuardIds.length,0);assert.equal(stateAt(clip(e),800),10);assert.equal(stateAt(clip(e),1000),70);
});
test('Paint command: endpointless old curve stays constant before the range instead of gaining a new ramp',()=>{
 const e=fixture([cc('a',0,20,{curve:{type:'ramp'}})]);ok(e,'midi.controllers.paint',args());assert.equal(stateAt(clip(e),100),20);assert.equal(stateAt(clip(e),299),20);assert.equal(stateAt(clip(e),701),20);
});
test('Paint command: 14-bit and poly-key scopes preserve foreign numeric events',()=>{
 const e=fixture([{id:'bend',tick:0,kind:'channel',status:224,data:[0,64]},{id:'p60',tick:500,kind:'channel',status:160,data:[60,50]},{id:'p61',tick:500,kind:'channel',status:160,data:[61,70]}]);
 ok(e,'midi.controllers.paint',args({lane:{kind:'pitchBend',channel:0},points:[{tick:300,value:16383},{tick:700,value:0}]}));assert.deepEqual(clip(e).events.find(x=>x.tick===300&&x.status===224).data,[127,127]);
 ok(e,'midi.controllers.paint',args({lane:{kind:'polyPressure',channel:0,pitch:60}}));assert.ok(!clip(e).events.some(x=>x.id==='p60'));assert.deepEqual(clip(e).events.find(x=>x.id==='p61').data,[61,70]);
});
test('Paint command: malformed range duplicate times invalid values and program curves are atomic',()=>{
 const e=fixture([cc('a',0,10)]);
 for(const a of [args({startTick:701}),args({endTick:2000}),args({points:[]}),args({points:[{tick:500,value:1},{tick:500,value:2}]}),args({points:[{tick:299,value:1}]}),args({points:[{tick:500,value:128}]}),args({lane:{kind:'program',channel:0},curve:{type:'ramp'}}),args({curve:{type:'bezier',handles:[{x:.8,value:128},{x:.2,value:0}]}})])rejected(e,a);
});
test('Paint command: order overflow and boundary event budget fail without partial guard mutation',()=>{
 const e=fixture([cc('a',0,10,{order:Number.MAX_SAFE_INTEGER})]);rejected(e,args(),'MIDI_ORDER_OVERFLOW');
 const big=fixture([],200000);const points=Array.from({length:200000},(_,tick)=>({tick,value:tick%128}));rejected(big,args({startTick:0,endTick:200000,points}),'MIDI_EVENT_LIMIT');
});
test('Paint command: sampled plan commits once and Undo Redo restore exact editable source and MIDI bytes',()=>{
 const e=fixture([cc('a',0,0,{curve:{type:'ramp'}}),cc('b',1920,127)]),before=structuredClone(e.project),midi=writeMidi(e.project),sampler=compileControllerPaint(e.project,{clipId:'c',startTick:300,startValue:20,stepTicks:120});sampler.push({tick:700,value:100});const result=sampler.finish(700);
 ok(e,'midi.controllers.paint',args({points:result.points,...result.range}));assert.equal(e.project.revision,before.revision+1);const after=structuredClone(clip(e));ok(e,'history.undo');assert.deepEqual(clip(e),before.clips[0]);assert.deepEqual(writeMidi(e.project),midi);ok(e,'history.redo');assert.deepEqual(clip(e),after);
});
test('Paint command: PCM outside the painted interval is unchanged while painted amplitude changes',()=>{
 const e=fixture([cc('a',0,0,{curve:{type:'ramp'}}),cc('b',1920,127)]),before=renderProject(e.project);ok(e,'midi.controllers.paint',args({points:[{tick:300,value:127},{tick:700,value:127}]}));const after=renderProject(e.project);
 for(let ch=0;ch<2;ch++){assert.deepEqual(after.channels[ch].slice(0,1200),before.channels[ch].slice(0,1200));assert.deepEqual(after.channels[ch].slice(3000),before.channels[ch].slice(3000));assert.notDeepEqual(after.channels[ch].slice(1400,2800),before.channels[ch].slice(1400,2800));}
});
