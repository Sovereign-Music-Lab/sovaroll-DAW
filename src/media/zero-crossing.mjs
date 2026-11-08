import{integer,finite,requireValue}from'./common.mjs';
/** Search a shared stereo crossing on the exact source/project sample grid.
 * Both channels must cross zero at the same boundary; DC correction and logical
 * reverse are included, while fades/envelopes and channel inserts are excluded. */
export function findAudioZeroCrossing(source,clip,{atSample,projectSampleRate,searchMs=10,edge}={}){
 requireValue(edge===undefined||['left','right'].includes(edge),'INVALID_ZERO_CROSSING','Trim edge must be left or right.');
 integer(atSample,0,Number.MAX_SAFE_INTEGER,'Project cursor');integer(projectSampleRate,8000,192000,'Project sample rate');finite(searchMs,0,100,'Zero crossing search milliseconds');
 requireValue(Array.isArray(source.channels)&&source.channels.length>=1&&source.channels.length<=2&&source.channels.every(c=>c instanceof Float32Array&&c.length===source.frames),'INVALID_AUDIO_SOURCE','Zero crossing requires mono/stereo decoded source.');
 const rate=integer(source.sampleRate,8000,384000,'Source sample rate'),radius=Math.ceil(searchMs/1000*rate),target=clip.offsetFrames+(atSample-clip.startSample)/projectSampleRate*rate,window=clip.reverseWindow??clip;
 const lower=edge==='left'?1:clip.offsetFrames+1,upper=edge==='right'?source.frames-1:clip.offsetFrames+clip.lengthFrames-1;
 const lo=Math.max(lower,clip.reverse?window.offsetFrames+1:1,Math.ceil(target-radius)),hi=Math.min(upper,clip.reverse?window.offsetFrames+window.lengthFrames-1:source.frames-1,Math.floor(target+radius));
 let best=null;
 for(let frame=lo;frame<=hi;frame++){
  const numerator=BigInt(frame-clip.offsetFrames)*BigInt(projectSampleRate);if(numerator%BigInt(rate)!==0n||clip.startSample+Number(numerator/BigInt(rate))<0)continue;
  let crossing=true,peak=0;for(let channel=0;channel<source.channels.length;channel++){const read=p=>{const index=clip.reverse?2*window.offsetFrames+window.lengthFrames-1-p:p;return source.channels[channel][index]-(clip.dcOffsets?.[channel]??0);},a=read(frame-1),b=read(frame);requireValue(Number.isFinite(a)&&Number.isFinite(b),'INVALID_AUDIO_SAMPLE','Zero crossing encountered invalid source samples.');if(!(a===0||b===0||a<0&&b>0||a>0&&b<0)){crossing=false;break;}peak=Math.max(peak,Math.abs(b));}
  if(!crossing)continue;const distance=Math.abs(frame-target);if(!best||distance<best.distance||distance===best.distance&&(peak<best.peak||peak===best.peak&&frame<best.sourceFrame))best={sourceFrame:frame,atSample:clip.startSample+Number(numerator/BigInt(rate)),distance,peak};
 }
 return {found:Boolean(best),atSample:best?.atSample??atSample,sourceFrame:best?.sourceFrame??null,searchMs,policy:'nearest shared-channel zero/sign crossing; exact project/source grid; smaller post-boundary peak then earlier frame breaks ties; DC/reverse included',...(best?{peak:best.peak}:{})};
}
