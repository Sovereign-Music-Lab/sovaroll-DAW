import {isFrameSilenced} from './audio-silence.mjs';
/** Clip-relative envelopes shared by render and source peak analysis. */
export function fadeCurve(value,shape='linear'){
 const x=Math.max(0,Math.min(1,value));
 return shape==='equalPower'?Math.sin(x*Math.PI/2):shape==='sCurve'?x*x*(3-2*x):x;
}
export function audioFadeGain(clip,position){
 if(isFrameSilenced(clip,position))return 0;
 const window=clip.fadeWindow??clip,local=position-window.offsetFrames;
 return audioEnvelopeGain(clip,position)*(clip.fadeInFrames?fadeCurve(local/clip.fadeInFrames,clip.fadeInShape):1)*
  (clip.fadeOutFrames?fadeCurve((window.lengthFrames-1-local)/clip.fadeOutFrames,clip.fadeOutShape):1);
}

export function audioEnvelopeGain(clip,position){
 const points=clip.volumeEnvelope;if(!points?.length)return 1;
 if(position<=points[0].frame)return points[0].gain;
 let lo=0,hi=points.length-1;
 while(lo+1<hi){const mid=(lo+hi)>>1;if(points[mid].frame<=position)lo=mid;else hi=mid;}
 if(position>=points[hi].frame)return points[hi].gain;
 const left=points[lo],right=points[hi];
 return left.gain+(right.gain-left.gain)*(position-left.frame)/(right.frame-left.frame);
}
