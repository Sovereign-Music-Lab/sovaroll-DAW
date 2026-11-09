import {spawn} from 'node:child_process';
import {promises as fs} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {StringDecoder} from 'node:string_decoder';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..');
const error=(code,message)=>Object.assign(new Error(message),{code});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
/** Explicitly opened backend, no discovery or output during module import. */
export async function openCoreMidi({testReceiver=false,timeoutMs=5000}={}){
 if(process.platform!=='darwin')throw error('NATIVE_PLATFORM','CoreMIDI requires macOS.');
 if(typeof testReceiver!=='boolean'||!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>30000)throw error('NATIVE_OPTIONS','Invalid native backend options.');
 const binary=path.join(root,'.native-build/newdaw-midi');
 let meta;try{meta=JSON.parse(await fs.readFile(binary+'.json','utf8'));}catch{throw error('NATIVE_BUILD_REQUIRED','Run node scripts/build-native-midi.mjs first.');}
 if(meta.sourceSha256!==hash(await fs.readFile(path.join(root,'native/macos/midi-bridge.swift')))||meta.binarySha256!==hash(await fs.readFile(binary)))throw error('NATIVE_BUILD_STALE','Native source/binary hashes differ from build receipt. Rebuild explicitly.');
 const child=spawn(binary,testReceiver?['--test-receiver']:[],{stdio:['pipe','pipe','pipe']}),events=new EventEmitter(),pending=new Map();
 const decoder=new StringDecoder('utf8');
 let buffer='',stderr='',failure=null,closing=false,sequence=0,readyResolve,readyReject,exitResolve;
 const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;}),exited=new Promise(resolve=>{exitResolve=resolve;});
 const fail=reason=>{if(failure)return;failure=reason;readyReject(reason);for(const entry of pending.values()){clearTimeout(entry.timer);entry.reject(reason);}pending.clear();child.kill('SIGTERM');};
 child.stderr.on('data',data=>{stderr=(stderr+data).slice(-8000);});
 child.stdin.on('error',e=>fail(error('NATIVE_PIPE',e.message)));
 child.on('error',e=>fail(error('NATIVE_SPAWN',e.message)));
 child.on('exit',(code,signal)=>{exitResolve({code,signal});if(!closing||pending.size)fail(error('NATIVE_EXIT',`CoreMIDI exited (${code??signal}). Delivery may be uncertain. ${stderr}`));events.emit('closed',{code,signal});});
 child.stdout.on('data',chunk=>{
  buffer+=decoder.write(chunk);if(buffer.length>2*1024*1024){fail(error('NATIVE_PROTOCOL','Oversized helper output'));return;}
  for(;;){const i=buffer.indexOf('\n');if(i<0)break;const line=buffer.slice(0,i);buffer=buffer.slice(i+1);let msg;try{msg=JSON.parse(line);}catch{fail(error('NATIVE_PROTOCOL','Invalid helper JSON'));return;}
   if(msg.event==='fatal'){fail(error(msg.code||'NATIVE_FATAL',msg.message));return;}
   if(msg.event==='ready'){if(msg.protocolVersion!==1){fail(error('NATIVE_PROTOCOL','Unsupported helper protocol'));return;}readyResolve(msg);}
   if(msg.event)events.emit(msg.event,msg);
   if(msg.requestId){const entry=pending.get(msg.requestId);if(!entry)continue;pending.delete(msg.requestId);clearTimeout(entry.timer);if(msg.ok===true)entry.resolve(msg.result);else entry.reject(error(msg.error?.code||'NATIVE_REQUEST',msg.error?.message||'Native request failed'));}
  }
 });
 const startup=setTimeout(()=>fail(error('NATIVE_TIMEOUT','CoreMIDI startup timed out')),timeoutMs);
 let readyInfo;try{readyInfo=await ready;}finally{clearTimeout(startup);}
 function request(action,args={}){
  if(failure)return Promise.reject(failure);if(closing)return Promise.reject(error('NATIVE_CLOSED','CoreMIDI backend is closing'));
  const requestId=`${++sequence}-${randomUUID()}`,line=JSON.stringify({...args,action,requestId})+'\n';
  if(Buffer.byteLength(line)>400000)return Promise.reject(error('NATIVE_LIMIT','Native request exceeds 400000 bytes'));
  return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>fail(error('NATIVE_TIMEOUT_UNCERTAIN','CoreMIDI response timed out; delivery may have occurred. Backend closed; do not automatically retry.')),timeoutMs);
   pending.set(requestId,{resolve,reject,timer});child.stdin.write(line,e=>{if(e)fail(error('NATIVE_PIPE',e.message));});
  });
 }
 return {events,pid:child.pid,build:meta,clock:{numer:readyInfo.timebaseNumer,denom:readyInfo.timebaseDenom},request,
  ports:()=>request('ports'),send:(destinationId,messages)=>request('send',{destinationId,messages}),release:destinationId=>request('release',{destinationId}),
  transportStatus:()=>request('transport.status'),start:(jobId,options={})=>request('transport.start',{jobId,...options}),stop:(jobId,options={})=>request('transport.stop',{...options,jobId}),reset:input=>request('reset',input),
  async close(){if(closing)return exited;if(failure){closing=true;child.kill('SIGTERM');return exited;}const pendingClose=request('close');closing=true;const response=await pendingClose;child.stdin.end();const result=await exited;if(result.code!==0)throw error('NATIVE_EXIT','CoreMIDI did not close cleanly');return {...response,...result};}
 };
}
