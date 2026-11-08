import {audibleTrackIds} from './track-audibility.mjs';
import {integer,requireValue} from './common.mjs';
import {compileMidiStreams} from './midi-stream.mjs';
import {chaseMidiStreams} from './midi-chase.mjs';
/** Detached audition source. Compile the complete track before filtering notes,
 * so controller protocols, modifier state and source ordering stay meaningful.
 * Output remains at original ticks; a renderer must rebase time and state together.
 */
export function planNoteAudition(project,{clipId,field='velocity',updates}={}){
 requireValue(['velocity','releaseVelocity'].includes(field),'INVALID_AUDITION','Unsupported note attribute.');
 requireValue(Array.isArray(updates)&&updates.length>0&&updates.length<=32,'INVALID_AUDITION','Audition requires 1..32 existing notes.');
 const snapshot=structuredClone(project),clip=snapshot.clips.find(c=>c.id===clipId);
 requireValue(clip?.type==='midi','INVALID_AUDITION','Audition requires an existing MIDI clip.');
 const ids=new Set(),byId=new Map(clip.notes.map(n=>[n.id,n]));
 for(const u of updates){requireValue(u&&Object.keys(u).every(k=>['noteId','value'].includes(k))&&!ids.has(u.noteId)&&byId.has(u.noteId),'INVALID_AUDITION','Select distinct existing note IDs.');integer(u.value,field==='velocity'?1:0,127,'Audition value');ids.add(u.noteId);const n=byId.get(u.noteId);n[field]=u.value;if(field==='releaseVelocity'&&u.value>0&&n.noteOffEncoding==='zeroVelocityNoteOn')n.noteOffEncoding='noteOff';}
 const track=snapshot.tracks.find(t=>t.id===clip.trackId),audible=!clip.mute&&audibleTrackIds(snapshot).has(track.id);
 const compiled=compileMidiStreams(snapshot,{trackIds:[track.id],includeMutedClips:false}),stream=compiled.tracks[0];
 const selected=audible?stream.events.filter(e=>e.kind==='noteOn'&&e.clipId===clipId&&ids.has(e.noteId)):[];
 if(!selected.length)return {silent:true,reason:'No audible selected notes',events:[],revision:project.revision};
 const startTick=Math.min(...selected.map(e=>e.tick)),keys=new Set(selected.map(e=>e.noteKey));
 const chase=chaseMidiStreams(compiled,snapshot,{tick:startTick,options:{notes:false}});
 const events=[...chase.tracks[0].events,...stream.events.filter(e=>e.tick>=startTick&&(e.kind==='raw'||keys.has(e.noteKey)))];
 return {silent:false,revision:project.revision,clipId,trackId:track.id,startTick,events,tempoMap:structuredClone(project.tempoMap),ppq:project.ppq,sampleRate:project.sampleRate,mixer:{...(track.pre?{pre:structuredClone(track.pre)}:{}),...(track.eq?{eq:structuredClone(track.eq)}:{}),...(track.delay?{delay:structuredClone(track.delay)}:{}),instrument:track.instrument??'sine',gainDb:track.gainDb,pan:track.pan,masterGainDb:project.masterGainDb,...(project.panLaw!==undefined?{panLaw:project.panLaw}:{})},warnings:[...(compiled.modifierWarnings??[]),...(chase.warnings??[])]};
}
