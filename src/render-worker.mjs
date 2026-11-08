import {encodeAiff} from './media/aiff.mjs';
import {resampleMixOutput} from './media/output-resample.mjs';
import {selectRenderTracks,selectRenderClips,bypassRenderEffects} from './media/render-tracks.mjs';
import {audibleTrackIds} from './media/track-audibility.mjs';
import {prepareMixOutput} from './media/mix-output.mjs';
import {MAX_WAV_FILE_BYTES} from './media/asset-limits.mjs';
import {compileTempoMap} from './media/time.mjs';
import { parentPort, workerData } from 'node:worker_threads';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { decodeWav, encodeWav } from './media/wav.mjs';
import { renderProject } from './media/render.mjs';

export async function renderSnapshotData(data){
  const { projectDirectory, options } = data;
  if(!['wav','aiff'].includes(options?.fileFormat??'wav'))throw new Error('Unsupported audio output container.');
  const project=bypassRenderEffects(selectRenderClips(selectRenderTracks(data.project,options?.trackIds),options?.clipIds),options?.bypassTrackEffects);
  const assets = new Map();
  const activeTracks=audibleTrackIds(project);
  const timeline=compileTempoMap(project.tempoMap,project.ppq),startFrame=Math.ceil(timeline.tickToSeconds(options?.startTick??0)*project.sampleRate),start=startFrame/project.sampleRate;
  const end=options?.durationSeconds===undefined?Infinity:start+options.durationSeconds;
  const metadata=new Map(project.assets.map(asset=>[asset.id,asset]));
  const usedAssets=new Set(project.clips.filter(clip=>{const asset=metadata.get(clip.assetId);return clip.type==='audio'&&!clip.mute&&activeTracks.has(clip.trackId)&&asset&&clip.startSample/project.sampleRate<end&&clip.startSample/project.sampleRate+clip.lengthFrames/asset.sampleRate>start;}).map(clip=>clip.assetId));
  let decodedSamples=0;
  for (const asset of project.assets) {
    if(!usedAssets.has(asset.id))continue;
    decodedSamples+=asset.frames*asset.channels;
    if(decodedSamples>64000000)throw new Error('Referenced assets exceed the 64 million decoded sample limit');
    if (!/^assets\/[a-f0-9]{64}\.wav$/.test(asset.path)) throw new Error(`Unsafe asset path: ${asset.id}`);
    if((await fs.stat(path.join(projectDirectory,asset.path))).size>MAX_WAV_FILE_BYTES)throw new Error(`Asset exceeds 128 MiB file limit: ${asset.name}`);
    const bytes = await fs.readFile(path.join(projectDirectory, asset.path));
    if (createHash('sha256').update(bytes).digest('hex') !== asset.sha256) throw new Error(`Asset content changed: ${asset.name}`);
    const decoded=decodeWav(bytes);
    if(decoded.frames!==asset.frames||decoded.channels.length!==asset.channels||decoded.sampleRate!==asset.sampleRate)throw new Error(`Asset metadata mismatch: ${asset.name}`);
    assets.set(asset.id, decoded);
  }
  const rendered = resampleMixOutput(prepareMixOutput(renderProject(project, assets, options),options?.channelMode??'stereo'),options?.outputSampleRate??project.sampleRate);
  const encoded = (options?.fileFormat==='aiff'?encodeAiff:encodeWav)({...rendered,sampleFormat:options?.sampleFormat??'pcm16',dither:options?.dither??'none',ditherSeed:options?.ditherSeed??0x6d2b79f5,ditherChannelOffset:options?.channelMode==='right'?1:0});
  const bytes = Uint8Array.from(encoded);
  const stats = {
    ...(options?.bypassTrackEffects?{trackEffectsBypassed:true}:{}),
    ...(options?.clipIds?{renderClipIds:options.clipIds}:{}),
    ...(options?.trackIds?{renderTrackIds:options.trackIds,trackSelectionPolicy:'solo bypassed; explicit mute, track gain/pan and master gain retained'}:{}),
    panLaw:rendered.panLaw??'legacy',monoDownmixGain:rendered.monoDownmixGain??null,channels:rendered.channels.length,channelMode:rendered.channelMode,stereoMixPeak:rendered.stereoMixPeak,stereoMixClippedSamples:rendered.stereoMixClippedSamples,
    fileFormat:options?.fileFormat??'wav',sampleFormat:options?.sampleFormat??'pcm16',bitDepth:options?.sampleFormat==='pcm24'?24:options?.sampleFormat==='float32'?32:16,
    ...(options?.exportPresetId?{exportPresetId:options.exportPresetId,exportPresetName:options.exportPresetName}:{}),dither:options?.dither??'none',...(options?.dither==='tpdf'?{ditherSeed:options.ditherSeed??0x6d2b79f5}:{}),resampling:rendered.resampling,timingOptions:rendered.timingOptions,lengthAdjustment:rendered.lengthAdjustment,
    startTick:rendered.startTick,startFrame:rendered.startFrame,startSeconds:rendered.startSeconds,chaseOptions:rendered.chaseOptions,chaseStats:rendered.chaseStats,
    sampleRate: rendered.sampleRate, frames: rendered.frames, durationSeconds: rendered.durationSeconds,
    effectTail:rendered.effectTail,peak: rendered.peak, clippedSamples: rendered.clippedSamples, warnings: rendered.warnings ?? []
  };
  return {bytes,stats};
}
if(parentPort&&workerData?.kind!=='stemBatch'){
 try{const result=await renderSnapshotData(workerData);parentPort.postMessage(result,[result.bytes.buffer]);}
 catch(error){parentPort.postMessage({error:{code:'RENDER_FAILED',message:error.message}});}
}

