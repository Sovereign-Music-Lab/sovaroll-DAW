import { integer, requireValue } from './common.mjs';
import { compileExactTempoMap } from './exact-tempo.mjs';
import { resolveTimeDisplay } from './time-display.mjs';
import { compileMusicalTime } from './musical-time.mjs';
import { compileTimecode } from './timecode.mjs';
import { timeFields, timeInteger, secondsForUnits, parseClockMilliseconds } from './elapsed-time.mjs';

export const ELAPSED_GRID_TYPES=Object.freeze({
  seconds:Object.freeze(['1-ms','10-ms','100-ms','1000-ms']),
  samples:Object.freeze(['1-sample','10-samples','100-samples','44100-samples']),
  timecode:Object.freeze(['subframe','quarter-frame','half-frame','frame','two-frames','1-second']),
  'user-fps':Object.freeze(['subframe','quarter-frame','half-frame','frame','two-frames','1-second'])
});
const MAX=Number.MAX_SAFE_INTEGER;
const checkedTick=(n,label)=>integer(n,0,MAX,label);
const safeAdd=(a,b)=>{requireValue(BigInt(a)+BigInt(b)<=BigInt(MAX),'EXACT_TIME_OUT_OF_RANGE','Converted position exceeds safe source tick range.');return a+b;};

/** Shared edit resolver only: callers must still enforce document/revision/profile
 * guards and use the command engine for persistence/Undo. No source object is edited.
 * Numeric time input is parsed exactly; pointer pixels never enter this API.
 */
export function compileTimeEditResolver(project,{displayPpq=480}={}){
  const settings=resolveTimeDisplay(project.timeDisplay),sampleRate=integer(project.sampleRate,1,MAX,'Sample rate');
  const time=compileExactTempoMap(project.tempoMap,project.ppq),musical=compileMusicalTime({ppq:project.ppq,displayPpq,timeSignature:project.timeSignature});
  const f=settings.frameRate,tc=compileTimecode({nominalFps:f.nominalFps,rate:{numerator:f.numerator,denominator:f.denominator},dropFrame:f.dropFrame}),user=compileTimecode({nominalFps:settings.userFps});
  function formatFor(scope='primary'){
    requireValue(['primary','timeline','piano'].includes(scope),'INVALID_TIME_EDIT','Unknown edit time scope.');const selected=scope==='primary'?settings.primaryFormat:settings[scope+'Format'];return selected==='inherit'?settings.primaryFormat:selected;
  }
  function unitRate(format){return format==='seconds'?{numerator:1000,denominator:1}:format==='samples'?{numerator:sampleRate,denominator:1}:format==='user-fps'?{numerator:settings.userFps*80,denominator:1}:{numerator:f.numerator*80,denominator:f.denominator};}
  function parsed(text,format){
    requireValue(typeof text==='string','INVALID_TIME_EDIT','Time edits require explicit text.');
    const count=format==='seconds'?parseClockMilliseconds(text):format==='samples'?timeInteger(text).toString():(format==='timecode'?tc:user).parse(text),rate=unitRate(format);
    return {count,rate,seconds:secondsForUnits(count,rate)};
  }
  function target(text,scope,origin,rounding,duration){
    checkedTick(origin,'Time origin');const format=formatFor(scope);
    if(format==='bars-beats'){
      const local=musical[duration?'parseDuration':'parsePosition'](text,rounding);return{tick:safeAdd(origin,local),format,originTick:origin,rounding,precision:time.precision};
    }
    const {count,rate,seconds}=parsed(text,format),fraction=time.tickFractionAtElapsed(origin,seconds),tick=time.tickAtElapsed(origin,seconds,rounding);
    return {tick,format,originTick:origin,rounding,precision:time.precision,requestedUnits:count,unitRate:rate,targetTick:fraction,exact:fraction.denominator==='1'};
  }
  return Object.freeze({precision:time.precision,formatFor,
    position(text,options={}){
      timeFields(options,['scope','originTick','rounding']);const {scope='primary',originTick=0,rounding='exact'}=options;return target(text,scope,originTick,rounding,false);
    },
    duration(text,options){
      timeFields(options,['scope','startTick','rounding']);const {scope='primary',startTick,rounding='exact'}=options;checkedTick(startTick,'Duration start');const result=target(text,scope,startTick,rounding,true);return {...result,startTick,endTick:result.tick,durationTicks:result.tick-startTick};
    },
    snap(tick,gridType,options={}){
      timeFields(options,['scope','originTick','rounding','sourceRounding','secondBasis']);const {scope='primary',originTick=0,rounding='nearest',sourceRounding='exact',secondBasis}=options,format=formatFor(scope);
      requireValue(ELAPSED_GRID_TYPES[format]?.includes(gridType),'INVALID_TIME_GRID','Choose a grid belonging to the selected elapsed time format.');
      let step,rate=unitRate(format),basis='format-units';
      if(format==='seconds'||format==='samples'){step=Number(gridType.split('-')[0]);requireValue(secondBasis===undefined,'INVALID_TIME_GRID','Second basis only applies to frame-format1-second grids.');}
      else if(gridType==='1-second'){
        requireValue(['elapsed','nominal-frames'].includes(secondBasis),'TIME_GRID_BASIS_REQUIRED','Frame-format1-second grids require explicit elapsed or nominal-frames basis.');basis=secondBasis;
        if(secondBasis==='elapsed'){rate={numerator:1,denominator:1};step=1;}else step=(format==='user-fps'?settings.userFps:f.nominalFps)*80;
      }else{
        requireValue(secondBasis===undefined,'INVALID_TIME_GRID','Second basis only applies to1-second grids.');step={subframe:1,'quarter-frame':20,'half-frame':40,frame:80,'two-frames':160}[gridType];
      }
      return {...time.snapTick(tick,{step,unitRate:rate,originTick,rounding,sourceRounding}),format,gridType,basis,step:String(step),unitRate:rate,precision:time.precision};
    }
  });
}
