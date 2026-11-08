import {fail} from './schema.mjs';
export function retimeLinearMidi(project,oldMap,newMap,changes,newTempoMap){
 const tracks=new Set(project.tracks.filter(t=>t.type==='midi'&&t.midiTimeBase==='linear').map(t=>t.id));
 for(const clip of project.clips){if(clip.type!=='midi'||!tracks.has(clip.trackId))continue;
 const curves=(clip.events??[]).some(e=>e.curve);let ratio=1,offset=0;
 if(curves){
 const coordinates=[clip.startTick,clip.startTick+clip.lengthTicks,...(clip.events??[]).flatMap(e=>[clip.startTick+e.tick,...(e.curve?.window?[clip.startTick+e.curve.window.startTick,clip.startTick+e.curve.window.endTick]:[])])];
 ({ratio,offset}=affineCurveMapping(project.tempoMap,newTempoMap,oldMap,newMap,coordinates,clip.id));
 if(coordinates.some(t=>!Number.isSafeInteger(Math.round(t*ratio+offset))||Math.abs(t*ratio+offset-Math.round(t*ratio+offset))>1e-8))fail('MIDI_LINEAR_CURVE_ROUNDING','Curve geometry requires exact integer tick mapping; use a compatible tempo or keep Musical mode.',{clipId:clip.id});
 }

 const oldStart=clip.startTick,convert=local=>Math.round(newMap.secondsToTick(oldMap.tickToSeconds(oldStart+local))),start=convert(0),end=convert(clip.lengthTicks);let length=Math.max(1,end-start);
 for(const note of clip.notes){const onset=convert(note.startTick),release=convert(note.startTick+note.durationTicks);if(note.quantizeReference){const ref=note.quantizeReference,a=convert(ref.startTick),b=convert(ref.startTick+ref.durationTicks);ref.startTick=a-start;ref.durationTicks=b-a;}
 note.startTick=onset-start;note.durationTicks=release-onset;length=Math.max(length,note.startTick+1,clip.allowNoteTails?0:note.startTick+note.durationTicks);changes.updated.push(note.id);}
 for(const event of clip.events??[]){if(event.curve?.window){event.curve.window.startTick=Math.round((oldStart+event.curve.window.startTick)*ratio+offset)-start;event.curve.window.endTick=Math.round((oldStart+event.curve.window.endTick)*ratio+offset)-start;}event.tick=convert(event.tick)-start;length=Math.max(length,event.tick);changes.updated.push(event.id);}
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(start+length)||start<0)fail('MIDI_TIME_BASE_OVERFLOW','Linear MIDI conversion exceeds safe ticks.',{clipId:clip.id});
 clip.startTick=start;clip.lengthTicks=length;
 for(const note of clip.notes){const r=note.quantizeReference;if(r&&(r.startTick<0||r.startTick>=length||r.durationTicks<0||r.startTick+r.durationTicks>length)){delete note.quantizeReference;(changes.invalidatedQuantizeNoteIds??=[]).push(note.id);}}
 changes.updated.push(clip.id);
 }
}

// Every old-map breakpoint and the preimage of every new-map breakpoint divides
// the piecewise-linear tick transform. Equal slopes prove a single affine domain.
function affineCurveMapping(oldPoints,newPoints,oldMap,newMap,coordinates,clipId){
 const global=oldPoints.every(p=>p.bpm===oldPoints[0].bpm)&&newPoints.every(p=>p.bpm===newPoints[0].bpm);
 if(global)return {ratio:newPoints[0].bpm/oldPoints[0].bpm,offset:0};
 let left=Infinity,right=-Infinity;for(const value of coordinates){left=Math.min(left,value);right=Math.max(right,value);}
 if(left<0||right<=left)fail('MIDI_LINEAR_CURVES_UNSUPPORTED','This curve domain requires piecewise time-warp preservation.',{clipId});
 const from=oldMap.tickToSeconds(left),to=oldMap.tickToSeconds(right),cuts=[left,right];
 for(const point of oldPoints)if(point.tick>left&&point.tick<right)cuts.push(point.tick);
 for(const point of newPoints){const seconds=newMap.tickToSeconds(point.tick);if(seconds>from&&seconds<to)cuts.push(oldMap.secondsToTick(seconds));}
 cuts.sort((a,b)=>a-b);let ratio=null;
 for(let i=1;i<cuts.length;i++){if(cuts[i]<=cuts[i-1])continue;const tick=cuts[i-1]+(cuts[i]-cuts[i-1])/2,nextTick=newMap.secondsToTick(oldMap.tickToSeconds(tick)),slope=newMap.bpmAtTick(nextTick)/oldMap.bpmAtTick(tick);
 if(ratio===null)ratio=slope;else if(Math.abs(slope-ratio)>1e-12*Math.max(1,ratio))fail('MIDI_LINEAR_CURVES_UNSUPPORTED','A tempo boundary changes the curve time scale; piecewise preservation is required.',{clipId});}
 const offset=newMap.secondsToTick(from)-left*ratio;return {ratio,offset};
}
