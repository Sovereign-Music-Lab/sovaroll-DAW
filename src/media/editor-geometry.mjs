import {compileTempoMap} from './time.mjs';
import { finite, integer, requireValue } from './common.mjs';
import { compileTimelineProjection } from './timeline-projection.mjs';
import { resolveTimeDisplay } from './time-display.mjs';

/** Shared source/pixel coordinates. Zoom is px/quarter, or px per half-second
 * in time-linear mode (fixed120 BPM reference, independent of project tempo).
 * Piano ticks are local to the clip; elapsed time always uses its project origin.
 */
export function compileEditorGeometry(project, { zoom = 48, clip = null } = {}) {
  finite(zoom, 1, 10000, 'Editor zoom');
  const options = resolveTimeDisplay(project.timeDisplay);
  function view(mode, originTick) {
    const projection = compileTimelineProjection({ tempoMap: project.tempoMap, ppq: project.ppq,
      sampleRate: project.sampleRate, mode, scale: mode === 'time-linear' ? zoom * 2 : zoom, originTick });
    // Work in local coordinates before adding any large absolute origin. A
    // project-wide seconds/tick roundtrip can erase sub-tick pointer precision.
    const before=project.tempoMap.filter(p=>p.tick<=originTick).at(-1);
    const localTempo=compileTempoMap([{tick:0,bpm:before.bpm},...project.tempoMap.filter(p=>p.tick>originTick).map(p=>({tick:p.tick-originTick,bpm:p.bpm}))],project.ppq);
    const tickToX = local => {
      finite(local, 0, Number.MAX_SAFE_INTEGER-originTick, 'Local tick');
      return finite(mode==='beat-linear'?local/project.ppq*zoom:localTempo.tickToSeconds(local)*zoom*2,0,Number.MAX_SAFE_INTEGER,'Editor pixel');
    };
    const xToTick = x => {
      finite(x, 0, Number.MAX_SAFE_INTEGER, 'Editor pixel');
      return finite(mode==='beat-linear'?x/zoom*project.ppq:localTempo.secondsToTick(x/(zoom*2)),0,Number.MAX_SAFE_INTEGER-originTick,'Local pointer tick');
    };
    return Object.freeze({ mode, originTick, tickToX, xToTick,
      secondsToX: projection.secondsToPixel, xToSeconds: projection.pixelToSeconds,
      sampleToX: projection.sampleToPixel,
      span(start, end) {
        requireValue(end >= start, 'INVALID_TIME_VALUE', 'Span end must follow start.');
        return tickToX(end) - tickToX(start);
      },
      /** Bounded visual grid, never a replacement for the actual source snap grid.
       * Coarsen labels if needed, retaining absolute step multiples and bar numbering.
       */
      grid(from, to, step, { maxLines = 2048, minPixels = 3 } = {}) {
        finite(from, 0, Number.MAX_SAFE_INTEGER, 'Grid start'); finite(to, from, Number.MAX_SAFE_INTEGER, 'Grid end');
        finite(step, Number.MIN_VALUE, Number.MAX_SAFE_INTEGER, 'Grid step');
        integer(maxLines, 2, 4096, 'Grid line limit'); finite(minPixels, 0, 1000, 'Grid pixel spacing');
        const stride = step * Math.max(1, Math.ceil((to - from) / step / (maxLines - 1)));
        requireValue(Number.isFinite(stride) && stride > 0, 'INVALID_TIME_VALUE', 'Grid step overflows.');
        const lines = []; let previous = -Infinity;
        for (let index = Math.ceil(from / stride), count = 0; count < maxLines; index++, count++) {
          const tick = index * stride; if (tick > to) break;
          const x = tickToX(tick);
          if (x - previous >= minPixels) { lines.push({ tick, x }); previous = x; }
        }
        return lines;
      }
    });
  }
  return Object.freeze({ timeline: view(options.timelineMode, 0), piano: view(options.pianoMode, clip?.type === 'midi' ? clip.startTick : 0) });
}

