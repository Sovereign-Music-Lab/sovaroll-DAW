import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject} from '../src/core/engine.mjs';
import {compilePointerTimeGrid} from '../src/media/pointer-time-grid.mjs';
const r=(n,d=1)=>({numerator:String(n),denominator:String(d)}),code=c=>e=>e.code===c;
const project=(extra={})=>({...createProject(),timeDisplay:{primaryFormat:'seconds'},...extra});
const grid=(p=project(),options={})=>compilePointerTimeGrid(p,{gridType:'1-ms',sourceRounding:'nearest',...options});

test('Pointer time grid: fractional midpoint is selected before any source-tick rounding',()=>{
 const g=grid();assert.equal(g.snap(.95).gridIndex,'0');assert.equal(g.snap(.96).gridIndex,'1');assert.equal(g.snap(.97).localTick,2);assert.equal(g.snap(Math.round(.95)).gridIndex,'1');
 const v=g.snap(.95);assert.deepEqual(v.inputTick,r(19,20));assert.deepEqual(v.inputElapsedSeconds,r(19,38400));assert.equal(v.inputCanonicalDecimal,'0.95');assert.equal(v.inputPrecision,'canonical-decimal-local-tick');
});
test('Pointer time grid: huge clip origin is added as a fraction without losing local decimals',()=>{
 const origin=Number.MAX_SAFE_INTEGER-10,g=grid(project(),{originTick:origin}),v=g.snap(.95);assert.equal((origin+.95)-origin,1);assert.equal(v.gridIndex,'0');assert.equal(v.tick,origin);assert.equal(v.localTick,0);assert.deepEqual(v.inputAbsoluteTick,r(BigInt(origin)*20n+19n,20));
 assert.equal(g.snap(.97).tick,origin+2);assert.throws(()=>g.snap(10.01),code('EXACT_TIME_OUT_OF_RANGE'));assert.equal(g.snap(10,{rounding:'floor'}).localTick,10);
});
test('Pointer time grid: subnormal scientific notation negative zero and rational input have explicit precision',()=>{
 const g=grid(),tiny=g.snap(5e-324);assert.equal(tiny.inputCanonicalDecimal,'5e-324');assert.deepEqual(tiny.inputTick,r(1,2n*10n**323n));assert.equal(tiny.gridIndex,'0');assert.equal(g.snap(-0).inputCanonicalDecimal,'0');
 const v=g.snap(r(24,25));assert.equal(v.inputPrecision,'exact-rational-local-tick');assert.ok(!Object.hasOwn(v,'inputCanonicalDecimal'));assert.equal(v.gridIndex,'1');
});
test('Pointer time grid: fractional tempo-boundary tails use the correct new segment and local origin',()=>{
 const p=project({tempoMap:[{tick:0,bpm:120},{tick:3840,bpm:60}]}),g=grid(p,{originTick:3839}),v=g.snap(1.25);
 assert.deepEqual(v.inputAbsoluteTick,r(15361,4));assert.deepEqual(v.inputElapsedSeconds,r(1,1280));assert.deepEqual(v.targetTick,r(192023,50));assert.equal(v.localTick,1);assert.deepEqual(g.snap(1).inputElapsedSeconds,r(1,1920));assert.deepEqual(g.snap(.5).inputElapsedSeconds,r(1,3840));
});
test('Pointer time grid: grid rounding and source rounding remain independent with exact error evidence',()=>{
 const p=project(),g=grid(p);assert.equal(g.snap(.95,{rounding:'floor'}).gridIndex,'0');assert.equal(g.snap(.95,{rounding:'ceil'}).gridIndex,'1');assert.throws(()=>g.snap(.95,{rounding:'exact'}),code('TIME_NOT_REPRESENTABLE'));assert.equal(g.snap(r(48,25),{rounding:'exact'}).gridIndex,'1');
 assert.throws(()=>grid(p,{sourceRounding:'exact'}).snap(1),code('TIME_NOT_REPRESENTABLE'));
 for(const [sourceRounding,tick]of [['floor',1],['ceil',2],['nearest',2]])assert.equal(grid(p,{sourceRounding}).snap(1).localTick,tick);
 const v=g.snap(1);assert.deepEqual(v.targetTick,r(48,25));assert.deepEqual(v.targetElapsedSeconds,r(1,1000));assert.deepEqual(v.actualElapsedSeconds,r(1,960));assert.deepEqual(v.errorSeconds,r(1,24000));assert.equal(v.exact,false);
});
test('Pointer time grid: adjacent cells advance grid index instead of resnapping rounded stored tick',()=>{
 const g=grid(project(),{sourceRounding:'floor'}),cell=g.cell(2,{rounding:'floor'});assert.equal(cell.start.gridIndex,'1');assert.equal(cell.start.localTick,1);assert.equal(cell.end.gridIndex,'2');assert.equal(cell.end.localTick,3);assert.equal(cell.durationTicks,2);assert.equal(g.snap(cell.start.localTick,{rounding:'floor'}).gridIndex,'0');assert.equal(cell.collapsed,false);
 assert.equal(g.cell(1.5).start.gridIndex,'0');assert.throws(()=>g.cell(0,null));
 const tiny=grid(project({timeDisplay:{primaryFormat:'samples'}}),{gridType:'1-sample'}).cell(0);assert.equal(tiny.durationTicks,0);assert.equal(tiny.collapsed,true);assert.equal(tiny.end.unit,'1');assert.notDeepEqual(tiny.start.targetTick,tiny.end.targetTick);
});
test('Pointer time grid: all supported millisecond and fixed sample presets retain format scopes',()=>{
 const p=project({sampleRate:96000,timeDisplay:{primaryFormat:'seconds',pianoFormat:'samples',timelineFormat:'seconds'}});
 for(const [scope,types,rate]of [['primary',['1-ms','10-ms','100-ms','1000-ms'],1000],['piano',['1-sample','10-samples','100-samples','44100-samples'],96000]])for(const gridType of types){const g=grid(p,{scope,gridType}),v=g.atIndex('2');assert.equal(v.unit,String(Number(gridType.split('-')[0])*2));assert.equal(v.unitRate.numerator,rate);}
 const sample=grid(p,{gridType:'44100-samples'}).atIndex(1);assert.deepEqual(sample.targetElapsedSeconds,r(147,320));
});
test('Pointer time grid: rational frame midpoint and80subframes do not use nominal elapsed speed',()=>{
 const p=project({timeDisplay:{primaryFormat:'timecode',frameRate:{nominalFps:30,numerator:30000,denominator:1001,dropFrame:true}}}),g=grid(p,{gridType:'frame'});
 assert.equal(g.snap(32.0321).gridIndex,'1');assert.equal(g.snap(Math.round(32.0321)).gridIndex,'0');assert.deepEqual(g.snap(32.0321).targetTick,r(8008,125));
 for(const [gridType,step]of [['subframe',1],['quarter-frame',20],['half-frame',40],['frame',80],['two-frames',160]])assert.equal(grid(p,{gridType}).atIndex(1).unit,String(step));
 assert.throws(()=>grid(p,{gridType:'1-second'}),code('TIME_GRID_BASIS_REQUIRED'));const a=grid(p,{gridType:'1-second',secondBasis:'elapsed'}),b=grid(p,{gridType:'1-second',secondBasis:'nominal-frames'});assert.equal(a.snap(960.5).gridIndex,'1');assert.equal(b.snap(960.5).gridIndex,'0');assert.deepEqual(b.atIndex(1).targetElapsedSeconds,r(1001,1000));
});
test('Pointer time grid: user fps and snapshot survive external project edits without aliasing results',()=>{
 const p=project({timeDisplay:{primaryFormat:'user-fps',userFps:25}}),before=JSON.stringify(p),options={gridType:'frame'},g=grid(p,options),v=g.atIndex(1);assert.deepEqual(v.targetTick,r(384,5));assert.equal(JSON.stringify(p),before);assert.deepEqual(options,{gridType:'frame'});
 v.unitRate.numerator=1;p.timeDisplay.userFps=100;p.tempoMap[0].bpm=20;assert.deepEqual(g.atIndex(1).targetTick,r(384,5));assert.equal(g.unitRate.numerator,2000);assert.ok(Object.isFrozen(g));assert.ok(Object.isFrozen(g.unitRate));
});
test('Pointer time grid: unsafe negative malformed and out-of-range targets reject without clamping',()=>{
 const g=grid();for(const value of [-1,NaN,Infinity,'1.5',null,[],{},r(1,0),r(-1),r('1'.repeat(4097)),r(1,'1'.repeat(4097)),{numerator:1,denominator:2,typo:1}])assert.throws(()=>g.snap(value));
 for(const settings of [null,[],{typo:1},{rounding:'truncate'}])assert.throws(()=>g.snap(0,settings));for(const value of [-1,'-1',1.5,{},'1e3'])assert.throws(()=>g.atIndex(value));
 const end=grid(project(),{originTick:Number.MAX_SAFE_INTEGER});assert.equal(end.snap(0).tick,Number.MAX_SAFE_INTEGER);assert.throws(()=>end.cell(0),code('EXACT_TIME_OUT_OF_RANGE'));assert.throws(()=>end.snap(.001),code('EXACT_TIME_OUT_OF_RANGE'));
 for(const options of [{scope:'all'},{originTick:-1},{gridType:'bogus'},{sourceRounding:'truncate'},{secondBasis:'elapsed'},{typo:1}])assert.throws(()=>grid(project(),options));assert.throws(()=>grid(project({timeDisplay:{primaryFormat:'bars-beats'}})));for(const p of [null,{},project({ppq:0}),project({tempoMap:[]})])assert.throws(()=>grid(p));
});

