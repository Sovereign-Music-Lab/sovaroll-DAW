import {retimeLinearMidi} from './midi-time-base.mjs';
import {compileTempoMap} from '../media/time.mjs';import {fail} from './schema.mjs';
export function replaceEffectiveTempo(project,tempoMap,changes){
 if(JSON.stringify(project.tempoMap)===JSON.stringify(tempoMap)){project.tempoMap=structuredClone(tempoMap);return;}
 const old=compileTempoMap(project.tempoMap,project.ppq),next=compileTempoMap(tempoMap,project.ppq),musical=new Set(project.tracks.filter(t=>t.type==='audio'&&t.audioTimeBase==='musical').map(t=>t.id));
 for(const clip of project.clips){if(clip.type!=='audio'||!musical.has(clip.trackId))continue;const anchor=clip.musicalAnchor,tick=anchor?.sample===clip.startSample&&Math.round(old.tickToSeconds(anchor.tick)*project.sampleRate)===clip.startSample?anchor.tick:old.secondsToTick(clip.startSample/project.sampleRate),sample=Math.round(next.tickToSeconds(tick)*project.sampleRate);
 if(!Number.isSafeInteger(sample)||sample<0)fail('AUDIO_TIME_BASE_OVERFLOW','Musical audio position exceeds safe sample time.',{clipId:clip.id});clip.startSample=sample;clip.musicalAnchor={tick,sample};changes.updated.push(clip.id);}
 retimeLinearMidi(project,old,next,changes,tempoMap);
 project.tempoMap=structuredClone(tempoMap);
}
export function setAudioTimeBase(project,track,mode,changes){
 if(track.type!=='audio')fail('TYPE_MISMATCH','Audio time base only applies to audio tracks.');track.audioTimeBase=mode;const map=compileTempoMap(project.tempoMap,project.ppq);
 for(const clip of project.clips){if(clip.trackId!==track.id)continue;if(mode==='musical')clip.musicalAnchor={tick:map.secondsToTick(clip.startSample/project.sampleRate),sample:clip.startSample};else delete clip.musicalAnchor;changes.updated.push(clip.id);}
 changes.updated.push(track.id);
}
