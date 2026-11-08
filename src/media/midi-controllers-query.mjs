import { controllerLane } from './midi-curves.mjs';

const invalid = (code,message,details) => { throw Object.assign(new Error(message),{code,details}); };
/** Explicit newdaw selection policy; manual base Auto Select bounds are ambiguous.
 * Half-open ranges and matching channels/pressure keys prevent unrelated voices
 * being silently moved. This read-only helper is shared by GUI and command core. */
export function noteControllerSelection(clip,{noteIds,mode='none',anchorNoteId}={}) {
  if(clip?.type!=='midi'||!Array.isArray(noteIds)||!noteIds.length||new Set(noteIds).size!==noteIds.length)invalid('INVALID_SELECTION','Select unique MIDI note IDs.');
  if(!['none','noteRange','extended'].includes(mode))invalid('INVALID_SELECTION','Unknown controller selection policy.');
  const byId=new Map(clip.notes.map(n=>[n.id,n])),selected=noteIds.map(id=>{const n=byId.get(id);if(!n)invalid('NOT_FOUND',`Note not found: ${id}.`,{id});return n;});
  if(anchorNoteId!==undefined&&!noteIds.includes(anchorNoteId))invalid('INVALID_SELECTION','The extended anchor must be a selected note.',{anchorNoteId});
  if(mode==='extended'&&anchorNoteId===undefined)invalid('ANCHOR_REQUIRED','Extended controller selection requires the most recently selected note ID.');
  const ranges=[];
  const starts=new Map();for(const n of clip.notes){let values=starts.get(n.channel??0);if(!values){values=[];starts.set(n.channel??0,values);}values.push(n.startTick);}
  for(const [channel,values]of starts)starts.set(channel,[...new Set(values)].sort((a,b)=>a-b));
  const nextStart=n=>{const values=starts.get(n.channel??0);let lo=0,hi=values.length;while(lo<hi){const mid=Math.floor((lo+hi)/2);if(values[mid]<=n.startTick)lo=mid+1;else hi=mid;}return values[lo]??clip.lengthTicks;};
  if(mode==='noteRange')for(const n of selected)ranges.push({noteId:n.id,channel:n.channel??0,pitch:n.pitch,startTick:n.startTick,endTick:nextStart(n)});
  if(mode==='extended'){
    for(const n of selected)ranges.push({noteId:n.id,channel:n.channel??0,pitch:n.pitch,startTick:n.startTick,endTick:n.startTick+n.durationTicks});
    const n=byId.get(anchorNoteId);ranges.push({noteId:n.id,channel:n.channel??0,pitch:n.pitch,startTick:n.startTick,endTick:nextStart(n),extended:true});
  }
  // Merge channel/key intervals and binary search them: no events × selected-notes scan.
  const buckets=new Map();for(const range of ranges)for(const key of [`${range.channel}:all`,`${range.channel}:${range.pitch}`]){let list=buckets.get(key);if(!list){list=[];buckets.set(key,list);}list.push([range.startTick,range.endTick]);}
  for(const [key,list]of buckets){list.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);const merged=[];for(const r of list){if(merged.length&&r[0]<=merged.at(-1)[1])merged.at(-1)[1]=Math.max(merged.at(-1)[1],r[1]);else merged.push([...r]);}buckets.set(key,merged);}
  const contains=(list,tick)=>{if(!list?.length)return false;let lo=0,hi=list.length;while(lo<hi){const mid=Math.floor((lo+hi)/2);if(list[mid][0]<=tick)lo=mid+1;else hi=mid;}return lo>0&&tick<list[lo-1][1];};
  const eventIds=[];for(const event of clip.events??[]){const lane=controllerLane(event);if(!lane||!['cc','pitchBend','channelPressure','polyPressure'].includes(lane.kind))continue;if(contains(buckets.get(`${lane.channel}:${lane.kind==='polyPressure'?lane.pitch:'all'}`),event.tick))eventIds.push(event.id);}
  return {eventIds,ranges,anchorNoteId:mode==='extended'?anchorNoteId:null,policy:'newdaw-channel-key-half-open-ranges-v1'};
}
