import test from 'node:test';
import assert from 'node:assert/strict';
import {Engine,createProject} from '../src/core/engine.mjs';
import {patchSnapGrid} from '../src/media/snap-grid.mjs';
import {compileControllerTimeGesture} from '../src/media/controller-time-gesture.mjs';
import {writeMidi} from '../src/media/midi.mjs';

function project(patch={}) {
  return {...createProject(),tempoMap:[{tick:0,bpm:120},{tick:3840,bpm:60}],
    timeDisplay:{primaryFormat:'seconds'},
    snapGrid:patchSnapGrid(undefined,{piano:{mode:'time',origin:'clip',seconds:'1000-ms',...patch}}),
    clips:[{id:'clip',type:'midi',startTick:2880,lengthTicks:9600,notes:[]}]};
}
const compile=(p=project(),options={})=>compileControllerTimeGesture(p,{clipId:'clip',...options});
const outOfBounds=e=>e.code==='CONTROLLER_GESTURE_OUT_OF_BOUNDS';

test('Controller time gesture: pointer samples snap through a tempo boundary without pre-rounding',()=>{
  const g=compile();assert.equal(g.position(1300.4),1440);assert.equal(g.position(2400.2),2400);
  const fine=compile(project({seconds:'1-ms',sourceRounding:'nearest'}));
  assert.equal(fine.position(.95),0);assert.equal(fine.position(1),2);
});
test('Controller time gesture: project grid before clip is rejected rather than clamped',()=>{
  const p=project({origin:'project'});p.clips[0].startTick=100;
  assert.throws(()=>compile(p).position(0),outOfBounds);
  assert.equal(compile(p).position(1900),1820);
});
test('Controller time gesture: exact errors remain errors and explicit source rounding works',()=>{
  const p=project({seconds:'1-ms'});assert.throws(()=>compile(p).position(1),e=>e.code==='TIME_NOT_REPRESENTABLE');
  p.snapGrid.piano.sourceRounding='nearest';assert.equal(compile(p).position(1),2);
});
test('Controller time gesture: musical fallback and snap off have separate rounding contracts',()=>{
  const p=project();p.timeDisplay.primaryFormat='bars-beats';assert.equal(compile(p).position(121),240);
  const off=compile(project({seconds:'1-ms'}),{snapEnabled:false});assert.equal(off.position(1.5),2);assert.equal(off.mode,'off');
});
test('Controller time gesture: draw coalesces collapsed samples using last value and preserves input',()=>{
  const p=project({sourceRounding:'nearest',samples:'1-sample'});p.timeDisplay.primaryFormat='samples';
  const samples=[{tick:.1,value:10},{tick:.2,value:70},{tick:1.2,value:50}],before=structuredClone(samples);
  assert.deepEqual(compile(p).draw(samples),[{tick:0,value:70},{tick:1,value:50}]);assert.deepEqual(samples,before);
});
test('Controller time gesture: movement preserves every off-grid interval with one anchor delta',()=>{
  const points=[{tick:100},{tick:917},{tick:1501},{tick:1501}],before=structuredClone(points);
  const result=compile().move({anchorTick:917,targetTick:1349.7,points});
  assert.deepEqual(result,{tick:1440,deltaTick:523,ticks:[623,1440,2024,2024]});assert.deepEqual(points,before);
});
test('Controller time gesture: group bounds include last point and note ends without partial clamp',()=>{
  const g=compile();assert.throws(()=>g.move({anchorTick:100,targetTick:1400,points:[{tick:100},{tick:9000}]}),outOfBounds);
  assert.throws(()=>g.move({anchorTick:100,targetTick:1400,points:[{tick:100,endTick:9000}]}),outOfBounds);
  assert.throws(()=>g.move({anchorTick:1900,targetTick:0,points:[{tick:10},{tick:1900}]}),outOfBounds);
});
test('Controller time gesture: reversed Line retains endpoint values and independent density',()=>{
  const result=compile().line({start:{tick:2400.1,value:127},end:{tick:1300.2,value:0},stepTicks:100});
  assert.deepEqual(result,{startTick:1440,endTick:2400,startValue:0,endValue:127,stepTicks:100});
});
test('Controller time gesture: collapsed Line rejects; snap-off density is source tick one',()=>{
  assert.throws(()=>compile().line({start:{tick:1400,value:0},end:{tick:1500,value:127},stepTicks:1}),e=>e.code==='CONTROLLER_GESTURE_COLLAPSED');
  const result=compile(project(),{snapEnabled:false}).line({start:{tick:10.4,value:1},end:{tick:20.4,value:2},stepTicks:NaN});
  assert.equal(result.stepTicks,1);assert.equal(result.startTick,10);assert.equal(result.endTick,20);
});
test('Controller time gesture: malformed input and source point budgets fail before mutation',()=>{
  const p=project(),before=JSON.stringify(p),g=compile(p);
  for(const value of [-1,9601,NaN,Infinity,'1'])assert.throws(()=>g.position(value));
  for(const samples of [[],[null],[{tick:1,value:-1}],new Array(200001)])assert.throws(()=>g.draw(samples));
  assert.throws(()=>g.move({anchorTick:1,targetTick:2,points:[{tick:3}]}));
  assert.throws(()=>g.move({anchorTick:1,targetTick:2,points:[{tick:1,endTick:0}]}));
  assert.throws(()=>compile(p,{snapEnabled:1}));assert.throws(()=>compileControllerTimeGesture(p,{clipId:'absent'}));
  assert.equal(JSON.stringify(p),before);
});
test('Controller time gesture: huge-origin fractional pointer survives and compiler snapshots its policy',()=>{
  const p=project({seconds:'1-ms',sourceRounding:'nearest'});p.tempoMap=[{tick:0,bpm:120}];p.clips[0].startTick=Number.MAX_SAFE_INTEGER-10000;
  const g=compile(p);p.clips[0].lengthTicks=1;p.tempoMap[0].bpm=20;p.snapGrid.piano.seconds='1000-ms';
  assert.equal(g.position(.95),0);assert.equal(g.position(1),2);assert.equal(g.lengthTicks,9600);
});
test('Controller time gesture: dense Line refuses over budget before allocating points',()=>{
  const p=project();p.clips[0].lengthTicks=300000;const g=compile(p,{snapEnabled:false});
  assert.throws(()=>g.line({start:{tick:0,value:0},end:{tick:200000,value:1}}),e=>e.code==='MIDI_EVENT_LIMIT');
  assert.equal(g.line({start:{tick:0,value:0},end:{tick:199999,value:1}}).endTick,199999);
});

