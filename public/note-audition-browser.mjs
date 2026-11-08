import {createNoteAudition} from './note-audition.mjs';
/** Temporary browser audio. The caller owns edit/transport permission. */
export function createBrowserNoteAudition({getContext,allowed,onError,fetchAudio=fetch,makeAudioContext=()=>new AudioContext(),delayMs=100}){
 let context=null,timer=null,latest=null,disposed=false,requestSerial=0;
 const identity=()=>{const c=getContext();return JSON.stringify([c.documentId,c.project?.id,c.project?.revision,c.selectedClip,c.selectedNote,[...(c.selectedNoteIds??[])].sort()]);};
 const player=createNoteAudition({allowed:()=>!disposed&&allowed(),onError,
  render:async(input,{signal})=>{
   const current=()=>!signal.aborted&&input.serial===requestSerial&&input.identity===identity();
   try{
   const response=await fetchAudio('/api/midi/audition',{method:'POST',signal,headers:{'Content-Type':'application/json','X-Newdaw-Document':input.documentId},body:JSON.stringify(input.body)});
   if(!current())return null;
   if(!response.ok){const error=await response.json();throw new Error(error.errors?.[0]?.message??'노트 미리 듣기 실패');}
   if(response.headers.get('content-type')?.includes('application/json'))return null;
   const bytes=await response.arrayBuffer();if(!current())return null;
   const buffer=await context.decodeAudioData(bytes);return current()?{buffer,identity:input.identity,serial:input.serial}:null;
   }catch(error){if(!current())return null;throw error;}
  },
  play:async(rendered,{signal})=>{
   if(!rendered||rendered.serial!==requestSerial||signal.aborted||rendered.identity!==identity()||!allowed())return ()=>{};
   const source=context.createBufferSource();source.buffer=rendered.buffer;source.connect(context.destination);
   let stopped=false;const stop=()=>{if(stopped)return;stopped=true;try{source.stop();}catch{}source.disconnect();};source.onended=stop;source.start();return stop;
  }
 });
 function cancel(){requestSerial++;if(timer!==null)clearTimeout(timer);timer=null;latest=null;player.cancel();}
 return {cancel,
  unlock(){if(disposed||!allowed())return;try{context??=makeAudioContext();void context.resume().catch(onError);}catch(error){onError(error);}},
  request({clipId,field,updates}){
   if(disposed||!allowed()||!context||!updates.length)return;
   const c=getContext();latest={serial:++requestSerial,identity:identity(),documentId:c.documentId,body:{expectedRevision:c.project.revision,clipId,field,updates:structuredClone(updates)}};
   if(timer!==null)return;
   timer=setTimeout(()=>{timer=null;const input=latest;latest=null;if(input.identity===identity())void player.request(input);},delayMs);
  },
  dispose(){cancel();disposed=true;player.dispose();void context?.close();}
 };
}
