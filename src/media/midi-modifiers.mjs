import { integer, requireValue } from './common.mjs';
import { compileTempoMap } from './time.mjs';

const int = (minimum, maximum) => ({type:'integer',minimum,maximum});
const object = properties => ({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const ratioSchema = object({numerator:int(1,1000),denominator:int(1,1000)});
const randomSchema = object({target:{enum:['off','position','pitch','velocity','length']},min:int(-1000000,1000000),max:int(-1000000,1000000)});
const rangeSchema = object({mode:{enum:['off','velocityLimit','velocityFilter','noteLimit','noteFilter']},min:int(0,127),max:int(0,127)});
const pair = items => ({type:'array',items,minItems:2,maxItems:2});
export const modifierSchema = object({bypass:{type:'boolean'},transpose:int(-127,127),velocityShift:int(-127,127),velocityRatio:ratioSchema,lengthRatio:ratioSchema,seed:int(0,4294967295),random:pair(randomSchema),ranges:pair(rangeSchema)});
const nullable7 = {oneOf:[{const:null},int(0,127)]};
export const trackParameterSchema = object({delayMs:{type:'number',minimum:-10000,maximum:10000},setupChannel:int(0,15),program:nullable7,bankMsb:nullable7,bankLsb:nullable7,volume:nullable7,pan:nullable7});
export const partModifierSchema = object({transpose:int(-127,127),velocityShift:int(-127,127)});
export const defaultModifiers = () => ({bypass:false,transpose:0,velocityShift:0,velocityRatio:{numerator:1,denominator:1},lengthRatio:{numerator:1,denominator:1},seed:0,random:[{target:'off',min:0,max:0},{target:'off',min:0,max:0}],ranges:[{mode:'off',min:0,max:127},{mode:'off',min:0,max:127}]});
export const defaultTrackParameters = () => ({delayMs:0,setupChannel:0,program:null,bankMsb:null,bankLsb:null,volume:null,pan:null});
export const defaultPartModifiers = () => ({transpose:0,velocityShift:0});
const clamp = (n,a,b) => Math.max(a,Math.min(b,n));
const check = (ok,message) => requireValue(ok,'INVALID_MIDI_MODIFIERS',message);
function exact(x,keys){return x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));}
const bounded = (n,a,b) => Number.isSafeInteger(n)&&n>=a&&n<=b;
export function validateModifierState(track, clip) {
  const m=track?.midiModifiers,p=track?.midiParameters,c=clip?.midiModifiers;
  if(m){check(exact(m,Object.keys(defaultModifiers()))&&typeof m.bypass==='boolean'&&bounded(m.transpose,-127,127)&&bounded(m.velocityShift,-127,127)&&bounded(m.seed,0,4294967295),'Invalid MIDI modifier fields.');
    for(const r of [m.velocityRatio,m.lengthRatio])check(exact(r,['numerator','denominator'])&&bounded(r.numerator,1,1000)&&bounded(r.denominator,1,1000),'Ratios require numerator/denominator in 1–1000.');
    check(Array.isArray(m.random)&&m.random.length===2&&Array.isArray(m.ranges)&&m.ranges.length===2,'Use exactly two random and two range slots.');
    for(const r of m.random)check(exact(r,['target','min','max'])&&['off','position','pitch','velocity','length'].includes(r.target)&&bounded(r.min,-1000000,1000000)&&bounded(r.max,-1000000,1000000)&&r.min<=r.max,'Random minimum must not exceed maximum.');
    for(const r of m.ranges)check(exact(r,['mode','min','max'])&&['off','velocityLimit','velocityFilter','noteLimit','noteFilter'].includes(r.mode)&&bounded(r.min,0,127)&&bounded(r.max,0,127)&&r.min<=r.max,'Range minimum must not exceed maximum.');
  }
  if(p){check(exact(p,Object.keys(defaultTrackParameters()))&&Number.isFinite(p.delayMs)&&Math.abs(p.delayMs)<=10000&&bounded(p.setupChannel,0,15),'Invalid track delay or setup channel.');for(const k of ['program','bankMsb','bankLsb','volume','pan'])check(p[k]===null||bounded(p[k],0,127),'Setup values must be null or 0–127.');}
  if(c)check(exact(c,['transpose','velocityShift'])&&bounded(c.transpose,-127,127)&&bounded(c.velocityShift,-127,127),'Invalid part transpose or velocity.');
}
export function modifierTrackIds(project) {
  const ids=new Set(project.tracks.filter(t=>t.type==='midi'&&(t.midiModifiers||t.midiParameters)).map(t=>t.id));
  for(const c of project.clips)if(c.type==='midi'&&c.midiModifiers)ids.add(c.trackId);
  return [...ids];
}
function randomOffset(seed,key,slot,min,max){let h=2166136261^(seed>>>0);for(const ch of `${key}:${slot}`)h=Math.imul(h^ch.codePointAt(0),16777619);h^=h>>>16;h=Math.imul(h,0x7feb352d);h^=h>>>15;h=Math.imul(h,0x846ca68b);h^=h>>>16;return min+Math.floor((h>>>0)/4294967296*(max-min+1));}
function ratio(n,r){const result=Math.round(n*r.numerator/r.denominator);integer(result,0,Number.MAX_SAFE_INTEGER,'Modified note length/value');return result;}

