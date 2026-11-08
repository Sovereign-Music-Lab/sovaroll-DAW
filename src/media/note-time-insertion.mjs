/** Detached note component of Paste Time. Controller/time insertion and clipboard
 * placement must be committed with this result by a shared command. */
export function planNoteTimeInsertion(notes,{atTick,lengthTicks,maxNotes=200000}={}){
 if(!Number.isSafeInteger(atTick)||atTick<0||!Number.isSafeInteger(lengthTicks)||lengthTicks<1)throw new Error('Insertion position and positive length must be safe integer ticks');
 const output=[],splitSourceIds=[],shiftedIds=[],invalidatedQuantizeNoteIds=[];
 const safe=t=>{if(!Number.isSafeInteger(t)||t<0)throw new Error('Inserted note timing exceeds safe integer range');return t;};
 for(const source of notes){
  const n=structuredClone(source),end=safe(n.startTick+n.durationTicks);
  if(n.startTick>=atTick){safe(end+lengthTicks);n.startTick=safe(n.startTick+lengthTicks);delete n.quantizeReference;shiftedIds.push(n.id);output.push(n);}
  else if(end>atTick){
   safe(end+lengthTicks);
   const right={...structuredClone(n),id:null,startTick:safe(atTick+lengthTicks),durationTicks:end-atTick};delete right.onOrder;delete right.quantizeReference;
   n.durationTicks=atTick-n.startTick;delete n.offOrder;delete n.quantizeReference;n.releaseVelocity=0;n.noteOffEncoding='noteOff';
   output.push(n,right);splitSourceIds.push(n.id);
  }else{if(n.quantizeReference&&(n.quantizeReference.startTick+n.quantizeReference.durationTicks>atTick||n.quantizeReference.startTick>=atTick))delete n.quantizeReference;output.push(n);}
  if(source.quantizeReference&&!n.quantizeReference)invalidatedQuantizeNoteIds.push(n.id);
  if(output.length>maxNotes)throw new Error('Time insertion exceeds note budget');
 }
 return {notes:output,splitSourceIds,shiftedIds,invalidatedQuantizeNoteIds};
}