// Independent arithmetic oracle: simple cross-products and whole-project sums.
// Production instead integrates integer local spans plus one fractional tail.
function reduce(a,b=1n){a=BigInt(a);b=BigInt(b);let x=a<0n?-a:a,y=b;while(y)[x,y]=[y,x%y];return[a/x,b/x];}
const plus=(a,b)=>reduce(a[0]*b[1]+b[0]*a[1],a[1]*b[1]),minus=(a,b)=>plus(a,[-b[0],b[1]]),times=(a,b)=>reduce(a[0]*b[0],a[1]*b[1]),over=(a,b)=>reduce(a[0]*b[1],a[1]*b[0]),compare=(a,b)=>a[0]*b[1]-b[0]*a[1];
function oracleAt(points,ppq,tick){let total=reduce(0);for(let i=0;i<points.length;i++){const start=reduce(points[i].tick);if(compare(tick,start)<=0)break;const boundary=points[i+1]?reduce(points[i+1].tick):tick,end=compare(tick,boundary)<0?tick:boundary;total=plus(total,times(minus(end,start),reduce(6000,BigInt(ppq)*BigInt(Math.round(points[i].bpm*100)))));}return total;}
function oracleInverse(points,ppq,seconds){let left=seconds;for(let i=0;i<points.length;i++){const rate=reduce(6000,BigInt(ppq)*BigInt(Math.round(points[i].bpm*100))),span=points[i+1]?times(reduce(points[i+1].tick-points[i].tick),rate):null;if(!span||compare(left,span)<=0)return plus(reduce(points[i].tick),over(left,rate));left=minus(left,span);}}

