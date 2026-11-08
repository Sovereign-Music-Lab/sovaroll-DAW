import {finite,integer,requireValue} from './common.mjs';
import {compileExactTempoMap} from './exact-tempo.mjs';
import {resolveTimeDisplay} from './time-display.mjs';

const MAX=Number.MAX_SAFE_INTEGER,LIMIT=200000,abs=n=>n<0n?-n:n;
function gcd(a,b){a=abs(a);while(b)[a,b]=[b,a%b];return a;}
function ratio(n,d=1n){if(d<0n){n=-n;d=-d;}const g=gcd(n,d);return {n:n/g,d:d/g};}
const add=(a,b)=>ratio(a.n*b.d+b.n*a.d,a.d*b.d),sub=(a,b)=>ratio(a.n*b.d-b.n*a.d,a.d*b.d);
const mul=(a,b)=>ratio(a.n*b.n,a.d*b.d),div=(a,b)=>ratio(a.n*b.d,a.d*b.n);
const floor=r=>{const q=r.n/r.d;return r.n<0n&&r.n%r.d?q-1n:q;};
const round=r=>floor(add(r,ratio(1n,2n))),json=r=>({numerator:String(r.n),denominator:String(r.d)}),from=r=>ratio(BigInt(r.numerator),BigInt(r.denominator));
const decimal=value=>{const m=/^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(String(value)),digits=m[3]??'',power=Number(m[4]??0)-digits.length,n=BigInt(m[2]+digits)*(m[1]?-1n:1n);return power>=0?ratio(n*10n**BigInt(power)):ratio(n,10n**BigInt(-power));};
// Ratios here can contain exact-tempo denominators too large for Number().
// Convert only the bounded normalized quotient, preserving 16 decimal places.
const unitNumber=r=>Number(r.n*10000000000000000n/r.d)/1e16;
const keys=(o,allowed)=>requireValue(o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).every(k=>allowed.includes(k)),'INVALID_CONTROLLER_SHAPE','Unexpected shape option.');

/** Pure generation plan for the common range replacement command. All time
 * inputs are clip-local stored ticks; position snap is the gesture caller's job.
 * Period is musical/source-tick based even in a time-linear editor. Parabola
 * progress and Quantize Link density follow the explicit project piano layout.
 * Exact formulas, 2px density and rounding are explicit application policies.
 */
