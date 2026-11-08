import {convertMidiTicks} from './midi-display-time.mjs';
const MAX_NOTES=200000,MAX_EVENTS=600000,MAX_DIAGNOSTICS=32;
const fail=(message,code='INVALID_LENGTH_ADJUSTMENT')=>{throw Object.assign(new Error(message),{code});};
const int=(n,min,max,name)=>{if(!Number.isSafeInteger(n)||n<min||n>max)fail(`Invalid ${name}`);};
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const id=(x,name)=>{if(typeof x!=='string'||!x.length||x.length>256)fail(`Invalid ${name}`);};
export function resolveLengthAdjustment(input){
 if(!object(input)||Object.keys(input).length!==3||!['projectPpq','displayPpq','lengthAdjustmentTicks'].every(k=>Object.hasOwn(input,k)))fail('Provide projectPpq, displayPpq and lengthAdjustmentTicks explicitly');
 int(input.projectPpq,1,32767,'project PPQ');int(input.displayPpq,1,32767,'display PPQ');int(input.lengthAdjustmentTicks,0,1000000,'Length Adjustment display ticks');
 // A minimum gap must never be rounded down. This is a documented newdaw
 // integer-output policy; source event timing remains independently represented.
 return {...input,gapProjectTicks:convertMidiTicks(input.lengthAdjustmentTicks,input.displayPpq,input.projectPpq,'ceil')};
}
/** Pure note-end adjustment within explicit output scopes. Caller establishes
 * scopes AFTER routing/channel overrides, before Chase or event scheduling.
 * A scope can be a destination (native) or an independent instrument (preview).
 * Co-onset voices remain separate; impossible gaps are reported, never erased. */
export function adjustMidiNoteLengths(input,options){
 const policy=resolveLengthAdjustment(options);
 if(!Array.isArray(input)||input.length>MAX_NOTES)fail('Expected at most200000 notes');
 const notes=structuredClone(input),scopes=new Map();
 for(const note of notes){
  if(!object(note))fail('Notes must be objects');id(note.scope,'output scope');id(note.key,'note key');
  int(note.startTick,0,Number.MAX_SAFE_INTEGER,'note start');int(note.durationTicks,0,Number.MAX_SAFE_INTEGER,'note duration');int(note.startTick+note.durationTicks,0,Number.MAX_SAFE_INTEGER,'note end');int(note.channel,0,15,'channel');int(note.pitch,0,127,'pitch');
  let scope=scopes.get(note.scope);if(!scope){scope={keys:new Set(),lanes:new Map()};scopes.set(note.scope,scope);}if(scope.keys.has(note.key))fail('Duplicate note key within output scope');scope.keys.add(note.key);
  const lane=note.channel*128+note.pitch,list=scope.lanes.get(lane)??[];list.push(note);scope.lanes.set(lane,list);
 }
 const changes=[],diagnostics=[],stats={notes:notes.length,adjustedNotes:0,coincidentGroups:0,infeasibleGaps:0,omittedDiagnostics:0};
 const diagnostic=value=>{if(diagnostics.length<MAX_DIAGNOSTICS)diagnostics.push(value);else stats.omittedDiagnostics++;};
 if(policy.gapProjectTicks)for(const [scope,{lanes}]of scopes)for(const list of lanes.values()){
  list.sort((a,b)=>a.startTick-b.startTick);let i=0;
  while(i<list.length){
   let j=i+1;while(j<list.length&&list[j].startTick===list[i].startTick)j++;
   if(j-i>1){stats.coincidentGroups++;diagnostic({code:'LENGTH_COINCIDENT_NOTES',scope,channel:list[i].channel,pitch:list[i].pitch,startTick:list[i].startTick,count:j-i,message:'Simultaneous note-ons are preserved; no positive gap is possible between them.'});}
   if(j<list.length){const nextTick=list[j].startTick;
    for(let k=i;k<j;k++){const note=list[k],end=note.startTick+note.durationTicks,target=Math.max(note.startTick,nextTick-policy.gapProjectTicks),adjusted=Math.min(end,target);
     if(nextTick-adjusted<policy.gapProjectTicks){stats.infeasibleGaps++;diagnostic({code:'LENGTH_GAP_UNATTAINABLE',scope,key:note.key,requestedTicks:policy.gapProjectTicks,availableTicks:nextTick-note.startTick,message:'Onset preserved; required gap exceeds the distance between onsets.'});}
     if(adjusted<end){note.durationTicks=adjusted-note.startTick;changes.push({scope,key:note.key,previousEndTick:end,endTick:adjusted,nextStartTick:nextTick});stats.adjustedNotes++;}
    }
   }
   i=j;
  }
 }
 return {notes,policy,changes,diagnostics,stats};
}
/** Detached compiler adapter. Raw controllers/SysEx and note-off encoding remain
 * intact; only paired note endpoints and their duration metadata are adjusted.
 * Call before Chase; never recompute using only the post-cursor suffix. */
