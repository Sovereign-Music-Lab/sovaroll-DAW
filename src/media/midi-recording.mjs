import {allowsMidiInput} from './midi-input-filter.mjs';
import {compileTempoMap} from './time.mjs';
import {requireValue} from './common.mjs';
/** Convert a timestamped channel-message take to editable notes and raw channel events. */
export function compileMidiTake(project,{startTick=0,durationSeconds,events,inputFilter=project.midiInputFilter}){
 const map=compileTempoMap(project.tempoMap,project.ppq),startSeconds=map.tickToSeconds(startTick),tickAt=seconds=>Math.max(0,Math.round(map.secondsToTick(startSeconds+seconds)-startTick));
 requireValue(Number.isFinite(durationSeconds)&&durationSeconds>0&&durationSeconds<=600,'INVALID_MIDI_TAKE','Take duration must be >0 and <=600 seconds.');
 const endTick=tickAt(durationSeconds),notes=[],raw=[],pending=new Map(),channels=new Set(),polyKeys=new Set(),warnings=[];let order=0,unmatched=0,closedAtEnd=0,acceptedMessages=0;
 const close=(note,tick,offOrder,velocity=0,encoding='noteOff')=>{note.durationTicks=Math.max(0,tick-note.startTick);note.offOrder=offOrder;note.releaseVelocity=velocity;note.noteOffEncoding=encoding;};
 const sorted=events.map((event,index)=>({...event,index})).sort((a,b)=>a.timeSeconds-b.timeSeconds||a.index-b.index);
 for(const event of sorted){
  requireValue(Number.isFinite(event.timeSeconds)&&event.timeSeconds>=0&&event.timeSeconds<=durationSeconds,'INVALID_MIDI_TAKE','Message timestamp is outside the take.');
  const data=event.data,status=data[0],type=status>>4,channel=status&15,size=type===12||type===13?2:3;
  requireValue(Number.isInteger(status)&&status>=128&&status<240&&data.length===size&&data.slice(1).every(v=>Number.isInteger(v)&&v>=0&&v<=127),'INVALID_MIDI_TAKE','Expected complete channel messages with 7-bit data.');
  if(!allowsMidiInput(data,inputFilter))continue;acceptedMessages++;
  const tick=tickAt(event.timeSeconds),eventOrder=order++,pitch=data[1],key=`${channel}/${pitch}`;channels.add(channel);
  if(type===9&&data[2]>0){const note={pitch,channel,startTick:tick,durationTicks:0,velocity:data[2],onOrder:eventOrder};notes.push(note);if(!pending.has(key))pending.set(key,[]);pending.get(key).push(note);}
  else if(type===8||type===9&&data[2]===0){const note=pending.get(key)?.shift();if(note)close(note,tick,eventOrder,type===8?data[2]:0,type===9?'zeroVelocityNoteOn':'noteOff');else{raw.push({kind:'channel',status,tick,order:eventOrder,data:data.slice(1)});unmatched++;}if(pending.get(key)?.length===0)pending.delete(key);}
  else{
   raw.push({kind:'channel',status,tick,order:eventOrder,data:data.slice(1)});
   if(type===10)polyKeys.add(key);
   if(type===11&&(pitch===120||pitch===123))for(const [voiceKey,queue] of [...pending])if(queue[0]?.channel===channel){for(const note of queue)close(note,tick,order++);pending.delete(voiceKey);}
  }
 }
 for(const queue of pending.values())for(const note of queue){close(note,endTick,order++);closedAtEnd++;}
 const stopResetStartOrder=order;
 // Saved messages terminate the take's pedal/expression state without sending anything to a device.
 for(const channel of [...channels].sort((a,b)=>a-b)){
  for(const controller of [64,66,1,2,123])raw.push({kind:'channel',status:0xb0|channel,tick:endTick,order:order++,data:[controller,0]});
  raw.push({kind:'channel',status:0xd0|channel,tick:endTick,order:order++,data:[0]},{kind:'channel',status:0xe0|channel,tick:endTick,order:order++,data:[0,64]});
 }
 for(const key of polyKeys){const [channel,pitch]=key.split('/').map(Number);raw.push({kind:'channel',status:0xa0|channel,tick:endTick,order:order++,data:[pitch,0]});}
 if(closedAtEnd)warnings.push(`${closedAtEnd} unreleased notes were closed at the take end.`);
 if(unmatched)warnings.push(`${unmatched} unmatched note-off messages were retained as raw channel events.`);
 requireValue(acceptedMessages>0,'EMPTY_MIDI_TAKE','No channel messages passed the input filter.');
 requireValue(notes.length<=200000&&raw.length<=200000,'MIDI_TAKE_LIMIT','Take exceeds the editable note/event budget after stop resets.');
 return {notes,events:raw,lengthTicks:Math.max(1,endTick+1),warnings,recording:{durationSeconds,inputMessages:events.length,acceptedMessages,filteredMessages:events.length-acceptedMessages,inputFilter:inputFilter??null,channels:[...channels].sort((a,b)=>a-b),closedAtEnd,unmatchedNoteOffs:unmatched,stopResetEvents:channels.size*7+polyKeys.size,stopResetStartOrder,timestampPolicy:'seconds relative to take start mapped through the frozen project tempo map; nearest integer tick'}};
}
