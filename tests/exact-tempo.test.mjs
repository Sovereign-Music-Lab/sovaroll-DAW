import test from 'node:test';
import assert from 'node:assert/strict';
import {compileExactTempoMap,EXACT_TEMPO_LIMITS} from '../src/media/exact-tempo.mjs';
import {compileTimecode} from '../src/media/timecode.mjs';
const ratio=(n,d=1)=>({numerator:String(n),denominator:String(d)}),rate=n=>ratio(n);
const map=()=>[{tick:0,bpm:120},{tick:3840,bpm:60},{tick:7680,bpm:180}];
const err=code=>e=>e.code===code;
// Deliberately simple independent oracle: scale all fixture BPMs by1000 and
// sum each crossed segment as unreduced cross-products, then reduce with Euclid.
function reduce(n,d){let a=n<0n?-n:n,b=d;while(b){const r=a%b;a=b;b=r;}return[n/a,d/a];}
const add=(a,b)=>reduce(a[0]*b[1]+b[0]*a[1],a[1]*b[1]);
function oracle(points,ppq,tick){let total=[0n,1n];for(let i=0;i<points.length&&tick>points[i].tick;i++){const end=Math.min(tick,points[i+1]?.tick??tick);total=add(total,[BigInt(end-points[i].tick)*60000n,BigInt(Math.round(points[i].bpm*1000))*BigInt(ppq)]);}return ratio(...total);}