/** Pure, deterministic output stage after curve sampling. Note source objects
 * and their editor geometry are untouched. Stable input order breaks new ties. */
export function applyMidiOutputModifiers(compiled,project) {
  const affected=new Set(modifierTrackIds(project));if(!compiled.tracks.some(t=>affected.has(t.trackId)))return compiled;
  const timeline=compileTempoMap(project.tempoMap,project.ppq),tracks=new Map(project.tracks.map(t=>[t.id,t])),clips=new Map(project.clips.map(c=>[c.id,c]));
  const warnings=new Set(),stats={filteredNotes:0,clampedNotes:0,narrowRangeFallbacks:0};
  const output=compiled.tracks.map(stream=>{
    if(!affected.has(stream.trackId))return stream;
    const track=tracks.get(stream.trackId);validateModifierState(track);
    const m=track.midiModifiers??defaultModifiers(),p=track.midiParameters??defaultTrackParameters(),transformed=new Map();
    const delayed=tick=>{integer(tick,0,Number.MAX_SAFE_INTEGER,'Modified tick');return Math.round(timeline.secondsToTick(Math.max(0,timeline.tickToSeconds(tick)+p.delayMs/1000)));};
    const entries=[];let index=0,endTick=stream.endTick;
    for(const event of stream.events){
      let result={...event,data:event.data.slice()};
      if(event.kind==='noteOn'){
        const clip=clips.get(event.clipId);validateModifierState(null,clip);const part=clip?.midiModifiers??defaultPartModifiers();
        let pitch=event.pitch+part.transpose,velocity=event.velocity+part.velocityShift,start=event.nominalStartTick,duration=event.durationTicks,filtered=false;
        if(!m.bypass){pitch+=m.transpose;velocity=Math.round(velocity*m.velocityRatio.numerator/m.velocityRatio.denominator)+m.velocityShift;duration=ratio(duration,m.lengthRatio);
          for(const [slot,r] of m.random.entries())if(r.target!=='off'){const delta=randomOffset(m.seed,`${track.id}:${event.noteId??`${clip?.id??event.clipIndex}:${event.noteKey}`}`,slot,r.min,r.max);if(r.target==='position')start+=delta;else if(r.target==='length')duration+=delta;else if(r.target==='pitch')pitch+=delta;else velocity+=delta;}
          for(const r of m.ranges){if(r.mode==='velocityLimit')velocity=clamp(velocity,r.min,r.max);if(r.mode==='velocityFilter'&&(velocity<r.min||velocity>r.max))filtered=true;if(r.mode==='noteFilter'&&(pitch<r.min||pitch>r.max))filtered=true;if(r.mode==='noteLimit'&&(pitch<r.min||pitch>r.max)){
            const lower=Math.ceil((r.min-pitch)/12),upper=Math.floor((r.max-pitch)/12);
            if(lower<=upper)pitch+=12*clamp(0,lower,upper);
            else{pitch=clamp(pitch,r.min,r.max);stats.narrowRangeFallbacks++;warnings.add('A Note Limit range contained no octave-equivalent pitch; the nearest boundary was used.');}
          }}
        }
        if(velocity<=0)filtered=true;
        if(filtered){transformed.set(event.noteKey,null);stats.filteredNotes++;continue;}
        if(pitch<0||pitch>127||velocity>127||duration<(event.durationTicks===0?0:1)||start<0)stats.clampedNotes++;
        pitch=clamp(pitch,0,127);velocity=clamp(velocity,1,127);start=Math.max(0,start);duration=Math.max(event.durationTicks===0?0:1,duration);integer(start+duration,0,Number.MAX_SAFE_INTEGER,'Modified note end');
        const shiftedStart=delayed(start),shiftedEnd=delayed(start+duration),end=Math.max(shiftedStart+(duration===0?0:1),shiftedEnd);integer(end,0,Number.MAX_SAFE_INTEGER,'Delayed note end');
        const values={pitch,velocity,nominalStartTick:shiftedStart,nominalEndTick:end,durationTicks:end-shiftedStart};transformed.set(event.noteKey,values);
        result={...result,...values,tick:shiftedStart,data:[pitch,velocity]};endTick=Math.max(endTick,end);
      }else if(event.kind==='noteOff'){
        const values=transformed.get(event.noteKey);check(values!==undefined,'Paired note-off appeared before its source note-on.');if(values===null)continue;
        result={...result,...values,tick:values.nominalEndTick,data:[values.pitch,event.releaseVelocity]};
      }else{result.tick=delayed(event.tick);endTick=Math.max(endTick,result.tick);}
      entries.push({event:result,index:index++});
    }
    const setup=[];for(const [key,cc] of [['bankMsb',0],['bankLsb',32],['volume',7],['pan',10]])if(p[key]!==null)setup.push({kind:'raw',rawKind:'channel',tick:0,status:0xb0|p.setupChannel,channel:p.setupChannel,data:[cc,p[key]],setupParameter:key,sourceTrack:stream.sourceTrack});
    if(p.program!==null)setup.splice([p.bankMsb,p.bankLsb].filter(x=>x!==null).length,0,{kind:'raw',rawKind:'channel',tick:0,status:0xc0|p.setupChannel,channel:p.setupChannel,data:[p.program],setupParameter:'program',sourceTrack:stream.sourceTrack});
    if(p.program!==null||p.bankMsb!==null||p.bankLsb!==null)warnings.add('Program/bank setup is exported as MIDI but does not select patches in the built-in oscillator.');
    entries.push(...setup.map((event,i)=>({event,index:i-setup.length})));
    entries.sort((a,b)=>a.event.tick-b.event.tick||a.index-b.index);
    return {...stream,endTick:setup.length?Math.max(1,endTick):endTick,events:entries.map(x=>x.event)};
  });
  const all=output.flatMap(t=>t.events),noteCount=all.filter(e=>e.kind==='noteOn').length,raw=all.filter(e=>e.kind==='raw'),payloadBytes=raw.reduce((n,e)=>n+e.data.length,0);
  requireValue(raw.length<=200000&&noteCount<=200000&&payloadBytes<=4*1024*1024,'MIDI_TOO_LARGE','Modifier output exceeds MIDI work limits.');
  return {...compiled,tracks:output,endTick:output.reduce((n,t)=>Math.max(n,t.endTick),compiled.endTick),noteCount,rawEventCount:raw.length,eventCount:all.length,payloadBytes,modifierWarnings:[...warnings],modifierStats:stats};
}
