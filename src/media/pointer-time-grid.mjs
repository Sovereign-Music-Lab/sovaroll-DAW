import {finite,integer,requireValue} from './common.mjs';
import {compileExactTempoMap,EXACT_TEMPO_LIMITS} from './exact-tempo.mjs';
import {compileTimeEditResolver} from './time-edit-resolver.mjs';
import {timeFields} from './elapsed-time.mjs';

const MAX=Number.MAX_SAFE_INTEGER,BMAX=BigInt(MAX),LIMIT=EXACT_TEMPO_LIMITS.fractionDigits;
const abs=n=>n<0n?-n:n;
function gcd(a,b){a=abs(a);while(b)[a,b]=[b,a%b];return a;}
function fraction(n,d=1n){
  requireValue(d>0n,'INVALID_POINTER_TIME','A tick fraction needs a positive denominator.');
  const g=gcd(n,d),result={n:n/g,d:d/g};
  requireValue(abs(result.n).toString().length<=LIMIT&&result.d.toString().length<=LIMIT,'EXACT_TIME_COMPLEXITY_LIMIT','Pointer time fraction exceeds the exact arithmetic limit.');return result;
}
const add=(a,b)=>{const g=gcd(a.d,b.d);return fraction(a.n*(b.d/g)+b.n*(a.d/g),(a.d/g)*b.d);};
const subtract=(a,b)=>add(a,{n:-b.n,d:b.d});
const multiply=(a,b)=>{const g=gcd(a.n,b.d),h=gcd(b.n,a.d);return fraction((a.n/g)*(b.n/h),(a.d/h)*(b.d/g));};
const divide=(a,b)=>{requireValue(b.n>0n,'INVALID_POINTER_TIME','Grid divisor must be positive.');return multiply(a,{n:b.d,d:b.n});};
const json=r=>({numerator:r.n.toString(),denominator:r.d.toString()});
function whole(value,signed=false){
  requireValue(typeof value==='number'&&Number.isSafeInteger(value)&&(signed||value>=0)||typeof value==='string'&&value.length>=1&&value.replace(/^-/,'').length<=LIMIT&&(signed?/^-?[0-9]+$/:/^[0-9]+$/).test(value),'INVALID_POINTER_TIME','Expected a bounded nonnegative integer or integer string.');return BigInt(value);
}
function ratio(value,signed=false){
  requireValue(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===2&&Object.keys(value).every(k=>['numerator','denominator'].includes(k)),'INVALID_POINTER_TIME','Expected a numerator/denominator tick fraction.');return fraction(whole(value.numerator,signed),whole(value.denominator));
}
// Input is the canonical decimal of the actual JS Number, including scientific
// notation. This does not recover information already lost by pixel projection.
function pointer(value){
  if(typeof value!=='number')return{value:ratio(value),precision:'exact-rational-local-tick'};
  finite(value,0,MAX,'Local pointer tick');const canonical=String(value),match=/^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(canonical);
  requireValue(match,'INVALID_POINTER_TIME','Invalid canonical decimal pointer value.');
  const tail=match[2]??'',power=Number(match[3]??0)-tail.length,n=BigInt(match[1]+tail);
  return{value:power>=0?fraction(n*10n**BigInt(power)):fraction(n,10n**BigInt(-power)),canonical,precision:'canonical-decimal-local-tick'};
}
function round(r,policy){
  requireValue(['exact','floor','ceil','nearest'].includes(policy),'INVALID_TIME_ROUNDING','Use exact, floor, ceil or nearest grid rounding.');
  const remainder=r.n%r.d;let q=r.n/r.d;
  requireValue(policy!=='exact'||remainder===0n,'TIME_NOT_REPRESENTABLE','Pointer is not exactly on the selected time grid.');
  if(policy==='floor'&&remainder<0n)q--;
  if(policy==='ceil'&&remainder>0n)q++;
  if(policy==='nearest'){if(remainder<0n)q--;if(2n*(r.n-q*r.d)>=r.d)q++;}
  return q;
}

/** Exact boundary between a fractional local pointer tick and an elapsed grid.
 * This compiler never reads pixels, stores preferences, edits projects or clamps
 * an out-of-range result. Callers still own projection, gesture guards and commits.
 * Use atIndex() for adjacent grid points; do not resnap rounded source ticks.
 */
