import {finite,integer,requireValue} from './common.mjs';
import {resolveTimeDisplay} from './time-display.mjs';
import {compileExactTempoMap} from './exact-tempo.mjs';
const MAX=Number.MAX_SAFE_INTEGER,abs=n=>n<0n?-n:n;
function gcd(a,b){a=abs(a);while(b)[a,b]=[b,a%b];return a;}
function ratio(n,d=1n){if(d<0n){n=-n;d=-d;}const g=gcd(n,d);return {n:n/g,d:d/g};}
const add=(a,b)=>ratio(a.n*b.d+b.n*a.d,a.d*b.d),sub=(a,b)=>ratio(a.n*b.d-b.n*a.d,a.d*b.d),mul=(a,b)=>ratio(a.n*b.n,a.d*b.d),div=(a,b)=>ratio(a.n*b.d,a.d*b.n);
const from=r=>ratio(BigInt(r.numerator),BigInt(r.denominator));
const floor=r=>{const q=r.n/r.d;return r.n<0n&&r.n%r.d?q-1n:q;},nearest=r=>Number(floor(add(r,ratio(1n,2n))));
function decimal(value){const m=/^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(String(value)),digits=m[2]??'',power=Number(m[3]??0)-digits.length,n=BigInt(m[1]+digits);return power>=0?ratio(n*10n**BigInt(power)):ratio(n,10n**BigInt(-power));}
const keys=(o,allowed)=>requireValue(o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).every(k=>allowed.includes(k)),'INVALID_NOTE_PAINT','Unexpected note Paint option.');

/** One bounded, frozen freehand edit of existing note values. Source ticks and
 * values may be fractional pointer samples. Interpolate in the visible beat or
 * elapsed-time domain, evaluate only original note onsets, and round values once.
 * Each later traversal replaces the earlier value at a visited onset. */
export function compileNotePaint(project,options){
 keys(options,['clipId','field','channel','selectedNoteIds','start','maxNotes','maxWork','maxSamples']);
 const {clipId,field,channel='all',selectedNoteIds=[],start,maxNotes=200000,maxWork=1000000,maxSamples=200000}=options;
 const clip=project.clips.find(c=>c.id===clipId);requireValue(clip?.type==='midi','INVALID_NOTE_PAINT','An existing MIDI clip is required.');
 const length=integer(clip.lengthTicks,1,MAX,'Clip length'),origin=integer(clip.startTick,0,MAX-length,'Clip start');
 requireValue(['velocity','releaseVelocity'].includes(field),'INVALID_NOTE_PAINT','Choose velocity or releaseVelocity.');
 requireValue(channel==='all'||Number.isSafeInteger(channel)&&channel>=0&&channel<=15,'INVALID_NOTE_PAINT','Choose all channels or 0..15.');
 requireValue(Array.isArray(selectedNoteIds)&&selectedNoteIds.length<=200000&&selectedNoteIds.every(id=>typeof id==='string')&&new Set(selectedNoteIds).size===selectedNoteIds.length,'INVALID_NOTE_SELECTION','Provide distinct existing note IDs.');
 const selection=new Set(selectedNoteIds),existing=new Set(clip.notes.map(n=>n.id));for(const id of selection)requireValue(existing.has(id),'NOT_FOUND',`Note not found: ${id}.`);
 integer(maxNotes,1,200000,'Note Paint note budget');integer(maxWork,1,1000000,'Note Paint work budget');integer(maxSamples,1,200000,'Note Paint sample budget');
 const minimum=field==='velocity'?1:0,notes=clip.notes.filter(n=>(channel==='all'||n.channel===channel)&&(!selection.size||selection.has(n.id))).map(n=>({...n})).sort((a,b)=>a.startTick-b.startTick),mode=resolveTimeDisplay(project.timeDisplay).pianoMode;
 const before=project.tempoMap.filter(p=>p.tick<=origin).at(-1),tempo=mode==='time-linear'?compileExactTempoMap([{tick:0,bpm:before.bpm},...project.tempoMap.filter(p=>p.tick>origin).map(p=>({tick:p.tick-origin,bpm:p.bpm}))],project.ppq):null;
 function coordinate(tick){if(!tempo)return decimal(tick);const whole=Math.floor(tick),base=from(tempo.secondsAt(whole));return whole===tick?base:add(base,mul(sub(decimal(tick),ratio(BigInt(whole))),from(tempo.secondsBetween(whole,whole+1))));}
 function point(p){keys(p,['tick','value']);finite(p.tick,0,length,'Note Paint pointer tick');finite(p.value,minimum,127,'Note Paint pointer value');return {tick:p.tick,value:p.value,coordinate:coordinate(p.tick),fraction:decimal(p.value)};}
 const bound=(tick,after)=>{let lo=0,hi=notes.length;while(lo<hi){const m=Math.floor((lo+hi)/2);if(notes[m].startTick<tick||after&&notes[m].startTick===tick)lo=m+1;else hi=m;}return lo;};
 let previous=null,work=0,failed=false,closed=false;const path=[],touched=new Map();
 function open(){requireValue(!failed&&!closed,failed?'NOTE_PAINT_ABORTED':'NOTE_PAINT_CLOSED','Discard this Paint gesture before starting another.');}
 function push(sample){open();try{
  const next=point(sample),prior=previous??next;requireValue(path.length<maxSamples,'NOTE_PAINT_LIMIT','Note Paint exceeds its pointer sample budget.');
  const a=bound(Math.min(prior.tick,next.tick),false),b=bound(Math.max(prior.tick,next.tick),true),count=b-a;
  requireValue(work+count<=maxWork,'NOTE_PAINT_LIMIT','Note Paint exceeds its evaluation work budget.');
  const changes=[];let added=0;
  for(let i=a;i<b;i++){const note=notes[i],value=nearest(prior.tick===next.tick?next.fraction:add(prior.fraction,mul(sub(next.fraction,prior.fraction),div(sub(coordinate(note.startTick),prior.coordinate),sub(next.coordinate,prior.coordinate)))));changes.push({note,value});if(!touched.has(note.id))added++;}
  requireValue(touched.size+added<=maxNotes,'NOTE_PAINT_LIMIT','Note Paint exceeds its distinct-note budget.');
  for(const item of changes)touched.set(item.note.id,item);work+=count;path.push({tick:next.tick,value:next.value});previous=next;
  return {sampleCount:path.length,matchedNoteCount:touched.size,work};
 }catch(error){failed=true;throw error;}}
 function snapshot(){const points=[],updates=[];for(const {note,value} of touched.values()){points.push({noteId:note.id,tick:note.startTick,value});if(value!==(note[field]??0))updates.push({noteId:note.id,value,...(field==='releaseVelocity'&&value!==0&&note.noteOffEncoding==='zeroVelocityNoteOn'?{noteOffEncoding:'noteOff'}:{})});}return {field,channel,mode,points,updates,sampleCount:path.length,work,failed,closed};}
 push(start);
 return Object.freeze({push,snapshot,finish(){open();closed=true;return {arguments:{clipId,field,channel,selectedNoteIds:[...selection],path:structuredClone(path)},plan:snapshot()};}});
}

export function planNotePaint(project,options){
 keys(options,['clipId','field','channel','selectedNoteIds','path']);const {path,...target}=options;
 requireValue(Array.isArray(path)&&path.length>=1&&path.length<=200000,'INVALID_NOTE_PAINT','Provide 1..200000 pointer samples.');
 const paint=compileNotePaint(project,{...target,start:path[0]});for(const p of path.slice(1))paint.push(p);return paint.finish().plan;
}