function compileShape(project,options){
 keys(options,['clipId','kind','startTick','endTick','startValue','endValue','periodTicks','phase','peak','duty','exponent','reverse','maxValue']);
 const {clipId,kind,startTick,endTick,startValue,endValue,maxValue=127}=options;
 requireValue(['line','parabola','sine','triangle','square'].includes(kind),'INVALID_CONTROLLER_SHAPE','Choose Line, Parabola, Sine, Triangle or Square.');
 const clip=project.clips.find(c=>c.id===clipId);requireValue(clip?.type==='midi','INVALID_CONTROLLER_SHAPE','An existing MIDI clip is required.');
 integer(clip.lengthTicks,1,MAX,'Clip length');integer(clip.startTick,0,MAX-clip.lengthTicks,'Clip start');
 integer(startTick,0,clip.lengthTicks,'Shape start');integer(endTick,0,clip.lengthTicks,'Shape end');requireValue(startTick!==endTick,'CONTROLLER_SHAPE_COLLAPSED','A shape requires two distinct source positions.');
 requireValue([127,16383].includes(maxValue),'INVALID_CONTROLLER_SHAPE','Choose a 7-bit or pitchbend range.');integer(startValue,0,maxValue,'Start value');integer(endValue,0,maxValue,'End value');
 const periodic=!['line','parabola'].includes(kind),valid=periodic?['periodTicks','phase',...(kind==='triangle'?['peak']:kind==='square'?['duty']:[])]:kind==='parabola'?['exponent','reverse']:[];
 for(const name of ['periodTicks','phase','peak','duty','exponent','reverse'])requireValue(options[name]===undefined||valid.includes(name),'INVALID_CONTROLLER_SHAPE',`${name} does not apply to ${kind}.`);
 const period=periodic?integer(options.periodTicks,1,MAX,'Wave period'):null;
 const phase=periodic?decimal(finite(options.phase??0,-MAX,MAX,'Wave phase')):null;
 const peak=kind==='triangle'?decimal(finite(options.peak??.5,0,1,'Triangle peak')):null;
 const duty=kind==='square'?decimal(finite(options.duty??.5,0,1,'Square duty')):null;
 const exponent=periodic?null:kind==='line'?1:finite(options.exponent??2,.01,1000,'Parabola exponent');
 requireValue(options.reverse===undefined||typeof options.reverse==='boolean','INVALID_CONTROLLER_SHAPE','Reverse must be boolean.');
 const reverse=options.reverse??false;
 const direction=endTick>startTick?1:-1,span=BigInt(Math.abs(endTick-startTick)),mode=resolveTimeDisplay(project.timeDisplay).pianoMode;
 let exact;
 function tempo(){if(!exact){const before=project.tempoMap.filter(p=>p.tick<=clip.startTick).at(-1);exact=compileExactTempoMap([{tick:0,bpm:before.bpm},...project.tempoMap.filter(p=>p.tick>clip.startTick).map(p=>({tick:p.tick-clip.startTick,bpm:p.bpm}))],project.ppq);}return exact;}
 const elapsed=(a,b)=>from(tempo().secondsBetween(a,b));
 const progressOrigin=!periodic&&mode==='time-linear'?from(tempo().secondsAt(startTick)):null;
 const progressTotal=progressOrigin?sub(from(tempo().secondsAt(endTick)),progressOrigin):null;
 const scaled=q=>Number(round(add(ratio(BigInt(startValue)),mul(ratio(BigInt(endValue-startValue)),q))));
 function value(tick){
  if(!periodic){
   if(tick===startTick)return startValue;if(tick===endTick)return endValue;
   const progress=progressTotal?div(sub(from(tempo().secondsAt(tick)),progressOrigin),progressTotal):ratio(BigInt(Math.abs(tick-startTick)),span);
   if(exponent===1)return scaled(progress);
   if(exponent===2)return scaled(reverse?sub(ratio(1n),mul(sub(ratio(1n),progress),sub(ratio(1n),progress))):mul(progress,progress));
   const u=unitNumber(progress);
   const f=reverse?1-Math.pow(1-u,exponent):Math.pow(u,exponent);
   return Math.max(0,Math.min(maxValue,Math.floor(startValue+(endValue-startValue)*f+.5)));
  }
  const cycles=add(ratio(BigInt(direction)*BigInt(tick-startTick),BigInt(period)),phase),q=sub(cycles,ratio(floor(cycles)));
  if(kind==='square')return q.n*duty.d<duty.n*q.d?endValue:startValue;
  if(kind==='triangle'){
   const f=peak.n===0n?sub(ratio(1n),q):peak.n===peak.d?q:q.n*peak.d<=peak.n*q.d?div(q,peak):div(sub(ratio(1n),q),sub(ratio(1n),peak));return scaled(f);
  }
  // Exact quadrants avoid libm noise changing a half-up MIDI value at landmarks.
  if(q.n===0n)return startValue;if(q.n*2n===q.d)return endValue;
  if(q.n*4n===q.d||q.n*4n===q.d*3n)return scaled(ratio(1n,2n));
  const f=(1-Math.cos(2*Math.PI*unitNumber(q)))/2;return Math.max(0,Math.min(maxValue,Math.floor(startValue+(endValue-startValue)*f+.5)));
 }
 const valueAt=tick=>{integer(tick,Math.min(startTick,endTick),Math.max(startTick,endTick),'Shape evaluation tick');return value(tick);};
 return {valueAt,kind,mode,direction,periodic,span,period,tempo,elapsed,range:{startTick:Math.min(startTick,endTick),endTick:Math.max(startTick,endTick)},...(periodic?{periodTicks:period}:{exponent,reverse:reverse??false})};
}

/** Evaluate at an exact existing source tick, without density sampling or new
 * events. The same function drives numeric controllers and note-value edits. */
export function compileControllerShape(project,options){
 const c=compileShape(project,options);
 return Object.freeze({valueAt:c.valueAt,kind:c.kind,mode:c.mode,direction:c.direction,range:Object.freeze(c.range),...(c.periodic?{periodTicks:c.period}:{exponent:c.exponent,reverse:c.reverse})});
}

