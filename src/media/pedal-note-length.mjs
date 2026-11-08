import {compileMidiStreams} from './midi-stream.mjs';
import {requireValue} from './common.mjs';
/** Selected-part conversion. Pedal state starts up; an unclosed pedal releases
 * at part end. Shared MIDI compilation resolves stored order and curve samples.
 */
export function planPedalNoteLengths(project,clip,noteIds){
 const byId=new Map(clip.notes.map(n=>[n.id,n])),selected=new Set(noteIds??byId.keys());
 for(const id of selected)requireValue(byId.has(id),'NOT_FOUND',`Note not found: ${id}.`);
 if(!selected.size)return{updates:[],removedEventIds:[],openChannels:[],scope:'selected-part',initialPedal:'up',unclosedPedal:'part-end',unselectedNotesMayChangeAfterPedalRemoval:false};
 const track=project.tracks.find(t=>t.id===clip.trackId),snapshot={...project,tracks:[track],clips:[clip]};
 const stream=compileMidiStreams(snapshot,{trackIds:[clip.trackId],applyModifiers:false,includeMutedClips:true}).tracks[0];
 const down=Array(16).fill(false),pending=Array.from({length:16},()=>new Set()),updates=new Map();
 const release=(channel,tick)=>{for(const id of pending[channel]){const n=byId.get(id),end=tick-clip.startTick;if(end>n.startTick+n.durationTicks)updates.set(id,{noteId:id,durationTicks:end-n.startTick});}pending[channel].clear();};
 for(const e of stream.events){
  if(e.kind==='raw'&&(e.status&240)===176){const cc=e.data[0];if(cc===64){const next=e.data[1]>=64;if(down[e.channel]&&!next)release(e.channel,e.tick);down[e.channel]=next;}else if(cc===121){release(e.channel,e.tick);down[e.channel]=false;}else if(cc===120){pending[e.channel].clear();}}
  else if(e.kind==='noteOff'&&selected.has(e.noteId)&&down[e.channel])pending[e.channel].add(e.noteId);
 }
 const openChannels=[];for(let channel=0;channel<16;channel++){if(pending[channel].size)openChannels.push(channel);release(channel,clip.startTick+clip.lengthTicks);}
 const removedEventIds=(clip.events??[]).filter(e=>e.kind==='channel'&&(e.status&240)===176&&e.data[0]===64).map(e=>e.id);
 return{updates:[...updates.values()],removedEventIds,openChannels,scope:'selected-part',initialPedal:'up',unclosedPedal:'part-end',unselectedNotesMayChangeAfterPedalRemoval:selected.size<clip.notes.length&&removedEventIds.length>0};
}
