import {spawn} from 'node:child_process';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const ROOT=path.resolve(import.meta.dirname,'..');
const problem=(code,message)=>Object.assign(new Error(message),{code,status:code==='INVALID_REQUEST'||code==='INVALID_PATH'?422:409});
/** Explicit offline Audio Unit helper owner. No plugin code runs before instantiate. */
export function createAudioUnits({helperPath=path.join(ROOT,'.native-build','newdaw-audio-units'),onChange=()=>{}}={}){
 let child=null,input='',events=[],waiters=[],directory=null,previewDirectory=null,queue=Promise.resolve(),closed=false;
 let state={status:'idle',selected:null,instantiated:false,playing:false,instrumentPlaying:false,previewJobId:null,previewRenderJobId:null,availableCount:0,parameters:[],lastRender:null,error:null},processedOutput=null;
 const snapshot=()=>({supported:process.platform==='darwin',integrated:true,offline:true,hasOutput:processedOutput!==null,...structuredClone(state)});
 const publish=()=>onChange(snapshot());
 function next(predicate,timeout=15000){
  const index=events.findIndex(predicate);if(index>=0)return Promise.resolve(events.splice(index,1)[0]);
  return new Promise((resolve,reject)=>{const waiter={predicate,resolve,reject,timer:setTimeout(()=>{waiters.splice(waiters.indexOf(waiter),1);reject(new Error('Audio Unit helper event timeout'));},timeout)};waiters.push(waiter);});
 }
 function accept(event){
  if(event.event==='error')state={...state,error:event.message??event.code};
  if(event.event==='list')state={...state,availableCount:event.availableCount??event.count,status:'ready',error:null};
  if(event.event==='selected'){state={...state,selected:event.component.id,instantiated:false,parameters:[],status:'selected',error:null};}
  if(event.event==='instantiated'){state={...state,selected:event.component.id,instantiated:true,parameters:[],status:'instantiated',error:null};}
  if(event.event==='parameters')state={...state,parameters:event.parameters??[],status:'parameters',error:null};
  if(event.event==='parameterSet')state={...state,parameters:(state.parameters??[]).map(parameter=>parameter.keyPath===event.parameter.keyPath?event.parameter:parameter),status:'parameter-set',error:null};
  if(event.event==='playing')state={...state,playing:true,instrumentPlaying:event.instrument===true,previewJobId:event.jobId,status:'playing',error:null};
  if(['completed','stopped'].includes(event.event)&&event.jobId&&event.jobId===state.previewJobId){state={...state,playing:false,instrumentPlaying:false,previewJobId:event.jobId,status:event.status,error:null};void cleanupPreview();}
  if(event.event==='rendered'){state={...state,lastRender:event,status:'rendered',error:null};}
  if(event.event==='released'){state={...state,instantiated:false,parameters:[],status:'released',error:null};}
  publish();events.push(event);
  for(const waiter of [...waiters])if(waiter.predicate(event)){events.splice(events.indexOf(event),1);waiters.splice(waiters.indexOf(waiter),1);clearTimeout(waiter.timer);waiter.resolve(event);}
 }
 async function open(){
  if(closed)throw problem('AUDIO_UNITS_CLOSED','Audio Unit owner is closed');if(child)return;
  child=spawn(helperPath,[],{stdio:['pipe','pipe','pipe']});
  child.stdout.on('data',bytes=>{input+=bytes.toString();while(input.includes('\n')){const index=input.indexOf('\n'),line=input.slice(0,index);input=input.slice(index+1);try{accept(JSON.parse(line));}catch{accept({event:'error',code:'INVALID_AUDIO_UNIT_JSON',message:'Invalid helper response'});}}});
  child.stderr.on('data',bytes=>{const message=bytes.toString().trim();if(message)accept({event:'error',code:'AUDIO_UNIT_STDERR',message});});
  child.on('error',error=>{for(const waiter of waiters.splice(0)){clearTimeout(waiter.timer);waiter.reject(error);}state={...state,status:'failed',error:error.message};publish();});
  child.on('exit',code=>{if(child&&code!==0){state={...state,playing:false,status:'failed',error:`Audio Unit helper exited ${code}`};publish();}child=null;void cleanupPreview();});
  await next(event=>event.event==='ready');
 }
 function send(command,fields={},predicate=event=>event.event===command){
  const run=queue.then(async()=>{
   await open();child.stdin.write(JSON.stringify({command,...fields})+'\n');
   const event=await next(event=>predicate(event)||event.event==='error');
   if(event.event==='error')throw problem(event.code,event.message??'Audio Unit helper error');
   return event;
  });queue=run.catch(()=>{});return run;
 }
 async function cleanup(){if(directory){const old=directory;directory=null;await fs.rm(old,{recursive:true,force:true}).catch(()=>{});}}
 async function cleanupPreview(){if(previewDirectory){const old=previewDirectory;previewDirectory=null;await fs.rm(old,{recursive:true,force:true}).catch(()=>{});}}
 return{
  snapshot,
  list:(limit=64)=>send('list',{limit},event=>event.event==='list'),
  select:id=>send('select',{id},event=>event.event==='selected'),
  instantiate:id=>send('instantiate',{id,offline:true},event=>event.event==='instantiated'),
  parameters:()=>send('parameters',{},event=>event.event==='parameters'),
  setParameter:(keyPath,value)=>send('setParameter',{keyPath,value},event=>event.event==='parameterSet'),
  async play({bytes,renderJobId,revision,documentId,allowDefaultOutput}){
   if(!allowDefaultOutput)throw problem('OUTPUT_REQUIRED','Audio Unit preview requires explicit default-output permission');
   if(state.playing)throw problem('AUDIO_UNIT_PLAYING','Stop the current Audio Unit preview first');
   await cleanupPreview();previewDirectory=await fs.mkdtemp(path.join(os.tmpdir(),'newdaw-audio-unit-preview-'));const file=path.join(previewDirectory,'preview.wav');await fs.writeFile(file,Buffer.from(bytes));
   try{
    const event=await send('play',{path:file,allowDefaultOutput:true},event=>event.event==='playing');
    state={...state,previewRenderJobId:renderJobId,previewRevision:revision,previewDocumentId:documentId};publish();return {...event,renderJobId,revision,documentId};
   }catch(error){await cleanupPreview();throw error;}
  },
  async playMidi({notes,durationFrames,sampleRate,allowDefaultOutput,outputGain,revision,documentId}){
   if(state.playing)throw problem('AUDIO_UNIT_PLAYING','Stop the current Audio Unit preview first');
   const event=await send('playMidi',{sampleRate,durationFrames,notes,allowDefaultOutput,outputGain},event=>event.event==='playing');
   state={...state,previewRenderJobId:null,previewRevision:revision,previewDocumentId:documentId};publish();return event;
  },
  async stop(jobId){
   if(!state.playing)return snapshot();if(jobId!==state.previewJobId)throw problem('AUDIO_UNIT_PREVIEW_CONFLICT','Audio Unit preview changed; fetch its current job ID before Stop');
   return send('stop',{},event=>event.event==='stopped');
  },
  async render({bytes,renderJobId,revision,documentId,sourceStartSample=null}){
   await cleanup();directory=await fs.mkdtemp(path.join(os.tmpdir(),'newdaw-audio-unit-render-'));const file=path.join(directory,'input.wav');await fs.writeFile(file,Buffer.from(bytes));
   try{
    const event=await send('render',{path:file,offline:true},event=>event.event==='rendered');
    if(!event.outputPath)throw problem('AUDIO_UNIT_OUTPUT_MISSING','Audio Unit helper returned no WAV output');
    const outputBytes=await fs.readFile(event.outputPath);
    const result={...event,outputUrl:'/api/audio-units/output',...(Number.isSafeInteger(sourceStartSample)&&sourceStartSample>=0?{sourceStartSample}:{})};
    processedOutput={bytes:outputBytes,renderJobId,revision,documentId,metadata:{...result}};
    state={...state,lastRender:result,status:'rendered',error:null};publish();
    return result;
   }finally{await cleanup();}
  },
  async renderMidi({notes,durationFrames,sampleRate,channels,sourceStartSample,revision,documentId}){
   await cleanup();directory=await fs.mkdtemp(path.join(os.tmpdir(),'newdaw-audio-unit-midi-'));const outputPath=path.join(directory,'instrument.wav');
   try{
    const event=await send('renderMidi',{outputPath,sampleRate,channels,durationFrames,notes,offline:true},event=>event.event==='renderedMidi');
    if(!event.outputPath)throw problem('AUDIO_UNIT_OUTPUT_MISSING','Audio Unit instrument returned no WAV output');
    const outputBytes=await fs.readFile(event.outputPath),result={...event,outputUrl:'/api/audio-units/output',...(Number.isSafeInteger(sourceStartSample)&&sourceStartSample>=0?{sourceStartSample}:{})};
    processedOutput={bytes:outputBytes,renderJobId:null,revision,documentId,metadata:{...result}};state={...state,lastRender:result,status:'rendered-midi',error:null};publish();return result;
   }finally{await cleanup();}
  },
  output(){return processedOutput;},
  async release(){if(!child){state={...state,instantiated:false,playing:false,instrumentPlaying:false,parameters:[],status:'released',error:null};publish();return {event:'released',instantiated:false};}const event=await send('release',{},event=>event.event==='released');return event;},
  async reset(){
   if(!child&&state.status==='idle'&&!state.selected&&!state.lastRender&&!state.error&&!directory&&!previewDirectory)return;
   if(state.instantiated)await send('release',{},event=>event.event==='released');
   state={status:'idle',selected:null,instantiated:false,playing:false,instrumentPlaying:false,previewJobId:null,previewRenderJobId:null,availableCount:0,parameters:[],lastRender:null,error:null};processedOutput=null;publish();await Promise.all([cleanup(),cleanupPreview()]);
  },
  async close(){
   if(closed)return;closed=true;if(state.instantiated)await send('release',{},event=>event.event==='released').catch(()=>{});
   if(child){const exiting=new Promise(resolve=>child.once('exit',resolve));child.stdin.write(JSON.stringify({command:'quit'})+'\n');await exiting;}child=null;
   for(const waiter of waiters.splice(0)){clearTimeout(waiter.timer);waiter.reject(new Error('Audio Unit owner closed'));}processedOutput=null;await Promise.all([cleanup(),cleanupPreview()]);
  },
 };
}
