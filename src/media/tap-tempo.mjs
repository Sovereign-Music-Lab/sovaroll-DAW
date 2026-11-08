import {requireValue,integer} from './common.mjs';
export const TAP_TEMPO_MODES=['automatic','selection','lastPlayback','cursor','project','display'];
/** Finite capture window; timestamps are monotonic milliseconds, one tap per quarter note. */
export function planTapTempo(project,options){
 const {tapTimesMs,mode='automatic',playing=false,tempoTrackEnabled=project.tempoTrackEnabled!==false}=options;
 requireValue(TAP_TEMPO_MODES.includes(mode),'INVALID_TAP_MODE','Unknown tap tempo mode.');
 requireValue(Array.isArray(tapTimesMs)&&tapTimesMs.length>=2&&tapTimesMs.length<=32&&tapTimesMs.every(Number.isFinite),'INVALID_TAP_CAPTURE','Supply 2–32 finite tap timestamps.');
 requireValue(typeof playing==='boolean'&&typeof tempoTrackEnabled==='boolean','INVALID_TAP_CONTEXT','Playback and tempo track context must be boolean.');
 for(let i=1;i<tapTimesMs.length;i++)requireValue(tapTimesMs[i]>tapTimesMs[i-1],'INVALID_TAP_CAPTURE','Tap timestamps must strictly increase.');
 const window=tapTimesMs.slice(-9),intervalMs=(window.at(-1)-window[0])/(window.length-1),bpm=Math.round(60000/intervalMs*1000)/1000;
 requireValue(bpm>=20&&bpm<=300,'TAP_TEMPO_RANGE','Tapped tempo must fit 20–300 BPM.');
 const tick=(value,name)=>integer(value,0,Number.MAX_SAFE_INTEGER,name);
 let resolved=mode;if(mode==='automatic')resolved=!tempoTrackEnabled?'project':options.selectionStartTick!==undefined?'selection':playing?'lastPlayback':'cursor';
 let atTick=null,reason=null;
 if(resolved==='project')atTick=0;
 else if(resolved==='selection'){if(options.selectionStartTick!==undefined)atTick=tick(options.selectionStartTick,'Selection start');else reason='no-selection';}
 else if(resolved==='lastPlayback')atTick=tick(options.lastPlaybackStartTick,'Last playback start');
 else if(resolved==='cursor')atTick=tick(options.cursorTick??0,'Project cursor');
 else reason='display-only';
 if(project.tempoTrackEnabled===false&&atTick!==null){resolved='project';atTick=0;}
 let tempoMap=null;if(atTick!==null){tempoMap=project.tempoMap.filter(p=>p.tick!==atTick).map(p=>({...p}));tempoMap.push({tick:atTick,bpm});tempoMap.sort((a,b)=>a.tick-b.tick);if(JSON.stringify(tempoMap)===JSON.stringify(project.tempoMap)){tempoMap=null;reason='unchanged';}}
 return {bpm,intervalMs,intervals:window.length-1,mode,resolvedMode:resolved,atTick,reason,commands:tempoMap?[{command:'tempo.set',arguments:{tempoMap}}]:[]};
}
