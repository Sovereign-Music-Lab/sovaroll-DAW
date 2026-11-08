import {compileTempoMap} from './time.mjs';import {requireValue} from './common.mjs';
export function planTempoFromAudio(project,{clipId,scope='project'}){
 requireValue(['project','event'].includes(scope),'INVALID_TEMPO_SCOPE','Choose project or event.');const clip=project.clips.find(c=>c.id===clipId),asset=project.assets.find(a=>a.id===clip?.assetId),range=project.locators;
 requireValue(clip?.type==='audio'&&asset,'INVALID_AUDIO_TEMPO','Choose an audio event with its original asset.');requireValue(range&&range.endTick>range.startTick,'INVALID_AUDIO_TEMPO','Set locators to the intended musical loop length.');
 const signature=project.timeSignature;requireValue(BigInt(range.endTick)*BigInt(signature.denominator)%(BigInt(project.ppq)*4n*BigInt(signature.numerator))===0n,'INVALID_AUDIO_TEMPO','Right locator must be at the end of a complete project bar.');
 const map=compileTempoMap(project.tempoMap,project.ppq),leftSample=map.tickToSeconds(range.startTick)*project.sampleRate;
 requireValue(Math.abs(leftSample-clip.startSample)<=1,'INVALID_AUDIO_TEMPO','Left locator must match the audio event start within one project sample.');
 const durationSeconds=clip.lengthFrames/asset.sampleRate,beats=(range.endTick-range.startTick)/project.ppq,bpm=60*beats/durationSeconds;
 requireValue(Number.isFinite(bpm)&&bpm>=20&&bpm<=300,'AUDIO_TEMPO_RANGE','Calculated tempo must fit 20–300 BPM.');
 let tempoMap,commands=[];if(scope==='project')tempoMap=[{tick:0,bpm}];else{const left=range.startTick,right=range.endTick,restore=map.bpmAtTick(right);tempoMap=project.tempoMap.filter(p=>p.tick<left||p.tick>right).map(p=>({...p}));tempoMap.push({tick:left,bpm},{tick:right,bpm:restore});tempoMap.sort((a,b)=>a.tick-b.tick);if(project.tempoTrackEnabled===false)commands.push({command:'tempo.mode',arguments:{enabled:true}});}
 commands.push({command:'tempo.set',arguments:{tempoMap}});return{clipId,scope,bpm,beats,durationSeconds,startTick:range.startTick,endTick:range.endTick,commands};
}
