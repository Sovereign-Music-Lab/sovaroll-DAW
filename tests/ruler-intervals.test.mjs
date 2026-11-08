import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject} from '../src/core/engine.mjs';
import {resolveTimeDisplay} from '../src/media/time-display.mjs';
import {compileRulerIntervals} from '../src/media/ruler-intervals.mjs';
const p=(options={})=>({...createProject(),tempoMap:[{tick:0,bpm:120},{tick:3840,bpm:60},{tick:7680,bpm:180}],timeDisplay:resolveTimeDisplay({primaryFormat:'seconds',timelineMode:'time-linear',pianoMode:'time-linear',...options})});
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
test('Ruler intervals: seconds labels follow elapsed units instead of musical bar anchors',()=>{
 const r=compileRulerIntervals(p()).range(0,700);assert.equal(r.step,'1000');assert.equal(r.unit,'millisecond');assert.deepEqual(r.ticks.slice(0,4).map(t=>[t.unit,t.x,t.tick,t.label]),[['0',0,0,'00:00:00.000'],['1000',96,1920,'00:00:01.000'],['2000',192,3840,'00:00:02.000'],['3000',288,4800,'00:00:03.000']]);
});
test('Ruler intervals: beat-linear seconds widen with tempo while retaining nonoverlapping labels',()=>{
 const r=compileRulerIntervals(p({timelineMode:'beat-linear'})).range(0,1100);assert.equal(r.step,'2000');assert.deepEqual(r.ticks.slice(0,5).map(t=>t.x),[0,192,288,384,672]);for(let i=1;i<r.ticks.length;i++)assert.ok(r.ticks[i].x-r.ticks[i-1].x>=96-1e-8);
});
test('Ruler intervals: independent scope and nonzero clip origin use local elapsed time',()=>{
 const project=p({timelineFormat:'samples',pianoFormat:'seconds'}),r=compileRulerIntervals(project,{scope:'piano',originTick:2880}).range(0,300);assert.equal(r.ticks[1].unit,'1000');assert.equal(r.ticks[1].tick,1440);assert.equal(r.ticks[1].x,96);assert.equal(r.ticks[1].label,'00:00:01.000');assert.equal(compileRulerIntervals(project).unit,'sample');
});
test('Ruler intervals: sample labels are integer identities even across fractional tick positions',()=>{
 const r=compileRulerIntervals(p({primaryFormat:'samples'})).range(0,400);assert.equal(r.step,'50000');assert.equal(r.ticks[1].label,'50000');near(r.ticks[1].x,100);near(r.ticks[1].tick,2000);const project=p({primaryFormat:'samples'});project.sampleRate=44100;const t=compileRulerIntervals(project).range(0,400).ticks[1];assert.equal(t.label,'50000');near(t.x,50000/44100*96);assert.ok(!Number.isInteger(t.tick));
});
test('Ruler intervals: rational-rate frames retain exact labels without float roundtrip loss',()=>{
 const r=compileRulerIntervals(p({primaryFormat:'timecode',frameRate:{nominalFps:30,numerator:30000,denominator:1001,dropFrame:false}})).range(0,500);assert.equal(r.step,'30');assert.equal(r.ticks[1].label,'00:00:01:00');near(r.ticks[1].x,96.096);near(r.ticks[1].tick,1921.92);
});
test('Ruler intervals: drop-frame minute labels are legal and ten-minute count is retained',()=>{
 const project=p({primaryFormat:'timecode',frameRate:{nominalFps:30,numerator:30000,denominator:1001,dropFrame:true}}),c=compileRulerIntervals(project,{zoom:10000});
 for(const frame of [1798,1799,1800,1801,17982]){const x=frame*1001/30000*20000,r=c.range(x,x+1,{minSpacing:16}),point=r.ticks.find(t=>t.unit===String(frame));assert.ok(point);if(frame===1800)assert.equal(point.label,'00:01:00;02');if(frame===17982)assert.equal(point.label,'00:10:00;00');assert.ok(!/00:01:00;0[01]$/.test(point.label));}
});
test('Ruler intervals: user fps and80subframe units refine at high zoom independently of project rate',()=>{
 const r=compileRulerIntervals(p({primaryFormat:'user-fps',userFps:25,showSubframes:true}),{zoom:10000}).range(0,200,{minSpacing:16});assert.equal(r.unit,'subframe');assert.equal(r.step,'2');assert.equal(r.ticks[1].label,'00:00:00:00.02');assert.equal(r.ticks[1].x,20);
});
test('Ruler intervals: viewport iteration is bounded and aligned when scrolling or viewing long spans',()=>{
 const c=compileRulerIntervals(p());for(const range of [[0,1e12],[1e9,1e9+500],[12345,12900]]){const r=c.range(...range,{maxLines:12});assert.ok(r.ticks.length<=12);const step=BigInt(r.step);assert.ok(r.ticks.every(t=>BigInt(t.unit)%step===0n));assert.ok(r.ticks.some(t=>t.x<=range[0]));assert.ok(r.ticks.at(-1).x>=range[1]);}
 const a=c.range(10000,11000),b=c.range(10100,11100);assert.equal(a.step,b.step);assert.ok(a.ticks.filter(t=>t.x>=10100&&t.x<=11000).every(t=>b.ticks.some(u=>u.unit===t.unit&&u.x===t.x)));
});
test('Ruler intervals: compiled snapshots survive edits and preserve input source bytes',()=>{
 const project=p(),before=JSON.stringify(project),c=compileRulerIntervals(project);const r=c.range(0,300);assert.equal(JSON.stringify(project),before);project.tempoMap[0].bpm=20;project.timeDisplay.primaryFormat='samples';assert.deepEqual(c.range(0,300),r);assert.ok(Object.isFrozen(c));
});
test('Ruler intervals: invalid scope range precision domain and iteration limits reject explicitly',()=>{
 assert.throws(()=>compileRulerIntervals(p(),{scope:'primary'}));assert.throws(()=>compileRulerIntervals(p({primaryFormat:'bars-beats'})));assert.throws(()=>compileRulerIntervals(p(),{originTick:-1}));assert.throws(()=>compileRulerIntervals(p(),{zoom:0}));const c=compileRulerIntervals(p());for(const args of [[-1,2],[2,1],[0,Infinity],[NaN,1],[0,1,{maxLines:3}],[0,1,{maxLines:2049}],[0,1,{minSpacing:0}]])assert.throws(()=>c.range(...args));const project=p({primaryFormat:'samples'});project.sampleRate=Number.MAX_SAFE_INTEGER;assert.throws(()=>compileRulerIntervals(project).range(0,1000));
});
