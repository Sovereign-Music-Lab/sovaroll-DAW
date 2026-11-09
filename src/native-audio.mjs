import {spawn} from 'node:child_process';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
const problem=(code,message,status=409)=>Object.assign(new Error(message),{code,status});
const ROOT=path.resolve(import.meta.dirname,'..');
/** Own one native preview process; rendered jobs remain server-owned, never browser paths. */
export function createNativeAudio({helperPath=path.join(ROOT,'.native-build','newdaw-audio'),offline=false,onChange=()=>{}}={}){
 let child=null,ready=null,input='',events=[],waiters=[],directory=null,current=null,generation=0,closed=false;
 const failure=(code,message)=>problem(code,message,code==='OUTPUT_REQUIRED'?422:409);
 const publish=()=>onChange(snapshot());
 function snapshot(){return {supported:process.platform==='darwin',integrated:true,offline,status:current?.status??'idle',jobId:current?.jobId??null,renderJobId:current?.renderJobId??null,revision:current?.revision??null,documentId:current?.documentId??null,reason:current?.reason??null,startAtUptimeNs:current?.startAtUptimeNs?.toString()??null,error:current?.error??null};}
 function resolveWaiters(event){
  if(current&&event.event==='playing'&&!current.helperId)current.helperId=event.jobId;
  if(current&&current.helperId&&event.jobId===current.helperId&&['completed','stopped'].includes(event.event)){
   current={...current,status:event.status,error:null};publish();void cleanup();
  }else if(current&&current.helperId&&event.jobId===current.helperId&&event.event==='error'){
   current={...current,status:'failed',error:event.message};publish();void cleanup();
  }
  events.push(event);
  for(const waiter of [...waiters])if(waiter.predicate(event)){events.splice(events.indexOf(event),1);waiters.splice(waiters.indexOf(waiter),1);clearTimeout(waiter.timer);waiter.resolve(event);}
 }
 function next(predicate,timeout=5000){
  const index=events.findIndex(predicate);if(index>=0)return Promise.resolve(events.splice(index,1)[0]);
  return new Promise((resolve,reject)=>{const waiter={predicate,resolve,reject,timer:setTimeout(()=>{waiters.splice(waiters.indexOf(waiter),1);reject(new Error('Native audio helper event timeout'));},timeout)};waiters.push(waiter);});
 }
 async function open(){
  if(closed)throw failure('NATIVE_AUDIO_CLOSED','Native audio owner is closed');
  if(child)return;
  const helper=spawn(helperPath,[],{stdio:['pipe','pipe','pipe']});
  child=helper;
  helper.stdout.on('data',bytes=>{
   input+=bytes.toString();
   while(input.includes('\n')){const index=input.indexOf('\n'),line=input.slice(0,index);input=input.slice(index+1);try{resolveWaiters(JSON.parse(line));}catch{resolveWaiters({event:'error',code:'INVALID_NATIVE_AUDIO_JSON',message:'Invalid helper response'});}}
  });
  helper.stderr.on('data',bytes=>{const message=bytes.toString().trim();if(message)resolveWaiters({event:'error',code:'NATIVE_AUDIO_STDERR',message});});
  helper.on('error',error=>{for(const waiter of waiters.splice(0)){clearTimeout(waiter.timer);waiter.reject(error);}if(current){current={...current,status:'failed',error:error.message};publish();}});
  helper.on('exit',code=>{if(child===helper)child=null;if(current&&['playing','stopping'].includes(current.status)){current={...current,status:code===0?'stopped':'failed',error:code===0?null:`Native audio helper exited ${code}`};publish();}});
  await next(event=>event.event==='ready');
 }
 async function cleanup(){
  generation++;if(directory){const old=directory;directory=null;await fs.rm(old,{recursive:true,force:true}).catch(()=>{});}
 }
 async function stop(jobId,{reason='stop'}={}={}){
  if(!current||['completed','stopped','failed'].includes(current.status))return snapshot();
  if(jobId!==current.jobId)throw failure('NATIVE_AUDIO_JOB_CONFLICT','Native audio playback changed; fetch its current job ID before Stop');
  current={...current,status:'stopping',reason};publish();
  try{if(child)child.stdin.write(JSON.stringify({command:'stop'})+'\n');current={...current,status:'stopped',reason};publish();}
  catch(error){current={...current,status:'failed',error:error.message};publish();throw error;}
  finally{await cleanup();}
  return snapshot();
 }
 async function stopAll(reason='stop'){return current?stop(current.jobId,{reason}):snapshot();}
 return {
  snapshot,
  async clock(){await open();child.stdin.write(JSON.stringify({command:'clock.now'})+'\n');return next(event=>event.event==='clock'||event.event==='error');},
  async play({bytes,renderJobId,revision,documentId,startAtUptimeNs=null}){
   if(closed)throw failure('NATIVE_AUDIO_CLOSED','Native audio owner is closed');
   if(current&&['playing','stopping'].includes(current.status))throw failure('NATIVE_AUDIO_PLAYING','Stop existing native audio playback first');
   await cleanup();directory=await fs.mkdtemp(path.join(os.tmpdir(),'newdaw-native-preview-'));
   const file=path.join(directory,'preview.wav');await fs.writeFile(file,Buffer.from(bytes));
   const jobId=randomUUID();current={jobId,renderJobId,revision,documentId,status:'playing',startAtUptimeNs,error:null};
   try{
    await open();child.stdin.write(JSON.stringify({command:'play',path:file,offline,allowDefaultOutput:!offline,...(startAtUptimeNs!==null?{startAtUptimeNs}:{})})+'\n');
    const event=await next(event=>event.event==='playing'||event.event==='error');
    if(event.event==='error')throw failure(event.code,event.message);
    current.helperId=event.jobId;publish();return snapshot();
   }catch(error){current={...current,status:'failed',error:error.message};publish();await cleanup();throw error;}
  },
  stop,
  stopAll,
  async close(){
   if(closed)return;closed=true;await stopAll('server-close');
   if(child){const exiting=new Promise(resolve=>child.once('exit',resolve));child.stdin.write(JSON.stringify({command:'quit'})+'\n');await exiting;}
   child=null;for(const waiter of waiters.splice(0)){clearTimeout(waiter.timer);waiter.reject(new Error('Native audio owner closed'));}await cleanup();
  },
 };
}