/** Page-follow keeps the playhead away from the viewport's extreme edges. */
export function playbackFollowScroll({x,scrollLeft,viewportWidth,contentWidth,mode='page'}){
 if(![x,scrollLeft,viewportWidth,contentWidth].every(Number.isFinite)||viewportWidth<=0)return scrollLeft;
 if(mode==='stationary')return Math.max(0,Math.min(Math.max(0,contentWidth-viewportWidth),x-viewportWidth/2));
 const margin=Math.min(48,viewportWidth*.1);
 if(x>=scrollLeft+margin&&x<=scrollLeft+viewportWidth-margin)return scrollLeft;
 return Math.max(0,Math.min(Math.max(0,contentWidth-viewportWidth),x-viewportWidth*.2));
}

/** Read-only arrangement selection, shared by GUI and CLI. */
export function selectProjectClips(project,options={}){
 const {mode='all',selectedIds=[],trackIds=[],cursorTick=0}=options;
 if(Object.keys(options).some(k=>!['mode','selectedIds','trackIds','cursorTick'].includes(k)))throw new Error('Unknown clip selection option');
 if(!['all','none','invert','inLoop','outsideLoop','beforeCursor','afterCursor','atCursor','tracks'].includes(mode))throw new Error('Unknown clip selection mode');
 if(!Array.isArray(selectedIds)||!Array.isArray(trackIds)||![...selectedIds,...trackIds].every(id=>typeof id==='string')||!Number.isFinite(cursorTick)||cursorTick<0)throw new Error('Invalid clip selection context');
 const selected=new Set(selectedIds),tracks=new Set(trackIds),map=compileTempoMap(project.tempoMap,project.ppq),range=project.locators;
 if(['inLoop','outsideLoop'].includes(mode)&&!range)throw new Error('Set locators before selecting a loop range');
 return project.clips.filter(clip=>{
  if(mode==='all')return true;if(mode==='none')return false;if(mode==='invert')return !selected.has(clip.id);if(mode==='tracks')return tracks.has(clip.trackId);
  const asset=clip.type==='audio'?project.assets.find(a=>a.id===clip.assetId):null;
  const start=clip.type==='midi'?clip.startTick:map.secondsToTick(clip.startSample/project.sampleRate),end=clip.type==='midi'?start+clip.lengthTicks:map.secondsToTick(clip.startSample/project.sampleRate+clip.lengthFrames/asset.sampleRate);
  if(mode==='beforeCursor')return start<cursorTick;if(mode==='afterCursor')return start>=cursorTick;if(mode==='atCursor')return start<=cursorTick&&end>cursorTick;
  const inside=start<range.endTick&&end>range.startTick;return mode==='inLoop'?inside:!inside;
 }).map(c=>c.id);
}

/** Validate the transport envelope; paste command validates every clip field. */
export function parseClipClipboard(text){
 const payload=JSON.parse(text);
 if(payload?.format!=='newdaw-clip-clipboard'||payload.version!==1||typeof payload.sourceProjectId!=='string'||!payload.sourceProjectId)throw new Error('Unsupported clip clipboard format');
 if(!Array.isArray(payload.clips)||payload.clips.length<1||payload.clips.length>4096||payload.clips.some(c=>!c||typeof c.id!=='string'||!['midi','audio'].includes(c.type)||typeof c.trackId!=='string'||c.type==='midi'&&!Array.isArray(c.notes)))throw new Error('Invalid clipboard clips');
 if(new Set(payload.clips.map(c=>c.id)).size!==payload.clips.length||payload.clips.reduce((sum,c)=>sum+(c.notes?.length??0),0)>200000)throw new Error('Clipboard exceeds unique clip/note limits');
 if(payload.sourceTracks!==undefined&&(!Array.isArray(payload.sourceTracks)||payload.sourceTracks.length>4096))throw new Error('Invalid clipboard source tracks');
 return payload;
}

/** Equal elapsed-time source slip across files with independent sample rates.
 * Intersect every retained source window before rounding to integral frames. */
