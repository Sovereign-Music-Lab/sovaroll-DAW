import {fail,EngineError} from './schema.mjs';
import {compileMidiStreams} from '../media/midi-stream.mjs';
import {defaultModifiers,defaultTrackParameters,defaultPartModifiers,validateModifierState} from '../media/midi-modifiers.mjs';
const id=kind=>`${kind}-${globalThis.crypto.randomUUID()}`;
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const commands=new Set(['midi.modifiers.set','midi.trackParameters.set','midi.partModifiers.set','midi.modifiers.freeze']);
export function applyModifiers(project,command,args){try{return apply(project,command,args);}catch(error){if(error.code&&!(error instanceof EngineError))fail(error.code,error.message,error.details);throw error;}}
function apply(project,command,args){
 if(!commands.has(command))return null;
 const changes={created:[],updated:[],removed:[]},target=command==='midi.partModifiers.set'?project.clips.find(c=>c.id===args.clipId):project.tracks.find(t=>t.id===args.trackId);
 if(!target)fail('NOT_FOUND','MIDI track/part not found.');if(target.type!=='midi')fail('TYPE_MISMATCH','MIDI modifiers require a MIDI track or part.');
 if(command!=='midi.modifiers.freeze'){
  if(!Object.keys(args.settings).length)fail('EMPTY_UPDATE','Provide at least one MIDI modifier setting.');
  const field=command==='midi.trackParameters.set'?'midiParameters':'midiModifiers',defaults=command==='midi.trackParameters.set'?defaultTrackParameters():command==='midi.partModifiers.set'?defaultPartModifiers():defaultModifiers();
  target[field]={...defaults,...target[field],...structuredClone(args.settings)};
  validateModifierState(command==='midi.partModifiers.set'?null:target,command==='midi.partModifiers.set'?target:null);changes.updated.push(target.id);
 }else{
  const clips=project.clips.filter(c=>c.trackId===target.id),work=target.midiModifiers&&!same(target.midiModifiers,defaultModifiers())||target.midiParameters&&!same(target.midiParameters,defaultTrackParameters())||clips.some(c=>c.midiModifiers&&!same(c.midiModifiers,defaultPartModifiers())||c.events?.some(e=>e.curve!==undefined));
  if(!work)return {changes:{...changes,noop:true},resolvedTargets:[target.id]};
  const compiled=compileMidiStreams(project,{trackIds:[target.id]}),stream=compiled.tracks[0],group=id('frozen-midi'),eventsByClip=new Map(clips.map(c=>[c.id,[]])),setup=[];
  stream.events.forEach((e,order)=>{const item={...e,order};if(e.setupParameter)setup.push(item);else eventsByClip.get(e.clipId).push(item);});
  const invalidated=[];
  for(const clip of clips){
   const output=eventsByClip.get(clip.id),originalIds=new Set([...(clip.events??[]).map(e=>e.id),...clip.notes.map(n=>n.id)]),on=new Map(),off=new Map(),raw=[];
   let start=clip.startTick,end=clip.startTick+clip.lengthTicks;
   for(const e of output){start=Math.min(start,e.tick);end=Math.max(end,e.tick+(e.kind==='noteOn'&&e.durationTicks===0?1:0));if(e.kind==='noteOn')on.set(e.noteId,e);else if(e.kind==='noteOff')off.set(e.noteId,e);else raw.push(e);}
   const notes=[];
   for(const n of clip.notes){const a=on.get(n.id),b=off.get(n.id);if(!a)continue;if(!b)fail('MIDI_FREEZE_PAIR','Missing paired note-off while freezing.');const next={...n,pitch:a.pitch,velocity:a.velocity,startTick:a.tick-start,durationTicks:b.tick-a.tick,onOrder:a.order,offOrder:b.order};
    if(n.quantizeReference&&(next.startTick!==n.startTick||next.durationTicks!==n.durationTicks)){delete next.quantizeReference;invalidated.push(n.id);}notes.push(next);
   }
   const events=raw.map(e=>({id:e.curveGenerated?id('event'):e.eventId,kind:e.rawKind,tick:e.tick-start,order:e.order,status:e.status,data:e.data.slice(),...(e.rawKind==='meta'?{metaType:e.metaType}:{})}));
   clip.startTick=start;clip.lengthTicks=Math.max(1,end-start);clip.notes=notes;clip.events=events;clip.midiOrderGroup=group;
   if(clip.midiModifiers)clip.midiModifiers=defaultPartModifiers();
   const nextIds=new Set([...notes.map(n=>n.id),...events.map(e=>e.id)]);for(const key of originalIds)if(!nextIds.has(key))changes.removed.push(key);for(const key of nextIds)(originalIds.has(key)?changes.updated:changes.created).push(key);changes.updated.push(clip.id);
  }
  if(setup.length){const clip={id:id('clip'),trackId:target.id,type:'midi',name:'Frozen MIDI setup',startTick:0,lengthTicks:1,notes:[],events:setup.map(e=>({id:id('event'),tick:0,order:e.order,kind:'channel',status:e.status,data:e.data.slice()})),midiOrderGroup:group};project.clips.push(clip);changes.created.push(clip.id,...clip.events.map(e=>e.id));}
  if(target.midiModifiers)target.midiModifiers=defaultModifiers();if(target.midiParameters)target.midiParameters=defaultTrackParameters();changes.updated.push(target.id);
  changes.invalidatedQuantizeNoteIds=invalidated;changes.warnings=[...(compiled.curveWarnings??[]),...(compiled.modifierWarnings??[]).map(message=>({code:'MIDI_MODIFIER_POLICY',message}))];changes.frozen={trackId:target.id,noteCount:compiled.noteCount,rawEventCount:compiled.rawEventCount,unsupported:['MIDI inserts','Hermode tuning','native MIDI input']};
 }
 return {changes,resolvedTargets:[target.id,...changes.created,...changes.updated,...changes.removed]};
}
