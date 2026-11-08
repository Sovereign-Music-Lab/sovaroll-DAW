import{audioFadeGain}from'./audio-fade.mjs';import{timeStretchAudio}from'./time-stretch.mjs';import{integer,requireValue}from'./common.mjs';
/** Bake event processing before time stretch, never track/master processing.
 * The original clip snapshot accompanies the result for provenance and Undo. */
export async function stretchAudioClip(source,clip,options){
 integer(options?.targetFrames,1,source.sampleRate*600,'Stretched frames');requireValue(clip.lengthFrames*source.channels.length*4<=64*1024*1024&&options.targetFrames*source.channels.length*4<=64*1024*1024,'STRETCH_LIMIT','Stretch input/output exceeds64MiB PCM.');
 requireValue(clip.type==='audio','TYPE_MISMATCH','Time stretch requires an audio event.');integer(clip.offsetFrames,0,source.frames-1,'Source offset');integer(clip.lengthFrames,1,source.frames-clip.offsetFrames,'Source length');
 requireValue(clip.snapPointFrame===undefined||clip.snapPointFrame>=clip.offsetFrames&&clip.snapPointFrame<=clip.offsetFrames+clip.lengthFrames,'UNMAPPED_SNAP_POINT','Move the event snap point inside its trim before stretching.');
 const window=clip.reverseWindow??clip,gain=10**((clip.gainDb??0)/20)*(clip.invertPolarity?-1:1),channels=source.channels.map((channel,c)=>{const output=new Float32Array(clip.lengthFrames);for(let i=0;i<output.length;i++){const position=clip.offsetFrames+i,index=clip.reverse?2*window.offsetFrames+window.lengthFrames-1-position:position,value=(channel[index]-(clip.dcOffsets?.[c]??0))*gain*audioFadeGain(clip,position);requireValue(Number.isFinite(value),'INVALID_AUDIO_SAMPLE','Event processing produced an invalid sample.');output[i]=value;}return output;});
 const output=await timeStretchAudio({sampleRate:source.sampleRate,frames:clip.lengthFrames,channels},options);
 return {...output,sourceClip:structuredClone(clip),baked:['gainDb','invertPolarity','reverse','dcOffsets','fades','volumeEnvelope','silencedRanges'],excluded:['trackPre','trackEq','trackDelay','trackMixer','master']};
}
