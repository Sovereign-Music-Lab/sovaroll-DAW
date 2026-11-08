import {integer,requireValue} from './common.mjs';
import {compileControllerShape} from './controller-shapes.mjs';

/** Existing-note editing only. A nonempty explicit selection restricts the
 * complete gesture; with no selection all in-range notes on the lane qualify.
 * Never sample a density lattice or snap a stored onset to the drawing grid. */
export function planNoteShape(project,options){
 requireValue(options&&typeof options==='object'&&!Array.isArray(options),'INVALID_NOTE_SHAPE','Expected note shape options.');
 const {field,channel='all',selectedNoteIds=[],...shape}=options;
 requireValue(['velocity','releaseVelocity'].includes(field),'INVALID_NOTE_SHAPE','Choose velocity or releaseVelocity.');
 requireValue(channel==='all'||Number.isSafeInteger(channel)&&channel>=0&&channel<=15,'INVALID_NOTE_SHAPE','Choose all channels or a MIDI channel 0..15.');
 requireValue(Array.isArray(selectedNoteIds)&&selectedNoteIds.length<=200000&&selectedNoteIds.every(id=>typeof id==='string')&&new Set(selectedNoteIds).size===selectedNoteIds.length,'INVALID_NOTE_SELECTION','Provide distinct existing note IDs.');
 const minimum=field==='velocity'?1:0;
 integer(shape.startValue,minimum,127,'Note shape start value');integer(shape.endValue,minimum,127,'Note shape end value');
 // maxValue is deliberately not a caller option for 7-bit note attributes.
 requireValue(shape.maxValue===undefined,'INVALID_NOTE_SHAPE','Note values use the fixed 7-bit range.');
 const compiled=compileControllerShape(project,shape),clip=project.clips.find(c=>c.id===shape.clipId),selected=new Set(selectedNoteIds),existing=new Set(clip.notes.map(n=>n.id));
 for(const id of selected)requireValue(existing.has(id),'NOT_FOUND',`Note not found: ${id}.`);
 const targets=clip.notes.filter(n=>(channel==='all'||n.channel===channel)&&(!selected.size||selected.has(n.id))&&n.startTick>=compiled.range.startTick&&n.startTick<=compiled.range.endTick);
 requireValue(targets.length<=200000,'NOTE_SHAPE_LIMIT','At most 200000 existing notes can be edited in one gesture.');
 const points=[],updates=[];
 for(const note of targets){
  const value=compiled.valueAt(note.startTick);points.push({noteId:note.id,tick:note.startTick,value});
  if(value!==(note[field]??0))updates.push({noteId:note.id,value,...(field==='releaseVelocity'&&value!==0&&note.noteOffEncoding==='zeroVelocityNoteOn'?{noteOffEncoding:'noteOff'}:{})});
 }
 return {field,channel,kind:compiled.kind,range:{...compiled.range},mode:compiled.mode,direction:compiled.direction,points,updates};
}
