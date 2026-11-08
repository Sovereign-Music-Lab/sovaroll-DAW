import {monoSumGain,resolvePanLaw} from './pan-law.mjs';
import {requireValue} from './common.mjs';
/** Apply export channel layout after the stereo master mix. */
export function prepareMixOutput(rendered,channelMode='stereo'){
 requireValue(['stereo','mono','left','right'].includes(channelMode),'INVALID_CHANNEL_MODE','Use stereo, mono, left, or right export.');
 if(channelMode==='stereo')return {...rendered,channelMode};
 requireValue(rendered.channels.length===2,'INVALID_CHANNEL_MODE','Mono downmix requires a stereo mix.');
 const panLaw=resolvePanLaw(rendered.panLaw),sumGain=monoSumGain(panLaw);
 const [left,right]=rendered.channels,mono=channelMode==='left'?left:channelMode==='right'?right:new Float32Array(left.length);let peak=0,clippedSamples=0;
 for(let i=0;i<mono.length;i++){const value=channelMode==='left'?left[i]:channelMode==='right'?right[i]:(left[i]+right[i])*sumGain;requireValue(Number.isFinite(value),'RENDER_OVERFLOW','Non-finite mono sample.');mono[i]=value;peak=Math.max(peak,Math.abs(mono[i]));if(Math.abs(mono[i])>1)clippedSamples++;}
 const warnings=(rendered.warnings??[]).filter(w=>!w.includes('channel samples exceed full scale'));
 warnings.push(channelMode==='mono'?`Mono export uses (left + right) × ${sumGain} after the stereo master mix (${panLaw} pan law); opposite-phase content may cancel.`:`${channelMode} channel extraction after the stereo master mix; no mono summation.`);
 if(clippedSamples)warnings.push(`${clippedSamples} channel samples exceed full scale and will be clipped by integer PCM export (float32 preserves headroom).`);
 return {...rendered,channels:[mono],channelMode,monoDownmixGain:channelMode==='mono'?sumGain:null,peak,clippedSamples,warnings,stereoMixPeak:rendered.peak,stereoMixClippedSamples:rendered.clippedSamples};
}
