import {materializeMidiCurves} from './midi-curves.mjs';
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
export function planRepeatMidiLoop(clip,{startTick,endTick}){
 if(!Number.isSafeInteger(startTick)||!Number.isSafeInteger(endTick)||startTick<0||endTick<=startTick||endTick>=clip.lengthTicks)fail('INVALID_LOOP','Provide a part-relative loop ending strictly before part end.');
 const span=endTick-startTick,count=Math.ceil((clip.lengthTicks-endTick)/span);
 if(count>4096)fail('COPY_LIMIT','Repeat Loop supports at most 4096 additional cycles.');
 const sourceNotes=clip.notes.filter(n=>n.startTick>=startTick&&n.startTick<endTick),hasCurves=(clip.events??[]).some(e=>e.curve),materialized=hasCurves?materializeMidiCurves(clip):null;
 const events=(materialized?.events??clip.events??[]).map(source=>{const e=structuredClone(source);delete e.curve;delete e.curveGenerated;delete e.curveSourceId;delete e.curveLane;return e;}),sourceEvents=events.filter(e=>e.tick>=startTick&&e.tick<endTick);
 if(sourceNotes.length*count>200000||sourceEvents.length*count+events.filter(e=>e.tick<endTick).length>200000)fail('COPY_LIMIT','Repeat Loop exceeds 200000 note/event copy budget.');
 const notes=clip.notes.filter(n=>n.startTick<endTick).map(n=>structuredClone(n)),keptEvents=events.filter(e=>e.tick<endTick),copiedNotes=[],copiedEvents=[];
 for(let i=1;i<=count;i++){
  const delta=i*span;
  for(const source of sourceNotes){const tick=source.startTick+delta;if(tick>=clip.lengthTicks)continue;const n=structuredClone(source);n.id=`note-${crypto.randomUUID()}`;n.startTick=tick;n.durationTicks=Math.min(n.durationTicks,clip.lengthTicks-tick);delete n.quantizeReference;copiedNotes.push(n);}
  for(const source of sourceEvents){const tick=source.tick+delta;if(tick>=clip.lengthTicks)continue;const e=structuredClone(source);e.id=`event-${crypto.randomUUID()}`;e.tick=tick;copiedEvents.push(e);}
 }
 for(const e of keptEvents)if(!e.id)e.id=`event-${crypto.randomUUID()}`;
 return {notes:notes.concat(copiedNotes),events:keptEvents.concat(copiedEvents),copiedNotes,copiedEvents,bakedCurves:hasCurves,startTick,endTick,cycles:count,warnings:materialized?.diagnostics??[]};
}
