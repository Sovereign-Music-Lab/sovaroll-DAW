import {finite,integer,requireValue} from './common.mjs';
import {compileEditorSnap} from './snap-grid.mjs';

const MAX = Number.MAX_SAFE_INTEGER;
const LIMIT = 200000;

/** Pure position-edit boundary. Never use this for hit testing, rectangle
 * selection, hover, value-only painting or normalized curve handles.
 * A caller must retain its document/revision/profile guard until commit.
 */
export function compileControllerTimeGesture(project,{clipId,snapEnabled=true}={}) {
  requireValue(typeof snapEnabled==='boolean','INVALID_CONTROLLER_GESTURE','Snap must be boolean.');
  const clip=project.clips.find(c=>c.id===clipId);
  requireValue(clip?.type==='midi','INVALID_CONTROLLER_GESTURE','An existing MIDI clip is required.');
  const length=integer(clip.lengthTicks,1,MAX,'Clip length');
  integer(clip.startTick,0,MAX-length,'Clip start');
  const grid=compileEditorSnap(project,{scope:'piano',clipId});
  function bounded(tick) {
    requireValue(Number.isSafeInteger(tick)&&tick>=0&&tick<=length,
      'CONTROLLER_GESTURE_OUT_OF_BOUNDS','The complete edit must fit inside the clip; positions are not clamped.');
    return tick;
  }
  function position(localTick) {
    // Preserve the fractional local pointer until grid selection. In particular,
    // Math.round(localTick) before grid.snap changes the selected elapsed cell.
    finite(localTick,0,length,'Controller pointer tick');
    return bounded(snapEnabled?grid.snap(localTick,'nearest').localTick:Math.round(localTick));
  }
  function point(input) {
    requireValue(input&&typeof input==='object','INVALID_CONTROLLER_GESTURE','Expected a controller point.');
    integer(input.value,0,16383,'Controller value');
    return {tick:position(input.tick),value:input.value};
  }
  return Object.freeze({clipId,lengthTicks:length,mode:snapEnabled?grid.mode:'off',position,
    // This resolves actual pointer samples, not Paint/Length Quantize resampling.
    // Last sample wins when multiple samples map to one stored source tick.
    draw(samples) {
      requireValue(Array.isArray(samples)&&samples.length>0&&samples.length<=LIMIT,
        'INVALID_CONTROLLER_GESTURE','Draw requires 1–200000 pointer samples.');
      const points=new Map();
      for(const sample of samples){const p=point(sample);points.set(p.tick,p);}
      return [...points.values()].sort((a,b)=>a.tick-b.tick);
    },
    move({anchorTick,targetTick,points}) {
      bounded(anchorTick);
      requireValue(Array.isArray(points)&&points.length>0&&points.length<=LIMIT,
        'INVALID_CONTROLLER_GESTURE','Move requires 1–200000 selected points.');
      requireValue(points.some(p=>p?.tick===anchorTick),'INVALID_CONTROLLER_GESTURE','The anchor must belong to the selection.');
      const tick=position(targetTick),deltaTick=tick-anchorTick;
      // Do not snap each selected event independently: tempo changes would
      // alter spacing. One anchor defines the common integer source delta.
      const ticks=points.map(p=>{
        bounded(p.tick);
        if(p.endTick!==undefined){bounded(p.endTick);requireValue(p.endTick>=p.tick,'INVALID_CONTROLLER_GESTURE','End must follow start.');bounded(p.endTick+deltaTick);}
        return bounded(p.tick+deltaTick);
      });
      return {tick,deltaTick,ticks};
    },
    line({start,end,stepTicks}) {
      let a=point(start),b=point(end);
      if(a.tick>b.tick)[a,b]=[b,a];
      requireValue(b.tick>a.tick,'CONTROLLER_GESTURE_COLLAPSED','Line endpoints map to the same source tick.');
      // Density is independent of position snap. stepTicks has already been
      // parsed from display ticks by the caller; Snap off uses source tick 1.
      const step=snapEnabled?integer(stepTicks,1,MAX,'Line density'):1;
      requireValue(Math.ceil((b.tick-a.tick)/step)+1<=LIMIT,'MIDI_EVENT_LIMIT','Line density exceeds 200000 points.');
      return {startTick:a.tick,endTick:b.tick,startValue:a.value,endValue:b.value,stepTicks:step};
    }
  });
}