export function generateControllerShape(project,options){
 keys(options,['clipId','kind','startTick','endTick','startValue','endValue','density','periodTicks','phase','peak','duty','exponent','reverse','maxValue','maxPoints']);
 const {density,maxPoints=LIMIT,...shape}=options;
 requireValue(shape.kind!=='line','INVALID_CONTROLLER_SHAPE','Use the Line command for numeric controller lines.');
 const c=compileShape(project,shape),{periodic,span,direction,mode,tempo,elapsed,period,exponent,reverse}=c,{startTick,endTick}=shape;
 integer(maxPoints,2,LIMIT,'Shape point budget');
 keys(density,['mode','stepTicks','zoom']);const ticks=[];
 if(density.mode==='ticks'){
  requireValue(density.zoom===undefined,'INVALID_CONTROLLER_SHAPE','Fixed density does not accept zoom.');const step=BigInt(integer(density.stepTicks,1,MAX,'Shape density'));
  const count=(span+step-1n)/step+1n;requireValue(count<=BigInt(maxPoints),'CONTROLLER_SHAPE_LIMIT','Shape density exceeds its point budget.');
  for(let offset=0n;offset<span;offset+=step)ticks.push(Number(BigInt(startTick)+BigInt(direction)*offset));ticks.push(endTick);
 }else{
  requireValue(periodic&&density.mode==='quantize-link'&&density.stepTicks===undefined,'INVALID_CONTROLLER_SHAPE','Quantize Link is only available for periodic shapes.');
  const zoom=decimal(finite(density.zoom,1,10000,'Quantize Link zoom')),pixelStep=ratio(2n);
  const pixelSpan=mode==='beat-linear'?mul(div(ratio(span),ratio(BigInt(project.ppq))),zoom):mul(ratio(2n),mul(zoom,elapsed(Math.min(startTick,endTick),Math.max(startTick,endTick))));
  const intervals=div(pixelSpan,pixelStep),full=floor(intervals),count=full+1n+(intervals.n%intervals.d?1n:0n);
  requireValue(count<=BigInt(maxPoints),'CONTROLLER_SHAPE_LIMIT','Quantize Link exceeds its bounded sampling budget.');
  const initial=mode==='time-linear'?from(tempo().secondsAt(startTick)):null;
  for(let i=0n;i<=full;i++){
   let tick;
   if(mode==='beat-linear'){const offset=div(mul(ratio(i*2n*BigInt(direction)*BigInt(project.ppq)),ratio(1n)),zoom);tick=Number(round(add(ratio(BigInt(startTick)),offset)));}
   else{const seconds=add(initial,div(ratio(i*BigInt(direction)),zoom));tick=tempo().tickAtSeconds(json(seconds),'nearest');}
   requireValue(tick>=Math.min(startTick,endTick)&&tick<=Math.max(startTick,endTick),'CONTROLLER_SHAPE_OUT_OF_BOUNDS','Density conversion left the source range.');
   if(ticks.at(-1)!==tick)ticks.push(tick);
  }
  if(ticks.at(-1)!==endTick)ticks.push(endTick);
 }
 return {points:ticks.map(tick=>({tick,value:c.valueAt(tick)})).sort((a,b)=>a.tick-b.tick),range:c.range,kind:c.kind,mode,direction,density:{...density},...(periodic?{periodTicks:period}:{exponent,reverse})};
}

/** Shift+Snap period policy: nearest positive multiple, ties to larger period.
 * The manual specifies a multiple but not this rounding/tie rule. */
export function quantizedControllerPeriod(startTick,endTick,quantizeTicks){
 integer(startTick,0,MAX,'Period start');integer(endTick,0,MAX,'Period end');integer(quantizeTicks,1,MAX,'Quantize');
 const q=BigInt(quantizeTicks),n=round(ratio(BigInt(Math.abs(endTick-startTick)),q)),period=(n<1n?1n:n)*q;
 requireValue(period<=BigInt(MAX),'CONTROLLER_SHAPE_OUT_OF_BOUNDS','Quantized period exceeds the safe source range.');return Number(period);
}

/** Alt position operation: translate both endpoints/value bounds together.
 * Never clip individual endpoints, which would silently change amplitude/span. */
export function translateControllerShape(options,{deltaTick=0,deltaValue=0,lengthTicks,maxValue=127}){
 integer(deltaTick,-MAX,MAX,'Shape translation');integer(deltaValue,-16383,16383,'Value translation');integer(lengthTicks,1,MAX,'Clip length');requireValue([127,16383].includes(maxValue),'INVALID_CONTROLLER_SHAPE','Invalid value range.');
 const result=structuredClone(options);
 for(const key of ['startTick','endTick']){integer(result[key],0,lengthTicks,key);const n=BigInt(result[key])+BigInt(deltaTick);requireValue(n>=0n&&n<=BigInt(lengthTicks),'CONTROLLER_SHAPE_OUT_OF_BOUNDS','Translate the complete shape within the clip.');result[key]=Number(n);}
 for(const key of ['startValue','endValue']){integer(result[key],0,maxValue,key);result[key]+=deltaValue;requireValue(result[key]>=0&&result[key]<=maxValue,'CONTROLLER_SHAPE_OUT_OF_BOUNDS','Translate the complete value range within the lane.');}
 return result;
}
