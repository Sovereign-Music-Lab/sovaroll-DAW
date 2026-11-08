import {integer} from './common.mjs';
const ceilRatio=(n,a,b)=>Number((BigInt(n)*BigInt(a)+BigInt(b)-1n)/BigInt(b));
export function resampledBounds(startFrame,frames,sourceRate,targetRate){
 for(const [value,label,min] of [[startFrame,'Source start frame',0],[frames,'Source frames',1],[sourceRate,'Source sample rate',1],[targetRate,'Output sample rate',1]])integer(value,min,label.includes('sample rate')?96000:Number.MAX_SAFE_INTEGER,label);
 const outputStartFrame=ceilRatio(startFrame,targetRate,sourceRate),outputEndFrame=ceilRatio(startFrame+frames,targetRate,sourceRate);
 integer(outputStartFrame,0,Number.MAX_SAFE_INTEGER,'Output start frame');integer(outputEndFrame,1,Number.MAX_SAFE_INTEGER,'Output end frame');
 return{startFrame:outputStartFrame,frames:outputEndFrame-outputStartFrame};
}
/** Post-mix conversion on an absolute output sample grid. Windowed sinc with a
 * 1024-phase table, anti-alias cutoff scaled for downsampling and zero padding.
 * This is a fixed algorithm; output quality depends on the source and conversion ratio.
 */
export function resampleMixOutput(rendered,targetRate=rendered.sampleRate){
 if(targetRate===rendered.sampleRate)return rendered;integer(targetRate,8000,96000,'Output sample rate');
 const sourceRate=rendered.sampleRate,sourceStartFrame=rendered.startFrame??0,bounds=resampledBounds(sourceStartFrame,rendered.frames,sourceRate,targetRate);
 if(bounds.frames<1)throw new Error('Output range collapses at the selected sample rate.');
 const cutoff=Math.min(1,targetRate/sourceRate),radius=Math.ceil(16/cutoff),phases=1024,taps=radius*2+1,table=new Float64Array(phases*taps);
 for(let phase=0;phase<phases;phase++){
  const fraction=phase/phases;let total=0;
  for(let tap=0;tap<taps;tap++){const x=tap-radius-fraction,window=Math.abs(x)<=radius?.42+.5*Math.cos(Math.PI*x/radius)+.08*Math.cos(2*Math.PI*x/radius):0,weight=(x===0?cutoff:Math.sin(Math.PI*cutoff*x)/(Math.PI*x))*window;table[phase*taps+tap]=weight;total+=weight;}
  for(let tap=0;tap<taps;tap++)table[phase*taps+tap]/=total;
 }
 const channels=rendered.channels.map(()=>new Float32Array(bounds.frames));let peak=0,clippedSamples=0;
 const sourceOffset=bounds.startFrame*sourceRate/targetRate-sourceStartFrame;
 for(let frame=0;frame<bounds.frames;frame++){
  const position=sourceOffset+frame*sourceRate/targetRate;let base=Math.floor(position),phase=Math.round((position-base)*phases);if(phase===phases){base++;phase=0;}
  const offset=phase*taps;
  for(let channel=0;channel<channels.length;channel++){let value=0;const source=rendered.channels[channel];for(let tap=0;tap<taps;tap++){const index=base+tap-radius;if(index>=0&&index<source.length)value+=source[index]*table[offset+tap];}channels[channel][frame]=value;peak=Math.max(peak,Math.abs(value));if(Math.abs(value)>1)clippedSamples++;}
 }
 const warnings=(rendered.warnings??[]).filter(w=>!String(w).includes('channel samples exceed full scale'));
 if(clippedSamples)warnings.push(`${clippedSamples} output channel samples exceed full scale after sample-rate conversion.`);
 return{...rendered,...bounds,channels,sampleRate:targetRate,startSeconds:bounds.startFrame/targetRate,durationSeconds:bounds.frames/targetRate,peak,clippedSamples,warnings,resampling:{method:'windowed-sinc-phase-table',phases,baseRadius:16,sourceSampleRate:sourceRate,targetSampleRate:targetRate,sourceStartFrame,sourceFrames:rendered.frames}};
}
