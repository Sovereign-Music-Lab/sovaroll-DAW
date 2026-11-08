import {Worker} from 'node:worker_threads';
const failure=(code,message,status)=>Object.assign(new Error(message),{code,status});
/** Bounded ephemeral renders, separate from the document mutation queue. */
export function createNoteAuditionJobs({maxConcurrent=2,timeoutMs=10000}={}){
 const jobs=new Set();let closed=false;
 return {
  get activeCount(){return jobs.size;},
  run(project,input,{signal}={}){
   if(closed)return Promise.reject(failure('AUDITION_CLOSED','Audition service is closed',503));
   if(signal?.aborted)return Promise.reject(failure('AUDITION_CANCELLED','Audition cancelled',499));
   if(jobs.size>=maxConcurrent)return Promise.reject(failure('AUDITION_BUSY','Audition capacity reached; retry the latest preview',503));
   return new Promise((resolve,reject)=>{
    let worker;try{worker=new Worker(new URL('./note-audition-worker.mjs',import.meta.url),{workerData:{project,input}});}catch(error){reject(error);return;}
    let settled=false,timer;const job={worker,stop:null,termination:null};jobs.add(job);
    const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);job.termination=worker.terminate().finally(()=>jobs.delete(job));job.termination.then(()=>error?reject(error):resolve(result),reject);};
    const abort=()=>finish(failure('AUDITION_CANCELLED','Audition cancelled',499));job.stop=abort;
    signal?.addEventListener('abort',abort,{once:true});
    worker.once('message',result=>{if(result.error){const e=result.error;finish(Object.assign(failure(e.code??'AUDITION_FAILED',e.message,e.name==='MediaError'?422:500),{name:e.name}));}else finish(null,result);});
    worker.once('error',error=>finish(error));worker.once('exit',code=>{if(!settled)finish(failure('AUDITION_WORKER_EXIT',`Audition worker exited without a result (${code})`,500));});
    timer=setTimeout(()=>finish(failure('AUDITION_TIMEOUT','Audition exceeded its time budget',503)),timeoutMs);timer.unref();
    if(signal?.aborted)abort();
   });
  },
  async close(){closed=true;const current=[...jobs];for(const job of current)job.stop();await Promise.allSettled(current.map(job=>job.termination));}
 };
}
