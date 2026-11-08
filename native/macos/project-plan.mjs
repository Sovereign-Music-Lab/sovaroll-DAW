import {adjustMidiStreamLengths,resolveMidiTimingOptions} from '../../src/media/midi-length-adjustment.mjs';
import {randomUUID} from 'node:crypto';
import {validateProject} from '../../src/core/engine.mjs';
import {compileMidiStreams,mergeMidiStreams} from '../../src/media/midi-stream.mjs';
import {chaseMidiStreams,resolveChaseOptions} from '../../src/media/midi-chase.mjs';
import {compileTempoMap} from '../../src/media/time.mjs';
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const integer=(value,min,max,name)=>{if(!Number.isSafeInteger(value)||value<min||value>max)fail('NATIVE_PLAN_INVALID',`Invalid ${name}`);return value;};
/** Freeze a detached MIDI output plan. Route/channel merging precedes Chase, because
 * multiple tracks on one device/channel share physical controller/pedal state. */
export function compileNativePlan(project,options={}){
 validateProject(project);
 if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>!['routes','startTick','endTick','chaseOptions','timingOptions'].includes(k)))fail('NATIVE_PLAN_INVALID','Unknown native plan options');
 const {routes,startTick=0}=options;integer(startTick,0,Number.MAX_SAFE_INTEGER,'startTick');const chaseOptions=resolveChaseOptions(options.chaseOptions),timingOptions=resolveMidiTimingOptions(options.timingOptions);
 if(!Array.isArray(routes)||!routes.length)fail('NATIVE_ROUTE','Explicit track routes are required');
 const tracks=new Map(project.tracks.map(t=>[t.id,t])),routeMap=new Map();
 for(const route of routes){
  if(!route||typeof route!=='object'||Array.isArray(route)||Object.keys(route).some(k=>!['trackId','destinationId','channel'].includes(k))||tracks.get(route.trackId)?.type!=='midi'||routeMap.has(route.trackId))fail('NATIVE_ROUTE','Routes require unique MIDI track IDs');
  if(route.destinationId!==null)integer(route.destinationId,-2147483648,2147483647,'destinationId');
  if(route.channel!==undefined&&route.channel!==null)integer(route.channel,0,15,'route channel');
  routeMap.set(route.trackId,{...route});
 }
 const solo=project.tracks.some(t=>t.solo),enabled=project.tracks.filter(t=>t.type==='midi'&&!t.mute&&(!solo||t.solo));
 for(const t of enabled)if(!routeMap.has(t.id)&&project.clips.some(c=>c.trackId===t.id&&!c.mute))fail('NATIVE_UNROUTED',`Audible MIDI track has no explicit route: ${t.id}`);
 const ids=enabled.filter(t=>routeMap.get(t.id)?.destinationId!=null).map(t=>t.id);
 const compiled=compileMidiStreams(project,{trackIds:ids,includeMutedClips:false}),byDestination=new Map();
 for(const track of compiled.tracks){
  const route=routeMap.get(track.trackId),events=track.events.map(e=>{
   const copy={...e,data:e.data.slice()};if(copy.status<0xf0&&route.channel!=null){copy.status=(copy.status&0xf0)|route.channel;copy.channel=route.channel;}return copy;
  });
  const list=byDestination.get(route.destinationId)??[];list.push({...track,events});byDestination.set(route.destinationId,list);
 }
 if(!byDestination.size||byDestination.size>64)fail('NATIVE_ROUTE','Expected 1...64 audible MIDI output destinations');
 let merged=[...byDestination].map(([id,tracks])=>({trackId:String(id),sourceTrack:tracks[0].sourceTrack,events:mergeMidiStreams({tracks}),endTick:Math.max(...tracks.map(t=>t.endTick))}));
 let lengthAdjustment=null;if(timingOptions.lengthAdjustmentTicks>0){const adjusted=adjustMidiStreamLengths({...compiled,tracks:merged},{projectPpq:project.ppq,...timingOptions});merged=adjusted.tracks;const {policy,stats,diagnostics}=adjusted.lengthAdjustment;lengthAdjustment={policy,stats,diagnostics};}
 const endTick=options.endTick??Math.max(...merged.map(t=>t.endTick));integer(endTick,startTick+1,Number.MAX_SAFE_INTEGER,'endTick');
 const timeline=compileTempoMap(project.tempoMap,project.ppq),origin=timeline.tickToSeconds(startTick),durationNs=Math.round((timeline.tickToSeconds(endTick)-origin)*1e9);integer(durationNs,1,3_600_000_000_000,'native duration (maximum one hour)');
 const chase=startTick>0?chaseMidiStreams({...compiled,tracks:merged},project,{tick:startTick,options:chaseOptions}):null;
 const warnings=[...(compiled.curveWarnings??[]),...(compiled.modifierWarnings??[]),...(chase?.warnings??[]),...(lengthAdjustment?.diagnostics??[])];
 if(project.clips.some(c=>c.type==='audio'&&!c.mute&&!tracks.get(c.trackId)?.mute))warnings.push({code:'NATIVE_AUDIO_NOT_RENDERED',message:'This native plan outputs MIDI only; audio clips require the future synchronized audio engine.'});
 const events=[];let payload=0,sequence=0,omittedMeta=0;
 for(const [index,stream]of merged.entries()){
  const prefix=chase?.tracks[index].events??[],future=stream.events.filter(e=>e.tick>=startTick&&(e.tick<endTick||e.tick===endTick&&(options.endTick===undefined||e.kind==='noteOff')));
  const paired=new Map();
  for(const event of [...prefix,...future]){
   if(event.rawKind==='meta'){omittedMeta++;continue;}
   // A skipped pre-cursor key must not emit a paired off into a later key. Raw
   // offs still preserve source bytes/order and consume the oldest matching key.
   if(event.kind==='noteOn')paired.set(event.noteKey,{channel:event.channel,pitch:event.pitch});
   if(event.kind==='noteOff'){if(!paired.has(event.noteKey))continue;paired.delete(event.noteKey);}
   if(event.kind==='raw'&&event.status<0xf0){
    const kind=event.status>>4,channel=event.status&15;
    if(kind===8||kind===9&&event.data[1]===0){for(const [key,note]of paired)if(note.channel===channel&&note.pitch===event.data[0]){paired.delete(key);break;}}
    if(kind===11&&(event.data[0]===120||event.data[0]>=123))for(const [key,note]of paired)if(note.channel===channel)paired.delete(key);
   }
   const bytes=[event.status,...event.data];
   if(event.rawKind==='sysex'&&(bytes[0]!==0xf0||bytes.at(-1)!==0xf7||bytes.slice(1,-1).some(b=>b>=128)))fail('NATIVE_SYSEX_STREAM_REQUIRED','Native scheduled output currently requires complete SysEx7 messages; fragmented SMF SysEx must not be silently flattened');
   if(bytes.length>65536||(payload+=bytes.length)>4*1024*1024)fail('NATIVE_PLAN_LIMIT','Native MIDI payload exceeds current backend limits');
   const offsetNs=Math.round((timeline.tickToSeconds(event.tick)-origin)*1e9);
   events.push({offsetNs,destinationId:Number(stream.trackId),bytes,sequence:sequence++});
  }
 }
 if(events.length>200000)fail('NATIVE_PLAN_LIMIT','Native plan exceeds 200000 events');
 events.sort((a,b)=>a.offsetNs-b.offsetNs||a.sequence-b.sequence);for(const event of events)delete event.sequence;
 return {projectId:project.id,revision:project.revision,startTick,endTick,durationNs,destinations:[...byDestination.keys()],events,warnings,omittedMeta,chaseOptions,timingOptions,lengthAdjustment};
}
/** Upload bounded chunks, without emitting MIDI. Starting is a separate explicit action. */
export async function prepareNativePlan(bridge,plan,{jobId=randomUUID(),signal,resetPreferences}={}){
 plan=structuredClone(plan); // Upload one frozen revision even if a caller edits its draft.
 let prepared=false;
 const abort=()=>{if(signal?.aborted)fail('NATIVE_CANCELLED','Native preparation cancelled before playback');};
 try{
  abort();await bridge.request('transport.prepare',{jobId,durationNs:plan.durationNs,eventCount:plan.events.length,destinations:plan.destinations,...(resetPreferences!==undefined?{resetPreferences}:{} )});prepared=true;
  let chunk=[],size=0;
  const flush=async()=>{if(!chunk.length)return;abort();await bridge.request('transport.append',{jobId,events:chunk});chunk=[];size=0;};
  for(const event of plan.events){const bytes=Buffer.byteLength(JSON.stringify(event));if(chunk.length>=1024||size+bytes>300000)await flush();chunk.push(event);size+=bytes;}
  await flush();abort();return {jobId,projectId:plan.projectId,revision:plan.revision,eventCount:plan.events.length,durationNs:plan.durationNs,warnings:plan.warnings};
 }catch(error){if(prepared)try{await bridge.request('transport.discard',{jobId});}catch(discardError){error.cleanupError=discardError.message;}throw error;}
}