test('Pointer time grid: independent fraction oracle covers origins fractional boundaries BPMs and PPQ',()=>{
 for(let seed=0;seed<32;seed++){
  const ppq=[1,96,960,32767][seed%4],points=Array.from({length:24},(_,i)=>({tick:i*127,bpm:[60,72.3,120,137.25,180][(i*7+seed)%5]})),originTick=(seed%12)*127+11,p=project({ppq,tempoMap:points}),g=grid(p,{originTick,gridType:'10-ms'});
  for(const local of [reduce(19,20),reduce(116),reduce(11601,100),reduce(1270001,1000),reduce(280099,100)]){
   const expectedElapsed=minus(oracleAt(points,ppq,plus(reduce(originTick),local)),oracleAt(points,ppq,reduce(originTick))),v=g.snap(r(...local)),indexFraction=times(expectedElapsed,reduce(100)),q=indexFraction[0]/indexFraction[1],index=q+(2n*(indexFraction[0]%indexFraction[1])>=indexFraction[1]?1n:0n),targetTime=plus(oracleAt(points,ppq,reduce(originTick)),reduce(index,100)),target=oracleInverse(points,ppq,targetTime),tick=target[0]/target[1]+(2n*(target[0]%target[1])>=target[1]?1n:0n);
   assert.deepEqual(v.inputElapsedSeconds,r(...expectedElapsed));assert.equal(v.gridIndex,index.toString());assert.deepEqual(v.targetTick,r(...target));assert.equal(v.tick,Number(tick));
  }
 }
});
test('Pointer time grid:100000-point map retains fractional tail and bounded local lookup',()=>{
 const points=Array.from({length:100000},(_,i)=>({tick:i*960,bpm:i%2?60:120})),originTick=points.at(-1).tick,g=grid(project({tempoMap:points}),{originTick});assert.deepEqual(g.snap(.95).inputElapsedSeconds,r(19,19200));assert.equal(g.snap(.95).gridIndex,'1');assert.equal(g.snap(.95).localTick,1);assert.equal(g.atIndex(1000).localTick,960);
});
test('Pointer time grid: complexity limit is explicit while later independent local origins remain usable',()=>{
 const points=Array.from({length:1200},(_,i)=>({tick:i*960,bpm:20+i/10000000000})),p=project({tempoMap:points}),g=grid(p);assert.throws(()=>g.snap(points.at(-1).tick+.5),code('EXACT_TIME_COMPLEXITY_LIMIT'));assert.equal(g.snap(0).localTick,0);const local=grid(p,{originTick:points.at(-1).tick});assert.ok(local.snap(.5).localTick>=0);
});
test('Pointer time grid: project grid and clip-local input have independent exact origins',()=>{
 const g=grid(project(),{originTick:0,inputOriginTick:2881,gridType:'1000-ms'}),v=g.snap(.95);assert.deepEqual(v.inputAbsoluteTick,r(57639,20));assert.equal(v.tick,3840);assert.equal(v.localTick,959);assert.equal(v.gridIndex,'2');assert.equal(v.originTick,0);assert.equal(v.inputOriginTick,2881);
 const start=g.cell(0);assert.equal(start.start.localTick,-961);assert.equal(start.end.localTick,959);assert.equal(start.durationTicks,1920); // Caller must handle clip bounds; never silently clamp.
});
test('Pointer time grid: signed grid indices before an independent anchor round ties later',()=>{
 const g=grid(project(),{originTick:3840,inputOriginTick:0,gridType:'1000-ms'});assert.equal(g.snap(2880).gridIndex,'0');assert.equal(g.snap(2879.95).gridIndex,'-1');assert.equal(g.snap(2880,{rounding:'floor'}).gridIndex,'-1');assert.equal(g.snap(2880,{rounding:'ceil'}).gridIndex,'0');assert.equal(g.atIndex(-2).tick,0);assert.throws(()=>g.atIndex(-3),code('EXACT_TIME_OUT_OF_RANGE'));assert.deepEqual(g.atIndex(-1).targetElapsedSeconds,r(-1));assert.equal(g.atIndex(-1).localTick,1920);
});
test('Pointer time grid: independent anchor integration crosses tempo changes without losing fractional tails',()=>{
 const p=project({tempoMap:[{tick:0,bpm:120},{tick:3840,bpm:60}]}),g=grid(p,{originTick:4800,inputOriginTick:3839}),v=g.snap(1.25);assert.deepEqual(v.inputElapsedSeconds,r(-3839,3840));assert.equal(v.gridIndex,'-1000');assert.equal(v.tick,3840);assert.equal(v.localTick,1);assert.equal(v.gridLocalTick,-960);assert.throws(()=>grid(p,{inputOriginTick:-1}));
});