function engineFixture() {
  const e=new Engine(createProject());
  const command=(command,args={})=>{const r=e.execute({command,arguments:args});assert.equal(r.status,'applied',JSON.stringify(r));return r;};
  command('track.add',{id:'track',type:'midi'});
  command('clip.add',{id:'clip',trackId:'track',type:'midi',startTick:2880,lengthTicks:9600,notes:[],events:[
    {id:'a',tick:100,kind:'channel',status:176,data:[11,20],order:0},
    {id:'b',tick:917,kind:'channel',status:176,data:[11,30],order:1},
    {id:'other',tick:100,kind:'channel',status:177,data:[11,40],order:2}]});
  command('tempo.set',{tempoMap:[{tick:0,bpm:120},{tick:3840,bpm:60}]});
  command('project.timeDisplay',{options:{primaryFormat:'seconds'}});
  command('project.snapGrid',{options:{piano:{mode:'time',seconds:'1000-ms'}}});
  return {e,command};
}
test('Controller time gesture engine: generated move is one Undo and MIDI bytes restore exactly',()=>{
  const {e,command}=engineFixture(),before=structuredClone(e.project),midi=writeMidi(e.project),g=compile(e.project);
  const move=g.move({anchorTick:917,targetTick:1300,points:[{tick:100},{tick:917}]});
  command('midi.controllers.move',{clipId:'clip',eventIds:['a','b'],deltaTick:move.deltaTick,deltaValue:3});
  assert.equal(e.project.revision,before.revision+1);
  assert.deepEqual(e.project.clips[0].events.map(x=>[x.id,x.tick,x.data[1]]),[['other',100,40],['a',623,23],['b',1440,33]]);
  command('history.undo');assert.deepEqual(e.project.clips,before.clips);assert.deepEqual(writeMidi(e.project),midi);
  command('history.redo');assert.equal(e.project.clips[0].events.find(x=>x.id==='b').tick,1440);
});
test('Controller time gesture engine: Line uses independent source density and preserves other channels',()=>{
  const {e,command}=engineFixture(),g=compile(e.project);
  const line=g.line({start:{tick:1300,value:0},end:{tick:2400,value:100},stepTicks:400});
  command('midi.controllers.line',{clipId:'clip',lane:{kind:'cc',channel:0,controller:11},...line});
  assert.deepEqual(e.project.clips[0].events.filter(x=>x.status===176&&x.tick>=1440).map(x=>[x.tick,x.data[1]]),[[1440,0],[1840,42],[2240,83],[2400,100]]);
  assert.equal(e.project.clips[0].events.find(x=>x.id==='other').data[1],40);
});
test('Controller time gesture engine: failed lane-value commit is atomic after valid time planning',()=>{
  const {e}=engineFixture(),before=structuredClone(e.project),history=e.exportHistory(),g=compile(e.project);
  const points=g.draw([{tick:1400,value:16383}]);
  const result=e.execute({command:'midi.controllers.draw',arguments:{clipId:'clip',lane:{kind:'cc',channel:0,controller:11},points}});
  assert.equal(result.status,'error');assert.deepEqual(e.project,before);assert.deepEqual(e.exportHistory(),history);
});