export function planAudioSlip(project,clipIds,seconds){
 finite(seconds,-Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER,'Slip seconds');
 requireValue(Array.isArray(clipIds)&&clipIds.length>0&&clipIds.length<=4096&&new Set(clipIds).size===clipIds.length,'INVALID_AUDIO_SLIP','Select 1..4096 distinct audio clips.');
 let minimum=-Infinity,maximum=Infinity;
 const targets=clipIds.map(id=>{
  const clip=project.clips.find(c=>c.id===id),asset=project.assets.find(a=>a.id===clip?.assetId);
  requireValue(clip?.type==='audio'&&asset,'INVALID_AUDIO_SLIP','Source slip requires existing audio clips and assets.');
  const windows=[clip,...['fadeWindow','reverseWindow'].filter(k=>clip[k]).map(k=>clip[k])];
  let low=Math.max(...windows.map(w=>-w.offsetFrames)),high=Math.min(...windows.map(w=>asset.frames-w.offsetFrames-w.lengthFrames));
  for(const p of clip.volumeEnvelope??[]){low=Math.max(low,-p.frame);high=Math.min(high,asset.frames-1-p.frame);}
  for(const r of clip.silencedRanges??[]){low=Math.max(low,-r.startFrame);high=Math.min(high,asset.frames-r.endFrame);}
  minimum=Math.max(minimum,low/asset.sampleRate);maximum=Math.min(maximum,high/asset.sampleRate);
  return {clip,asset,low,high};
 });
 const appliedSeconds=Math.min(maximum,Math.max(minimum,seconds));
 return {seconds:appliedSeconds,limited:appliedSeconds!==seconds,commands:targets.map(({clip,asset,low,high})=>({command:'audio.clip.slip',arguments:{clipId:clip.id,deltaFrames:Math.min(high,Math.max(low,Math.round(appliedSeconds*asset.sampleRate)))}})).filter(c=>c.arguments.deltaFrames!==0)};
}

/** Normal sizing: the source remains anchored to project time on a left trim.
 * Left edges use the exact common source/project sample grid. */
export function planAudioTrim(project,clipIds,edge,seconds,{mode='normal'}={}){
 requireValue(['normal','moveContents'].includes(mode),'INVALID_AUDIO_TRIM','Resize mode must be normal or moveContents.');
 finite(seconds,-Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER,'Trim seconds');
 requireValue(['left','right'].includes(edge)&&Array.isArray(clipIds)&&clipIds.length>0&&clipIds.length<=4096&&new Set(clipIds).size===clipIds.length,'INVALID_AUDIO_TRIM','Select 1..4096 distinct audio clips and a valid edge.');
 const commands=clipIds.map(id=>{
  const clip=project.clips.find(c=>c.id===id),asset=project.assets.find(a=>a.id===clip?.assetId);
  requireValue(clip?.type==='audio'&&asset,'INVALID_AUDIO_TRIM','Normal sizing requires existing audio clips and assets.');
  let a=project.sampleRate,b=asset.sampleRate;while(b)[a,b]=[b,a%b];const step=asset.sampleRate/a;
  const raw=Math.round(seconds*asset.sampleRate),delta=edge==='left'?Math.round(raw/step)*step:raw,offset=mode==='moveContents'?(edge==='left'?clip.offsetFrames:clip.offsetFrames-delta):clip.offsetFrames+(edge==='left'?delta:0),length=clip.lengthFrames+(edge==='left'?-delta:delta),start=clip.startSample+(edge==='left'?delta/step*(project.sampleRate/a):0),window=clip.reverseWindow??clip;
  requireValue([delta,offset,length,start].every(Number.isSafeInteger)&&offset>=0&&length>0&&start>=0&&offset<=asset.frames-length&&(!clip.reverse||offset>=window.offsetFrames&&offset+length<=window.offsetFrames+window.lengthFrames),'INVALID_AUDIO_TRIM','Every resized clip must fit source, reverse window and project bounds.');
  return {command:mode==='moveContents'?'audio.clip.resizeContents':'audio.clip.trim',arguments:{clipId:id,edge,deltaFrames:delta}};
 });
 return {commands:commands.filter(c=>c.arguments.deltaFrames!==0)};
}

/** Align the event's logical source snap point, preserving audio duration through
 * tempo transitions. Returns the clip-start tick, which may be fractional. */
