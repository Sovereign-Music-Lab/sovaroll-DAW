import {splitMidiCurves,validateMidiCurves} from './midi-curves.mjs';
/** Detached source fragments for time insertion. Keep fragments separate: merging
 * them would interpolate editable curves through the newly inserted interval. */
export function planControllerTimeInsertion(clip,{atTick,lengthTicks}={}){
 if(!Number.isSafeInteger(atTick)||atTick<0||atTick>clip.lengthTicks||!Number.isSafeInteger(lengthTicks)||lengthTicks<1||!Number.isSafeInteger(clip.startTick+clip.lengthTicks+lengthTicks))throw new Error('Invalid controller insertion interval');
 validateMidiCurves(clip);
 const left=structuredClone(clip),right=structuredClone(clip);let changes={createdEventIds:[],movedEventIds:[],updatedEventIds:[],warnings:[]};
 if(atTick===0){left.events=[];left.lengthTicks=0;right.startTick+=lengthTicks;}
 else if(atTick===clip.lengthTicks){left.lengthTicks++;changes=splitMidiCurves(left,right,atTick,{chaseControllers:true});left.lengthTicks=atTick;right.startTick+=atTick+lengthTicks;right.lengthTicks=0;}
 else{changes=splitMidiCurves(left,right,atTick,{chaseControllers:true});left.lengthTicks=atTick;right.startTick+=atTick+lengthTicks;right.lengthTicks-=atTick;}
 // This planner owns controller fragments only; notes use their independent plan.
 left.notes=[];right.notes=[];
 return {left,right,changes,insertedTicks:lengthTicks,requiresFragmentCommit:true};
}
