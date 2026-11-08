import {defaultResetOptions} from './reset-settings.mjs';
import {compileMidiReset} from '../native/macos/reset-policy.mjs';
import {openCoreMidi} from '../native/macos/client.mjs';
import {compileNativePlan,prepareNativePlan} from '../native/macos/project-plan.mjs';
import {randomUUID} from 'node:crypto';
const problem=(code,message,status=409)=>Object.assign(new Error(message),{code,status});
const running=s=>['preparing','playing','stopping','resetting'].includes(s.status);
/** One server owns one backend transport, independent of any browser tab. */
export function createNativeTransport({openBackend=openCoreMidi,onChange=()=>{},checkFresh=async()=>true,pollMs=250,readResetPreferences=async()=>defaultResetOptions()}={}){
 let bridge=null,opening=null,operation=null,resetting=null,stopping=null,preparation=null,generation=0,closed=false,polling=false,sequence=0;
 let state={status:'idle',jobId:null};
 const snapshot=()=>structuredClone({...state,sequence}),publish=()=>{sequence++;onChange(snapshot());};
 async function backend(){
  if(closed)throw problem('NATIVE_CLOSED','Native transport owner is closed');
  if(bridge)return bridge;
  if(!opening)opening=openBackend().then(value=>{
   bridge=value;
   value.events.on('transport',event=>{if(event.transport.jobId!==state.jobId)return;state={...state,...event.transport,...(resetting?{status:'resetting'}:{})};publish();});
   value.events.on('ports-changed',()=>onChange(snapshot(),{portsChanged:true}));
   value.events.on('cleanup-error',error=>{state={...state,cleanupErrors:[...(state.cleanupErrors??[]),error]};publish();});
   value.events.on('closed',result=>{if(bridge!==value)return;bridge=null;if(running(state)){generation++;state={...state,status:'failed',error:'Native backend closed; hardware release cannot be guaranteed',exit:result};publish();}});
   return value;
  }).finally(()=>{opening=null;});
  return opening;
 }
 function stopInternal(reason){
  if(resetting)return resetting.catch(()=>{}).then(()=>stopInternal(reason));
  if(stopping)return stopping;
  if(!running(state)&&!operation)return Promise.resolve(snapshot());
  const task=stopOnce(reason);stopping=task;
  return task.finally(()=>{if(stopping===task)stopping=null;});
 }
 async function stopOnce(reason){
  generation++;preparation?.abort();const pending=operation;
  if(running(state)){state={...state,status:'stopping',reason};publish();}
  if(pending)await pending.catch(()=>{});
  const id=state.jobId;
  if(bridge&&id&&running(state))try{const resetPreferences=await readResetPreferences().catch(()=>null);const result=await bridge.stop(id,{reason:reason==='server-close'?'shutdown':!resetPreferences?'failure':reason==='locate'?'locate':'stop',...(resetPreferences?{resetPreferences}:{})});state={...state,...result,reason};}
  catch(error){try{await bridge.close();}catch{}state={...state,status:'failed',reason,error:error.message};}
  if(state.status==='stopping')state={...state,status:'stopped',reason};
  publish();return snapshot();
 }
 async function start({project,documentId,profile,chaseProfile,resetProfile,timingProfile,startTick=0,endTick}){
  if(closed)throw problem('NATIVE_CLOSED','Native transport owner is closed');
  if(running(state)||operation||stopping||resetting)throw problem('NATIVE_PLAYING','Stop existing native playback first');
  const token=++generation,jobId=randomUUID();
  const abort=new AbortController();preparation=abort;
  state={status:'preparing',jobId,projectId:project.id,revision:project.revision,documentId,startTick,profileFingerprint:profile.fingerprint,chaseFingerprint:chaseProfile.fingerprint,...(resetProfile?{resetFingerprint:resetProfile.fingerprint}:{}),...(timingProfile?{timingFingerprint:timingProfile.fingerprint}:{}),positionNs:0};publish();
  const fresh=async()=>{if(closed||token!==generation||!await checkFresh(snapshot()))throw problem('NATIVE_STALE','Project, MIDI settings or playback changed during preparation');};
  const task=(async()=>{
   let helper,prepared=false,started=false;
   try{
    const config=profile.settings.projects[project.id];if(config?.mode!=='native-midi')throw problem('NATIVE_MODE','Select native MIDI mode before starting playback',422);
    const plan=compileNativePlan(project,{routes:config.routes,startTick,...(endTick!==undefined?{endTick}:{}),chaseOptions:chaseProfile.settings.options,...(timingProfile?{timingOptions:timingProfile.settings.options}:{})});
    state={...state,durationNs:plan.durationNs,warnings:plan.warnings,endTick:plan.endTick,timingOptions:plan.timingOptions,lengthAdjustment:plan.lengthAdjustment};helper=await backend();await fresh();
    if(startTick>0&&resetProfile){
     const current=await helper.transportStatus();await fresh();
     const reset=await helper.reset({reason:'locate',preferences:resetProfile.settings.options,destinations:plan.destinations,expectedJobId:current.transport.jobId??null,expectedPreparedJobId:current.preparedJobId??null});
     if(reset.status==='failed')throw problem('MIDI_RESET_FAILED','Locate Reset failed; playback was not started',503);await fresh();
    }
    await prepareNativePlan(helper,plan,{jobId,signal:abort.signal,...(resetProfile?{resetPreferences:resetProfile.settings.options}:{})});prepared=true;await fresh();
    const result=await helper.start(jobId);started=true;await fresh();
    state={...state,...result};publish();return snapshot();
   }catch(error){
    if(helper)try{if(started)await helper.stop(jobId,{reason:'failure'});else if(prepared)await helper.request('transport.discard',{jobId});}catch(cleanupError){try{await helper.close();}catch{}error.cleanupError=cleanupError.message;}
    state={...state,status:token!==generation?'stopped':'failed',error:error.message,...(error.cleanupError?{cleanupError:error.cleanupError}:{})};publish();throw error;
   }
  })();operation=task;try{return await task;}finally{if(operation===task)operation=null;if(preparation===abort)preparation=null;}
 }
 async function reset({project,documentId,profile,chaseProfile,resetProfile,timingProfile}){
  if(closed)throw problem('NATIVE_CLOSED','Native transport owner is closed');
  if(resetting||stopping)throw problem('NATIVE_BUSY','A native Stop or Reset is already in progress');
  const config=profile.settings.projects[project.id];
  const destinations=[...new Set((config?.routes??[]).filter(r=>project.tracks.some(t=>t.id===r.trackId&&t.type==='midi')&&r.destinationId!==null).map(r=>r.destinationId))];
  const preferences=resetProfile.settings.options;compileMidiReset({reason:'manual',preferences,destinations});
  const context={projectId:project.id,revision:project.revision,documentId,profileFingerprint:profile.fingerprint,chaseFingerprint:chaseProfile.fingerprint,resetFingerprint:resetProfile.fingerprint,...(timingProfile?{timingFingerprint:timingProfile.fingerprint}:{})};
  const token=++generation;preparation?.abort();const pending=operation;
  const task=(async()=>{
   try{
    if(pending)await pending.catch(()=>{});
    if(closed||token!==generation||!await checkFresh(context))throw problem('NATIVE_STALE','Project or MIDI settings changed before Reset');
    state={...state,...context,status:'resetting',preserveCursor:true};publish();
    const helper=await backend(),current=await helper.transportStatus();
    if(closed||token!==generation||!await checkFresh(context))throw problem('NATIVE_STALE','Project or MIDI settings changed before Reset');
    const report=await helper.reset({reason:'manual',preferences,destinations,expectedJobId:current.transport.jobId??null,expectedPreparedJobId:current.preparedJobId??null});
    state={...state,...report.transport,status:report.status==='failed'?'failed':'stopped',reason:'manual-reset',reset:report,error:undefined,preserveCursor:true};publish();
    if(report.status==='failed')throw problem('MIDI_RESET_FAILED','Reset delivery failed or cleanup was incomplete; do not automatically retry',503);
    return snapshot();
   }catch(error){
    if(state.status==='resetting')try{const current=await bridge?.transportStatus();state={...state,...current?.transport,status:current?.transport?.status??'failed'};}catch{state={...state,status:'failed'};}
    state={...state,error:error.message,preserveCursor:state.status!=='playing'};publish();throw error;
   }
  })();resetting=task;try{return await task;}finally{if(resetting===task)resetting=null;}
 }
 const timer=setInterval(async()=>{if(polling||closed||resetting||!running(state))return;polling=true;const id=state.jobId;try{if(!await checkFresh(snapshot())&&state.jobId===id)await stopInternal('settings-or-document-changed');}catch(error){if(state.jobId===id)await stopInternal('profile-unavailable');}finally{polling=false;}},pollMs);timer.unref();
 return {snapshot,start,reset,ports:async()=>{const helper=await backend();return {...await helper.ports(),available:true};},
  async status(){if(bridge&&state.status==='playing'){const value=await bridge.transportStatus();if(value.transport.jobId===state.jobId){state={...state,...value.transport};sequence++;}}return snapshot();},
  async stop(jobId,{reason='stop'}={}){if(typeof jobId!=='string'||jobId!==state.jobId)throw problem('NATIVE_JOB_CONFLICT','Playback changed; fetch its current job ID before Stop');return stopInternal(reason==='locate'?'locate':'user-stop');},
  stopAll:stopInternal,
  async close(){if(closed)return;closed=true;clearInterval(timer);await stopInternal('server-close');if(opening)await opening.catch(()=>{});if(bridge)await bridge.close();bridge=null;}
 };
}