export function snapAudioEventStart(project,clip,startTick,snap){
 finite(startTick,0,Number.MAX_SAFE_INTEGER,'Dragged start tick');
 if(clip.type!=='audio'||clip.snapPointFrame===undefined)return snap(startTick).tick;
 const asset=project.assets.find(a=>a.id===clip.assetId);requireValue(asset,'ASSET_MISSING','Event snap point requires an existing source asset.');
 const map=compileTempoMap(project.tempoMap,project.ppq),offset=(clip.snapPointFrame-clip.offsetFrames)/asset.sampleRate,pointSeconds=Math.max(0,map.tickToSeconds(startTick)+offset),pointTick=snap(map.secondsToTick(pointSeconds)).tick;
 return map.secondsToTick(Math.max(0,map.tickToSeconds(pointTick)-offset));
}

/** Resolve source crossings read-only before committing the whole split batch. */
export async function planZeroCrossingSplits(project,{atTick,clipIds=[]},resolveAudio){
 integer(atTick,0,Number.MAX_SAFE_INTEGER,'Split tick');requireValue(Array.isArray(clipIds)&&clipIds.length<=4096&&new Set(clipIds).size===clipIds.length,'INVALID_SPLIT','Use distinct clip IDs.');
 const selected=clipIds.length?new Set(clipIds):null;if(selected)for(const id of selected)requireValue(project.clips.some(c=>c.id===id),'INVALID_SPLIT','Selected clip is missing.');
 const map=compileTempoMap(project.tempoMap,project.ppq),atSample=Math.round(map.tickToSeconds(atTick)*project.sampleRate),commands=[],zeroCrossings=[];
 for(const clip of project.clips){if(selected&&!selected.has(clip.id))continue;if(clip.type==='midi'){if(atTick>clip.startTick&&atTick<clip.startTick+clip.lengthTicks)commands.push({command:'clip.split',arguments:{clipId:clip.id,atTick}});continue;}
 const asset=project.assets.find(a=>a.id===clip.assetId);requireValue(asset,'ASSET_MISSING','Split requires source metadata.');if(atSample<=clip.startSample||atSample>=clip.startSample+clip.lengthFrames/asset.sampleRate*project.sampleRate)continue;
 const result=await resolveAudio(clip,atSample);requireValue(result&&typeof result.found==='boolean'&&Number.isSafeInteger(result.atSample),'INVALID_ZERO_CROSSING','Invalid zero crossing response.');const actual=result.found?result.atSample:atSample;
 requireValue(actual>clip.startSample&&actual<clip.startSample+clip.lengthFrames/asset.sampleRate*project.sampleRate,'INVALID_ZERO_CROSSING','Crossing must remain inside the selected event.');commands.push({command:'clip.split',arguments:{clipId:clip.id,atSample:actual}});zeroCrossings.push({clipId:clip.id,requestedSample:atSample,actualSample:actual,found:result.found});
 }
 requireValue(commands.length>0,'NOTHING_TO_SPLIT','No targeted clips cross the cursor.');requireValue(commands.length<=4096,'SPLIT_LIMIT','At most4096 splits per operation.');return {commands,zeroCrossings};
}

/** Keep the previewed normal trim unless a safe per-event crossing is found. */
export async function refineZeroCrossingTrims(project,commands,resolveAudio){
 const result=[];for(const command of commands){requireValue(command.command==='audio.clip.trim','INVALID_AUDIO_TRIM','Zero refinement accepts normal audio trims only.');const args=command.arguments,clip=project.clips.find(c=>c.id===args.clipId),asset=project.assets.find(a=>a.id===clip?.assetId);requireValue(clip?.type==='audio'&&asset,'INVALID_AUDIO_TRIM','Trim source is missing.');
 const atSample=Math.round(clip.startSample+(args.edge==='left'?args.deltaFrames:clip.lengthFrames+args.deltaFrames)/asset.sampleRate*project.sampleRate),crossing=await resolveAudio(clip,atSample,args.edge);
 if(!crossing.found){result.push(command);continue;}integer(crossing.sourceFrame,0,asset.frames,'Crossing source frame');const deltaFrames=crossing.sourceFrame-clip.offsetFrames-(args.edge==='right'?clip.lengthFrames:0);if(deltaFrames)result.push({command:'audio.clip.trim',arguments:{...args,deltaFrames}});
 }return result;
}

