import {audioFadeGain} from './audio-fade.mjs';
import {requireValue} from './common.mjs';
const db=value=>value>0?20*Math.log10(value):null;
/** Source-sample statistics, not a resampled playback/true-peak or loudness measurement. */
export function audioClipStatistics(source,clip,{mode='event'}={}){
 requireValue(['raw','event'].includes(mode),'INVALID_STATISTICS_MODE','Use raw or event statistics.');
 requireValue(clip.lengthFrames>0&&clip.offsetFrames>=0&&clip.offsetFrames+clip.lengthFrames<=source.frames,'INVALID_AUDIO_TRIM','Clip trim is outside source.');
 const results=[];let totalSquares=0,overallPeak=0,maxChannelRms=0;
 for(const [channelIndex,channel] of source.channels.entries()){
  let min=Infinity,max=-Infinity,sum=0,squares=0,peak=0,overloadSamples=0;
  for(let i=0;i<clip.lengthFrames;i++){
   const position=clip.offsetFrames+i,window=clip.reverseWindow??clip,index=clip.reverse?2*window.offsetFrames+window.lengthFrames-1-position:position;
   const gain=mode==='event'?audioFadeGain(clip,position)*10**((clip.gainDb??0)/20)*(clip.invertPolarity?-1:1):1,value=(channel[index]-(mode==='event'?(clip.dcOffsets?.[channelIndex]??0):0))*gain;
   requireValue(Number.isFinite(value),'INVALID_AUDIO_SAMPLE','Source contains an invalid sample.');
   min=Math.min(min,value);max=Math.max(max,value);sum+=value;squares+=value*value;peak=Math.max(peak,Math.abs(value));if(Math.abs(value)>1)overloadSamples++;
  }
  const mean=sum/clip.lengthFrames,rms=Math.sqrt(squares/clip.lengthFrames);totalSquares+=squares;overallPeak=Math.max(overallPeak,peak);maxChannelRms=Math.max(maxChannelRms,rms);
  results.push({channel:channelIndex+1,minSample:min,maxSample:max,samplePeak:peak,samplePeakDbFS:db(peak),rms,rmsDbFS:db(rms),rmsAES17DbFS:rms>0?db(rms)+10*Math.log10(2):null,dcOffset:mean,dcOffsetPercent:mean*100,dcOffsetDbFS:db(Math.abs(mean)),overloadSamples});
 }
 const rms=Math.sqrt(totalSquares/(clip.lengthFrames*source.channels.length));
 return {mode,measurement:'source samples in the selected trim; event mode includes DC correction, reverse, fades, volume envelope, clip gain and polarity before track/master processing; null dB means silence',sampleRate:source.sampleRate,frames:clip.lengthFrames,durationSeconds:clip.lengthFrames/source.sampleRate,channels:results,samplePeak:overallPeak,samplePeakDbFS:db(overallPeak),allChannelRms:rms,allChannelRmsDbFS:db(rms),maxChannelRms,maxChannelRmsDbFS:db(maxChannelRms),unsupported:['truePeak','loudnessR128','estimatedPitch','effectiveBitDepth']};
}