export function compilePointerTimeGrid(project,options){
  requireValue(project&&typeof project==='object'&&!Array.isArray(project)&&Array.isArray(project.tempoMap)&&project.tempoMap.length>0&&project.tempoMap.length<=EXACT_TEMPO_LIMITS.points,'INVALID_TEMPO_MAP','Expected a project with1–100000 tempo points.');
  integer(project.ppq,1,MAX,'Project PPQ');
  timeFields(options,['scope','originTick','inputOriginTick','gridType','sourceRounding','secondBasis']);
  const {scope='piano',originTick=0,inputOriginTick=originTick,gridType,sourceRounding='exact',secondBasis}=options;
  integer(originTick,0,MAX,'Pointer grid origin');integer(inputOriginTick,0,MAX,'Pointer input origin');
  requireValue(['exact','floor','ceil','nearest'].includes(sourceRounding),'INVALID_TIME_ROUNDING','Choose explicit source rounding.');
  const points=project.tempoMap.map(p=>({...p})),snapshot={...project,tempoMap:points,timeDisplay:project.timeDisplay===undefined?undefined:structuredClone(project.timeDisplay)};
  const time=compileExactTempoMap(points,project.ppq),ppq=project.ppq;
  // Reuse the format catalog and explicit frame-second contract. Probe at zero
  // requires no tempo prefix and cannot round an inexact source position.
  const policy=compileTimeEditResolver(snapshot).snap(0,gridType,{scope,sourceRounding,secondBasis});
  const rate=ratio(policy.unitRate),step=whole(policy.step),origin=fraction(BigInt(inputOriginTick));
  const metadata={scope,originTick,inputOriginTick,gridType,sourceRounding,format:policy.format,basis:policy.basis,step:policy.step,unitRate:policy.unitRate,precision:time.precision};
  function secondsForPointer(value){
    const absolute=add(origin,value);
    requireValue(absolute.n<=BMAX*absolute.d,'EXACT_TIME_OUT_OF_RANGE','Local pointer plus origin exceeds safe source ticks.');
    const floor=absolute.n/absolute.d,tail=fraction(absolute.n%absolute.d,absolute.d),floorTick=Number(floor);
    let lo=0,hi=points.length;while(lo+1<hi){const m=Math.floor((lo+hi)/2);if(points[m].tick<=floorTick)lo=m;else hi=m;}
    const [wholeBpm,decimal='']=String(points[lo].bpm).split('.'),bpm=fraction(BigInt(wholeBpm+decimal),10n**BigInt(decimal.length));
    const secondsPerTick=divide(fraction(60n),multiply(bpm,fraction(BigInt(ppq))));
    return{absolute,seconds:add(ratio(time.secondsBetween(originTick,floorTick),true),multiply(tail,secondsPerTick))};
  }
  function atIndex(index){
    const i=whole(index,true),unit=i*step,targetSeconds=divide(fraction(unit),rate),targetTick=time.tickFractionAtElapsed(originTick,json(targetSeconds)),tick=time.tickAtElapsed(originTick,json(targetSeconds),sourceRounding),actual=ratio(time.secondsBetween(originTick,tick),true);
    return{...structuredClone(metadata),gridIndex:i.toString(),unit:unit.toString(),tick,localTick:tick-inputOriginTick,gridLocalTick:tick-originTick,targetTick,targetElapsedSeconds:json(targetSeconds),actualElapsedSeconds:json(actual),errorSeconds:json(subtract(actual,targetSeconds)),exact:targetTick.denominator==='1'};
  }
  function snap(localTick,settings={}){
    timeFields(settings,['rounding']);const rounding=settings.rounding??'nearest',input=pointer(localTick),elapsed=secondsForPointer(input.value),index=round(divide(multiply(elapsed.seconds,rate),fraction(step)),rounding);
    return{...atIndex(index.toString()),gridRounding:rounding,inputTick:json(input.value),inputAbsoluteTick:json(elapsed.absolute),inputElapsedSeconds:json(elapsed.seconds),inputPrecision:input.precision,...(input.canonical===undefined?{}:{inputCanonicalDecimal:input.canonical})};
  }
  return Object.freeze({ ...Object.freeze({...metadata,unitRate:Object.freeze({...metadata.unitRate})}),snap,atIndex,
    cell(localTick,settings={}){
      timeFields(settings,['rounding']);const start=snap(localTick,{rounding:'floor',...settings}),end=atIndex((BigInt(start.gridIndex)+1n).toString());
      return{start,end,durationTicks:end.tick-start.tick,collapsed:end.tick===start.tick};
    }
  });
}
