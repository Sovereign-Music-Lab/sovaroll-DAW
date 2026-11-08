import test from 'node:test';
import assert from 'node:assert/strict';
import {generateControllerShape as generate,quantizedControllerPeriod,translateControllerShape} from '../src/media/controller-shapes.mjs';
const project=(mode='beat-linear')=>({ppq:960,tempoMap:[{tick:0,bpm:120},{tick:3840,bpm:60}],timeDisplay:{pianoMode:mode},clips:[{id:'c',type:'midi',startTick:2880,lengthTicks:9600}]});
const options=(extra={})=>({clipId:'c',kind:'parabola',startTick:0,endTick:960,startValue:0,endValue:120,density:{mode:'ticks',stepTicks:240},...extra});
const shape=(extra={},p=project())=>generate(p,options(extra)),values=r=>r.points.map(p=>p.value),ticks=r=>r.points.map(p=>p.tick);
const error=code=>e=>e.code===code;
test('Controller shapes: quadratic Parabola and reversed exponent preserve both endpoints',()=>{
 assert.deepEqual(values(shape()),[0,8,30,68,120]);assert.deepEqual(values(shape({reverse:true})),[0,53,90,113,120]);
 assert.deepEqual(values(shape({exponent:1})),[0,30,60,90,120]);assert.equal(values(shape({exponent:3}))[2],15);
});
test('Controller shapes: right-to-left Parabola retains click direction rather than silently swapping shape',()=>{
 assert.deepEqual(values(shape({startTick:960,endTick:0,startValue:120,endValue:0})),[0,53,90,113,120]);
 assert.deepEqual(values(shape({startTick:960,endTick:0,startValue:120,endValue:0,reverse:true})),[0,8,30,68,120]);
});
test('Controller shapes: descending values and equal values stay within 7-bit domain',()=>{
 assert.deepEqual(values(shape({startValue:120,endValue:0})),[120,113,90,53,0]);assert.deepEqual(values(shape({startValue:63,endValue:63})),[63,63,63,63,63]);
});
test('Controller shapes: Sine exact quadrants use half-up rounding without cosine noise',()=>{
 assert.deepEqual(values(shape({kind:'sine',periodTicks:960,startValue:0,endValue:127})),[0,64,127,64,0]);
 assert.deepEqual(values(shape({kind:'sine',periodTicks:960,startValue:127,endValue:0})),[127,64,0,64,127]);
});
test('Controller shapes: signed and wrapped phase shifts preserve musical period',()=>{
 const base={kind:'sine',periodTicks:960};assert.deepEqual(values(shape({...base,phase:.25})),[60,120,60,0,60]);
 assert.deepEqual(values(shape({...base,phase:-.75})),values(shape({...base,phase:1000000.25})));
});
test('Controller shapes: Triangle peak and both sawtooth limits have explicit wrap values',()=>{
 const base={kind:'triangle',periodTicks:960};assert.deepEqual(values(shape(base)),[0,60,120,60,0]);
 assert.deepEqual(values(shape({...base,peak:.25})),[0,120,80,40,0]);assert.deepEqual(values(shape({...base,peak:0})),[120,90,60,30,120]);assert.deepEqual(values(shape({...base,peak:1})),[0,30,60,90,0]);
});
test('Controller shapes: Square duty is half-open and constant at zero and one',()=>{
 const base={kind:'square',periodTicks:960};assert.deepEqual(values(shape(base)),[120,120,0,0,120]);
 assert.deepEqual(values(shape({...base,duty:.25})),[120,0,0,0,120]);assert.deepEqual(values(shape({...base,duty:0})),[0,0,0,0,0]);assert.deepEqual(values(shape({...base,duty:1})),[120,120,120,120,120]);
});
test('Controller shapes: exact decimal phase compares correctly at triangle and pulse boundaries',()=>{
 assert.equal(values(shape({kind:'triangle',periodTicks:7,phase:.1,peak:.1}))[0],120);
 assert.equal(values(shape({kind:'square',periodTicks:7,phase:.1,duty:.1}))[0],0);
 assert.equal(values(shape({kind:'square',periodTicks:7,phase:-.9,duty:.1}))[0],0);
});
test('Controller shapes: period and fixed density are independent and include irregular endpoint',()=>{
 const a=shape({kind:'sine',periodTicks:960,endTick:1000,density:{mode:'ticks',stepTicks:300}});assert.deepEqual(ticks(a),[0,300,600,900,1000]);
 const b=shape({kind:'sine',periodTicks:480,endTick:1000,density:{mode:'ticks',stepTicks:300}});assert.deepEqual(ticks(a),ticks(b));assert.notDeepEqual(values(a),values(b));
});
test('Controller shapes: reverse wave traversal anchors phase and density to clicked start',()=>{
 const a=shape({kind:'square',periodTicks:960,phase:.25,startTick:1000,endTick:0,density:{mode:'ticks',stepTicks:300}});
 assert.deepEqual(ticks(a),[0,100,400,700,1000]);assert.deepEqual(values(a),[120,120,0,0,120]);assert.equal(a.direction,-1);
});
test('Controller shapes: time-linear Parabola follows local tempo elapsed position',()=>{
 const a=shape({endTick:1920,density:{mode:'ticks',stepTicks:960}},project('time-linear'));assert.deepEqual(values(a),[0,13,120]);
 assert.deepEqual(values(shape({endTick:1920,density:{mode:'ticks',stepTicks:960}})),[0,30,120]);
});
test('Controller shapes: periodic source period does not change with display mode or tempo',()=>{
 const input={kind:'triangle',periodTicks:960,endTick:1920};assert.deepEqual(shape(input).points,shape(input,project('time-linear')).points);
});
test('Controller shapes: Quantize Link changes point density with zoom without changing source phase',()=>{
 const input={kind:'triangle',periodTicks:960};const a=shape({...input,density:{mode:'quantize-link',zoom:8}}),b=shape({...input,density:{mode:'quantize-link',zoom:16}});
 assert.deepEqual(ticks(a),[0,240,480,720,960]);assert.equal(b.points.length,9);for(const p of a.points)assert.deepEqual(b.points.find(q=>q.tick===p.tick),p);
});
test('Controller shapes: time-linear Quantize Link uses equal elapsed pixel spacing through tempo change',()=>{
 const a=shape({kind:'triangle',periodTicks:960,endTick:1920,density:{mode:'quantize-link',zoom:4}},project('time-linear'));
 assert.deepEqual(ticks(a),[0,480,960,1200,1440,1680,1920]);
 const b=shape({kind:'triangle',periodTicks:960,startTick:1920,endTick:0,density:{mode:'quantize-link',zoom:4}},project('time-linear'));assert.deepEqual(ticks(b),ticks(a));
});
test('Controller shapes: Quantize Link deduplicates collapsed ticks and always includes endpoint',()=>{
 const p=project();p.ppq=1;const a=shape({kind:'square',periodTicks:2,endTick:3,density:{mode:'quantize-link',zoom:100}},p);assert.deepEqual(ticks(a),[0,1,2,3]);
 const b=shape({kind:'triangle',periodTicks:960,endTick:999,density:{mode:'quantize-link',zoom:8}});assert.deepEqual(ticks(b),[0,240,480,720,960,999]);
});
test('Controller shapes: large source origin and period do not lose low modulo bits',()=>{
 const p=project(),max=Number.MAX_SAFE_INTEGER;p.clips[0]={id:'c',type:'midi',startTick:0,lengthTicks:max};
 const r=shape({kind:'square',periodTicks:3,startTick:max-9,endTick:max,density:{mode:'ticks',stepTicks:1}},p);assert.deepEqual(values(r),[120,120,0,120,120,0,120,120,0,120]);
 const q=shape({kind:'triangle',periodTicks:3,startTick:max-9,endTick:max,density:{mode:'quantize-link',zoom:960}},p);assert.deepEqual(ticks(q),[max-9,max-7,max-5,max-3,max-1,max]);
});
test('Controller shapes: pitchbend preserves full 14-bit midpoint and asymmetric value bounds',()=>{
 assert.deepEqual(values(shape({kind:'triangle',periodTicks:960,startValue:0,endValue:16383,maxValue:16383})),[0,8192,16383,8192,0]);
 assert.deepEqual(values(shape({kind:'square',periodTicks:960,startValue:6000,endValue:12000,maxValue:16383})),[12000,12000,6000,6000,12000]);
});
test('Controller shapes: irrelevant unknown malformed and out-of-range inputs fail before returning a plan',()=>{
 for(const x of [{kind:'noise'},{endTick:0},{endTick:10000},{startValue:128},{exponent:0},{reverse:1},{phase:0},{kind:'sine'},{kind:'sine',periodTicks:0},{kind:'sine',periodTicks:960,duty:.5},{kind:'triangle',periodTicks:960,peak:1.1},{kind:'square',periodTicks:960,duty:NaN},{density:{mode:'ticks',stepTicks:.5}},{density:{mode:'ticks',stepTicks:1,zoom:48}},{density:{mode:'quantize-link',zoom:48}},{kind:'sine',periodTicks:960,density:{mode:'quantize-link',zoom:0}},{unknown:true}])assert.throws(()=>shape(x));
});
test('Controller shapes: generation and translation never mutate project or request',()=>{
 const p=project(),input=options({kind:'triangle',periodTicks:960}),before=structuredClone({p,input});const r=generate(p,input);r.points[0].value=55;r.density.stepTicks=1;assert.deepEqual({p,input},before);
 const moved=translateControllerShape(input,{deltaTick:240,deltaValue:5,lengthTicks:9600});assert.equal(moved.startTick,240);assert.equal(moved.endTick,1200);assert.equal(moved.endValue,125);assert.deepEqual(input,before.input);
});
test('Controller shapes: whole-curve translation rejects overflow instead of clipping amplitude or duration',()=>{
 const input=options();for(const shift of [{deltaTick:-1},{deltaTick:9000},{deltaValue:8},{deltaValue:-1}])assert.throws(()=>translateControllerShape(input,{...shift,lengthTicks:9600}),error('CONTROLLER_SHAPE_OUT_OF_BOUNDS'));
 const x=options({startTick:Number.MAX_SAFE_INTEGER-100,endTick:Number.MAX_SAFE_INTEGER});assert.throws(()=>translateControllerShape(x,{deltaTick:1,lengthTicks:Number.MAX_SAFE_INTEGER}),error('CONTROLLER_SHAPE_OUT_OF_BOUNDS'));
});
test('Controller shapes: Shift period resolution uses positive Quantize multiples with exact tie handling',()=>{
 assert.equal(quantizedControllerPeriod(100,100,240),240);assert.equal(quantizedControllerPeriod(100,460,240),480);assert.equal(quantizedControllerPeriod(460,100,240),480);assert.equal(quantizedControllerPeriod(100,459,240),240);
 assert.equal(quantizedControllerPeriod(0,Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER-1),Number.MAX_SAFE_INTEGER-1);assert.throws(()=>quantizedControllerPeriod(0,Number.MAX_SAFE_INTEGER,6000000000000000),error('CONTROLLER_SHAPE_OUT_OF_BOUNDS'));
});
test('Controller shapes: budgets count final endpoint and Zoom candidates before allocation',()=>{
 assert.throws(()=>shape({maxPoints:4}),error('CONTROLLER_SHAPE_LIMIT'));assert.throws(()=>shape({endTick:961,maxPoints:5}),error('CONTROLLER_SHAPE_LIMIT'));
 assert.throws(()=>shape({kind:'sine',periodTicks:960,density:{mode:'quantize-link',zoom:10000},maxPoints:100}),error('CONTROLLER_SHAPE_LIMIT'));
 assert.throws(()=>shape({maxPoints:200001}));
});
test('Controller shapes: 200000 source samples are generated exactly and excess is rejected',()=>{
 const p=project();p.clips[0].lengthTicks=200000;const r=shape({kind:'square',periodTicks:4,endTick:199999,density:{mode:'ticks',stepTicks:1}},p);assert.equal(r.points.length,200000);assert.deepEqual(r.points.slice(0,4).map(p=>p.value),[120,120,0,0]);assert.equal(r.points.at(-1).tick,199999);
 assert.throws(()=>shape({kind:'square',periodTicks:4,endTick:200000,density:{mode:'ticks',stepTicks:1}},p),error('CONTROLLER_SHAPE_LIMIT'));
});
test('Controller shapes: independent integer triangle oracle covers directions phases densities and peaks',()=>{
 for(const direction of [-1,1])for(const period of [4,8,12])for(const peak of [.25,.5,.75])for(const phase of [0,.25,-.25]){
  const start=direction>0?100:196,end=direction>0?196:100,r=shape({kind:'triangle',periodTicks:period,startTick:start,endTick:end,phase,peak,startValue:10,endValue:110,density:{mode:'ticks',stepTicks:1}});
  for(const p of r.points){let position=((Math.abs(p.tick-start)+phase*period)%period+period)%period;const peakTick=peak*period,f=position<=peakTick?position/peakTick:(period-position)/(period-peakTick);assert.equal(p.value,Math.floor(10+100*f+.5));}
 }
});
