import {parentPort,workerData} from 'node:worker_threads';
import {createHash} from 'node:crypto';
import {storedZip} from './project-files.mjs';
import {renderSnapshotData} from './render-worker.mjs';
import {planStemExport,stemManifest,MAX_STEM_ZIP_BYTES} from './media/stem-plan.mjs';
export {MAX_STEM_ZIP_BYTES};
export async function renderStemBundle({project,projectDirectory,options={}}){
 const plan=planStemExport(project,options),manifest=stemManifest(project,options,plan),entries=[];let totalBytes=0;
 for(const output of plan.outputs){
  const result=await renderSnapshotData({project,projectDirectory,options:{...output.renderOptions,trackIds:output.renderTrackIds}});
  if(result.stats.frames!==output.frames||result.stats.startFrame!==output.startFrame)throw new Error('Stem alignment mismatch.');
  const data=Buffer.from(result.bytes);totalBytes+=data.length;if(totalBytes+1024*1024>MAX_STEM_ZIP_BYTES)throw new Error('Stem ZIP exceeds 128 MiB.');
  entries.push({name:output.filename,data});manifest.outputs.push({...output,sha256:createHash('sha256').update(data).digest('hex'),bytes:data.length,stats:result.stats});
 }
 entries.push({name:'manifest.json',data:Buffer.from(JSON.stringify(manifest,null,2)+'\n')});
 return{bytes:Uint8Array.from(storedZip(entries,MAX_STEM_ZIP_BYTES)),stats:{kind:'stems',channels:plan.channels,channelMode:options.channelMode??'stereo',sampleFormat:options.sampleFormat??'pcm16',trackCount:plan.trackIds.length,rangeCount:plan.ranges.length,fileCount:manifest.outputs.length,startFrame:plan.startFrame,frames:plan.frames,sampleRate:plan.outputSampleRate,durationSeconds:plan.frames/plan.outputSampleRate,manifest}};
}
if(parentPort&&workerData?.kind==='stemBatch'){
 try{const result=await renderStemBundle(workerData);parentPort.postMessage(result,[result.bytes.buffer]);}
 catch(error){parentPort.postMessage({error:{code:'STEM_RENDER_FAILED',message:error.message}});}
}
