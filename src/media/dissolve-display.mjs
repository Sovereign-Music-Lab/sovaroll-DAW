/** Notes become connected sounding islands; raw controller timelines remain intact. */
export function optimizeDissolvedPart(source){
 const clone=x=>structuredClone(x),newId=()=>`clip-${crypto.randomUUID()}`,groups=[],invalidatedQuantizeNoteIds=[];
 for(const note of [...source.notes].sort((a,b)=>a.startTick-b.startTick)){
  const end=Math.max(note.startTick+1,Math.min(source.lengthTicks,note.startTick+note.durationTicks)),last=groups.at(-1);
  if(last&&note.startTick<=last.end){last.end=Math.max(last.end,end);last.notes.push(note);}else groups.push({start:note.startTick,end,notes:[note]});
 }
 if(groups.length>4096)throw Object.assign(new Error('Optimized display supports at most 4096 note islands per part.'),{code:'COPY_LIMIT'});
 const parts=[],group=source.midiOrderGroup??`midi-order-${crypto.randomUUID()}`;
 if(source.events?.length){const controls=clone(source);controls.notes=[];controls.midiOrderGroup=group;controls.name=`${source.name.slice(0,240)} · Controls`;parts.push(controls);}
 for(const island of groups){const part=clone(source);part.id=parts.length?newId():source.id;part.startTick+=island.start;part.lengthTicks=Math.max(1,island.end-island.start);part.events=[];part.midiOrderGroup=group;
  part.notes=island.notes.map(sourceNote=>{const note=clone(sourceNote);note.startTick-=island.start;if(note.quantizeReference){const ref=note.quantizeReference;ref.startTick-=island.start;if(ref.startTick<0||ref.startTick+ref.durationTicks>part.lengthTicks){delete note.quantizeReference;invalidatedQuantizeNoteIds.push(note.id);}}return note;});parts.push(part);
 }
 return {parts,invalidatedQuantizeNoteIds,controllerPartPreserved:Boolean(source.events?.length)};
}
