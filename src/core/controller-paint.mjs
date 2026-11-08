import {fail,MAX_MIDI_EVENTS} from './schema.mjs';
import {addMidiEvents} from './midi-events.mjs';
import {controllerLane,controllerValue,withControllerValue,evaluateCurve,validateMidiCurves} from '../media/midi-curves.mjs';
const clone=x=>structuredClone(x),round=x=>Math.floor(x+.5);
const geometry=(p,n)=>p.curve?.window??(n&&n.tick>p.tick?{startTick:p.tick,endTick:n.tick,startValue:controllerValue(p),endValue:controllerValue(n)}:null);
function eventFor(lane,tick,value){
 const status={cc:0xb0,pitchBend:0xe0,channelPressure:0xd0,polyPressure:0xa0,program:0xc0}[lane.kind]|lane.channel;
 return {kind:'channel',status,tick,data:lane.kind==='cc'?[lane.controller,value]:lane.kind==='polyPressure'?[lane.pitch,value]:lane.kind==='pitchBend'?[value&127,value>>7]:[value]};
}
/** Engine candidate only. Preserve old materialized integer-tick values outside
 * the inclusive range using explicit guards and editable original windows.
 * This is not a destructive bake. Only swap events after complete validation.
 */
export function replaceControllerPaint(clip,{lane,startTick,endTick,points,curve=null}){
 if(startTick>endTick||endTick>clip.lengthTicks)fail('INVALID_CONTROLLER_RANGE','Paint range must fit the clip, including its end tick.');
 const max=lane.kind==='pitchBend'?16383:127;
 if(new Set(points.map(p=>p.tick)).size!==points.length)fail('DUPLICATE_POINT_TIME','Paint points must have distinct source ticks.');
 for(const p of points){if(p.tick<startTick||p.tick>endTick)fail('MIDI_EVENT_OUT_OF_BOUNDS','Every Paint point must be inside its inclusive range.');if(p.value>max)fail('CONTROLLER_VALUE_OUT_OF_BOUNDS',`Controller value must be 0..${max}.`);}
 if(curve?.handles?.some(h=>h.value>max))fail('CONTROLLER_VALUE_OUT_OF_BOUNDS','Paint curve handles exceed the lane value range.');
 if(curve&&lane.kind==='program')fail('CURVE_NOT_SUPPORTED','Program changes cannot carry continuous curves.');
 validateMidiCurves(clip);
 const key=controllerLane(eventFor(lane,0,0)).key,original=clip.events??[];
 const selected=original.filter(e=>controllerLane(e)?.key===key).sort((a,b)=>a.tick-b.tick||a.order-b.order);
 const retained=original.filter(e=>controllerLane(e)?.key!==key||e.tick<startTick||e.tick>endTick).map(clone);
 const byId=new Map(retained.map(e=>[e.id,e])),inputs=[],warnings=[],guardInputs=[],edgeInputs=[];
 function active(tick){let lo=0,hi=selected.length;while(lo<hi){const m=(lo+hi)>>1;if(selected[m].tick<=tick)lo=m+1;else hi=m;}return {point:selected[lo-1],next:selected[lo]};}
 function guard(point,next,tick,{resume=false}={}){
  const event=withControllerValue(point,round(evaluateCurve(point,next,tick)));delete event.id;delete event.order;delete event.curve;event.tick=tick;
  const g=geometry(point,next);if(resume&&point.curve&&g&&g.endTick>tick)event.curve={...clone(point.curve),window:{...clone(g),emitStart:'raw'}};
  inputs.push(event);guardInputs.push(event);return event;
 }
 if(startTick>0){const left=startTick-1,{point,next}=active(left);if(point?.curve){const saved=byId.get(point.id),g=geometry(point,next);if(point.tick===left||!g)delete saved.curve;else{saved.curve={...clone(point.curve),window:{...clone(g),emitStart:point.curve.window?.emitStart??'raw'}};guard(point,next,left);}}}
 if(endTick<clip.lengthTicks){const right=endTick+1,{point,next}=active(right);if(point?.tick!==right){if(point)guard(point,next,right,{resume:true});else warnings.push({code:'CONTROLLER_PAINT_UNKNOWN_PRIOR_STATE',message:'No stored lane state exists after this range; the painted value holds until the next stored event. No device default was invented.'});}}
 const knots=[...points].sort((a,b)=>a.tick-b.tick);
 // Sparse density can omit extrema: explicit edges hold nearest sampled values.
 if(knots[0].tick>startTick)knots.unshift({tick:startTick,value:knots[0].value,edge:true});
 if(knots.at(-1).tick<endTick)knots.push({tick:endTick,value:knots.at(-1).value,edge:true});
 const representatives=new Map();for(const e of selected)if(e.tick>=startTick&&e.tick<=endTick)representatives.set(e.tick,e);
 for(let i=0;i<knots.length;i++){const p=knots[i],event=eventFor(lane,p.tick,p.value),prior=representatives.get(p.tick);if(prior){event.id=prior.id;event.order=prior.order;}if(curve&&i<knots.length-1)event.curve=clone(curve);inputs.push(event);if(p.edge)edgeInputs.push(event);}
 if(retained.length+inputs.length>MAX_MIDI_EVENTS)fail('MIDI_EVENT_LIMIT','Paint points and boundary guards exceed the raw MIDI event budget.');
 const candidate={...clip,events:retained},added=addMidiEvents(candidate,inputs);validateMidiCurves(candidate);
 const oldById=new Map(original.map(e=>[e.id,e])),newById=new Map(candidate.events.map(e=>[e.id,e])),created=[],updated=[],removed=[];
 for(const e of candidate.events){const old=oldById.get(e.id);if(!old)created.push(e.id);else if(JSON.stringify(old)!==JSON.stringify(e))updated.push(e.id);}
 for(const e of original)if(!newById.has(e.id))removed.push(e.id);
 const guardSet=new Set(guardInputs),edgeSet=new Set(edgeInputs);clip.events=candidate.events;
 return {created,updated:[...updated,clip.id],removed,warnings,paintRange:{startTick,endTick},boundaryGuardIds:added.filter((e,i)=>guardSet.has(inputs[i])).map(e=>e.id),paintEdgeIds:added.filter((e,i)=>edgeSet.has(inputs[i])).map(e=>e.id)};
}
