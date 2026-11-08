import {parentPort,workerData} from 'node:worker_threads';
import {renderNoteAudition} from './media/render-note-audition.mjs';
import {encodeWav} from './media/wav.mjs';
try{
 const {project,input}=workerData,result=renderNoteAudition(project,{clipId:input.clipId,field:input.field,updates:input.updates},{durationSeconds:input.durationSeconds});
 parentPort.postMessage(result.silent?{silent:true,revision:result.revision,warnings:result.warnings}:{silent:false,revision:result.revision,bytes:encodeWav(result)});
}catch(error){parentPort.postMessage({error:{name:error.name,code:error.code,message:error.message}});}
