import {finite,integer,requireValue} from './common.mjs';
import {resolveTimeDisplay} from './time-display.mjs';
import {ELAPSED_GRID_TYPES} from './time-edit-resolver.mjs';
import {compilePointerTimeGrid} from './pointer-time-grid.mjs';
import {compileTempoMap} from './time.mjs';

const choice=values=>({type:'string',enum:values});
export const SNAP_GRID_FIELDS={mode:choice(['musical','time']),quarterNotes:{type:'number',enum:[.25,.5,1,2]},origin:choice(['project','clip']),sourceRounding:choice(['exact','floor','ceil','nearest']),seconds:choice([...ELAPSED_GRID_TYPES.seconds]),samples:choice([...ELAPSED_GRID_TYPES.samples]),timecode:choice(ELAPSED_GRID_TYPES.timecode.filter(x=>x!=='1-second')),userFps:choice(ELAPSED_GRID_TYPES['user-fps'].filter(x=>x!=='1-second'))};
const configSchema={type:'object',additionalProperties:false,properties:SNAP_GRID_FIELDS,required:Object.keys(SNAP_GRID_FIELDS)};
export const snapGridSchema={type:'object',additionalProperties:false,properties:{primary:configSchema,piano:configSchema},required:['primary','piano']};
export const snapGridPatchSchema={...snapGridSchema,required:[],properties:{primary:{...configSchema,required:[]},piano:{...configSchema,required:[]}}};
const plain=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
const defaults=origin=>({mode:'musical',quarterNotes:.25,origin,sourceRounding:'exact',seconds:'100-ms',samples:'100-samples',timecode:'frame',userFps:'frame'});
export function resolveSnapGrid(input={}){
 requireValue(plain(input)&&Object.keys(input).every(k=>['primary','piano'].includes(k)),'INVALID_SNAP_GRID','Unknown snap grid scope.');const result={};
 for(const scope of ['primary','piano']){
  const value=Object.hasOwn(input,scope)?input[scope]:{};requireValue(plain(value)&&Object.keys(value).every(k=>Object.hasOwn(SNAP_GRID_FIELDS,k)),'INVALID_SNAP_GRID','Unknown snap grid setting.');
  const config={...defaults(scope==='primary'?'project':'clip'),...value};for(const [key,schema]of Object.entries(SNAP_GRID_FIELDS))requireValue(schema.enum.includes(config[key]),'INVALID_SNAP_GRID',`Invalid grid ${key}`);
  requireValue(scope!=='primary'||config.origin==='project','INVALID_SNAP_GRID','Primary grid uses project origin.');result[scope]=config;
 }return result;
}
export function patchSnapGrid(current,patch){
 requireValue(plain(patch)&&Object.keys(patch).length>0&&Object.keys(patch).every(k=>['primary','piano'].includes(k)),'INVALID_SNAP_GRID','Provide a primary or piano grid patch.');
 const value=resolveSnapGrid(current);for(const [scope,update]of Object.entries(patch)){requireValue(plain(update)&&Object.keys(update).length>0,'INVALID_SNAP_GRID','Grid patch must not be empty.');value[scope]={...value[scope],...update};}return resolveSnapGrid(value);
}

/** Primary grid follows primaryFormat, regardless of Timeline ruler override.
 * Piano uses pianoFormat/inherit, with an explicit project or clip grid origin.
 * Musical mode preserves legacy clip-local integer tick snapping.
 */
export function compileEditorSnap(project,{scope='piano',clipId}={}){
 project={...project,tempoMap:project.tempoMap.map(p=>({...p})),timeDisplay:project.timeDisplay===undefined?undefined:structuredClone(project.timeDisplay)};
 requireValue(['primary','piano'].includes(scope),'INVALID_SNAP_GRID','Use primary or piano snap scope.');
 const config=resolveSnapGrid(project.snapGrid)[scope],display=resolveTimeDisplay(project.timeDisplay),selected=scope==='primary'?display.primaryFormat:display.pianoFormat,format=selected==='inherit'?display.primaryFormat:selected;
 const clip=clipId===undefined?null:project.clips.find(c=>c.id===clipId);requireValue(scope!=='piano'||clip?.type==='midi','INVALID_SNAP_GRID','Piano snap needs an existing MIDI clip.');
 const inputOriginTick=scope==='piano'?clip.startTick:0,originTick=config.origin==='clip'?inputOriginTick:0,stepTicks=Math.max(1,Math.round(config.quarterNotes*project.ppq));
 const mode=config.mode==='time'&&format!=='bars-beats'?'time':'musical',gridType=mode==='time'?config[format==='user-fps'?'userFps':format]:null;
 const options={scope,originTick,inputOriginTick,gridType,sourceRounding:config.sourceRounding},elapsed=mode==='time'?compilePointerTimeGrid(project,options):null;
 const metadata={scope,mode,format,originTick:mode==='time'?originTick:inputOriginTick,inputOriginTick,gridType,stepTicks,config:Object.freeze({...config})};
 function snap(localTick,rounding='nearest'){
  if(elapsed)return elapsed.snap(localTick,{rounding});
  finite(localTick,0,Number.MAX_SAFE_INTEGER,'Musical local tick');requireValue(['floor','ceil','nearest'].includes(rounding),'INVALID_TIME_ROUNDING','Musical pointer rounding must be floor, ceil or nearest.');
  const local=(rounding==='nearest'?Math.round:Math[rounding])(localTick/stepTicks)*stepTicks,tick=local+inputOriginTick;integer(tick,0,Number.MAX_SAFE_INTEGER,'Musical snapped tick');
  return{tick,localTick:local,gridIndex:String(local/stepTicks),exact:true,precision:'legacy-musical-float64',sourceRounding:'integer-grid'};
 }
 let visual=null,tempo=null;
 return Object.freeze({...metadata,snap,
  cell(localTick,rounding='floor'){if(elapsed)return elapsed.cell(localTick,{rounding});const start=snap(localTick,rounding),end=snap(start.localTick+stepTicks,'floor');return{start,end,durationTicks:end.tick-start.tick,collapsed:false};},
  // Display-only thinning. Source snapping never uses these coarsened lines.
  lines(endTick,{maxLines=1024}={}){
   integer(endTick,0,Number.MAX_SAFE_INTEGER,'Grid end');integer(maxLines,2,4096,'Grid line budget');if(!elapsed)return[];
   visual??=compilePointerTimeGrid(project,{...options,sourceRounding:'nearest'});tempo??=compileTempoMap(project.tempoMap,project.ppq);
   const first=BigInt(visual.snap(0,{rounding:'ceil'}).gridIndex),last=BigInt(visual.snap(endTick,{rounding:'floor'}).gridIndex),count=last-first+1n;if(count<=0n)return[];
   const stride=(count+BigInt(maxLines)-1n)/BigInt(maxLines),start=first>=0n?(first+stride-1n)/stride*stride:first/stride*stride,lines=[],secondsPerUnit=visual.unitRate.denominator/visual.unitRate.numerator,originSeconds=tempo.tickToSeconds(originTick);
   for(let index=start;index<=last&&lines.length<maxLines;index+=stride){const seconds=originSeconds+Number(index*BigInt(visual.step))*secondsPerUnit;if(seconds<0)continue;const local=tempo.secondsToTick(seconds)-inputOriginTick;if(local>=0&&local<=endTick)lines.push({tick:local,gridIndex:index.toString()});}return lines;
  }
 });
}