/** Build a single atomic chain for multiple cursor/locator/repeat boundaries.
 * Queries always reference original clips; later commands use preallocated IDs. */
export async function planZeroCrossingBoundarySplits(project,{ticks,clipIds=[]},resolveAudio,makeId=()=>`clip-${globalThis.crypto.randomUUID()}`){
 requireValue(Array.isArray(ticks)&&ticks.length>0&&ticks.length<=1024,'SPLIT_LIMIT','Use 1..1024 split boundaries.');for(const tick of ticks)integer(tick,0,Number.MAX_SAFE_INTEGER,'Split tick');
 const byClip=new Map(),zeroCrossings=[];let queryCount=0,splitCount=0;
 for(const atTick of [...new Set(ticks)].sort((a,b)=>a-b)){
  let plan;try{plan=await planZeroCrossingSplits(project,{atTick,clipIds},(clip,sample)=>{requireValue(++queryCount<=4096,'SPLIT_LIMIT','At most4096 zero-crossing queries per operation.');return resolveAudio(clip,sample);});}catch(error){if(error.code==='NOTHING_TO_SPLIT')continue;throw error;}
  zeroCrossings.push(...plan.zeroCrossings);
  for(const command of plan.commands){const id=command.arguments.clipId,clip=project.clips.find(c=>c.id===id);let position=command.arguments.atTick??command.arguments.atSample;
   if(clip.type==='audio'){const asset=project.assets.find(a=>a.id===clip.assetId);let a=BigInt(project.sampleRate),b=BigInt(asset.sampleRate);while(b)[a,b]=[b,a%b];const pg=BigInt(project.sampleRate)/a,sg=BigInt(asset.sampleRate)/a,last=(BigInt(clip.lengthFrames)-1n)/sg;requireValue(last>=1n,'NO_EXACT_SPLIT','Audio event has no interior common sample boundary.');let n=(2n*BigInt(position-clip.startSample)+pg)/(2n*pg);n=n<1n?1n:n>last?last:n;position=clip.startSample+Number(n*pg);}
   if(!byClip.has(id))byClip.set(id,new Set());if(!byClip.get(id).has(position))requireValue(++splitCount<=4096,'SPLIT_LIMIT','At most4096 splits per operation.');byClip.get(id).add(position);
  }
 }
 const commands=[];for(const[id,positions]of byClip){const clip=project.clips.find(c=>c.id===id);let current=id;for(const position of [...positions].sort((a,b)=>a-b)){const rightClipId=makeId();commands.push({command:'clip.split',arguments:{clipId:current,rightClipId,[clip.type==='midi'?'atTick':'atSample']:position}});current=rightClipId;}}
 requireValue(commands.length>0,'NOTHING_TO_SPLIT','No targeted clips cross the boundaries.');requireValue(commands.length<=4096,'SPLIT_LIMIT','At most4096 splits per operation.');return {commands,zeroCrossings};
}

export function repeatedSplitTicks(range,intervalTicks){
 requireValue(range&&Number.isSafeInteger(range.startTick)&&range.startTick>=0&&Number.isSafeInteger(range.endTick)&&range.endTick>range.startTick,'INVALID_LOCATORS','Provide a positive safe locator range.');integer(intervalTicks,1,Number.MAX_SAFE_INTEGER,'Split interval');
 const start=BigInt(range.startTick),count=(BigInt(range.endTick)-start-1n)/BigInt(intervalTicks);requireValue(count<=1024n,'SPLIT_LIMIT','Repeated split supports at most1024 boundaries.');requireValue(count>0n,'NOTHING_TO_SPLIT','The interval has no interior boundary in this range.');return Array.from({length:Number(count)},(_,i)=>Number(start+BigInt(i+1)*BigInt(intervalTicks)));
}

