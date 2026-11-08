import { finite, integer, requireValue } from './common.mjs';

export const EXACT_TEMPO_LIMITS = Object.freeze({ points:100000, fractionDigits:4096, cachedDigits:64000000 });
const MAX=Number.MAX_SAFE_INTEGER, MAX_BIG=BigInt(MAX), ZERO={n:0n,d:1n};
const abs=n=>n<0n?-n:n;
function gcd(a,b){a=abs(a);while(b){[a,b]=[b,a%b];}return a;}
function bounded(n,d){
  requireValue(abs(n).toString().length<=EXACT_TEMPO_LIMITS.fractionDigits&&d.toString().length<=EXACT_TEMPO_LIMITS.fractionDigits,
    'EXACT_TIME_COMPLEXITY_LIMIT','Exact time fraction exceeds the bounded precision budget; no approximate edit was performed.');
  return {n,d};
}
function fraction(n,d=1n){
  requireValue(d!==0n,'INVALID_EXACT_TIME','Time denominator must be nonzero.');if(d<0n){n=-n;d=-d;}if(n===0n)return ZERO;
  const g=gcd(n,d);return bounded(n/g,d/g);
}
function add(a,b){
  const g=gcd(a.d,b.d),n=a.n*(b.d/g)+b.n*(a.d/g),h=gcd(n,g);
  return bounded(n/h,(a.d/g)*(b.d/h));
}
const neg=a=>({n:-a.n,d:a.d}),sub=(a,b)=>add(a,neg(b));
function mul(a,b){const g=gcd(a.n,b.d),h=gcd(b.n,a.d);return bounded((a.n/g)*(b.n/h),(a.d/h)*(b.d/g));}
function div(a,b){requireValue(b.n!==0n,'INVALID_EXACT_TIME','Time divisor must be nonzero.');return mul(a,fraction(b.d,b.n));}
const compare=(a,b)=>{const delta=a.n*b.d-b.n*a.d;return delta<0n?-1:delta>0n?1:0;};
function inputInteger(value,signed=false){
  requireValue(typeof value==='number'&&Number.isSafeInteger(value)&&(signed||value>=0)||typeof value==='string'&&value.length>=1&&value.replace(/^-/,'').length<=EXACT_TEMPO_LIMITS.fractionDigits&&(signed?/^-?[0-9]+$/:/^[0-9]+$/).test(value),
    'INVALID_EXACT_TIME','Expected a bounded integer number or decimal string.');
  const result=BigInt(value);requireValue(abs(result).toString().length<=EXACT_TEMPO_LIMITS.fractionDigits,'EXACT_TIME_COMPLEXITY_LIMIT','Integer exceeds exact time budget.');return result;
}
function inputRatio(value,{signed=false,positive=false}={}){
  requireValue(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===2&&Object.keys(value).every(k=>['numerator','denominator'].includes(k)),
    'INVALID_EXACT_TIME','Expected numerator and denominator.');
  const n=inputInteger(value.numerator,signed),d=inputInteger(value.denominator);
  requireValue(d>0n&&(!positive||n>0n),'INVALID_EXACT_TIME','Denominator and unit rate must be positive.');return fraction(n,d);
}
const json=a=>({numerator:a.n.toString(),denominator:a.d.toString()});
function round(a,policy){
  requireValue(['exact','floor','ceil','nearest'].includes(policy),'INVALID_TIME_ROUNDING','Use exact, floor, ceil or nearest.');
  const remainder=a.n%a.d;requireValue(policy!=='exact'||remainder===0n,'TIME_NOT_REPRESENTABLE','Time does not lie on the requested integer grid; choose explicit rounding.');
  let q=a.n/a.d;
  if(policy==='floor'&&remainder<0n)q--;
  if(policy==='ceil'&&remainder>0n)q++;
  if(policy==='nearest'){if(remainder<0n)q--;if(2n*(a.n-q*a.d)>=a.d)q++;}
  return q;
}
function sourceFraction(value){
  requireValue(value.n>=0n&&value.n<=MAX_BIG*value.d,'EXACT_TIME_OUT_OF_RANGE','Target time is outside the nonnegative safe source-tick range.');return value;
}
const sourceInteger=(value,rounding)=>Number(round(sourceFraction(value),rounding));
function decimalBpm(value){
  finite(value,20,300,'Tempo BPM');
  // JSON numbers retain their canonical Number.toString() decimal, not original input lexemes.
  const [whole,tail='']=String(value).split('.');return fraction(BigInt(whole+tail),10n**BigInt(tail.length));
}

