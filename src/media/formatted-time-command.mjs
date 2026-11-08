import {compileTimeEditResolver} from './time-edit-resolver.mjs';

const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const plain=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
const tick=n=>{if(!Number.isSafeInteger(n)||n<0)fail('INVALID_TIME_EDIT','Source anchors must be nonnegative safe ticks');return n;};
const add=(a,b)=>{tick(a);tick(b);if(BigInt(a)+BigInt(b)>BigInt(Number.MAX_SAFE_INTEGER))fail('EXACT_TIME_OUT_OF_RANGE','Absolute source anchor exceeds safe ticks');return a+b;};

/** One focused edit; no arbitrary batch pre-resolution against stale anchors.
 * The returned command goes through the normal atomic engine/save/Undo barrier.
 * Omitted fields are never reconstructed from rounded display readouts.
 */
export function resolveFormattedTimeCommand(project,command,args,times,options={}) {
  if(!['clip.update','midi.notes.update'].includes(command))fail('UNSUPPORTED_FORMATTED_TIME_COMMAND','Formatted editing currently supports MIDI clip.update and midi.notes.update');
  if(!plain(args)||!plain(times)||!plain(options))fail('INVALID_TIME_EDIT','Use argument, formatted-time and option objects');
  if(Object.keys(options).some(k=>!['scope','rounding','displayPpq','controllers'].includes(k)))fail('INVALID_TIME_EDIT','Unknown formatted edit option');
  const noteEdit=command==='midi.notes.update',lengthKey=noteEdit?'durationTicks':'lengthTicks';
  if(Object.keys(times).some(k=>!['startTick',lengthKey].includes(k)))fail('INVALID_TIME_EDIT','Unsupported formatted time field');
  for(const k of Object.keys(times))if(Object.hasOwn(args,k))fail('AMBIGUOUS_TIME_UNITS',`Remove source ${k} before supplying formatted time`);
  const {scope=noteEdit?'piano':'timeline',rounding='exact',displayPpq=480,controllers='none'}=options;
  if(!['primary','timeline','piano'].includes(scope)||!['exact','floor','ceil','nearest'].includes(rounding)||!['none','noteRange','extended'].includes(controllers)||!noteEdit&&controllers!=='none')fail('INVALID_TIME_EDIT','Invalid time scope, rounding or controller policy');
  const clip=project.clips.find(c=>c.id===args.clipId);
  if(!clip||clip.type!=='midi')fail('INVALID_TIME_EDIT','Select an existing MIDI clip');
  const note=noteEdit?clip.notes.find(n=>n.id===args.noteId):null;
  if(noteEdit&&!note)fail('INVALID_TIME_EDIT','Select an existing note');
  const resolver=compileTimeEditResolver(project,{displayPpq}),out=structuredClone(args),conversions=[];
  const origin=noteEdit?clip.startTick:0,stored=note??clip;
  if(Object.hasOwn(times,'startTick')){
    const result=resolver.position(times.startTick,{scope,originTick:origin,rounding});
    out.startTick=result.tick-origin;conversions.push({field:'startTick',...result,storedTick:out.startTick});
  }
  const absoluteStart=add(origin,Object.hasOwn(out,'startTick')?tick(out.startTick):stored.startTick);
  if(Object.hasOwn(times,lengthKey)){
    const result=resolver.duration(times[lengthKey],{scope,startTick:absoluteStart,rounding});
    out[lengthKey]=result.durationTicks;conversions.push({field:lengthKey,...result,storedTick:out[lengthKey]});
  }
  // Follow controllers using the old note range, then apply the new anchored length.
  // Both steps are validated and durably committed as one engine transaction.
  if(noteEdit&&controllers!=='none'&&((out.startTick??note.startTick)!==note.startTick||(out.pitch??note.pitch)!==note.pitch)){
    const deltaTick=(out.startTick??note.startTick)-note.startTick,deltaPitch=(out.pitch??note.pitch)-note.pitch;
    delete out.startTick;delete out.pitch;
    return {command:'batch',arguments:{commands:[{command:'midi.notes.move',arguments:{clipId:clip.id,noteIds:[note.id],deltaTick,deltaPitch,controllers,...(controllers==='extended'?{anchorNoteId:note.id}:{})}},{command,arguments:out}]},conversions,scope,rounding};
  }
  return {command,arguments:out,conversions,scope,rounding};
}
