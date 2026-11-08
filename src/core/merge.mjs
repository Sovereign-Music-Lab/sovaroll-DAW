import {audibleTrackIds} from '../media/track-audibility.mjs';
import {chaseMidiStreams} from '../media/midi-chase.mjs';
import {EngineError,fail} from './schema.mjs';
import {compileMidiStreams,mergeMidiStreams} from '../media/midi-stream.mjs';
import {splitMidiEvents,midiObjectIds} from './midi-events.mjs';
import {defaultModifiers,defaultPartModifiers} from '../media/midi-modifiers.mjs';
const id=kind=>`${kind}-${globalThis.crypto.randomUUID()}`;
const clone=x=>structuredClone(x);
const inLoop=(tick,left,right)=>tick>=left&&tick<right;
function sliceEvents(original,from,to){
 let work=clone(original);
 if(to<work.lengthTicks){const right=clone(work);splitMidiEvents(work,right,to);work.lengthTicks=to;}
 if(from>0){const right=clone(work);splitMidiEvents(work,right,from);right.startTick+=from;right.lengthTicks=to-from;work=right;}
 return work.events??[];
}
/** Erase note onsets and raw/curve points in [left,right), preserving outside
 * editable geometry, stable surviving IDs and the complete paired note tails. */
function eraseDestination(project,trackId,left,right){
 const result=[];
 for(const original of project.clips){
  if(original.trackId!==trackId||original.type!=='midi'){result.push(original);continue;}
  const start=original.startTick,end=start+original.lengthTicks;
  if(start>=right||end<left){result.push(original);continue;}
  const pieces=[],group=original.midiOrderGroup??id('midi-order');
  for(const [from,to] of [[0,Math.min(original.lengthTicks,left-start)],[Math.max(0,right-start),original.lengthTicks]]){
   if(to<=from||from<0||to>original.lengthTicks)continue;
   const piece={...clone(original),id:pieces.length?id('clip'):original.id,startTick:start+from,lengthTicks:to-from,notes:[],events:sliceEvents(original,from,to),midiOrderGroup:group};
   // A source point exactly at the left locator belongs to the erased interval.
   piece.events=piece.events.filter(e=>!inLoop(piece.startTick+e.tick,left,right));
   for(const note of original.notes){const absolute=start+note.startTick;if(absolute<start+from||absolute>=start+to||inLoop(absolute,left,right))continue;
    const n={...clone(note),startTick:note.startTick-from};
    if(n.quantizeReference){const q=n.quantizeReference;if(q.startTick>=from&&q.startTick+q.durationTicks<=to)q.startTick-=from;else delete n.quantizeReference;}
    if(n.startTick+n.durationTicks>piece.lengthTicks)piece.allowNoteTails=true;
    piece.notes.push(n);
   }
   pieces.push(piece);
  }
  // Raw MIDI at the original end tick is valid and right is exclusive. A part
  // ending at right can therefore leave a one-tick event-only fragment.
  if(end===right){const events=(original.events??[]).filter(e=>e.tick===original.lengthTicks).map(e=>{const n=clone(e);n.tick=0;if(n.curve?.window){n.curve.window.startTick-=original.lengthTicks;n.curve.window.endTick-=original.lengthTicks;}return n;});
   if(events.length)pieces.push({...clone(original),id:pieces.length?id('clip'):original.id,startTick:right,lengthTicks:1,notes:[],events,midiOrderGroup:group});
  }
  result.push(...pieces);
 }
 project.clips=result;
}
export function applyMerge(project,command,args){
 if(command!=='midi.mergeLoop')return null;
 try{return merge(project,args);}catch(e){if(e.code&&!(e instanceof EngineError))fail(e.code,e.message,e.details);throw e;}
}
function merge(project,args){
 const {leftTick:left,rightTick:right}=args;
 if(right<=left)fail('INVALID_LOCATORS','Right locator must be after left locator.');
 if(args.includeSends||args.convertVst3)fail('UNSUPPORTED_MIDI_MERGE_OPTION','MIDI sends and VST3 conversion are not implemented. No data was changed.');
 const selected=args.selectedTrackIds??[];
 if(new Set(selected).size!==selected.length)fail('DUPLICATE_TARGET','Selected track IDs must be unique.');
 for(const key of selected){const t=project.tracks.find(t=>t.id===key);if(!t)fail('NOT_FOUND',`Selected track not found: ${key}.`);if(t.type!=='midi')fail('TYPE_MISMATCH','Merge destination selections must be MIDI tracks.');}
 const activeIds=audibleTrackIds(project),sourceIds=project.tracks.filter(t=>t.type==='midi'&&activeIds.has(t.id)).map(t=>t.id);
 const source=clone(project);
 if(args.includeInserts===false){for(const t of source.tracks)if(t.midiModifiers)t.midiModifiers=defaultModifiers();for(const c of source.clips)if(c.midiModifiers)c.midiModifiers=defaultPartModifiers();}
 const compiled=compileMidiStreams(source,{trackIds:sourceIds,includeMutedClips:false});
 const chased=args.includeChase?chaseMidiStreams(compiled,source,{tick:left,options:args.chaseOptions}):null;
 const chase=chased?.tracks.flatMap(t=>t.events)??[],chasedKeys=new Set(chase.filter(e=>e.kind==='noteOn').map(e=>e.noteKey)),releasedKeys=new Set(chase.filter(e=>e.kind==='noteOff').map(e=>e.noteKey));
 const all=mergeMidiStreams(compiled),selectedNotes=new Set(all.filter(e=>e.kind==='noteOn'&&inLoop(e.tick,left,right)).map(e=>e.noteKey));
 const output=[...chase,...all.filter(e=>e.kind==='raw'?inLoop(e.tick,left,right):selectedNotes.has(e.noteKey)||e.kind==='noteOff'&&e.tick>=left&&chasedKeys.has(e.noteKey)&&!releasedKeys.has(e.noteKey))];
 // Chase precedes every source event at left. Other ties retain source track order
 // and the shared stream's note/raw/generated order.
 output.sort((a,b)=>a.tick-b.tick||Number(!a.chased)-Number(!b.chased));
 const raw=output.filter(e=>e.kind==='raw');if(raw.length>200000||raw.reduce((n,e)=>n+e.data.length,0)>4*1024*1024)fail('MIDI_TOO_LARGE','Merged MIDI events exceed the stored event/payload limit.');
 if(selectedNotes.size+chasedKeys.size>200000)fail('COPY_LIMIT','Merge may create at most 200000 MIDI notes.');
 const beforeClips=project.clips,priorIds=new Set(beforeClips.flatMap(midiObjectIds));
 let target=project.tracks.find(t=>t.id===selected[0]),newTrack=false;
 if(!target){target={id:id('track'),name:'Merged MIDI',type:'midi',color:'#a3f0bf',gainDb:0,pan:0,mute:false,solo:false,instrument:'sine'};project.tracks.push(target);newTrack=true;}
 if(args.eraseDestination)eraseDestination(project,target.id,left,right);
 const clip={id:id('clip'),trackId:target.id,type:'midi',name:args.name??'Merged MIDI',startTick:left,lengthTicks:right-left,notes:[],events:[],midiOrderGroup:id('midi-order')},on=new Map();
 output.forEach((e,order)=>{
  if(e.kind==='noteOn'){const note={id:id('note'),pitch:e.pitch,velocity:e.velocity,channel:e.channel,startTick:e.tick-left,durationTicks:e.durationTicks,releaseVelocity:e.releaseVelocity,noteOffEncoding:e.noteOffEncoding,onOrder:order};on.set(e.noteKey,note);clip.notes.push(note);if(note.startTick+note.durationTicks>clip.lengthTicks)clip.allowNoteTails=true;}
  else if(e.kind==='noteOff'){const n=on.get(e.noteKey);if(!n)fail('MIDI_MERGE_PAIR','Merged note-off has no note-on.');n.offOrder=order;n.durationTicks=e.tick-left-n.startTick;n.releaseVelocity=e.releaseVelocity;n.noteOffEncoding=e.noteOffEncoding;}
  else clip.events.push({id:id('event'),tick:e.tick-left,order,kind:e.rawKind,status:e.status,data:e.data.slice(),...(e.rawKind==='meta'?{metaType:e.metaType}:{})});
 });
 project.clips.push(clip);
 const nextIds=new Set(project.clips.flatMap(midiObjectIds)),changes={created:[],updated:[],removed:[]};
 for(const key of nextIds)if(!priorIds.has(key))changes.created.push(key);
 if(newTrack)changes.created.unshift(target.id);
 for(const key of priorIds)if(!nextIds.has(key))changes.removed.push(key);
 const beforeById=new Map(beforeClips.map(c=>[c.id,c]));for(const c of project.clips)if(beforeById.has(c.id)&&JSON.stringify(c)!==JSON.stringify(beforeById.get(c.id))){changes.updated.push(c.id);for(const n of c.notes??[])changes.updated.push(n.id);for(const e of c.events??[])changes.updated.push(e.id);}
 changes.warnings=[...(chased?.warnings??[]),...(compiled.curveWarnings??[]),...(compiled.modifierWarnings??[]).map(message=>({code:'MIDI_MODIFIER_POLICY',message})),{code:'MIDI_MERGE_BOUNDARY_POLICY',message:'Selection uses output onset in [left,right). Note tails are preserved. Source track order resolves equal ticks; MIDI channels are not remapped.'}];
 if(sourceIds.length>1)changes.warnings.push({code:'MIDI_MERGE_CHANNEL_COLLISION',message:'Source tracks share one destination MIDI stream. Same-channel program/controller state can interact; audio mixer gain/pan and instruments are not merged.'});
 if(args.includeChase)changes.warnings.push({code:'MIDI_MERGE_CHASE_SCOPE',message:'Chase restores the selected MIDI types before left, including key-down and pedal-held notes. Protocol and SysEx packet order is preserved; device-specific SysEx state and VST3 are not interpreted. Raw events after right are not copied; a pedal still down at the end requires playback/device stop-reset handling.'});
 if(target.midiModifiers||target.midiParameters)changes.warnings.push({code:'MIDI_MERGE_RESET_DESTINATION',message:'Destination output settings remain active. Reset modifiers/delay/setup as appropriate after merging to avoid applying them twice; other parts on this track also use these settings.'});
 changes.merge={clipId:clip.id,trackId:target.id,newTrack,leftTick:left,rightTick:right,sourceTrackIds:sourceIds,noteCount:clip.notes.length,eventCount:clip.events.length,chasedEventCount:chase.length,chasedNoteCount:chasedKeys.size,chaseOptions:chased?.options??null,includeInserts:args.includeInserts!==false,eraseDestination:args.eraseDestination??false};
 return {changes,resolvedTargets:[...new Set([...sourceIds,target.id,...changes.created,...changes.updated,...changes.removed])]};
}