/** Exact editing-domain step-tempo snapshot, using canonical JSON decimal BPM.
 * Separate from float64 playback/display time.mjs; never silently falls back to it.
 * Prefixes are lazy, bounded and reused. Local elapsed conversion avoids unrelated
 * earlier tempo complexity. All returned fractions are reduced JSON-safe strings.
 */
export function compileExactTempoMap(tempoMap,ppq=960){
  integer(ppq,1,MAX,'PPQ');requireValue(Array.isArray(tempoMap)&&tempoMap.length>0&&tempoMap.length<=EXACT_TEMPO_LIMITS.points,'INVALID_TEMPO_MAP','Expected1–100000 step tempo points.');
  const points=tempoMap.map((p,i)=>{
    requireValue(p&&typeof p==='object'&&!Array.isArray(p),'INVALID_TEMPO_MAP','Invalid tempo point.');integer(p.tick,0,MAX,'Tempo tick');
    requireValue(i?p.tick>tempoMap[i-1].tick:p.tick===0,'INVALID_TEMPO_MAP','Tempo ticks must start at0 and strictly increase.');
    return {tick:p.tick,rate:div(fraction(60n),mul(decimalBpm(p.bpm),fraction(BigInt(ppq))))};
  });
  const prefixes=[ZERO];let cachedDigits=2;
  function prefix(index){
    while(prefixes.length<=index){const i=prefixes.length,value=add(prefixes[i-1],mul(fraction(BigInt(points[i].tick-points[i-1].tick)),points[i-1].rate));
      const digits=value.n.toString().length+value.d.toString().length;
      requireValue(cachedDigits+digits<=EXACT_TEMPO_LIMITS.cachedDigits,'EXACT_TIME_COMPLEXITY_LIMIT','Exact tempo prefix cache exceeds its budget; no approximate edit was performed.');
      prefixes.push(value);cachedDigits+=digits;
    }return prefixes[index];
  }
  function segment(tick){let lo=0,hi=points.length;while(lo+1<hi){const m=Math.floor((lo+hi)/2);if(points[m].tick<=tick)lo=m;else hi=m;}return lo;}
  const tickInput=tick=>integer(tick,0,MAX,'Source tick');
  function at(tick){tickInput(tick);const i=segment(tick);return add(prefix(i),mul(fraction(BigInt(tick-points[i].tick)),points[i].rate));}
  function between(start,end){
    tickInput(start);tickInput(end);if(start===end)return ZERO;if(end<start)return neg(between(end,start));
    let i=segment(start),cursor=start,total=ZERO;
    while(cursor<end){const next=Math.min(end,points[i+1]?.tick??end);total=add(total,mul(fraction(BigInt(next-cursor)),points[i].rate));cursor=next;i++;}return total;
  }
  function inverse(seconds){
    requireValue(seconds.n>=0n,'EXACT_TIME_OUT_OF_RANGE','Absolute time must be nonnegative.');
    while(prefixes.length<points.length&&compare(prefixes.at(-1),seconds)<0){
      const i=prefixes.length-1,remaining=sub(seconds,prefixes[i]),span=mul(fraction(BigInt(points[i+1].tick-points[i].tick)),points[i].rate),order=compare(remaining,span);
      if(order<0)return sourceFraction(add(fraction(BigInt(points[i].tick)),div(remaining,points[i].rate)));
      if(order===0)return fraction(BigInt(points[i+1].tick));
      prefix(i+1);
    }
    let lo=0,hi=prefixes.length;while(lo+1<hi){const m=Math.floor((lo+hi)/2);if(compare(prefixes[m],seconds)<=0)lo=m;else hi=m;}
    return sourceFraction(add(fraction(BigInt(points[lo].tick)),div(sub(seconds,prefixes[lo]),points[lo].rate)));
  }
  function elapsed(origin,seconds){
    tickInput(origin);if(seconds.n===0n)return fraction(BigInt(origin));
    const forward=seconds.n>0n;let remaining=forward?seconds:neg(seconds),cursor=origin,i=segment(origin);
    if(!forward&&cursor===points[i].tick)i--;
    for(;;){
      requireValue(i>=0&&i<points.length,'EXACT_TIME_OUT_OF_RANGE','Elapsed target leaves the source-tick domain.');
      const boundary=forward?(points[i+1]?.tick??MAX):points[i].tick,span=mul(fraction(BigInt(Math.abs(boundary-cursor))),points[i].rate);
      if(compare(remaining,span)<=0){const delta=div(remaining,points[i].rate);return sourceFraction(add(fraction(BigInt(cursor)),forward?delta:neg(delta)));}
      remaining=sub(remaining,span);cursor=boundary;i+=forward?1:-1;
    }
  }
  const rate=value=>inputRatio(value,{positive:true});
  return Object.freeze({ppq,precision:'canonical-decimal-bpm-rational',
    secondsAt:tick=>json(at(tick)),
    secondsBetween:(start,end)=>json(between(start,end)),
    tickFractionAtSeconds:seconds=>json(inverse(inputRatio(seconds))),
    tickAtSeconds:(seconds,rounding='exact')=>sourceInteger(inverse(inputRatio(seconds)),rounding),
    tickFractionAtElapsed:(origin,seconds)=>json(elapsed(origin,inputRatio(seconds,{signed:true}))),
    tickAtElapsed:(origin,seconds,rounding='exact')=>sourceInteger(elapsed(origin,inputRatio(seconds,{signed:true})),rounding),
    unitsAt:(tick,unitRate,rounding='exact')=>round(mul(at(tick),rate(unitRate)),rounding).toString(),
    unitsBetween:(start,end,unitRate,rounding='exact')=>round(mul(between(start,end),rate(unitRate)),rounding).toString(),
    tickAtUnits:(count,unitRate,rounding='exact')=>sourceInteger(inverse(div(fraction(inputInteger(count)),rate(unitRate))),rounding),
    tickAtElapsedUnits:(origin,count,unitRate,rounding='exact')=>sourceInteger(elapsed(origin,div(fraction(inputInteger(count,true)),rate(unitRate))),rounding),
    snapTick(tick,options){
      requireValue(options&&typeof options==='object'&&!Array.isArray(options)&&Object.keys(options).every(k=>['unitRate','step','originTick','rounding','sourceRounding'].includes(k)),'INVALID_EXACT_TIME','Invalid time grid options.');
      const {originTick=0,rounding='nearest',sourceRounding='exact'}=options,r=rate(options.unitRate),step=inputInteger(options.step);
      requireValue(step>0n,'INVALID_EXACT_TIME','Grid step must be positive.');
      const index=round(div(mul(between(originTick,tick),r),fraction(step)),rounding),count=index*step,targetTime=div(fraction(count),r),targetTick=elapsed(originTick,targetTime),storedTick=sourceInteger(targetTick,sourceRounding),actual=between(originTick,storedTick);
      return {tick:storedTick,originTick,gridIndex:index.toString(),unit:count.toString(),targetTick:json(targetTick),targetElapsedSeconds:json(targetTime),actualElapsedSeconds:json(actual),errorSeconds:json(sub(actual,targetTime)),exact:targetTick.d===1n,sourceRounding};
    }
  });
}
