import {spawn} from 'node:child_process';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const ROOT=path.resolve(import.meta.dirname,'..');
const problem=(code,message)=>Object.assign(new Error(message),{code,status:code==='INVALID_REQUEST'||code==='INVALID_PATH'?422:409});
/** Explicit offline Audio Unit helper owner. No plugin code runs before instantiate. */
export function createAudioUnits({helperPath=path.join(ROOT,'.native-build','newdaw-audio-units'),onChange=()=>{}}={}){
 let child=null,input='',events=[],waiters=[],directory=null,queue=Promise.resolve(),closed=false;
 let state={status:'idle',selected:null,instantiated:false,availableCount:0,lastRender:null,error:null};
 const snapshot=()=>({supported:process.platform==='darwin',integrated:true,offline:true,...structuredClone(state)});
 const publish=()=>onChange(snapshot());
 function next(predicate,timeout=15000){
  const index=events.findIndex(predicate);if(index>=0)return Promise.resolve(events.splice(index,1)[0]);
  return new Promise((resolve,reject)=>{const waiter={predicate,resolve,reject,timer:setTimeout(()=>{waiters.splice(waiters.indexOf(waiter),1);reject(new Error('Audio Unit helper event timeout'));},timeout)};waiters.push(waiter);});
 }
 function accept(event){
  if(event.event==='error')state={...state,error:event.message??event.code};
  if(event.event==='list')state={...state,availableCount:event.availableCount??event.count,status:'ready',error:null};
  if(event.event==='selected'){state={...state,selected:event.component.id,instantiated:false,status:'selected',error:null};}
  if(event.event==='instantiated'){state={...state,selected:event.component.id,instantiated:true,status:'instantiated',error:null};}
  if(event.event==='rendered'){state={...state,lastRender:event,status:'rendered',error:null};}
  if(event.event==='released'){state={...state,instantiated:false,status:'released',error:null};}
  publish();events.push(event);
  for(const waiter of [...waiters])if(waiter.predicate(event)){events.splice(events.indexOf(event),1);waiters.splice(waiters.indexOf(waiter),1);clearTimeout(waiter.timer);waiter.resolve(event);}
 }
 async function open(){
  if(closed)throw problem('AUDIO_UNITS_CLOSED','Audio Unit owner is closed');if(child)return;
  child=spawn(helperPath,[],{stdio:['pipe','pipe','pipe']});
  child.stdout.on('data',bytes=>{input+=bytes.toString();while(input.includes('\n')){const index=input.indexOf('\n'),line=input.slice(0,index);input=input.slice(index+1);try{accept(JSON.parse(line));}catch{accept({event:'error',code:'INVALID_AUDIO_UNIT_JSON',message:'Invalid helper response'});}}});
  child.stderr.on('data',bytes=>{const message=bytes.toString().trim();if(message)accept({event:'error',code:'AUDIO_UNIT_STDERR',message});});
  child.on('error',error=>{for(const waiter of waiters.splice(0)){clearTimeout(waiter.timer);waiter.reject(error);}state={...state,status:'failed',error:error.message};publish();});
  child.on('exit',code=>{if(child&&code!==0){state={...state,status:'failed',error:`Audio Unit helper exited ${code}`};publish();}child=null;});
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
 return{
  snapshot,
  list:(limit=64)=>send('list',{limit},event=>event.event==='list'),
  select:id=>send('select',{id},event=>event.event==='selected'),
  instantiate:id=>send('instantiate',{id,offline:true},event=>event.event==='instantiated'),
  async render({bytes,renderJobId,revision,documentId}){
   await cleanup();directory=await fs.mkdtemp(path.join(os.tmpdir(),'newdaw-audio-unit-render-'));const file=path.join(directory,'input.wav');await fs.writeFile(file,Buffer.from(bytes));
   try{return await send('render',{path:file,offline:true},event=>event.event==='rendered');}finally{await cleanup();}
  },
  async release(){if(!child){state={...state,instantiated:false,status:'released',error:null};publish();return {event:'released',instantiated:false};}const event=await send('release',{},event=>event.event==='released');return event;},
  async reset(){
   if(!child&&state.status==='idle'&&!state.selected&&!state.lastRender&&!state.error&&!directory)return;
   if(state.instantiated)await send('release',{},event=>event.event==='released');
   state={status:'idle',selected:null,instantiated:false,availableCount:0,lastRender:null,error:null};publish();await cleanup();
  },
  async close(){
   if(closed)return;closed=true;if(state.instantiated)await send('release',{},event=>event.event==='released').catch(()=>{});
   if(child){const exiting=new Promise(resolve=>child.once('exit',resolve));child.stdin.write(JSON.stringify({command:'quit'})+'\n');await exiting;}child=null;
   for(const waiter of waiters.splice(0)){clearTimeout(waiter.timer);waiter.reject(new Error('Audio Unit owner closed'));}await cleanup();
  },
 };
}
