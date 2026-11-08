import {planRepeatMidiLoop} from '../media/repeat-midi-loop.mjs';
import {planControllerThinning} from '../media/controller-thin.mjs';
import {planPedalNoteLengths} from '../media/pedal-note-length.mjs';
import {resolveStepTiming} from '../media/step-timing.mjs';
import {planPasteTimeClips} from '../media/paste-time-plan.mjs';
import {planNotePaint} from '../media/note-paint.mjs';
import {planNoteShape} from '../media/note-shapes.mjs';
import {generateControllerShape} from '../media/controller-shapes.mjs';
import {replaceControllerPaint} from './controller-paint.mjs';
import {describeControllerSegment,bendControllerCurve} from '../media/controller-bend.mjs';
import { fail, EngineError, MAX_MIDI_EVENTS } from './schema.mjs';
import { addMidiEvents } from './midi-events.mjs';
import { controllerLane, controllerValue, withControllerValue, rebaseMidiCurves, reconcileEditedMidiCurves, setMidiControllerValues } from '../media/midi-curves.mjs';
import { noteControllerSelection } from '../media/midi-controllers-query.mjs';

const commands=new Set(['midi.part.repeatLoop','midi.controllers.thin','midi.controllers.delete','midi.notes.pedalsToLength','midi.step','midi.notes.pasteTime','midi.notes.repeat','midi.notes.paint','midi.notes.shape','midi.controllers.shape','midi.controllers.paint','midi.controllers.bend','midi.controllers.draw','midi.controllers.line','midi.controllers.move','midi.controllers.curve','midi.controllers.paste','midi.controllers.setValues','midi.pitchBendGrid.set','midi.notes.move']);
const clone=x=>structuredClone(x),newId=kind=>`${kind}-${globalThis.crypto.randomUUID()}`;
const laneKey=lane=>lane?`${lane.kind}:${lane.channel}:${lane.controller??lane.pitch??''}`:null;
const eventKey=event=>`${laneKey(controllerLane(event))}@${event.tick}`;
const maxValue=lane=>lane.kind==='pitchBend'?16383:127;
const checkValue=(lane,value)=>{if(!Number.isSafeInteger(value)||value<0||value>maxValue(lane))fail('CONTROLLER_VALUE_OUT_OF_BOUNDS',`Controller value must be 0..${maxValue(lane)}.`,{lane,value});};
const checkTick=(clip,tick)=>{if(!Number.isSafeInteger(tick)||tick<0||tick>clip.lengthTicks)fail('MIDI_EVENT_OUT_OF_BOUNDS','Controller points must fit the clip, including its end tick.',{clipId:clip.id,tick});};
const find=(items,id,kind)=>{const item=items.find(x=>x.id===id);if(!item)fail('NOT_FOUND',`${kind} not found: ${id}.`,{id});return item;};
const getClip=(project,id)=>{const c=find(project.clips,id,'Clip');if(c.type!=='midi')fail('TYPE_MISMATCH','Controller editing requires a MIDI clip.');return c;};
function makeEvent(lane,tick,value){
  checkValue(lane,value);const status={cc:0xb0,pitchBend:0xe0,channelPressure:0xd0,polyPressure:0xa0,program:0xc0}[lane.kind]|lane.channel;
  const data=lane.kind==='cc'?[lane.controller,value]:lane.kind==='polyPressure'?[lane.pitch,value]:lane.kind==='pitchBend'?[value&127,value>>7]:[value];
  return {kind:'channel',status,data,tick};
}
function mergeRebase(changes,result){
  changes.created=changes.created.concat(result.createdEventIds??[]);changes.updated=changes.updated.concat(result.updatedEventIds??[]);
  if(result.warnings?.length)changes.warnings=(changes.warnings??[]).concat(result.warnings.map(x=>typeof x==='string'?{code:'CURVE_REBASED',message:x}:x));
}
export function normalizeEditedCurves(clip,ids,changes){if(!ids.length)return;try{mergeRebase(changes,rebaseMidiCurves(clip,ids));}catch(error){if(error instanceof EngineError)throw error;if(error.code)fail(error.code,error.message,error.details);throw error;}}
function reconcileWindows(clip,events,changes){const ids=events.filter(event=>event.curve?.window).map(event=>event.id);if(ids.length)mergeRebase(changes,reconcileEditedMidiCurves(clip,ids));}
function relatedForLocations(clip,locations){
  const lanes=new Map();for(const event of clip.events??[]){const key=laneKey(controllerLane(event));if(!key)continue;let list=lanes.get(key);if(!list){list=[];lanes.set(key,list);}list.push(event);}
  for(const list of lanes.values())list.sort((a,b)=>a.tick-b.tick||a.order-b.order);
  const ids=new Set();for(const {lane,tick}of locations){const sorted=lanes.get(laneKey(lane));if(!sorted)continue;let lo=0,hi=sorted.length;while(lo<hi){const m=Math.floor((lo+hi)/2);if(sorted[m].tick<=tick)lo=m+1;else hi=m;}if(lo)ids.add(sorted[lo-1].id);if(lo<sorted.length)ids.add(sorted[lo].id);}
  return [...ids];
}
function relatedBeforeInsert(clip,lane,ticks){return relatedForLocations(clip,ticks.map(tick=>({lane,tick})));}
export function normalizeInsertedCurves(clip,events,changes){const locations=events.map(event=>({lane:controllerLane(event),tick:event.tick})).filter(x=>x.lane);normalizeEditedCurves(clip,relatedForLocations(clip,locations),changes);}
function setCurve(event,curve){if(curve==null)delete event.curve;else{if(!['cc','pitchBend','channelPressure','polyPressure'].includes(controllerLane(event)?.kind))fail('CURVE_NOT_SUPPORTED','Only CC, pitchbend and pressure events can have curves.');event.curve=clone(curve);}}
function replacePoints(clip,lane,points,changes,{curve=null,replaceInterval,clipboard=false}={}){
  if(!clipboard&&new Set(points.map(p=>p.tick)).size!==points.length)fail('DUPLICATE_POINT_TIME','Draw points must have distinct ticks.');
  for(const point of points){checkTick(clip,point.tick);checkValue(lane,point.value);}
  normalizeEditedCurves(clip,relatedBeforeInsert(clip,lane,points.map(p=>p.tick)),changes);
  const key=laneKey(lane),ticks=new Set(points.map(p=>p.tick)),replaced=new Map(),retained=[];
  for(const event of clip.events??[]){if(laneKey(controllerLane(event))===key&&(ticks.has(event.tick)||(replaceInterval&&event.tick>=replaceInterval[0]&&event.tick<=replaceInterval[1]))){let list=replaced.get(event.tick);if(!list){list=[];replaced.set(event.tick,list);}list.push(event);}else retained.push(event);}
  if(retained.length+points.length>MAX_MIDI_EVENTS)fail('MIDI_EVENT_LIMIT','The edit exceeds the MIDI controller event limit.');
  clip.events=retained;const inputs=[];
  for(const point of [...points].sort((a,b)=>a.tick-b.tick)){
    const old=(replaced.get(point.tick)??[]).sort((a,b)=>a.order-b.order).at(-1);
    let event=makeEvent(lane,point.tick,point.value);
    if(old){event.id=old.id;event.order=old.order;if(old.curve)event.curve=clone(old.curve);changes.updated.push(old.id);for(const item of replaced.get(point.tick))if(item!==old)changes.removed.push(item.id);replaced.delete(point.tick);}
    if(clipboard)setCurve(event,point.curve??null);inputs.push(event);
  }
  for(const list of replaced.values())for(const event of list)changes.removed.push(event.id);
  const output=addMidiEvents(clip,inputs);for(let i=0;i<output.length;i++)if(!inputs[i].id)changes.created.push(output[i].id);
  if(!clipboard){const sorted=clip.events.filter(e=>laneKey(controllerLane(e))===key).sort((a,b)=>a.tick-b.tick||a.order-b.order),targets=new Set(output.map(e=>e.id));for(let i=1;i<sorted.length;i++)if(targets.has(sorted[i].id)&&sorted[i-1].tick<sorted[i].tick){setCurve(sorted[i-1],curve);changes.updated.push(sorted[i-1].id);}}
  reconcileWindows(clip,output,changes);changes.updated.push(clip.id);return output;
}
function selectedEvents(clip,ids){const byId=new Map((clip.events??[]).map(e=>[e.id,e]));return ids.map(id=>{const e=byId.get(id);if(!e)fail('NOT_FOUND',`MIDI event not found: ${id}.`,{id});if(!controllerLane(e))fail('TYPE_MISMATCH','Select numeric controller events.',{id});return e;});}
function assignSafeOrders(clip,events,notes,changes){
  const eventIds=new Set(events.map(e=>e.id)),noteIds=new Set(notes.map(n=>n.id)),used=new Map(),groups=new Map();let maximum=-1;
  const mark=(tick,value)=>{if(value===undefined)return;maximum=Math.max(maximum,value);let set=used.get(tick);if(!set){set=new Set();used.set(tick,set);}set.add(value);};
  for(const e of clip.events??[])if(!eventIds.has(e.id))mark(e.tick,e.order);
  for(const n of clip.notes)if(!noteIds.has(n.id)){mark(n.startTick,n.onOrder);mark(n.startTick+n.durationTicks,n.offOrder);}
  const add=(item,key,tick)=>{if(item[key]===undefined)return;maximum=Math.max(maximum,item[key]);let list=groups.get(tick);if(!list){list=[];groups.set(tick,list);}list.push({item,key,value:item[key]});};
  for(const e of events)add(e,'order',e.tick);for(const n of notes){add(n,'onOrder',n.startTick);add(n,'offOrder',n.startTick+n.durationTicks);}
  for(const [tick,list]of [...groups].sort((a,b)=>a[0]-b[0])){
    const reserved=used.get(tick)??new Set(),values=new Set();let conflict=false;
    for(const entry of list){if(reserved.has(entry.value)||values.has(entry.value))conflict=true;values.add(entry.value);}
    list.sort((a,b)=>a.value-b.value);
    if(conflict){if(list.length>Number.MAX_SAFE_INTEGER-maximum)fail('MIDI_ORDER_OVERFLOW','No safe MIDI order remains for moved points.');for(const {item,key}of list){item[key]=++maximum;(changes.orderReassignedIds??=[]).push(item.id);}}
    for(const {item,key}of list)reserved.add(item[key]);used.set(tick,reserved);
  }
}
function shiftEvents(clip,args,changes){
  const source=selectedEvents(clip,args.eventIds),sourceIds=new Set(args.eventIds);
  if(!args.copy)normalizeEditedCurves(clip,args.eventIds,changes);
  const moved=source.map(event=>{
    const sourceLane=controllerLane(event);let lane=args.targetLane??sourceLane;
    if(lane.kind==='polyPressure'&&args.polyPitchDelta){const pitch=lane.pitch+args.polyPitchDelta;if(pitch<0||pitch>127)fail('PITCH_OUT_OF_BOUNDS','Moved poly pressure key would leave 0..127.');lane={...lane,pitch};}
    if(lane.kind!==sourceLane.kind)fail('CONTROLLER_TYPE_MISMATCH','Clipboard or move conversion must preserve the MIDI event class.');
    const tick=event.tick+args.deltaTick,value=controllerValue(event)+(args.deltaValue??0);checkTick(clip,tick);checkValue(lane,value);
    const copy={...clone(event),...makeEvent(lane,tick,value)};if(args.copy){copy.id=newId('event');if(copy.curve?.window){const w=copy.curve.window;w.startTick+=args.deltaTick;w.endTick+=args.deltaTick;w.startValue+=args.deltaValue??0;w.endValue+=args.deltaValue??0;}}
    if(copy.curve?.handles&&args.deltaValue)for(const h of copy.curve.handles){h.value+=args.deltaValue;checkValue(lane,Math.round(h.value));if(h.value<0||h.value>maxValue(lane))fail('CONTROLLER_VALUE_OUT_OF_BOUNDS','Curve handle would leave the controller value range.');}
    return copy;
  });
  normalizeEditedCurves(clip,relatedForLocations(clip,moved.map(e=>({lane:controllerLane(e),tick:e.tick}))),changes);
  const targets=new Set(moved.map(eventKey));clip.events=(clip.events??[]).filter(e=>{if(!args.copy&&sourceIds.has(e.id))return false;if(targets.has(eventKey(e))){changes.removed.push(e.id);return false;}return true;});
  clip.events=clip.events.concat(moved);reconcileWindows(clip,moved,changes);if(!args.deferOrders)assignSafeOrders(clip,moved,[],changes);
  for(const event of moved)(args.copy?changes.created:changes.updated).push(event.id);changes.updated.push(clip.id);return moved;
}
function moveNotes(clip,args,changes){
  const noteMap=new Map(clip.notes.map(n=>[n.id,n])),notes=args.noteIds.map(id=>{const n=noteMap.get(id);if(!n)fail('NOT_FOUND',`Note not found: ${id}.`,{id});return n;}),selection=noteControllerSelection(clip,{noteIds:args.noteIds,mode:args.controllers??'none',anchorNoteId:args.anchorNoteId});
  if(args.copy&&notes.length>200000)fail('COPY_LIMIT','At most 200000 notes can be copied in one command.');
  for(const n of notes){const start=n.startTick+args.deltaTick,pitch=n.pitch+(args.deltaPitch??0);if(!Number.isSafeInteger(start)||start<0||start>=clip.lengthTicks||start+n.durationTicks>clip.lengthTicks)fail('NOTE_OUT_OF_BOUNDS','All moved notes must fit the clip.');if(pitch<0||pitch>127)fail('PITCH_OUT_OF_BOUNDS','All moved pitches must remain within 0..127.');}
  const movedEvents=selection.eventIds.length?shiftEvents(clip,{eventIds:selection.eventIds,deltaTick:args.deltaTick,copy:args.copy,polyPitchDelta:args.deltaPitch??0,deferOrders:true},changes):[];
    const moved=notes.map(n=>{const item=args.copy?clone(n):n;if(args.copy)item.id=newId('note');item.startTick+=args.deltaTick;item.pitch+=args.deltaPitch??0;if(item.quantizeReference&&args.deltaTick){delete item.quantizeReference;(changes.invalidatedQuantizeNoteIds??=[]).push(item.id);}return item;});
  if(args.copy)clip.notes=clip.notes.concat(moved);assignSafeOrders(clip,movedEvents,moved,changes);
  for(const note of moved)(args.copy?changes.created:changes.updated).push(note.id);changes.updated.push(clip.id);changes.controllerSelection=selection;
}
/** Runs only on the detached Engine candidate. */
export function applyControllers(project,command,args){
  if(!commands.has(command))return null;
  try{
    const changes={created:[],updated:[],removed:[]};let target;
    if(command==='midi.pitchBendGrid.set'){
      const track=find(project.tracks,args.trackId,'Track');if(track.type!=='midi')fail('TYPE_MISMATCH','Pitchbend grid belongs to a MIDI track.');
      if(Object.keys(args).length===1)fail('EMPTY_UPDATE','Provide a grid field to update.');
      const settings={enabled:false,up:2,down:2,linked:true,snap:false,...track.pitchBendGrid,...Object.fromEntries(Object.entries(args).filter(([k])=>k!=='trackId'))};
      if(settings.linked){if(args.up!==undefined&&args.down!==undefined&&args.up!==args.down)fail('GRID_RANGE_CONFLICT','Linked pitchbend ranges must be equal.');const range=args.up??args.down??settings.up;settings.up=range;settings.down=range;}
      track.pitchBendGrid=settings;changes.updated.push(track.id);target=track.id;
    }else{
      const clip=getClip(project,args.clipId);target=clip.id;
      if(command==='midi.part.repeatLoop'){
        const before=new Set([...clip.notes,...(clip.events??[])].map(e=>e.id)),plan=planRepeatMidiLoop(clip,args),after=new Set([...plan.notes,...plan.events].map(e=>e.id));
        clip.notes=plan.notes;clip.events=[];addMidiEvents(clip,plan.events);assignSafeOrders(clip,clip.events,plan.copiedNotes,changes);
        for(const id of before)if(!after.has(id))changes.removed.push(id);for(const id of after)(before.has(id)?changes.updated:changes.created).push(id);changes.updated.push(clip.id);
        changes.repeatLoop={startTick:plan.startTick,endTick:plan.endTick,cycles:plan.cycles,copiedNotes:plan.copiedNotes.length,copiedEvents:plan.copiedEvents.length,bakedCurves:plan.bakedCurves};
        if(plan.bakedCurves)changes.warnings=[{code:'REPEAT_LOOP_CURVES_BAKED',message:'Editable controller curves were baked to integer-tick MIDI points for Repeat Loop. Undo restores their handles.'}];
      }
      else if(command==='midi.controllers.thin'){
        const plan=planControllerThinning(clip,args.tolerance??0),removed=new Set(plan.removedEventIds);
        clip.events=(clip.events??[]).filter(e=>!removed.has(e.id));changes.removed.push(...removed);if(removed.size)changes.updated.push(clip.id);changes.controllerThinning=plan;
      }
      else if(command==='midi.controllers.delete'){
        clip.events=(clip.events??[]).filter(event=>{const lane=controllerLane(event),remove=lane?.kind==='cc'&&(args.mode==='all'||!(lane.controller>=64&&lane.controller<=69||lane.controller>=120));if(remove)changes.removed.push(event.id);return !remove;});
        if(changes.removed.length)changes.updated.push(clip.id);
        changes.controllerDeletion={mode:args.mode,removedCount:changes.removed.length,preservedSwitchControllers:args.mode==='continuous'?[64,65,66,67,68,69]:[],preservesChannelMode:args.mode==='continuous'};
      }
      else if(command==='midi.notes.shape'||command==='midi.notes.paint'){const plan=command==='midi.notes.shape'?planNoteShape(project,args):planNotePaint(project,args),byId=new Map(clip.notes.map(n=>[n.id,n]));for(const u of plan.updates){const n=byId.get(u.noteId);n[plan.field]=u.value;if(u.noteOffEncoding)n.noteOffEncoding=u.noteOffEncoding;changes.updated.push(n.id);}if(plan.updates.length)changes.updated.push(clip.id);changes[command==='midi.notes.shape'?'noteShape':'notePaint']={field:plan.field,mode:plan.mode,matchedNoteCount:plan.points.length,updatedNoteCount:plan.updates.length,...(command==='midi.notes.shape'?{kind:plan.kind,direction:plan.direction}:{sampleCount:plan.sampleCount,work:plan.work})};}
      else if(command==='midi.controllers.shape'){const {lane,curve,...options}=args;const result=generateControllerShape(project,{...options,maxValue:lane.kind==='pitchBend'?16383:127});Object.assign(changes,replaceControllerPaint(clip,{lane,curve,...result.range,points:result.points}),{shape:{kind:result.kind,mode:result.mode,direction:result.direction,density:result.density,pointCount:result.points.length,...(result.periodTicks?{periodTicks:result.periodTicks}:{exponent:result.exponent,reverse:result.reverse})}});}
      else if(command==='midi.controllers.paint')Object.assign(changes,replaceControllerPaint(clip,args));
      else if(command==='midi.controllers.draw')replacePoints(clip,args.lane,args.points,changes,{curve:args.curve});
      else if(command==='midi.controllers.setValues'){
        const ids=args.updates.map(update=>update.eventId);
        if(new Set(ids).size!==ids.length)fail('DUPLICATE_EVENT_ID','Provide one value per existing controller event.');
        const events=selectedEvents(clip,ids);for(let i=0;i<events.length;i++)checkValue(controllerLane(events[i]),args.updates[i].value);
        mergeRebase(changes,setMidiControllerValues(clip,args.updates));if(changes.updated.length)changes.updated.push(clip.id);
      }
      else if(command==='midi.controllers.line'){
        if(args.endTick<=args.startTick)fail('INVALID_CONTROLLER_RANGE','Line endTick must be after startTick.');checkTick(clip,args.startTick);checkTick(clip,args.endTick);checkValue(args.lane,args.startValue);checkValue(args.lane,args.endValue);
        const count=Math.ceil((args.endTick-args.startTick)/args.stepTicks)+1;if(count>MAX_MIDI_EVENTS)fail('MIDI_EVENT_LIMIT','Line density exceeds 200000 points; increase stepTicks.');
        const points=[];for(let tick=args.startTick;tick<args.endTick;tick+=args.stepTicks)points.push({tick,value:Math.round(args.startValue+(args.endValue-args.startValue)*(tick-args.startTick)/(args.endTick-args.startTick))});points.push({tick:args.endTick,value:args.endValue});
        replacePoints(clip,args.lane,points,changes,{curve:args.curve,replaceInterval:[args.startTick,args.endTick]});
      }else if(command==='midi.controllers.paste')replacePoints(clip,args.lane,args.events.map(e=>{const point=clone(e);point.tick+=args.atTick;if(point.curve?.window){point.curve.window.startTick+=args.atTick;point.curve.window.endTick+=args.atTick;}return point;}),changes,{clipboard:true});
      else if(command==='midi.controllers.move')shiftEvents(clip,args,changes);
      else if(command==='midi.controllers.bend'){
        const event=selectedEvents(clip,[args.eventId])[0],key=laneKey(controllerLane(event));
        const segment=()=>{const points=(clip.events??[]).filter(e=>laneKey(controllerLane(e))===key).sort((a,b)=>a.tick-b.tick||a.order-b.order),index=points.indexOf(event);return describeControllerSegment(clip,event,points[index+1]);};
        // Validate before creating window endpoints, then use the exact rebased local shape.
        bendControllerCurve(segment(),args.deltaValue);normalizeEditedCurves(clip,[event.id],changes);
        event.curve=bendControllerCurve(segment(),args.deltaValue);changes.updated.push(event.id,clip.id);
      }
      else if(command==='midi.controllers.curve'){const events=selectedEvents(clip,args.eventIds);normalizeEditedCurves(clip,args.eventIds,changes);for(const event of events){setCurve(event,args.curve);changes.updated.push(event.id);}changes.updated.push(clip.id);}
      else if(command==='midi.notes.pedalsToLength'){
        const plan=planPedalNoteLengths(project,clip,args.noteIds),byId=new Map(clip.notes.map(n=>[n.id,n]));
        for(const update of plan.updates){const note=byId.get(update.noteId);note.durationTicks=update.durationTicks;delete note.offOrder;if(note.quantizeReference){delete note.quantizeReference;(changes.invalidatedQuantizeNoteIds??=[]).push(note.id);}changes.updated.push(note.id);}
        const removed=new Set(plan.removedEventIds);clip.events=(clip.events??[]).filter(e=>!removed.has(e.id));changes.removed.push(...removed);
        if(plan.updates.length||removed.size)changes.updated.push(clip.id);changes.pedalsToLength=plan;
      }
      else if(command==='midi.step'){
        const timing=resolveStepTiming(project,clip,args);args={...args,...timing};
        const nextTick=args.atTick+args.stepTicks,end=args.atTick+args.durationTicks;
        if(!Number.isSafeInteger(nextTick)||!Number.isSafeInteger(end)||!Number.isSafeInteger(clip.startTick+Math.max(nextTick,end)))fail('TIME_OVERFLOW','Step input exceeds safe tick range.');
        if(args.atTick>clip.lengthTicks)clip.lengthTicks=args.atTick;
        for(const key of ['velocities','releaseVelocities'])if(args[key]&&args[key].length!==args.pitches.length)fail('VALIDATION_ERROR',`Step ${key} must match pitches.`);
        const notes=args.pitches.map((pitch,i)=>({pitch,startTick:0,durationTicks:args.durationTicks,channel:args.channel??0,velocity:args.velocities?.[i]??args.velocity??90,releaseVelocity:args.releaseVelocities?.[i]??args.releaseVelocity??0}));
        let nextClip=clip,insertedClipId=clip.id;
        if(args.moveInsert){
          const before=new Set([clip.id,...clip.notes.map(n=>n.id),...(clip.events??[]).map(e=>e.id)]);
          const plan=planPasteTimeClips(clip,{atTick:args.atTick,lengthTicks:args.stepTicks,notes,allowEmpty:true,allowNoteTails:true});
          project.clips.splice(project.clips.indexOf(clip),1,...plan.clips);
          for(const part of plan.clips)for(const id of [part.id,...part.notes.map(n=>n.id),...(part.events??[]).map(e=>e.id)])(before.has(id)?changes.updated:changes.created).push(id);
          insertedClipId=plan.insertedClipId;
          nextClip=plan.clips.find(c=>c.startTick===clip.startTick+nextTick);
          if(!nextClip){nextClip={id:newId('clip'),trackId:clip.trackId,type:'midi',name:clip.name,startTick:clip.startTick+nextTick,lengthTicks:args.stepTicks,notes:[],...(clip.midiModifiers?{midiModifiers:clone(clip.midiModifiers)}:{}),...(clip.mute?{mute:true}:{})};project.clips.push(nextClip);changes.created.push(nextClip.id);}
          changes.warnings=plan.warnings;changes.invalidatedQuantizeNoteIds=plan.invalidatedQuantizeNoteIds;
        }else{
          const inserted=notes.map(n=>({...n,id:newId('note'),startTick:args.atTick}));
          assignSafeOrders(clip,[],inserted,changes);clip.notes.push(...inserted);clip.lengthTicks=Math.max(clip.lengthTicks,nextTick,notes.length?end:0);
          changes.created.push(...inserted.map(n=>n.id));changes.updated.push(clip.id);
        }
        changes.step={...timing,insertedClipId,nextClipId:nextClip.id,nextTick:clip.startTick+nextTick-nextClip.startTick,nextProjectTick:clip.startTick+nextTick,rest:notes.length===0,moveInsert:args.moveInsert??false};
      }
      else if(command==='midi.notes.pasteTime'){
        const plan=planPasteTimeClips(clip,args),before=new Set([clip.id,...clip.notes.map(n=>n.id),...(clip.events??[]).map(e=>e.id)]);
        const index=project.clips.indexOf(clip);project.clips.splice(index,1,...plan.clips);
        for(const c of plan.clips)for(const id of [c.id,...c.notes.map(n=>n.id),...(c.events??[]).map(e=>e.id)])(before.has(id)?changes.updated:changes.created).push(id);
        changes.pasteTime={insertedClipId:plan.insertedClipId,splitSourceIds:plan.splitSourceIds};if(plan.invalidatedQuantizeNoteIds.length)changes.invalidatedQuantizeNoteIds=plan.invalidatedQuantizeNoteIds;if(plan.warnings.length)changes.warnings=plan.warnings;
      }
      else if(command==='midi.notes.repeat'){
        const count=args.count??1;
        if(args.noteIds.length*count>200000)fail('COPY_LIMIT','At most 200000 notes can be repeated in one command.');
        const noteMap=new Map(clip.notes.map(n=>[n.id,n]));
        const selected=args.noteIds.map(id=>{const n=noteMap.get(id);if(!n)fail('NOT_FOUND',`Note not found: ${id}.`,{id});return n;});
        let first=Infinity,last=0;for(const n of selected){first=Math.min(first,n.startTick);last=Math.max(last,n.startTick+n.durationTicks);}
        const span=last-first;
        if(!Number.isSafeInteger(last+span*count)||last+span*count>clip.lengthTicks)fail('NOTE_OUT_OF_BOUNDS','All repeated notes must fit the clip.');
        for(let i=1;i<=count;i++)moveNotes(clip,{noteIds:args.noteIds,deltaTick:span*i,copy:true,controllers:'none'},changes);
        changes.noteRepeat={count,spanTicks:span,createdNoteCount:selected.length*count};
      }
      else if(command==='midi.notes.move')moveNotes(clip,args,changes);
    }
    for(const key of ['created','updated','removed'])changes[key]=[...new Set(changes[key])];return {changes,resolvedTargets:[...new Set([target,...changes.created,...changes.updated,...changes.removed])]};
  }catch(error){if(error instanceof EngineError)throw error;if(error.code)fail(error.code,error.message,error.details);throw error;}
}
