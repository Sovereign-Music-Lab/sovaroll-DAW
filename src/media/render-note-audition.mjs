import {finite,requireValue} from './common.mjs';
import {compileExactTempoMap} from './exact-tempo.mjs';
import {planNoteAudition} from './note-audition.mjs';
import {renderProject} from './render.mjs';
/** Rebase compiled output, not source notes: modifiers have already run once.
 * Chase messages precede source messages at zero, preserving protocol order. */
export function renderNoteAudition(project,args,{durationSeconds=.35}={}){
 finite(durationSeconds,.05,2,'Audition duration');const plan=planNoteAudition(project,args);
 if(plan.silent)return {silent:true,revision:project.revision,sampleRate:project.sampleRate,channels:[new Float32Array(0),new Float32Array(0)],warnings:[plan.reason]};
 const start=plan.startTick,before=plan.tempoMap.filter(p=>p.tick<=start).at(-1),tempoMap=[{tick:0,bpm:before.bpm},...plan.tempoMap.filter(p=>p.tick>start).map(p=>({tick:p.tick-start,bpm:p.bpm}))];
 const time=compileExactTempoMap(tempoMap,plan.ppq),end=Math.max(1,time.tickAtSeconds({numerator:String(Math.round(durationSeconds*1000000)),denominator:'1000000'},'ceil'));
 const clip={id:'audition-clip',type:'midi',trackId:'audition-track',startTick:0,lengthTicks:end,notes:[],events:[]},notes=new Map();let order=0;
 for(const e of plan.events){const tick=e.tick-start;if(tick<0||tick>end||(e.kind==='noteOn'&&tick===end))continue;requireValue(++order<=200000,'AUDITION_LIMIT','Audition exceeds its event budget.');
  if(e.kind==='noteOn'){const note={id:'audition-note-'+order,pitch:e.pitch,velocity:e.velocity,channel:e.channel,startTick:tick,durationTicks:end-tick,releaseVelocity:e.releaseVelocity??0,noteOffEncoding:e.noteOffEncoding??'noteOff',onOrder:order};clip.notes.push(note);notes.set(e.noteKey,note);}
  else if(e.kind==='noteOff'){const note=notes.get(e.noteKey);if(note){note.durationTicks=tick-note.startTick;note.offOrder=order;note.releaseVelocity=e.data[1];note.noteOffEncoding=e.status>>4===9?'zeroVelocityNoteOn':'noteOff';}}
  else clip.events.push({id:'audition-event-'+order,tick,order,kind:e.rawKind,status:e.status,data:e.data.slice(),...(e.rawKind==='meta'?{metaType:e.metaType}:{})});
 }
 for(const note of clip.notes)if(note.offOrder===undefined)note.offOrder=++order;
 const isolated={panLaw:plan.mixer.panLaw,ppq:plan.ppq,sampleRate:plan.sampleRate,tempoMap,masterGainDb:plan.mixer.masterGainDb,tracks:[{...(plan.mixer.pre?{pre:plan.mixer.pre}:{}),...(plan.mixer.eq?{eq:plan.mixer.eq}:{}),...(plan.mixer.delay?{delay:plan.mixer.delay}:{}),id:'audition-track',type:'midi',instrument:plan.mixer.instrument,gainDb:plan.mixer.gainDb,pan:plan.mixer.pan,mute:false,solo:false}],clips:[clip],assets:[]};
 const result=renderProject(isolated,new Map(),{durationSeconds,tailSeconds:0});
 // An audition is intentionally time-bounded. Fade its last 5ms to silence.
 for(const channel of result.channels){const n=Math.min(channel.length,Math.ceil(plan.sampleRate*.005));for(let i=0;i<n;i++)channel[channel.length-n+i]=i===n-1?0:channel[channel.length-n+i]*(n-1-i)/Math.max(1,n-1);}
 return {...result,silent:false,revision:project.revision,sourceStartTick:start,warnings:[...plan.warnings,...result.warnings]};
}