/** Pitch-preserving resize request; no source-window expansion is needed. */
export function planAudioStretchResize(project,clipId,edge,seconds){
 finite(seconds,-Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER,'Stretch edge movement');requireValue(['left','right'].includes(edge),'INVALID_TIME_STRETCH','Choose left or right edge.');const clip=project.clips.find(c=>c.id===clipId),asset=project.assets.find(a=>a.id===clip?.assetId);requireValue(clip?.type==='audio'&&asset,'INVALID_TIME_STRETCH','Select an audio event.');let a=project.sampleRate,b=asset.sampleRate;while(b)[a,b]=[b,a%b];const step=asset.sampleRate/a,raw=Math.round(seconds*asset.sampleRate),deltaFrames=edge==='left'?Math.round(raw/step)*step:raw,targetFrames=clip.lengthFrames+(edge==='left'?-deltaFrames:deltaFrames),startSample=clip.startSample+(edge==='left'?deltaFrames/step*(project.sampleRate/a):0);
 requireValue(Number.isSafeInteger(targetFrames)&&targetFrames>0&&Number.isSafeInteger(startSample)&&startSample>=0,'INVALID_TIME_STRETCH','Resize must retain positive duration and project position.');requireValue(targetFrames/clip.lengthFrames>=.125&&targetFrames/clip.lengthFrames<=8,'STRETCH_LIMIT','Stretch duration must be between1/8 and8 times the source.');requireValue(targetFrames<=asset.sampleRate*600&&Math.max(targetFrames,clip.lengthFrames)*asset.channels*4<=64*1024*1024,'STRETCH_LIMIT','Stretch supports600 seconds and64MiB input/output PCM.');return {clipId,targetFrames,startSample,deltaFrames};
}

// Normal right-edge sizing only: retain every source note/controller unchanged.
export function planMidiPartEndResize(project,clipIds,deltaTicks){
 if(!Number.isSafeInteger(deltaTicks))throw new Error('파트 길이 변화는 정수 tick이어야 합니다.');
 if(!Array.isArray(clipIds)||!clipIds.length||clipIds.length>4096||new Set(clipIds).size!==clipIds.length)throw new Error('서로 다른 MIDI 파트를 1–4096개 선택하세요.');
 const commands=clipIds.map(id=>{const clip=project.clips.find(c=>c.id===id);if(clip?.type!=='midi')throw new Error('MIDI 파트만 함께 길이를 변경할 수 있습니다.');const length=clip.lengthTicks+deltaTicks;
 if(!Number.isSafeInteger(length)||length<1||!Number.isSafeInteger(clip.startTick+length))throw new Error('파트 길이가 유효 범위를 벗어납니다.');
 if(clip.notes.some(n=>n.startTick>=length||!clip.allowNoteTails&&n.startTick+n.durationTicks>length)||(clip.events??[]).some(e=>e.tick>length))throw new Error('기존 노트·컨트롤러를 자르는 길이 변경은 지원하지 않습니다. 먼저 분할하세요.');
 return {command:'clip.update',arguments:{clipId:id,lengthTicks:length}};});
 return deltaTicks?commands:[];
}

export function planMidiPartStartResize(project,clipIds,deltaTicks){
 if(!Number.isSafeInteger(deltaTicks))throw new Error('파트 경계 변화는 정수 tick이어야 합니다.');
 if(!Array.isArray(clipIds)||!clipIds.length||clipIds.length>4096||new Set(clipIds).size!==clipIds.length)throw new Error('서로 다른 MIDI 파트를 1–4096개 선택하세요.');
 const commands=clipIds.map(id=>{const c=project.clips.find(c=>c.id===id);if(c?.type!=='midi')throw new Error('MIDI 파트만 선택하세요.');const start=c.startTick+deltaTicks,length=c.lengthTicks-deltaTicks;
 if(!Number.isSafeInteger(start)||start<0||!Number.isSafeInteger(length)||length<1)throw new Error('파트 경계가 프로젝트 범위를 벗어납니다.');
 if(c.notes.some(n=>n.startTick<deltaTicks)||(c.events??[]).some(e=>e.tick<deltaTicks))throw new Error('기존 노트·컨트롤러를 자르는 길이 변경은 지원하지 않습니다. 먼저 분할하세요.');
 return {command:'midi.clip.resizeStart',arguments:{clipId:id,deltaTicks}};});return deltaTicks?commands:[];
}

