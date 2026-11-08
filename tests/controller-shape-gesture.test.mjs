import test from 'node:test';
import assert from 'node:assert/strict';
import {compileControllerShapeGesture as compile} from '../src/media/controller-shape-gesture.mjs';
import {createProject,Engine} from '../src/core/engine.mjs';
const project=()=>({...createProject(),clips:[{id:'c',type:'midi',startTick:0,lengthTicks:9600,notes:[]}]}),point=(tick,value=100)=>({tick,value,x:tick/960*48,y:127-value});
const make=(extra={},p=project())=>compile(p,{clipId:'c',kind:'triangle',start:point(240,20),density:{mode:'ticks',stepTicks:240},periodTicks:960,quantizeTicks:240,height:127,...extra});
const err=code=>e=>e.code===code;
test('Shape gesture: normal range produces detached shared arguments and finish seals gesture',()=>{
 const g=make();g.update(point(1200));const p=g.preview();assert.deepEqual(p.points.map(x=>x.tick),[240,480,720,960,1200]);p.points[0].value=99;assert.equal(g.preview().points[0].value,20);const r=g.finish();assert.equal(r.arguments.endTick,1200);assert.equal(r.arguments.endValue,100);assert.throws(()=>g.update(point(1440)),err('CONTROLLER_SHAPE_CLOSED'));
});
test('Shape gesture: Ctrl phase freezes bounds and transitions do not jump on release',()=>{
 const g=make();g.update(point(1200));g.update(point(1200),{ctrlKey:true});let o=g.update(point(1440),{ctrlKey:true});assert.equal(o.phase,.25);assert.equal(o.endTick,1200);assert.equal(o.endValue,100);
 o=g.update(point(1440),{});assert.equal(o.endTick,1200);o=g.update(point(1680),{});assert.equal(o.endTick,1440);assert.equal(o.phase,.25);
});
test('Shape gesture: Cmd and Ctrl phase are equivalent including reversed direction',()=>{
 const a=make(),b=make();for(const g of [a,b])g.update(point(1200));a.update(point(1200),{ctrlKey:true});b.update(point(1200),{metaKey:true});a.update(point(1440),{ctrlKey:true});b.update(point(1440),{metaKey:true});assert.deepEqual(a.finish().arguments,b.finish().arguments);
 const c=make({start:point(1200,20)});c.update(point(240));c.update(point(240),{ctrlKey:true});assert.equal(c.update(point(0),{ctrlKey:true}).phase,.25);
});
test('Shape gesture: Alt Ctrl translates both bounds and values and a release preserves placement',()=>{
 const g=make();g.update(point(1200,80));const keys={altKey:true,ctrlKey:true};g.update(point(1200,80),keys);const o=g.update(point(1440,90),keys);assert.deepEqual([o.startTick,o.endTick,o.startValue,o.endValue],[480,1440,30,90]);assert.deepEqual(g.update(point(1440,90),{}),o);
});
test('Shape gesture: whole translation beyond clip or MIDI range aborts all later commits',()=>{
 const g=make();g.update(point(1200));g.update(point(1200),{ctrlKey:true,altKey:true});assert.throws(()=>g.update(point(0),{ctrlKey:true,altKey:true}));assert.throws(()=>g.finish(),err('CONTROLLER_SHAPE_ABORTED'));
 const h=make();h.update(point(1200));h.update(point(1200),{ctrlKey:true,altKey:true});assert.throws(()=>h.update(point(1440,0),{ctrlKey:true,altKey:true}));assert.throws(()=>h.finish(),err('CONTROLLER_SHAPE_ABORTED'));
});
test('Shape gesture: triangle peak and square duty use Shift Ctrl while Sine remains phase',()=>{
 for(const kind of ['triangle','square','sine']){const g=make({kind}),keys={shiftKey:true,ctrlKey:true};g.update(point(1200));g.update(point(1200),keys);const o=g.update(point(1680),keys);assert.equal(o.endTick,1200);assert.equal(o[kind==='triangle'?'peak':kind==='square'?'duty':'phase'],kind==='sine'?.5:1);}
});
test('Shape gesture: initial Shift drag sets Quantize-multiple period and Snap off uses free source length',()=>{
 const g=make({modifiers:{shiftKey:true}});g.update(point(1550),{shiftKey:true});const o=g.finish().arguments;assert.equal(o.endTick,1440);assert.equal(o.periodTicks,1200);
 const h=make({snapEnabled:false,modifiers:{shiftKey:true}});h.update(point(1550),{shiftKey:true});assert.equal(h.finish().arguments.periodTicks,1310);
});
test('Shape gesture: Parabola Ctrl reverse is held while Shift exponent keeps fixed endpoints',()=>{
 const g=make({kind:'parabola'});g.update(point(1200,80));g.update(point(1200,80),{ctrlKey:true});assert.equal(g.snapshot().options.reverse,true);g.update(point(1200,80),{shiftKey:true});const o=g.update({...point(1200,100),y:47-127/4},{shiftKey:true});assert.equal(o.exponent,4);assert.equal(o.reverse,false);assert.deepEqual([o.startTick,o.endTick,o.startValue,o.endValue],[240,1200,20,80]);
});
test('Shape gesture: Parabola Alt translates and modifier held at start first establishes a real range',()=>{
 const g=make({kind:'parabola',modifiers:{altKey:true}});g.update(point(1200,80),{altKey:true});assert.equal(g.snapshot().options.endTick,1200);const o=g.update(point(1440,90),{altKey:true});assert.deepEqual([o.startTick,o.endTick,o.startValue,o.endValue],[480,1440,30,90]);
});
test('Shape gesture: time-linear translation uses pixels for the anchor but preserves source duration',()=>{
 const p=project();p.timeDisplay={pianoMode:'time-linear'};p.tempoMap=[{tick:0,bpm:120},{tick:960,bpm:60}];const t=(tick,value=100)=>({...point(tick,value),x:tick<=960?tick/20:48+(tick-960)/10});
 const g=make({start:t(480,20)},p);g.update(t(1440));g.update(t(1440),{ctrlKey:true,altKey:true});const o=g.update(t(1680),{ctrlKey:true,altKey:true});assert.equal(o.startTick,960);assert.equal(o.endTick,1920);
});
test('Shape gesture: project snapshot and Quantize Link zoom are frozen for preview and commit',()=>{
 const p=project(),g=make({density:{mode:'quantize-link',zoom:8}},p);p.tempoMap[0].bpm=20;p.timeDisplay={pianoMode:'time-linear'};g.update(point(1200));const result=g.finish();assert.equal(result.plan.mode,'beat-linear');assert.equal(result.plan.points.length,5);assert.equal(result.arguments.density.zoom,8);
});
test('Shape gesture: collapsed range and preview budget failure cannot commit previous data',()=>{
 const g=make();assert.equal(g.preview(),null);assert.throws(()=>g.finish(),err('CONTROLLER_SHAPE_COLLAPSED'));assert.throws(()=>g.finish(),err('CONTROLLER_SHAPE_ABORTED'));
 const p=project();p.clips[0].lengthTicks=300000;const h=make({density:{mode:'ticks',stepTicks:1}},p);h.update(point(250000));assert.throws(()=>h.preview(),err('CONTROLLER_SHAPE_LIMIT'));assert.throws(()=>h.finish(),err('CONTROLLER_SHAPE_ABORTED'));
});
test('Shape gesture: exact elapsed position failure poisons the whole gesture',()=>{
 const p=project();p.timeDisplay={primaryFormat:'seconds'};p.snapGrid={piano:{mode:'time',seconds:'1-ms',sourceRounding:'exact'}};const g=make({start:point(0,20)},p);assert.throws(()=>g.update(point(10)),err('TIME_NOT_REPRESENTABLE'));assert.throws(()=>g.finish(),err('CONTROLLER_SHAPE_ABORTED'));
});
test('Shape gesture: generated arguments apply through one real engine Undo and Redo',()=>{
 const e=new Engine(createProject());e.execute({command:'track.add',arguments:{id:'t',type:'midi'}});e.execute({command:'clip.add',arguments:{id:'c',trackId:'t',type:'midi',lengthTicks:9600,notes:[]}});const before=structuredClone(e.project.clips[0]),g=make({},e.project);g.update(point(1200));g.update(point(1200),{ctrlKey:true});g.update(point(1440),{ctrlKey:true});const result=g.finish();let r=e.execute({command:'midi.controllers.shape',arguments:{...result.arguments,lane:{kind:'cc',channel:0,controller:11}}});assert.equal(r.status,'applied');const saved=structuredClone(e.project.clips[0]);assert.equal(saved.events[0].data[1],60);e.execute({command:'history.undo',arguments:{}});assert.deepEqual(e.project.clips[0],before);e.execute({command:'history.redo',arguments:{}});assert.deepEqual(e.project.clips[0],saved);
});

test('Shape gesture: releasing Ctrl into Shift period does not change a multi-cycle shape until motion',()=>{
 const g=make();g.update(point(2160));g.update(point(2160),{ctrlKey:true,shiftKey:true});g.update(point(2400),{ctrlKey:true,shiftKey:true});let o=g.update(point(2400),{shiftKey:true});assert.equal(o.periodTicks,960);assert.equal(o.endTick,2160);o=g.update(point(2400),{});assert.equal(o.periodTicks,960);assert.equal(o.endTick,2160);
});
