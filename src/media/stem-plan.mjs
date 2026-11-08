import {estimateTrackEffectsTail} from './track-effects.mjs';
import {resolvePanLaw,monoSumGain} from './pan-law.mjs';
import {resampledBounds} from './output-resample.mjs';
import {projectDurationSeconds} from './render.mjs';
import {compileTempoMap} from './time.mjs';
import {selectRenderTracks} from './render-tracks.mjs';
export const MAX_STEM_ZIP_BYTES=128*1024*1024;
const safeName=name=>String(name).replace(/[^\p{L}\p{N} _-]/gu,'_').trim().slice(0,70)||'Untitled';
export function planStemExport(project,options={}, {bundle=true}={}){
 const trackIds=options.trackIds??project.tracks.map(t=>t.id);selectRenderTracks(project,trackIds);
 if(bundle&&!options.stemMixdown&&trackIds.length>128)throw new Error('Stem ZIP supports at most 128 tracks.');
 const timeline=compileTempoMap(project.tempoMap,project.ppq),tail=options.tailSeconds??.2;
 if(!Number.isFinite(tail)||tail<0||tail>10)throw new Error('Stem tail must be 0..10 seconds.');
 const selectedProject=selectRenderTracks(project,trackIds),effectEstimate=options.autoEffectTail===false?0:selectedProject.tracks.filter(t=>!t.mute).reduce((max,t)=>Math.max(max,estimateTrackEffectsTail(t,project.sampleRate,project.tempoMap)),0),wholeTail=Math.max(tail,Math.min(10,effectEstimate));
 let ranges;
 if(options.cycleMarkerIds!==undefined){
  const ids=options.cycleMarkerIds;if(!Array.isArray(ids)||!ids.length||ids.length>128||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'))throw new Error('Use 1..128 unique cycle marker IDs.');
  if(options.startTick!==undefined||options.durationSeconds!==undefined)throw new Error('Cycle marker export cannot combine with explicit start/duration.');
  ranges=ids.map(id=>{const marker=project.markers?.find(m=>m.id===id);if(!marker||marker.endTick===undefined)throw new Error(`Cycle marker not found: ${id}`);const startFrame=Math.ceil(timeline.tickToSeconds(marker.tick)*project.sampleRate),endFrame=Math.ceil(timeline.tickToSeconds(marker.endTick)*project.sampleRate);return{markerId:id,markerName:marker.name,startTick:marker.tick,endTick:marker.endTick,startFrame,durationSeconds:(endFrame-startFrame)/project.sampleRate+tail};});
 }else{const startTick=options.startTick??0,startFrame=Math.ceil(timeline.tickToSeconds(startTick)*project.sampleRate);ranges=[{startTick,startFrame,durationSeconds:options.durationSeconds??projectDurationSeconds(project)+wholeTail-startFrame/project.sampleRate}];}
 if(options.stemSplitChannels&&options.channelMode!==undefined&&options.channelMode!=='stereo')throw new Error('Split L/R requires stereo channel mode.');
 const channels=options.stemSplitChannels||['mono','left','right'].includes(options.channelMode)?1:2,bytesPerSample=options.sampleFormat==='pcm24'?3:options.sampleFormat==='float32'?4:2;
 for(const range of ranges){range.frames=Math.ceil((range.startFrame/project.sampleRate+range.durationSeconds)*project.sampleRate)-range.startFrame;if(!Number.isSafeInteger(range.frames)||range.frames<1||!Number.isFinite(range.durationSeconds)||range.durationSeconds>600)throw new Error('Each stem range must be positive and at most 600 seconds.');}
 const outputSampleRate=options.outputSampleRate??project.sampleRate;for(const range of ranges){const sourceStartFrame=range.startFrame,sourceFrames=range.frames;Object.assign(range,resampledBounds(sourceStartFrame,sourceFrames,project.sampleRate,outputSampleRate),{sourceStartFrame,sourceFrames});}
 const filesPerRange=(options.stemMixdown?1:trackIds.length)*(options.stemSplitChannels?2:1);
 if(filesPerRange*ranges.length>4096)throw new Error('One export supports at most 4096 output files.');
 const estimatedBytes=ranges.reduce((n,r)=>n+r.frames*channels*bytesPerSample*filesPerRange+filesPerRange*4096,0);
 if(bundle&&estimatedBytes>MAX_STEM_ZIP_BYTES)throw new Error('Stem ZIP exceeds 128 MiB; shorten range, select fewer tracks, or use offline-render-stems-dir.');
 const extension=options.fileFormat==='aiff'?'aiff':'wav';
 let outputs=[];
 for(const [rangeIndex,range]of ranges.entries()){
  const prefix=range.markerId?`${String(rangeIndex+1).padStart(3,'0')}-${safeName(range.markerName)}/`:'';
  const common={...(range.markerId?{markerId:range.markerId,markerName:range.markerName}:{}),rangeIndex,startFrame:range.startFrame,frames:range.frames,renderOptions:{...options,cycleMarkerIds:undefined,startTick:range.startTick,durationSeconds:range.durationSeconds}};
  if(options.stemMixdown)outputs.push({...common,outputKind:'mix',renderTrackIds:options.trackIds,filename:`${prefix}Mix.${extension}`});
  else for(const [index,id]of trackIds.entries()){
   const track=project.tracks.find(t=>t.id===id);
   outputs.push({...common,outputKind:'track',trackId:id,trackName:track.name,renderTrackIds:[id],filename:`${prefix}${String(index+1).padStart(3,'0')}-${safeName(track.name)}.${extension}`});
  }
 }
 if(options.stemSplitChannels)outputs=outputs.flatMap(output=>['left','right'].map((channel,index)=>({...output,channelLabel:index===0?'L':'R',filename:output.filename.replace(/\.(wav|aiff)$/,`-${index===0?'L':'R'}.${extension}`),renderOptions:{...output.renderOptions,channelMode:channel}})));
 return{effectTail:{estimatedSeconds:effectEstimate,capped:effectEstimate>10,wholeTailSeconds:wholeTail},trackIds,outputSampleRate,...ranges[0],ranges,channels,estimatedBytes,outputs};
}
export function stemManifest(project,options,plan){return{format:'newdaw-stems-v1',effectTail:plan.effectTail,panLaw:resolvePanLaw(project.panLaw),monoDownmixGain:options.channelMode==='mono'?monoSumGain(project.panLaw):null,projectId:project.id,projectName:project.name,revision:project.revision,startTick:plan.startTick,startFrame:plan.startFrame,frames:plan.frames,ranges:plan.ranges,sampleRate:plan.outputSampleRate,sourceSampleRate:project.sampleRate,options:{...options,...(!options.cycleMarkerIds?{durationSeconds:plan.durationSeconds}:{})},policy:options.stemMixdown&&!options.trackIds?'Whole mix retains current solo/mute/gain/pan/master.':'Track selection bypasses solo; explicit mute, gain/pan and master gain retained. No cross-track routing/FX stem graph.',plannedTrackIds:plan.trackIds,outputs:[]};}
