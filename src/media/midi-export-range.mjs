import {requireValue} from './common.mjs';
import {chaseMidiStreams} from './midi-chase.mjs';
/** Export-only projection. Range is half-open, rebased, and all held voices end at its right edge. */
export function projectMidiExportRange(project,compiled,range,{includeChase=true}={}){
 const left=range?.startTick,right=range?.endTick;requireValue(Number.isSafeInteger(left)&&Number.isSafeInteger(right)&&left>=0&&right>left,'INVALID_LOCATORS','MIDI export requires a positive integer locator range.');
 const chased=includeChase?chaseMidiStreams(compiled,project,{tick:left}):null,length=right-left;
 const tracks=compiled.tracks.map(track=>{
  const chase=chased?.tracks.find(t=>t.trackId===track.trackId)?.events??[],chaseKeys=new Set(chase.filter(e=>e.kind==='noteOn').map(e=>e.noteKey)),released=new Set(chase.filter(e=>e.kind==='noteOff').map(e=>e.noteKey)),inside=new Set(track.events.filter(e=>e.kind==='noteOn'&&e.tick>=left&&e.tick<right).map(e=>e.noteKey));
  const source=track.events.filter(e=>e.kind==='raw'?e.tick>=left&&e.tick<right:inside.has(e.noteKey)||e.kind==='noteOff'&&e.tick>=left&&chaseKeys.has(e.noteKey)&&!released.has(e.noteKey));
  const events=[...chase,...source].map((e,index)=>({...e,tick:Math.min(right,e.tick)-left,exportIndex:index}));
  events.sort((a,b)=>a.tick-b.tick||Number(!a.chased)-Number(!b.chased)||a.exportIndex-b.exportIndex);for(const event of events)delete event.exportIndex;
  const channels=new Set(events.filter(e=>e.kind==='noteOn'||e.kind==='raw'&&e.rawKind==='channel').map(e=>e.channel??(e.status&15)));
  for(const channel of channels)for(const cc of[64,66])events.push({kind:'raw',rawKind:'channel',tick:length,status:176|channel,channel,data:[cc,0],sourceTrack:track.sourceTrack});
  return {...track,events,endTick:length};
 });
 const tempo=project.tempoMap.filter(p=>p.tick<=left).at(-1),metadata={...project,tempoMap:[{tick:0,bpm:tempo.bpm},...project.tempoMap.filter(p=>p.tick>left&&p.tick<right).map(p=>({...p,tick:p.tick-left}))],markers:(project.markers??[]).filter(m=>m.tick>=left&&m.tick<right).map(m=>({...m,tick:m.tick-left,...(m.endTick!==undefined?{endTick:m.endTick-left}:{})}))};
 return {metadata,compiled:{...compiled,tracks,eventCount:tracks.reduce((sum,t)=>sum+t.events.length,0),endTick:length},range:{startTick:left,endTick:right,rebasedToZero:true,includeChase,truncateNotesAtEnd:true,pedalReleaseAtEnd:true},warnings:[...(chased?.warnings??[]).map(w=>typeof w==='string'?w:w.message),'Locator SMF starts at tick zero, truncates note ends and releases sustain/sostenuto at the right edge. Raw SysEx packet context outside the range is not reconstructed.']};
}
