import {promises as fs} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {atomicWrite} from './storage.mjs';
import {renderSnapshotData} from './render-worker.mjs';
import {planStemExport,stemManifest} from './media/stem-plan.mjs';
/** One WAV in memory at a time; new output directory only. Interrupted exports
 * keep completed files and a running/failed manifest rather than claim success.
 */
export async function renderStemDirectory({project,projectDirectory,outputDirectory,options={},onProgress=()=>{}}){
 const plan=planStemExport(project,options,{bundle:false}),output=path.resolve(outputDirectory),manifest={...stemManifest(project,options,plan),status:'running'};
 await fs.mkdir(path.dirname(output),{recursive:true});await fs.mkdir(output,{mode:0o700});
 const manifestPath=path.join(output,'manifest.json');
 try{
  await atomicWrite(manifestPath,JSON.stringify(manifest,null,2)+'\n',{noClobber:true});
  for(const item of plan.outputs){
   const result=await renderSnapshotData({project,projectDirectory,options:{...item.renderOptions,trackIds:item.renderTrackIds}});
   if(result.stats.frames!==item.frames||result.stats.startFrame!==item.startFrame)throw new Error('Stem alignment mismatch.');
   await atomicWrite(path.join(output,item.filename),result.bytes,{noClobber:true});
   manifest.outputs.push({...item,sha256:createHash('sha256').update(result.bytes).digest('hex'),bytes:result.bytes.length,stats:result.stats});
   await atomicWrite(manifestPath,JSON.stringify(manifest,null,2)+'\n');onProgress({completed:manifest.outputs.length,total:plan.outputs.length});
  }
  manifest.status='completed';await atomicWrite(manifestPath,JSON.stringify(manifest,null,2)+'\n');return{outputDirectory:output,manifestPath,trackCount:plan.trackIds.length,rangeCount:plan.ranges.length,fileCount:manifest.outputs.length,frames:plan.frames,status:'completed'};
 }catch(error){manifest.status='failed';manifest.error={message:error.message};try{await atomicWrite(manifestPath,JSON.stringify(manifest,null,2)+'\n');}catch{}throw error;}
}
