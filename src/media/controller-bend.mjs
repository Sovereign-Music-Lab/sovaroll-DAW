import {controllerLane,controllerValue,withControllerValue,evaluateCurve,localControllerCurve} from './midi-curves.mjs';
import {requireValue} from './common.mjs';
const need=(ok,message)=>requireValue(ok,'INVALID_CONTROLLER_SEGMENT',message);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
/** Describe visible local geometry without mutating or expanding the source clip.
 * Window edges use the same integer endpoint rebasing as intentional core edits. */
export function describeControllerSegment(clip,event,next){
 const lane=controllerLane(event);if(!lane||lane.kind==='program'||next&&controllerLane(next)?.key!==lane.key)return null;
 if(next&&next.tick<=event.tick)return null;
 const end=Math.min(clip.lengthTicks,next?.tick??Infinity,event.curve?.window?.endTick??Infinity);
 if(!Number.isFinite(end)||end<=event.tick||!next&&!event.curve?.window)return null;
 const endpoint=next?.tick===end?structuredClone(next):{...withControllerValue(event,Math.round(evaluateCurve(event,next,end))),tick:end};
 delete endpoint.curve;
 const point=structuredClone(event);
 if(event.curve?.window)point.curve=localControllerCurve(event,next,end);
 const tick=event.tick+(end-event.tick)/2,value=evaluateCurve(point,endpoint,tick);
 return {point,next:endpoint,tick,value,max:lane.max};
}
/** Vertical center displacement; fixed endpoint values/times and handle times.
 * Equal displacement of both controls is scaled by their exact midpoint weight.
 * Clamping control values keeps the whole Bezier inside the MIDI value domain. */
export function bendControllerCurve(segment,deltaValue){
 need(segment&&['ramp','bezier'].includes(segment.point.curve?.type),'Bending requires an active Ramp or Bezier segment.');
 need(Number.isFinite(deltaValue)&&Math.abs(deltaValue)<=segment.max,'Bend displacement exceeds the MIDI value domain.');
 const a=controllerValue(segment.point),b=controllerValue(segment.next),original=segment.point.curve;
 const handles=original.type==='bezier'?structuredClone(original.handles):[{x:1/3,value:a+(b-a)/3},{x:2/3,value:a+2*(b-a)/3}];
 let lo=0,hi=1;for(let i=0;i<60;i++){const t=(lo+hi)/2,u=1-t,x=3*u*u*t*handles[0].x+3*u*t*t*handles[1].x+t*t*t;if(x<.5)lo=t;else hi=t;}
 const t=(lo+hi)/2,offset=deltaValue/(3*t*(1-t));
 for(const handle of handles)handle.value=clamp(handle.value+offset,0,segment.max);
 return {type:'bezier',handles};
}
