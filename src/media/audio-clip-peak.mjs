import {audioFadeGain} from './audio-fade.mjs';
/** Source-sample peak after nondestructive clip fades, before track/master gain. */
export function audioClipPeak(source,clip){
 let peak=0;
 for(let i=0;i<clip.lengthFrames;i++){
  const frame=clip.offsetFrames+i,fade=audioFadeGain(clip,frame);
  for(const [channelIndex,channel] of source.channels.entries()){const w=clip.reverseWindow??clip,index=clip.reverse?2*w.offsetFrames+w.lengthFrames-1-frame:frame,sample=channel[index]-(clip.dcOffsets?.[channelIndex]??0);if(!Number.isFinite(sample))throw new Error('Invalid audio sample');peak=Math.max(peak,Math.abs(sample)*fade);}
 }
 return peak;
}