test('Exact tempo: canonical decimal BPM is rational and never changes stored source',()=>{
 const points=[{tick:0,bpm:72.3}],before=structuredClone(points),c=compileExactTempoMap(points);assert.equal(c.precision,'canonical-decimal-bpm-rational');assert.deepEqual(c.secondsAt(1),ratio(5,5784));assert.deepEqual(c.secondsAt(5784),ratio(5));assert.equal(c.tickAtSeconds(ratio(5)),5784);assert.deepEqual(points,before);assert.ok(Object.isFrozen(c));assert.ok(Object.isFrozen(EXACT_TEMPO_LIMITS));
});
test('Exact tempo: boundaries belong to new segments and inverse fractions are exact',()=>{
 const c=compileExactTempoMap(map());for(const [tick,time]of [[0,ratio(0)],[3840,ratio(2)],[7680,ratio(6)],[8000,ratio(55,9)]]){assert.deepEqual(c.secondsAt(tick),time);assert.equal(c.tickAtSeconds(time),tick);}
 assert.deepEqual(c.tickFractionAtSeconds(ratio(4001,2000)),ratio(96012,25));assert.deepEqual(c.tickFractionAtSeconds(ratio(11999,2000)),ratio(191988,25));
});
test('Exact tempo: clip-local elapsed durations cross both forward and backward tempo boundaries',()=>{
 const c=compileExactTempoMap(map());assert.deepEqual(c.secondsBetween(2880,4800),ratio(3,2));assert.deepEqual(c.secondsBetween(4800,2880),ratio(-3,2));assert.equal(c.tickAtElapsed(2880,ratio(1)),4320);assert.equal(c.tickAtElapsed(4800,ratio(-3,2)),2880);assert.equal(c.tickAtElapsed(3840,ratio(-1,2)),2880);assert.equal(c.tickAtElapsed(3840,ratio(1,2)),4320);assert.equal(c.tickAtElapsed(7680,ratio(-4)),3840);assert.equal(c.tickAtElapsed(7680,ratio(0)),7680);
});
test('Exact tempo: source rounding is explicit with midpoint ties toward later positions',()=>{
 const c=compileExactTempoMap([{tick:0,bpm:120}]);assert.deepEqual(c.tickFractionAtSeconds(ratio(1,3840)),ratio(1,2));assert.throws(()=>c.tickAtSeconds(ratio(1,3840)),err('TIME_NOT_REPRESENTABLE'));
 for(const [policy,result]of [['floor',0],['ceil',1],['nearest',1]])assert.equal(c.tickAtSeconds(ratio(1,3840),policy),result);
 assert.equal(c.tickAtElapsed(1,ratio(-1,3840),'nearest'),1);assert.equal(c.tickAtElapsed(1,ratio(-1,3840),'floor'),0);assert.equal(c.tickAtElapsed(1,ratio(1,3840),'nearest'),2);
 assert.equal(c.unitsBetween(1,0,rate(960),'floor'),'-1');assert.equal(c.unitsBetween(1,0,rate(960),'ceil'),'0');assert.equal(c.unitsBetween(1,0,rate(960),'nearest'),'0');
});
test('Exact tempo: samples and rational-rate frames convert without floating seconds',()=>{
 const c=compileExactTempoMap(map());assert.equal(c.unitsAt(3840,rate(48000)),'96000');assert.equal(c.unitsBetween(2880,4800,rate(48000)),'72000');assert.equal(c.tickAtUnits(96000,rate(48000)),3840);assert.equal(c.tickAtElapsedUnits(4800,-72000,rate(48000)),2880);
 assert.throws(()=>c.tickAtUnits(1,rate(44100)),err('TIME_NOT_REPRESENTABLE'));assert.equal(c.tickAtUnits(1,rate(44100),'nearest'),0);
 assert.throws(()=>c.tickAtUnits(30,ratio(30000,1001)),err('TIME_NOT_REPRESENTABLE'));assert.equal(c.tickAtUnits(30,ratio(30000,1001),'nearest'),1922);assert.equal(c.unitsAt(1922,ratio(30000,1001),'floor'),'30');
});
test('Exact tempo:80subframe drop-frame label integration retains exact actual rate',()=>{
 const tc=compileTimecode({nominalFps:30,rate:ratio(30000,1001),dropFrame:true}),c=compileExactTempoMap([{tick:0,bpm:120}]);const sf=tc.parse('00:01:00;02'),seconds=tc.secondsAt(sf);assert.equal(sf,'144000');assert.deepEqual(seconds,ratio(3003,50));assert.deepEqual(c.tickFractionAtSeconds(seconds),ratio(576576,5));assert.equal(c.tickAtSeconds(seconds,'nearest'),115315);assert.equal(tc.format(tc.subframesAt(seconds)),'00:01:00;02.00');
});
test('Exact tempo: very large safe ticks and PPQs avoid intermediate float multiplication',()=>{
 const max=Number.MAX_SAFE_INTEGER,c=compileExactTempoMap([{tick:0,bpm:120}]);assert.deepEqual(c.secondsAt(max),ratio(BigInt(max),1920));assert.equal(c.tickAtSeconds(c.secondsAt(max)),max);assert.equal(c.unitsAt(max,rate(1920)),String(max));
 const high=compileExactTempoMap([{tick:0,bpm:300}],max);assert.deepEqual(high.secondsAt(max),ratio(1,5));assert.equal(high.tickAtSeconds(ratio(1,5)),max);assert.equal(c.tickAtElapsed(max,ratio(0)),max);
});
test('Exact tempo: out-of-domain targets reject before source rounding could clamp them',()=>{
 const c=compileExactTempoMap([{tick:0,bpm:120}]);for(const policy of ['exact','floor','ceil','nearest']){assert.throws(()=>c.tickAtElapsed(0,ratio(-1,3840),policy),err('EXACT_TIME_OUT_OF_RANGE'));assert.throws(()=>c.tickAtElapsed(Number.MAX_SAFE_INTEGER,ratio(1,3840),policy),err('EXACT_TIME_OUT_OF_RANGE'));}
 assert.throws(()=>c.tickAtSeconds(ratio('999999999999999999999999999')),err('EXACT_TIME_OUT_OF_RANGE'));
});
test('Exact tempo: shuffled queries and deterministic multi-tempo oracle agree at all boundaries',()=>{
 let seed=123456789;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
 for(const ppq of [1,96,960,32767])for(let round=0;round<12;round++){
  let tick=0;const points=Array.from({length:20},(_,i)=>{if(i)tick+=1+random()%1000;return{tick,bpm:(160+random()%2241)/8};}),c=compileExactTempoMap(points,ppq);
  const probes=[0,...points.map(p=>p.tick),tick+999,1,...points.slice(1).map(p=>p.tick-1)];for(let i=probes.length-1;i>0;i--){const j=random()%(i+1);[probes[i],probes[j]]=[probes[j],probes[i]];}
  for(const t of probes){const expected=oracle(points,ppq,t);assert.deepEqual(c.secondsAt(t),expected);assert.equal(c.tickAtSeconds(expected),t);}
 }
});
test('Exact tempo: local signed elapsed roundtrips match independent absolute-time differences',()=>{
 const points=[{tick:0,bpm:21.25},{tick:100,bpm:61.5},{tick:1000,bpm:127.125},{tick:5000,bpm:299.5}],c=compileExactTempoMap(points);
 for(const start of [0,1,99,100,999,1000,4999,5000,10000])for(const end of [0,2,100,500,1001,5000,12000]){
  const a=oracle(points,960,start),b=oracle(points,960,end),expected=ratio(...add([BigInt(b.numerator),BigInt(b.denominator)],[-BigInt(a.numerator),BigInt(a.denominator)]));assert.deepEqual(c.secondsBetween(start,end),expected);assert.equal(c.tickAtElapsed(start,expected),end);
 }
});
test('Exact tempo: compiler snapshots and returned fraction objects cannot mutate cached time',()=>{
 const points=map(),c=compileExactTempoMap(points),before=c.secondsAt(10000);points[0].bpm=20;points[1].tick=1;points.push({tick:2,bpm:50});const value=c.secondsAt(10000);value.numerator='0';assert.deepEqual(c.secondsAt(10000),before);assert.equal(c.tickAtSeconds(before),10000);
});
test('Exact tempo:100000 tempo points are accepted and inverse caches retain late and early queries',()=>{
 const points=Array.from({length:100000},(_,i)=>({tick:i*960,bpm:i%2?60:120})),c=compileExactTempoMap(points),last=points.at(-1).tick;
 assert.deepEqual(c.secondsAt(last),ratio(74999));assert.equal(c.tickAtSeconds(ratio(74999)),last);assert.equal(c.tickAtSeconds(ratio(1,2)),960);assert.deepEqual(c.secondsAt(1),ratio(1,1920));
});
test('Exact tempo: complexity failure is explicit and leaves earlier and local queries usable',()=>{
 const points=Array.from({length:1200},(_,i)=>({tick:i*960,bpm:20+i/10000000000})),c=compileExactTempoMap(points),before=JSON.stringify(points);
 assert.throws(()=>c.secondsAt(points.at(-1).tick),err('EXACT_TIME_COMPLEXITY_LIMIT'));assert.deepEqual(c.secondsAt(0),ratio(0));assert.deepEqual(c.secondsAt(1),ratio(1,320));assert.equal(c.tickAtSeconds(ratio(1,320)),1);
 const last=points.at(-1).tick,time=c.secondsBetween(last,last+1);assert.equal(c.tickAtElapsed(last,time),last+1);assert.equal(JSON.stringify(points),before);
});
test('Exact tempo: invalid tempo maps PPQ ratio schemas and rounding policies fail explicitly',()=>{
 for(const points of [[],[{tick:1,bpm:120}],[{tick:0,bpm:19}],[{tick:0,bpm:301}],[{tick:0,bpm:NaN}],[{tick:0,bpm:120},{tick:0,bpm:100}],new Array(100001).fill({tick:0,bpm:120})])assert.throws(()=>compileExactTempoMap(points));
 for(const ppq of [0,1.5,Infinity,MAX_VALUE()])assert.throws(()=>compileExactTempoMap(map(),ppq));const c=compileExactTempoMap(map());
 for(const value of [null,{},ratio(1,0),ratio(-1),ratio('1.5'),ratio('1e2'),{numerator:1,denominator:1,typo:1},ratio('1'.repeat(4097))])assert.throws(()=>c.tickAtSeconds(value));
 for(const tick of [-1,1.5,Infinity,'1'])assert.throws(()=>c.secondsAt(tick));assert.throws(()=>c.tickAtSeconds(ratio(0),'truncate'),err('INVALID_TIME_ROUNDING'));assert.throws(()=>c.unitsAt(0,rate(0)));assert.throws(()=>c.tickAtUnits(-1,rate(1)));
 function MAX_VALUE(){return Number.MAX_SAFE_INTEGER+1;}
});
test('Exact time grid: default refuses inexact MIDI target and explicit rounding returns exact error',()=>{
 const c=compileExactTempoMap([{tick:0,bpm:120}]),options={step:1,unitRate:rate(1000)};assert.throws(()=>c.snapTick(1,options),err('TIME_NOT_REPRESENTABLE'));
 const r=c.snapTick(1,{...options,sourceRounding:'nearest'});assert.equal(r.tick,2);assert.equal(r.gridIndex,'1');assert.equal(r.unit,'1');assert.deepEqual(r.targetTick,ratio(48,25));assert.deepEqual(r.targetElapsedSeconds,ratio(1,1000));assert.deepEqual(r.actualElapsedSeconds,ratio(1,960));assert.deepEqual(r.errorSeconds,ratio(1,24000));assert.equal(r.exact,false);
});
test('Exact time grid: project and clip origins select different anchored grid points',()=>{
 const c=compileExactTempoMap(map()),base={step:1000,unitRate:rate(1000)};
 const global=c.snapTick(4000,base),local=c.snapTick(4000,{...base,originTick:2880});assert.equal(global.tick,3840);assert.equal(local.tick,4320);assert.equal(local.unit,'1000');assert.deepEqual(local.targetElapsedSeconds,ratio(1));assert.equal(local.exact,true);assert.deepEqual(local.errorSeconds,ratio(0));
});
test('Exact time grid: floor ceil nearest and signed relative midpoints use independent source rounding',()=>{
 const c=compileExactTempoMap([{tick:0,bpm:120}]),base={step:1,unitRate:rate(1)};
 assert.equal(c.snapTick(960,base).tick,1920);assert.equal(c.snapTick(960,{...base,rounding:'floor'}).tick,0);assert.equal(c.snapTick(960,{...base,rounding:'ceil'}).tick,1920);
 const relative=c.snapTick(960,{...base,originTick:1920});assert.equal(relative.gridIndex,'0');assert.equal(relative.tick,1920);assert.equal(c.snapTick(960,{...base,originTick:1920,rounding:'floor'}).tick,0);
 assert.throws(()=>c.snapTick(960,{...base,rounding:'exact'}),err('TIME_NOT_REPRESENTABLE'));
});
test('Exact time grid:44100-sample and fractional-frame steps retain the requested grid identity',()=>{
 const c=compileExactTempoMap([{tick:0,bpm:120}]),r=c.snapTick(4,{step:100,unitRate:rate(44100),sourceRounding:'nearest'});assert.equal(r.unit,'100');assert.deepEqual(r.targetTick,ratio(640,147));assert.equal(r.tick,4);assert.deepEqual(r.errorSeconds,ratio(-13,70560));
 const quarter=c.snapTick(17,{step:20,unitRate:ratio(30000*80,1001),sourceRounding:'nearest'});assert.equal(quarter.unit,'20');assert.deepEqual(quarter.targetTick,ratio(2002,125));assert.equal(quarter.tick,16);
});
test('Exact time grid: invalid grids overflow negative destinations and input mutation never pass silently',()=>{
 const c=compileExactTempoMap(map());for(const options of [null,{},[],{step:0,unitRate:rate(1)},{step:-1,unitRate:rate(1)},{step:1,unitRate:rate(0)},{step:1,unitRate:rate(1),typo:true},{step:1,unitRate:rate(1),rounding:'truncate'},{step:1,unitRate:rate(1),sourceRounding:'truncate'}])assert.throws(()=>c.snapTick(1,options));
 assert.throws(()=>c.snapTick(0,{originTick:1,step:1000,unitRate:rate(1),rounding:'floor'}),err('EXACT_TIME_OUT_OF_RANGE'));
 const options={step:1,unitRate:rate(1000),sourceRounding:'nearest'},before=JSON.stringify(options);c.snapTick(1,options);assert.equal(JSON.stringify(options),before);
});

test('Exact tempo:100000 varied integer BPM points fit the exact cache budget and independent cycle sum',()=>{
 const points=Array.from({length:100000},(_,i)=>({tick:i*960,bpm:20+i%281})),c=compileExactTempoMap(points),last=points.at(-1).tick;
 const period=oracle(points.slice(0,282),960,281*960),remainder=oracle(points.slice(0,282),960,(99999%281)*960),cycles=BigInt(Math.floor(99999/281));const expected=ratio(...add([BigInt(period.numerator)*cycles,BigInt(period.denominator)],[BigInt(remainder.numerator),BigInt(remainder.denominator)]));assert.deepEqual(c.secondsAt(last),expected);assert.equal(c.tickAtSeconds(expected),last);assert.equal(c.tickAtElapsed(last,c.secondsBetween(last,last-1000)),last-1000);
});
