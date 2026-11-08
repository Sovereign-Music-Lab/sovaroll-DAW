import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,Engine} from '../src/core/engine.mjs';
import {compileControllerPaint} from '../src/media/controller-paint.mjs';
import {writeMidi} from '../src/media/midi.mjs';

const project=(mode='beat-linear')=>({...createProject(),tempoMap:[{tick:0,bpm:120},{tick:3840,bpm:60}],timeDisplay:{pianoMode:mode},clips:[{id:'c',type:'midi',startTick:2880,lengthTicks:9600,notes:[]}]});
const compile=(options={},p=project())=>compileControllerPaint(p,{clipId:'c',startTick:0,startValue:0,stepTicks:240,...options});
const pairs=result=>result.points.map(p=>[p.tick,p.value]);
const limit=e=>e.code==='CONTROLLER_PAINT_LIMIT';
test('Controller Paint: sparse and subdivided collinear packets produce identical density points',()=>{
  const a=compile(),b=compile();a.push({tick:1920,value:120});
  for(let tick=120;tick<=1920;tick+=120)b.push({tick,value:tick/16});
  assert.deepEqual(pairs(a.finish(1920)),pairs(b.finish(1920)));
  assert.deepEqual(pairs(b.snapshot()),[[0,0],[240,15],[480,30],[720,45],[960,60],[1200,75],[1440,90],[1680,105],[1920,120]]);
});
test('Controller Paint: packet endpoints never create unwanted extra events',()=>{
  const g=compile({stepTicks:100});for(const tick of [20,35,80,130,170,250])g.push({tick,value:tick/2});
  assert.deepEqual(pairs(g.finish(250)),[[0,0],[100,50],[200,100],[250,125]]);
});
test('Controller Paint: reversing the path overwrites crossed knots and preserves unvisited tail',()=>{
  const g=compile({stepTicks:100});g.push({tick:400,value:100});g.push({tick:100,value:10});
  assert.deepEqual(pairs(g.finish(100)),[[0,0],[100,10],[200,40],[300,70],[400,100]]);
  assert.deepEqual(g.snapshot().range,{startTick:0,endTick:400});
});
test('Controller Paint: negative lattice indices work for a right-to-left drag',()=>{
  const g=compile({startTick:1050,startValue:100,stepTicks:200});g.push({tick:50,value:0});
  assert.deepEqual(pairs(g.finish(50)),[[50,0],[250,20],[450,40],[650,60],[850,80],[1050,100]]);
});
test('Controller Paint: vertical motion updates a lattice knot but does not invent off-grid samples',()=>{
  const g=compile({stepTicks:100});g.push({tick:0,value:10});g.push({tick:250,value:110});g.push({tick:250,value:70});
  assert.deepEqual(pairs(g.finish(250)),[[0,10],[100,50],[200,90],[250,70]]);
});
test('Controller Paint: time-linear interpolation differs correctly across tempo boundaries',()=>{
  const beat=compile(),time=compile({},project('time-linear')),split=compile({},project('time-linear'));
  beat.push({tick:1920,value:120});time.push({tick:1920,value:120});split.push({tick:960,value:40});split.push({tick:1920,value:120});
  assert.equal(beat.finish(1920).points.find(p=>p.tick===960).value,60);
  const result=time.finish(1920);assert.equal(result.points.find(p=>p.tick===960).value,40);
  assert.deepEqual(pairs(result),pairs(split.finish(1920)));
});
test('Controller Paint: fractional source coordinates are not rounded before lattice intersection',()=>{
  const g=compile({stepTicks:1});g.push({tick:.95,value:95});assert.deepEqual(pairs(g.snapshot()),[[0,0]]);
  g.push({tick:1.05,value:105});assert.deepEqual(pairs(g.finish(1)),[[0,0],[1,105]]);
  // The grid interpolation at tick1 is100; finish explicitly sets the endpoint.
  const h=compile({stepTicks:1});h.push({tick:.95,value:95});h.push({tick:1.05,value:105});assert.deepEqual(pairs(h.snapshot()),[[0,0],[1,100]]);
});
test('Controller Paint: exact half values round upward for ascending and descending segments',()=>{
  const a=compile({stepTicks:1});a.push({tick:2,value:1});assert.deepEqual(pairs(a.finish(2)),[[0,0],[1,1],[2,1]]);
  const b=compile({startValue:1,stepTicks:1});b.push({tick:2,value:0});assert.deepEqual(pairs(b.finish(2)),[[0,1],[1,1],[2,0]]);
});
test('Controller Paint: full14-bit bend and subnormal tick input remain bounded',()=>{
  const a=compile({maxValue:16383,stepTicks:1});a.push({tick:2,value:16383});assert.deepEqual(pairs(a.finish(2)),[[0,0],[1,8192],[2,16383]]);
  const b=compile({stepTicks:1});b.push({tick:Number.MIN_VALUE,value:1});assert.deepEqual(pairs(b.finish(0)),[[0,1]]);
});
test('Controller Paint: exact index traversal remains safe at MAX_SAFE_INTEGER',()=>{
  const p=project();p.clips[0].startTick=0;p.clips[0].lengthTicks=Number.MAX_SAFE_INTEGER;
  const start=Number.MAX_SAFE_INTEGER-10,g=compile({startTick:start,stepTicks:2},p);g.push({tick:start+10,value:100});
  assert.deepEqual(pairs(g.finish(start+10)),Array.from({length:6},(_,i)=>[start+i*2,i*20]));
});
test('Controller Paint: point budget rejects an entire segment and permanently prevents partial commit',()=>{
  const g=compile({stepTicks:1,maxPoints:3}),before=g.snapshot();assert.throws(()=>g.push({tick:5,value:100}),limit);
  assert.deepEqual(g.snapshot().points,before.points);assert.equal(g.snapshot().failed,true);
  assert.throws(()=>g.finish(0),e=>e.code==='CONTROLLER_PAINT_ABORTED');assert.throws(()=>g.push({tick:1,value:1}),e=>e.code==='CONTROLLER_PAINT_ABORTED');
});
test('Controller Paint: repeated overpainting has an independent work budget',()=>{
  const g=compile({stepTicks:1,maxWork:6});g.push({tick:2,value:20});g.push({tick:0,value:0});
  const before=g.snapshot();assert.throws(()=>g.push({tick:2,value:20}),limit);assert.deepEqual(g.snapshot().points,before.points);assert.equal(g.snapshot().work,6);
});
test('Controller Paint: final endpoint and stationary packet budgets cannot bypass limits',()=>{
  const g=compile({stepTicks:100,maxPoints:1});g.push({tick:50,value:50});assert.throws(()=>g.finish(50),limit);assert.throws(()=>g.finish(0),e=>e.code==='CONTROLLER_PAINT_ABORTED');
  const h=compile({maxSegments:1});h.push({tick:1,value:1});assert.throws(()=>h.push({tick:1,value:2}),limit);
});
test('Controller Paint: invalid sample leaves source and previous preview untouched and aborts finish',()=>{
  for(const sample of [null,{tick:-1,value:0},{tick:9601,value:0},{tick:0,value:128},{tick:NaN,value:0},{tick:1,value:Infinity}]){
    const p=project(),before=JSON.stringify(p),g=compile({},p),preview=g.snapshot();assert.throws(()=>g.push(sample));assert.deepEqual(g.snapshot().points,preview.points);assert.equal(JSON.stringify(p),before);assert.throws(()=>g.finish(0));
  }
  for(const options of [{stepTicks:0},{stepTicks:.5},{maxValue:255},{maxPoints:200001},{maxWork:1000001},{startTick:-1},{startValue:128}])assert.throws(()=>compile(options));
});
test('Controller Paint: input project and returned previews are detached from the captured gesture',()=>{
  const p=project('time-linear'),g=compile({},p);p.tempoMap[0].bpm=20;p.timeDisplay.pianoMode='beat-linear';p.clips[0].lengthTicks=1;
  const preview=g.snapshot();preview.points[0].value=127;preview.range.endTick=999;
  g.push({tick:1920,value:120});const result=g.finish(1920);assert.equal(result.points[0].value,0);assert.equal(result.points.find(x=>x.tick===960).value,40);assert.equal(result.closed,true);assert.throws(()=>g.push({tick:1,value:1}),e=>e.code==='CONTROLLER_PAINT_CLOSED');
});
test('Controller Paint: independent per-integer oracle matches deterministic reversing trajectories',()=>{
  let seed=71;const random=()=>((seed=(seed*1664525+1013904223)>>>0)%101);
  for(let trial=0;trial<24;trial++){
    const start=random(),step=trial%7+1,value=random(),g=compile({startTick:start,startValue:value,stepTicks:step}),oracle=new Map([[start,value]]);let prior={tick:start,value};
    for(let i=0;i<12;i++){
      const next={tick:random(),value:random()};g.push(next);
      for(let tick=0;tick<=100;tick++)if((tick-start)%step===0&&tick>=Math.min(prior.tick,next.tick)&&tick<=Math.max(prior.tick,next.tick)){
        const den=Math.abs(next.tick-prior.tick),num=prior.tick===next.tick?0:(next.tick>prior.tick?tick-prior.tick:prior.tick-tick);
        // Integer weighted-sum oracle, independent of the rational implementation.
        oracle.set(tick,den===0?next.value:Math.floor((prior.value*(den-num)+next.value*num)/den+.5));
      }
      prior=next;
    }
    oracle.set(prior.tick,prior.value);assert.deepEqual(pairs(g.finish(prior.tick)),[...oracle].sort((a,b)=>a[0]-b[0]));
  }
});
test('Controller Paint: maximum200000-point gesture completes without stack spread or over-budget allocation',()=>{
  const p=project();p.clips[0].lengthTicks=300000;
  const g=compile({stepTicks:1},p);g.push({tick:199999,value:127});
  const result=g.finish(199999);assert.equal(result.points.length,200000);
  assert.deepEqual(result.points[0],{tick:0,value:0});assert.deepEqual(result.points.at(-1),{tick:199999,value:127});
  assert.ok(result.points.every((point,i)=>point.tick===i&&point.value>=0&&point.value<=127));
  const h=compile({stepTicks:1},p);assert.throws(()=>h.push({tick:200000,value:127}),limit);assert.equal(h.snapshot().points.length,1);
});
test('Controller Paint: existing draw command consumes generated points in one Undo with exact MIDI recovery',()=>{
  const e=new Engine(createProject()),command=(c,a={})=>{const r=e.execute({command:c,arguments:a});assert.equal(r.status,'applied',JSON.stringify(r));};
  command('track.add',{id:'t',type:'midi'});command('clip.add',{id:'c',trackId:'t',type:'midi',lengthTicks:1920,notes:[],events:[{id:'foreign',tick:240,kind:'channel',status:177,data:[11,77]}]});
  const before=structuredClone(e.project),midi=writeMidi(e.project),g=compile({},e.project);g.push({tick:960,value:100});
  command('midi.controllers.draw',{clipId:'c',lane:{kind:'cc',channel:0,controller:11},points:g.finish(960).points});
  assert.equal(e.project.revision,before.revision+1);assert.deepEqual(e.project.clips[0].events.filter(x=>x.status===176).map(x=>[x.tick,x.data[1]]),[[0,0],[240,25],[480,50],[720,75],[960,100]]);
  assert.deepEqual(e.project.clips[0].events.find(x=>x.id==='foreign'),before.clips[0].events[0]);command('history.undo');assert.deepEqual(writeMidi(e.project),midi);
});