export function adjustMidiStreamLengths(compiled,options){
 resolveLengthAdjustment(options);
 if(!object(compiled)||!Array.isArray(compiled.tracks))fail('Expected compiled MIDI tracks');
 const result=structuredClone(compiled),notes=[],pairs=new Map(),trackIds=new Set();let count=0;
 for(const track of result.tracks){
  if(!object(track))fail('Invalid compiled track');id(track.trackId,'track/output ID');if(trackIds.has(track.trackId))fail('Duplicate output scope');trackIds.add(track.trackId);
  if(!Array.isArray(track.events)||(count+=track.events.length)>MAX_EVENTS)fail('Compiled event budget exceeds600000');
  const byKey=new Map();pairs.set(track.trackId,byKey);let previousTick=-1;
  for(const e of track.events){
   if(!object(e)||!['noteOn','noteOff','raw'].includes(e.kind)||!Array.isArray(e.data))fail('Invalid compiled event');int(e.tick,0,Number.MAX_SAFE_INTEGER,'event tick');if(e.tick<previousTick)fail('Expected chronologically ordered compiler events');previousTick=e.tick;
   if(e.kind==='raw')continue;
   id(e.noteKey,'paired note key');int(e.channel,0,15,'note channel');int(e.pitch,0,127,'note pitch');int(e.nominalStartTick,0,Number.MAX_SAFE_INTEGER,'nominal start');int(e.nominalEndTick,e.nominalStartTick,Number.MAX_SAFE_INTEGER,'nominal end');
   if(e.durationTicks!==e.nominalEndTick-e.nominalStartTick||e.tick!==(e.kind==='noteOn'?e.nominalStartTick:e.nominalEndTick))fail('Inconsistent paired note timing');
   const pair=byKey.get(e.noteKey)??{};if(e.kind==='noteOff'&&!pair.noteOn)fail('Paired note-off precedes its note-on');if(pair[e.kind])fail('Duplicate paired note endpoint');pair[e.kind]=e;byKey.set(e.noteKey,pair);
  }
  for(const [key,pair]of byKey){
   const {noteOn:on,noteOff:off}=pair;if(!on||!off||['channel','pitch','nominalStartTick','nominalEndTick','durationTicks'].some(k=>on[k]!==off[k]))fail('Missing or inconsistent paired note endpoints');
   notes.push({scope:track.trackId,key,startTick:on.tick,durationTicks:on.durationTicks,channel:on.channel,pitch:on.pitch});
  }
 }
 const adjusted=adjustMidiNoteLengths(notes,options);
 for(const change of adjusted.changes){const pair=pairs.get(change.scope).get(change.key),duration=change.endTick-pair.noteOn.tick;for(const event of [pair.noteOn,pair.noteOff]){event.nominalEndTick=change.endTick;event.durationTicks=duration;}pair.noteOff.tick=change.endTick;}
 // Stable sort preserves existing controller/note lineage at equal ticks. For
 // truncated-to-zero notes the source onset precedes its moved endpoint.
 for(const track of result.tracks)track.events.sort((a,b)=>a.tick-b.tick);
 result.lengthAdjustment={policy:adjusted.policy,stats:adjusted.stats,diagnostics:adjusted.diagnostics,changes:adjusted.changes};
 return result;
}

export const defaultMidiTimingOptions=()=>({displayPpq:480,lengthAdjustmentTicks:0});
export function resolveMidiTimingOptions(input={}){
 if(!object(input)||Object.keys(input).some(k=>!Object.hasOwn(defaultMidiTimingOptions(),k)))fail('Unknown MIDI timing option');
 const value={...defaultMidiTimingOptions(),...input};resolveLengthAdjustment({projectPpq:960,...value});return value;
}
