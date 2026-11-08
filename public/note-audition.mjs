/** Audition owns temporary sound only, never a document edit or transport.
 * render receives an immutable request copy and AbortSignal; play returns an
 * idempotent stop callback. Permission is checked again after asynchronous work.
 */
export function createNoteAudition({render,play,allowed=()=>true,onError=()=>{}}){
 let generation=0,pending=null,stopSound=null,disposed=false;
 function cancel(){generation++;pending?.abort();pending=null;const stop=stopSound;stopSound=null;stop?.();}
 return Object.freeze({
  cancel,
  dispose(){cancel();disposed=true;},
  async request(input){
   cancel();if(disposed||!allowed())return false;
   const token=generation,controller=new AbortController();pending=controller;
   const valid=()=>!disposed&&token===generation&&!controller.signal.aborted&&allowed();
   try{
    const rendered=await render(structuredClone(input),{signal:controller.signal});
    if(!valid())return false;
    const stop=await play(rendered,{signal:controller.signal});
    if(typeof stop!=='function')throw new Error('Audition player must return a stop callback.');
    if(!valid()){stop();return false;}
    stopSound=stop;return true;
   }catch(error){if(valid()&&error?.name!=='AbortError')onError(error);return false;}
   finally{if(token===generation)pending=null;}
  }
 });
}
