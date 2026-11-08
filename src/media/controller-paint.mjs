import {finite,integer,requireValue} from './common.mjs';
import {resolveTimeDisplay} from './time-display.mjs';
import {compileExactTempoMap} from './exact-tempo.mjs';

const MAX=Number.MAX_SAFE_INTEGER;
const abs=n=>n<0n?-n:n;
function gcd(a,b){a=abs(a);while(b)[a,b]=[b,a%b];return a;}
function fraction(n,d=1n){if(d<0n){n=-n;d=-d;}const g=gcd(n,d);return {n:n/g,d:d/g};}
const add=(a,b)=>fraction(a.n*b.d+b.n*a.d,a.d*b.d);
const sub=(a,b)=>fraction(a.n*b.d-b.n*a.d,a.d*b.d);
const mul=(a,b)=>fraction(a.n*b.n,a.d*b.d);
const div=(a,b)=>fraction(a.n*b.d,a.d*b.n);
const fromJSON=r=>fraction(BigInt(r.numerator),BigInt(r.denominator));
const floor=r=>{const q=r.n/r.d;return r.n<0n&&r.n%r.d?q-1n:q;};
const ceil=r=>-floor({n:-r.n,d:r.d});
const nearest=r=>Number(floor(add(r,{n:1n,d:2n})));
// Only validated finite nonnegative JS Numbers enter this adapter. Preserve
// their canonical decimal, including subnormal values, rather than binary noise.
function decimal(value){
  const m=/^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(String(value)),tail=m[2]??'',power=Number(m[3]??0)-tail.length,n=BigInt(m[1]+tail);
  return power>=0?fraction(n*10n**BigInt(power)):fraction(n,10n**BigInt(-power));
}

/** Stateful, bounded resampler for one continuous controller Paint gesture.
 * startTick and finish(endTick) are already-resolved source positions; callers
 * own position snap, source rounding and transaction/revision guards. push()
 * receives RAW local pointer ticks, never repeatedly snapped pointer samples.
 * Density is a source-tick lattice anchored at startTick. Values interpolate in
 * the editor's beat/time domain; exact source density never uses screen thinning.
 * Browser Draw uses this with the shared midi.controllers.paint transaction.
 */
export function compileControllerPaint(project,{clipId,startTick,startValue,stepTicks,maxValue=127,maxPoints=200000,maxWork=1000000,maxSegments=200000}={}){
  const clip=project.clips.find(c=>c.id===clipId);
  requireValue(clip?.type==='midi','INVALID_CONTROLLER_PAINT','An existing MIDI clip is required.');
  const length=integer(clip.lengthTicks,1,MAX,'Clip length');integer(clip.startTick,0,MAX-length,'Clip start');
  integer(startTick,0,length,'Paint start');integer(stepTicks,1,MAX,'Paint density');
  requireValue([127,16383].includes(maxValue),'INVALID_CONTROLLER_PAINT','Choose a 7-bit or pitchbend range.');
  finite(startValue,0,maxValue,'Paint start value');integer(maxPoints,1,200000,'Paint point budget');
  integer(maxWork,1,1000000,'Paint work budget');integer(maxSegments,1,200000,'Paint segment budget');
  const mode=resolveTimeDisplay(project.timeDisplay).pianoMode;
  const origin=clip.startTick,anchor=BigInt(startTick),step=BigInt(stepTicks);
  const before=project.tempoMap.filter(p=>p.tick<=origin).at(-1);
  const time=mode==='time-linear'?compileExactTempoMap([{tick:0,bpm:before.bpm},...project.tempoMap.filter(p=>p.tick>origin).map(p=>({tick:p.tick-origin,bpm:p.bpm}))],project.ppq):null;
  function coordinate(tick){
    if(!time)return decimal(tick);
    const whole=Math.floor(tick),base=fromJSON(time.secondsAt(whole));
    if(whole===tick)return base;
    return add(base,mul(sub(decimal(tick),fraction(BigInt(whole))),fromJSON(time.secondsBetween(whole,whole+1))));
  }
  function point(p){
    requireValue(p&&typeof p==='object'&&!Array.isArray(p),'INVALID_CONTROLLER_PAINT','Expected a pointer sample.');
    finite(p.tick,0,length,'Paint pointer tick');finite(p.value,0,maxValue,'Paint pointer value');
    return {tick:p.tick,value:decimal(p.value),coordinate:coordinate(p.tick)};
  }
  let previous=point({tick:startTick,value:startValue}),minTick=startTick,maxTick=startTick,work=0,segments=0,failed=false,closed=false;
  const points=new Map([[startTick,nearest(previous.value)]]);
  function open(){requireValue(!failed,'CONTROLLER_PAINT_ABORTED','Paint failed; discard this gesture before committing.');requireValue(!closed,'CONTROLLER_PAINT_CLOSED','Paint gesture has finished.');}
  function snapshot(){return {points:[...points].sort((a,b)=>a[0]-b[0]).map(([tick,value])=>({tick,value})),range:{startTick:Math.ceil(minTick),endTick:Math.floor(maxTick)},mode,stepTicks,work,segments,failed,closed};}
  return Object.freeze({mode,stepTicks,
    snapshot,
    push(sample){
      open();
      try{
        const next=point(sample);
        requireValue(segments<maxSegments,'CONTROLLER_PAINT_LIMIT','Paint has too many pointer segments.');
        const low=decimal(Math.min(previous.tick,next.tick)),high=decimal(Math.max(previous.tick,next.tick));
        const first=ceil(div(sub(low,fraction(anchor)),fraction(step))),last=floor(div(sub(high,fraction(anchor)),fraction(step)));
        const count=last>=first?last-first+1n:0n;
        requireValue(count<=BigInt(maxPoints)&&BigInt(work)+count<=BigInt(maxWork),'CONTROLLER_PAINT_LIMIT','Paint density exceeds its point/work budget.');
        const updates=[];let newCount=0;
        for(let index=first;index<=last;index++){
          const tick=Number(anchor+index*step);
          const value=previous.tick===next.tick?next.value:add(previous.value,mul(sub(next.value,previous.value),div(sub(coordinate(tick),previous.coordinate),sub(next.coordinate,previous.coordinate))));
          updates.push([tick,nearest(value)]);if(!points.has(tick))newCount++;
        }
        requireValue(points.size+newCount<=maxPoints,'CONTROLLER_PAINT_LIMIT','Paint has too many distinct source points.');
        // Apply only after the whole segment has passed validation. A failure
        // poisons finish(), so callers cannot commit an earlier valid preview.
        for(const [tick,value]of updates)points.set(tick,value);
        work+=Number(count);segments++;minTick=Math.min(minTick,next.tick);maxTick=Math.max(maxTick,next.tick);previous=next;
        return {pointCount:points.size,work,segments};
      }catch(error){failed=true;throw error;}
    },
    finish(endTick){
      open();
      try{
        integer(endTick,0,length,'Resolved Paint end');
        requireValue(points.has(endTick)||points.size<maxPoints,'CONTROLLER_PAINT_LIMIT','Paint endpoint exceeds the point budget.');
        // Like Line, retain an explicit final endpoint even when it is not on
        // the density lattice. Intermediate packet endpoints are never kept.
        points.set(endTick,nearest(previous.value));minTick=Math.min(minTick,endTick);maxTick=Math.max(maxTick,endTick);closed=true;
        return snapshot();
      }catch(error){failed=true;throw error;}
    }
  });
}
