import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject} from '../src/core/engine.mjs';
import {resolveTimeDisplay} from '../src/media/time-display.mjs';
import {compileTimeEditResolver,ELAPSED_GRID_TYPES} from '../src/media/time-edit-resolver.mjs';
const project=(settings={})=>({...createProject(),tempoMap:[{tick:0,bpm:120},{tick:3840,bpm:60},{tick:7680,bpm:180}],timeDisplay:resolveTimeDisplay(settings)});
const ratio=(n,d=1)=>({numerator:String(n),denominator:String(d)}),err=code=>e=>e.code===code;

test('Time edit resolver: legacy BarsBeats position and duration retain display PPQ and origin semantics',()=>{
 const p=createProject(),before=JSON.stringify(p),r=compileTimeEditResolver(p);assert.equal(r.position('002.1.1.000').tick,3840);assert.equal(r.position('001.1.1.000',{originTick:2880}).tick,2880);assert.equal(r.duration('000.1.0.000',{startTick:2880}).durationTicks,960);assert.equal(JSON.stringify(p),before);assert.ok(Object.isFrozen(r));
});
test('Time edit resolver: primary independent scopes and local elapsed positions are parsed exactly',()=>{
 const r=compileTimeEditResolver(project({primaryFormat:'seconds',timelineFormat:'samples',pianoFormat:'timecode'}));assert.equal(r.position('00:00:03.000').tick,4800);assert.equal(r.position('144000',{scope:'timeline'}).tick,4800);assert.equal(r.position('00:00:01:00',{scope:'piano',originTick:2880}).tick,4320);assert.equal(r.position('00:00:01.000',{originTick:2880}).tick,4320);
});
test('Time edit resolver: durations are anchored at the actual tempo and never converted from zero',()=>{
 const r=compileTimeEditResolver(project({primaryFormat:'seconds'}));let value=r.duration('00:00:01.000',{startTick:2880});assert.equal(value.durationTicks,1440);assert.equal(value.endTick,4320);value=r.duration('00:00:01.000',{startTick:4800});assert.equal(value.durationTicks,960);assert.equal(r.duration('00:00:00.000',{startTick:4800}).durationTicks,0);
});
test('Time edit resolver: timecode drop-frame and80subframe text use actual rational frame speed',()=>{
 const r=compileTimeEditResolver(project({primaryFormat:'timecode',frameRate:{nominalFps:30,numerator:30000,denominator:1001,dropFrame:true}}));assert.throws(()=>r.position('00:01:00;02'),err('TIME_NOT_REPRESENTABLE'));const v=r.position('00:01:00;02',{rounding:'nearest'});assert.equal(v.requestedUnits,'144000');assert.equal(v.exact,false);assert.throws(()=>r.position('00:01:00;00'),err('INVALID_TIMECODE_LABEL'));assert.throws(()=>r.position('00:00:00;00.80'));const sf=r.position('00:00:00;00.01',{rounding:'nearest'});assert.deepEqual(sf.targetTick,ratio(1001,1250));assert.equal(sf.tick,1);
});
test('Time edit resolver: user fps is independent and parses explicit subframes even when readouts hide them',()=>{
 const r=compileTimeEditResolver(project({primaryFormat:'user-fps',userFps:25,showSubframes:false}));assert.equal(r.position('00:00:01:00').tick,1920);const v=r.position('00:00:00:00.01',{rounding:'nearest'});assert.deepEqual(v.targetTick,ratio(24,25));assert.equal(v.tick,1);assert.equal(v.unitRate.numerator,2000);
});
test('Time edit resolver: source rounding never silently accepts inexact millisecond or sample edits',()=>{
 const r=compileTimeEditResolver(project({primaryFormat:'seconds',timelineFormat:'samples'}));assert.throws(()=>r.position('00:00:00.001'),err('TIME_NOT_REPRESENTABLE'));assert.equal(r.position('00:00:00.001',{rounding:'floor'}).tick,1);assert.equal(r.position('00:00:00.001',{rounding:'ceil'}).tick,2);assert.throws(()=>r.position('1',{scope:'timeline'}),err('TIME_NOT_REPRESENTABLE'));assert.equal(r.position('1',{scope:'timeline',rounding:'nearest'}).tick,0);
});
test('Time edit resolver: all explicit millisecond and sample grid options preserve their actual counts',()=>{
 for(const format of ['seconds','samples']){const r=compileTimeEditResolver(project({primaryFormat:format}));for(const grid of ELAPSED_GRID_TYPES[format]){const v=r.snap(4000,grid,{sourceRounding:'nearest'});assert.equal(v.step,grid.split('-')[0]);assert.equal(BigInt(v.unit)%BigInt(v.step),0n);assert.equal(v.unitRate.numerator,format==='seconds'?1000:48000);}}
 const p=project({primaryFormat:'samples'});p.sampleRate=96000;const v=compileTimeEditResolver(p).snap(4000,'44100-samples',{sourceRounding:'nearest'});assert.equal(v.step,'44100');assert.equal(v.unitRate.numerator,96000);
});
test('Time edit resolver: subframe quarter half single and double frame grids preserve80subframe structure',()=>{
 for(const format of ['timecode','user-fps']){const r=compileTimeEditResolver(project({primaryFormat:format,userFps:25,frameRate:{nominalFps:30,numerator:30000,denominator:1001,dropFrame:false}}));for(const [grid,step]of [['subframe',1],['quarter-frame',20],['half-frame',40],['frame',80],['two-frames',160]]){const v=r.snap(17,grid,{sourceRounding:'nearest'});assert.equal(v.step,String(step));assert.equal(BigInt(v.unit)%BigInt(step),0n);assert.equal(v.unitRate.numerator,format==='user-fps'?2000:2400000);}}
});
test('Time edit resolver: ambiguous frame-format1-second basis requires an explicit policy',()=>{
 const p=project({primaryFormat:'timecode',frameRate:{nominalFps:30,numerator:30000,denominator:1001,dropFrame:false}}),r=compileTimeEditResolver(p);assert.throws(()=>r.snap(1920,'1-second'),err('TIME_GRID_BASIS_REQUIRED'));
 const elapsed=r.snap(1920,'1-second',{secondBasis:'elapsed'}),nominal=r.snap(1920,'1-second',{secondBasis:'nominal-frames',sourceRounding:'nearest'});assert.equal(elapsed.tick,1920);assert.deepEqual(elapsed.targetElapsedSeconds,ratio(1));assert.equal(nominal.tick,1922);assert.deepEqual(nominal.targetElapsedSeconds,ratio(1001,1000));assert.equal(nominal.unit,'2400');
});
test('Time edit resolver: snapshot and numeric conversion never mutate project events or options',()=>{
 const p=project({primaryFormat:'seconds'}),before=JSON.stringify(p),r=compileTimeEditResolver(p),options={originTick:2880,rounding:'nearest'},frozen=JSON.stringify(options);r.position('00:00:01.001',options);r.duration('00:00:01.000',{startTick:2880});r.snap(4000,'1000-ms');assert.equal(JSON.stringify(p),before);assert.equal(JSON.stringify(options),frozen);p.tempoMap[0].bpm=20;p.timeDisplay.primaryFormat='samples';assert.equal(r.position('00:00:01.000').tick,1920);
});
test('Time edit resolver: schema format malformed text negative offsets and unsafe endpoints reject',()=>{
 const r=compileTimeEditResolver(project({primaryFormat:'seconds'}));for(const text of [1,'','-00:00:01.000','00:60:00.000','00:00:00.1',' 00:00:00.000'])assert.throws(()=>r.position(text));for(const options of [{scope:'unknown'},{originTick:-1},{originTick:0.5},{rounding:'truncate'},{typo:1},null])assert.throws(()=>r.position('00:00:01.000',options));assert.throws(()=>r.duration('00:00:01.000',{}));assert.throws(()=>r.duration('00:00:01.000',{startTick:Number.MAX_SAFE_INTEGER}));
 const bars=compileTimeEditResolver(createProject());assert.throws(()=>bars.position('002.1.1.000',{originTick:Number.MAX_SAFE_INTEGER}),err('EXACT_TIME_OUT_OF_RANGE'));
});
test('Time edit resolver: invalid mixed grid types and implicit frame second basis never fall back',()=>{
 const r=compileTimeEditResolver(project({primaryFormat:'seconds'}));for(const [grid,options]of [['frame',{}],['10-ms',{secondBasis:'elapsed'}],['1-ms',{scope:'unknown'}],['1-ms',{originTick:-1}],['1-ms',{sourceRounding:'truncate'}],['1-ms',{typo:true}]])assert.throws(()=>r.snap(1,grid,options));assert.throws(()=>compileTimeEditResolver(createProject()).snap(1,'1-ms'));const frame=compileTimeEditResolver(project({primaryFormat:'timecode'}));assert.throws(()=>frame.snap(1,'1-second',{secondBasis:'automatic'}),err('TIME_GRID_BASIS_REQUIRED'));assert.throws(()=>frame.snap(1,'frame',{secondBasis:'elapsed'}));
});
