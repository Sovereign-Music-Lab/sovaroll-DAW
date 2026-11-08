import {planNoteTimeInsertion} from './note-time-insertion.mjs';
import {planControllerTimeInsertion} from './controller-time-insertion.mjs';
/** Build valid independent clips, keeping editable curve fragments separated. */
export function planPasteTimeClips(clip,{atTick,lengthTicks,notes,allowEmpty=false,allowNoteTails=false}={}){
 if(!Array.isArray(notes)||(!allowEmpty&&!notes.length)||notes.length>200000)throw new Error('Paste Time requires 1..200000 clipboard notes');
 const newId=kind=>`${kind}-${globalThis.crypto.randomUUID()}`;
 const inserted=notes.map(source=>{const n=structuredClone(source);if(!Number.isSafeInteger(n.startTick)||n.startTick<0||!Number.isSafeInteger(n.durationTicks)||n.durationTicks<0||!Number.isSafeInteger(n.startTick+n.durationTicks)||(!allowNoteTails&&n.startTick+n.durationTicks>lengthTicks))throw new Error('Clipboard notes must fit the explicit insertion interval');n.id=newId('note');n.channel??=0;delete n.quantizeReference;delete n.onOrder;delete n.offOrder;return n;});
 const shifted=planNoteTimeInsertion(clip.notes,{atTick,lengthTicks}),fragments=planControllerTimeInsertion(clip,{atTick,lengthTicks});
 const left=fragments.left,right=fragments.right;right.id=newId('clip');
 for(const n of shifted.notes){if(n.id===null)n.id=newId('note');if(n.startTick<atTick)left.notes.push(n);else{n.startTick-=atTick+lengthTicks;right.notes.push(n);}}
 const middle={...structuredClone(clip),id:atTick===0?clip.id:newId('clip'),startTick:clip.startTick+atTick,lengthTicks,notes:inserted,events:[]};delete middle.midiOrderGroup;if(allowNoteTails)middle.allowNoteTails=true;
 const clips=[];if(left.lengthTicks>0)clips.push(left);clips.push(middle);
 if(right.lengthTicks>0||right.events.length||right.notes.length){right.lengthTicks=Math.max(1,right.lengthTicks);clips.push(right);}
 return {clips,insertedClipId:middle.id,splitSourceIds:shifted.splitSourceIds,invalidatedQuantizeNoteIds:shifted.invalidatedQuantizeNoteIds,warnings:fragments.changes.warnings};
}