/** View ordering only: never renumber or reorder the project's stored marker array. */
export function sortProjectMarkers(markers,options={}){
 if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>!['sortBy','direction'].includes(k)))throw new Error('Invalid marker ordering options');
 const {sortBy='position',direction='ascending'}=options;
 if(!['position','number','name','type','end','length','id'].includes(sortBy)||!['ascending','descending'].includes(direction))throw new Error('Unknown marker sort column or direction');
 const value=m=>sortBy==='position'?m.tick:sortBy==='number'?m.number:sortBy==='type'?(m.endTick===undefined?0:1):sortBy==='end'?(m.endTick??m.tick):sortBy==='length'?(m.endTick===undefined?0:m.endTick-m.tick):String(m[sortBy]).toLowerCase();
 return markers.map((marker,index)=>({marker,index})).sort((a,b)=>{const x=value(a.marker),y=value(b.marker),comparison=x<y?-1:x>y?1:0;return comparison*(direction==='descending'?-1:1)||a.index-b.index;}).map(row=>row.marker);
}

export function navigateMarkerRows(ids,currentId,key){
 if(!['ArrowUp','ArrowDown','Home','End'].includes(key))throw new Error('Unknown marker navigation key');if(!ids.length)return null;
 if(key==='Home')return ids[0];if(key==='End')return ids.at(-1);const index=ids.indexOf(currentId);
 if(index<0)return key==='ArrowUp'?ids.at(-1):ids[0];return ids[Math.max(0,Math.min(ids.length-1,index+(key==='ArrowDown'?1:-1)))];
}

export function resolveMarkerListView(input={}){
 const keys=['number','name','position','end','length','id','actions'],defaults={number:120,name:180,position:110,end:110,length:110,id:180,actions:140};
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['columns','widths','sortBy','direction'].includes(k)))throw new Error('Invalid marker view settings');
 const columns=input.columns??keys;if(!Array.isArray(columns)||columns.length!==keys.length||new Set(columns).size!==keys.length||columns.some(k=>!keys.includes(k)))throw new Error('Marker columns must contain every column once');
 if(input.widths!==undefined&&(!input.widths||typeof input.widths!=='object'||Array.isArray(input.widths)))throw new Error('Invalid marker widths');
 const widths={...defaults,...input.widths};for(const [k,v]of Object.entries(widths))if(!keys.includes(k)||!Number.isInteger(v)||v<60||v>600)throw new Error('Marker column width must be 60–600px');
 const sortBy=input.sortBy??'position',direction=input.direction??'ascending';sortProjectMarkers([],{sortBy,direction});return{columns:[...columns],widths,sortBy,direction};
}

export function recoverMarkerRowFocus(previousIds,nextIds,currentId){
 if(!nextIds.length)return null;if(nextIds.includes(currentId))return currentId;const index=Math.max(0,previousIds.indexOf(currentId));return nextIds[Math.min(index,nextIds.length-1)];
}

// Greedy interval partitioning: half-open touching events can share a lane.
export function assignAudioEventLanes(clips,assets,projectSampleRate){
 const metadata=new Map(assets.map(a=>[a.id,a])),ends=[],rows=new Map();
 const ordered=clips.map((clip,index)=>({clip,index})).sort((a,b)=>a.clip.startSample-b.clip.startSample||a.index-b.index);
 for(const {clip}of ordered){const asset=metadata.get(clip.assetId);if(!asset)throw new Error('Audio lane asset is missing.');const end=clip.startSample+Math.ceil(clip.lengthFrames*projectSampleRate/asset.sampleRate);let lane=ends.findIndex(value=>value<=clip.startSample);if(lane<0)lane=ends.length;ends[lane]=end;rows.set(clip.id,lane);}
 return{rows,laneCount:ends.length};
}
