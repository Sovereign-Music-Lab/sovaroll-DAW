import {resolveStepSettings} from './step-settings.mjs';
import {compileEditorSnap} from './snap-grid.mjs';
import {integer,requireValue} from './common.mjs';
/** Resolve one complete grid-cell duration at the insertion position.
 * We preserve the explicit input onset, including off-grid onsets.
 * Elapsed grids use the shared rounding policy and may reject inexact cells.
 */
export function resolveStepTiming(project,clip,args){
 args={...resolveStepSettings(project),...args};
 const gridTicks=source=>{
  const scope=source==='pianoGrid'?'piano':'primary';
  const grid=compileEditorSnap(project,{scope,clipId:clip.id});
  const localTick=scope==='piano'?args.atTick:clip.startTick+args.atTick;
  const cell=grid.cell(localTick);
  requireValue(!cell.collapsed,'STEP_GRID_COLLAPSED','Step grid cell collapses at this position.');
  return integer(cell.durationTicks,1,Number.MAX_SAFE_INTEGER,'Step grid duration');
 };
 const stepSource=args.stepSource??'ticks',lengthSource=args.lengthSource??'ticks';
 const stepTicks=stepSource==='ticks'?integer(args.stepTicks,1,Number.MAX_SAFE_INTEGER,'Step ticks'):gridTicks(stepSource);
 const noteValue=project.ppq*4/args.lengthDenominator*(args.lengthModifier==='dotted'?1.5:args.lengthModifier==='triplet'?2/3:1);
 const durationTicks=lengthSource==='noteValue'?Math.max(1,Math.round(noteValue)):lengthSource==='step'?stepTicks:lengthSource==='ticks'?integer(args.durationTicks,1,Number.MAX_SAFE_INTEGER,'Note duration'):gridTicks(lengthSource);
 return {stepSource,lengthSource,stepTicks,durationTicks,...(lengthSource==='noteValue'?{lengthDenominator:args.lengthDenominator,lengthModifier:args.lengthModifier,lengthRounded:noteValue!==durationTicks}:{})};
}

/** Cursor-only navigation. Never adds rests, notes, clip length or Undo records. */
export function moveStepCursor(project,clip,args,direction){
 requireValue(direction===-1||direction===1,'INVALID_STEP_DIRECTION','Choose previous or next step.');
 const atTick=integer(args.atTick,0,Number.MAX_SAFE_INTEGER,'Step cursor');
 const timing=resolveStepTiming(project,clip,{...args,atTick:direction<0?Math.max(0,atTick-1):atTick});
 const nextTick=Math.max(0,atTick+direction*timing.stepTicks);
 requireValue(Number.isSafeInteger(nextTick)&&Number.isSafeInteger(clip.startTick+nextTick),'STEP_CURSOR_OVERFLOW','Step cursor exceeds safe time.');
 return {atTick:nextTick,projectTick:clip.startTick+nextTick,stepTicks:timing.stepTicks};
}

export function resizeHeldStep(project,clip,args,durationTicks,direction){
 requireValue(direction===-1||direction===1,'INVALID_STEP_DIRECTION','Choose shorter or longer.');
 const timing=resolveStepTiming(project,clip,args),current=durationTicks??timing.durationTicks;
 integer(current,1,Number.MAX_SAFE_INTEGER,'Held note duration');
 const duration=Math.max(1,current+direction*timing.stepTicks);
 requireValue(Number.isSafeInteger(duration)&&Number.isSafeInteger(clip.startTick+args.atTick+duration),'STEP_DURATION_OVERFLOW','Held note duration exceeds safe time.');
 return {durationTicks:duration,stepTicks:timing.stepTicks};
}
