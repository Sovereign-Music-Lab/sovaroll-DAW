import {fail} from './schema.mjs';
export function applyMidiInputEdit(clip,args){
 const selected=args.noteIds.map(id=>{const note=clip.notes.find(n=>n.id===id);if(!note)fail('NOT_FOUND','Selected input note does not exist.',{noteId:id});return note;}).sort((a,b)=>a.pitch-b.pitch||clip.notes.indexOf(a)-clip.notes.indexOf(b));
 const anchor=selected[0],pitch=args.applyPitch??true,on=args.applyVelocity??false,off=args.applyReleaseVelocity??false,mode=args.chordMode??'replace';
 if(!pitch&&!on&&!off)fail('EMPTY_MIDI_INPUT_EDIT','Enable at least one MIDI input field.');
 if(selected.some(n=>n.startTick!==anchor.startTick))fail('MIDI_INPUT_SELECTION','Select a note or chord at one onset.');
 if(mode==='add'&&!pitch)fail('MIDI_INPUT_SELECTION','Adding chord notes requires pitch input.');
 const incoming=args.notes;if(!pitch&&incoming.length!==1&&incoming.length!==selected.length)fail('MIDI_INPUT_SELECTION','Velocity-only input needs one incoming note or one per selected note.');
 const created=[],updated=[],removed=[],result=[];
 const apply=(target,input)=>{if(pitch)target.pitch=input.pitch;if(on)target.velocity=input.velocity;if(off){target.releaseVelocity=input.releaseVelocity??0;if(target.releaseVelocity&&target.noteOffEncoding==='zeroVelocityNoteOn')target.noteOffEncoding='noteOff';}};
 if(mode==='replace'){
   const count=pitch?incoming.length:selected.length;
   for(let i=0;i<count;i++){
     let target=selected[i];if(!target){target=structuredClone(anchor);target.id=`note-${globalThis.crypto.randomUUID()}`;delete target.onOrder;delete target.offOrder;clip.notes.push(target);created.push(target.id);}else updated.push(target.id);
     apply(target,incoming[i]??incoming[0]);result.push(target.id);
   }
   if(pitch&&selected.length>count){const ids=new Set(selected.slice(count).map(n=>n.id));clip.notes=clip.notes.filter(n=>!ids.has(n.id));removed.push(...ids);}
 }else{
   for(const input of incoming){const target=structuredClone(anchor);target.id=`note-${globalThis.crypto.randomUUID()}`;delete target.onOrder;delete target.offOrder;apply(target,input);clip.notes.push(target);created.push(target.id);result.push(target.id);}
 }
 const later=clip.notes.filter(n=>n.startTick>anchor.startTick).sort((a,b)=>a.startTick-b.startTick||a.pitch-b.pitch),next=later.length?later.filter(n=>n.startTick===later[0].startTick).map(n=>n.id):[];
 return {created,updated,removed,inputEdit:{noteIds:result,nextNoteIds:next,atTick:anchor.startTick,chordMode:mode,applyPitch:pitch,applyVelocity:on,applyReleaseVelocity:off}};
}
