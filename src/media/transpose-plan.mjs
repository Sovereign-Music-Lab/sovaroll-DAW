export const TRANSPOSE_SCALES=Object.freeze({chromatic:[0,1,2,3,4,5,6,7,8,9,10,11],major:[0,2,4,5,7,9,11],naturalMinor:[0,2,3,5,7,8,10],harmonicMinor:[0,2,3,5,7,8,11],melodicMinor:[0,2,3,5,7,9,11],dorian:[0,2,3,5,7,9,10],phrygian:[0,1,3,5,7,8,10],lydian:[0,2,4,6,7,9,11],mixolydian:[0,2,4,5,7,9,10],locrian:[0,1,3,5,6,8,10],majorPentatonic:[0,2,4,7,9],minorPentatonic:[0,3,5,7,10],blues:[0,3,5,6,7,10],wholeTone:[0,2,4,6,8,10]});
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function nearest(pitch,root,scale){let best=null;const octave=Math.floor((pitch-root)/12);for(let o=octave-1;o<=octave+1;o++)for(let degree=0;degree<scale.length;degree++){const value=root+o*12+scale[degree],distance=Math.abs(pitch-value);if(!best||distance<best.distance||distance===best.distance&&value>best.pitch)best={pitch:value,octave:o,degree,distance};}return best;}
export function planTranspose(notes,{semitones,pitchRange,scaleCorrection}){
 const invalid=(code,message)=>{throw Object.assign(new Error(message),{code});};
 if(pitchRange&&pitchRange.min>pitchRange.max)invalid('INVALID_PITCH_RANGE','Minimum pitch must not exceed maximum pitch.');
 const source=scaleCorrection&&TRANSPOSE_SCALES[scaleCorrection.fromScale],target=scaleCorrection&&TRANSPOSE_SCALES[scaleCorrection.toScale];if(scaleCorrection&&(!source||!target))invalid('INVALID_SCALE','Unsupported transpose scale.');
 let folded=0,clipped=0,corrected=0;const updates=[];
 for(const note of notes){let pitch=note.pitch+semitones;
  if(scaleCorrection){const {fromRoot,toRoot}=scaleCorrection,current=nearest(pitch,fromRoot,source);let rootShift=toRoot-fromRoot;while(rootShift>6)rootShift-=12;while(rootShift< -6)rootShift+=12;
   if(source.length===target.length)pitch=current.pitch-source[current.degree]+target[current.degree]+rootShift;
   else pitch=nearest(current.pitch+rootShift,fromRoot+rootShift,target).pitch;
   if(pitch!==note.pitch+semitones)corrected++;
  }
  if(pitchRange){const {min,max}=pitchRange,low=Math.ceil((min-pitch)/12),high=Math.floor((max-pitch)/12);if(low<=high){const offset=clamp(0,low,high);pitch+=offset*12;if(offset)folded++;}else{pitch=clamp(pitch+12*Math.round(((min+max)/2-pitch)/12),min,max);clipped++;}}
  else if(pitch<0||pitch>127)invalid('PITCH_OUT_OF_RANGE','Transpose would move a note outside MIDI pitch 0..127.');
  updates.push({noteId:note.id,pitch});
 }
 return {updates,semitones,pitchRange:pitchRange??null,scaleCorrection:scaleCorrection??null,scalePolicy:'nearest-source-upward-ties/equal-cardinality-degree-map/otherwise-nearest-target/shortest-root-shift',scaleCorrected:corrected,octaveFolded:folded,narrowRangeClipped:clipped};
}
