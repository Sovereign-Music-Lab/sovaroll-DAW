/** Browser-safe editable controller geometry. Sampling never mutates project data. */
export const MAX_CURVE_EVALUATIONS = 2_000_000;
export const MAX_MATERIALIZED_EVENTS = 200_000;
const MAX = Number.MAX_SAFE_INTEGER;
const scalar = { type: 'number', minimum: 0, maximum: 16383 };
const object = (properties, required = Object.keys(properties)) => ({type:'object',properties,required,additionalProperties:false});
const windowSchema = object({startTick:{type:'integer',minimum:-MAX,maximum:MAX},endTick:{type:'integer',minimum:-MAX,maximum:MAX},startValue:scalar,endValue:scalar,emitStart:{type:'string',enum:['raw','sample']}});
const handlesSchema = {type:'array',minItems:2,maxItems:2,items:object({x:{type:'number',minimum:0,maximum:1},value:scalar})};
export const controllerCurveSchema = {oneOf:[
  object({type:{const:'ramp'},window:windowSchema},['type']),
  object({type:{const:'bezier'},handles:handlesSchema,window:windowSchema},['type','handles']),
]};
const risky = new Set([0,32,64,98,99,100,101,120,121,122,123,124,125,126,127]);
function fail(code,message,details) { const e=new Error(message);e.name='MidiCurveError';e.code=code;if(details)e.details=details;throw e; }
function need(ok,message,details) { if(!ok) fail('INVALID_MIDI_CURVE',message,details); }
function finite(value,min,max) { return Number.isFinite(value)&&value>=min&&value<=max; }
function integer(value,min=0,max=MAX) { return Number.isSafeInteger(value)&&value>=min&&value<=max; }
function exactKeys(value,allowed) { return value && typeof value==='object' && !Array.isArray(value) && Object.keys(value).every(k=>allowed.includes(k)); }
const clone = value => structuredClone(value);
const rounded = value => Math.floor(value+0.5);
const newId = () => `event-${globalThis.crypto.randomUUID()}`;

/** Program is a numeric point lane but never a smoothly interpolated curve. */
export function controllerLane(event) {
  if(event?.kind!=='channel'||!integer(event.status,0x80,0xef)||!Array.isArray(event.data))return null;
  const channel=event.status&15,type=event.status>>4,data=event.data;
  if(!data.every(v=>integer(v,0,127)))return null;
  let kind,extra={},max=127;
  if(type===11&&data.length===2){kind='cc';extra.controller=data[0];}
  else if(type===14&&data.length===2){kind='pitchBend';max=16383;}
  else if(type===13&&data.length===1)kind='channelPressure';
  else if(type===10&&data.length===2){kind='polyPressure';extra.pitch=data[0];}
  else if(type===12&&data.length===1)kind='program';
  else return null;
  return {key:`${kind}:${channel}:${extra.controller??extra.pitch??''}`,kind,channel,...extra,min:0,max};
}
export function controllerValue(event) {
  const lane=controllerLane(event);need(lane,'The event is not a numeric controller point.');
  return lane.kind==='pitchBend'?event.data[0]+event.data[1]*128:event.data.at(-1);
}
export function withControllerValue(event,value) {
  const lane=controllerLane(event);need(lane&&integer(value,0,lane.max),'Controller value is outside its MIDI integer range.');
  const copy=clone(event);
  if(lane.kind==='pitchBend')copy.data=[value&127,value>>7];else copy.data[copy.data.length-1]=value;
  return copy;
}
function cubic(a,b,c,d,t) { const u=1-t;return u*u*u*a+3*u*u*t*b+3*u*t*t*c+t*t*t*d; }
function parameter(x,handles) {
  if(x<=0)return 0;if(x>=1)return 1;
  let lo=0,hi=1;
  for(let i=0;i<64;i++){const mid=(lo+hi)/2,v=cubic(0,handles[0].x,handles[1].x,1,mid);if(v===x)return mid;if(v<x)lo=mid;else hi=mid;}
  return (lo+hi)/2;
}
function geometry(event,next) {
  const w=event.curve?.window;
  if(w)return {startTick:w.startTick,endTick:w.endTick,startValue:w.startValue,endValue:w.endValue};
  if(!next||next.tick<=event.tick)return null;
  return {startTick:event.tick,endTick:next.tick,startValue:controllerValue(event),endValue:controllerValue(next)};
}
/** Float geometry in clip-relative ticks; only the materializer quantizes to MIDI. */
export function evaluateCurve(event,next,tick) {
  need(Number.isFinite(tick),'Curve evaluation tick must be finite.');
  const value=controllerValue(event),curve=event.curve,g=geometry(event,next);
  if(!curve||!g)return value;
  need(finite(g.startTick,-MAX,MAX)&&finite(g.endTick,-MAX,MAX)&&g.endTick>g.startTick&&finite(g.startValue,0,controllerLane(event).max)&&finite(g.endValue,0,controllerLane(event).max),'Invalid curve evaluation domain.');
  const x=Math.max(0,Math.min(1,(tick-g.startTick)/(g.endTick-g.startTick)));
  if(curve.type==='ramp')return g.startValue+(g.endValue-g.startValue)*x;
  need(curve.type==='bezier'&&Array.isArray(curve.handles)&&curve.handles.length===2&&curve.handles.every(h=>h&&finite(h.x,0,1)&&finite(h.value,0,controllerLane(event).max)),'Invalid curve geometry.');
  const t=parameter(x,curve.handles);
  return cubic(g.startValue,curve.handles[0].value,curve.handles[1].value,g.endValue,t);
}
function lanesOf(clip) {
  const lanes=new Map();
  for(const [index,event] of (clip.events??[]).entries()){
    const lane=controllerLane(event);if(!lane)continue;
    if(!lanes.has(lane.key))lanes.set(lane.key,[]);
    lanes.get(lane.key).push({event,index,lane});
  }
  for(const points of lanes.values())points.sort((a,b)=>a.event.tick-b.event.tick||a.event.order-b.event.order||a.index-b.index);
  return lanes;
}
function nextPoint(points,index) { return points[index+1]?.event; }
function activeSegment(points,index) {
  const event=points[index].event,next=nextPoint(points,index);
  return !(next&&next.tick===event.tick);
}
function segmentEnd(clip,event,next) { return Math.min(clip.lengthTicks,next?.tick??clip.lengthTicks,event.curve?.window?.endTick??next?.tick??clip.lengthTicks); }
function validateCurve(event) {
  const curve=event.curve;if(curve===undefined)return;
  const lane=controllerLane(event);
  need(lane&&lane.kind!=='program','Only CC, pitch bend and pressure points can carry curves.',{eventId:event.id});
  need(exactKeys(curve,['type','handles','window'])&&['ramp','bezier'].includes(curve.type),'Unknown controller curve type.',{eventId:event.id});
  if(curve.type==='ramp')need(curve.handles===undefined,'Ramp curves do not contain Bezier handles.');
  else need(Array.isArray(curve.handles)&&curve.handles.length===2&&curve.handles.every(h=>exactKeys(h,['x','value'])&&finite(h.x,0,1)&&finite(h.value,0,lane.max)),'Bezier requires two finite in-range time/value handles.');
  if(curve.window!==undefined){
    const w=curve.window;
    need(exactKeys(w,['startTick','endTick','startValue','endValue','emitStart'])&&integer(w.startTick,-MAX)&&integer(w.endTick,-MAX)&&w.endTick>w.startTick&&Number.isSafeInteger(w.endTick-w.startTick)&&finite(w.startValue,0,lane.max)&&finite(w.endValue,0,lane.max)&&['raw','sample'].includes(w.emitStart),'Invalid source geometry window.');
    need(w.startTick<=event.tick&&event.tick<w.endTick,'A curve window must contain its current starting point.',{eventId:event.id});
    need(controllerValue(event)===rounded(evaluateCurve(event,undefined,event.tick)),'A curve window anchor must equal its quantized source value; rebase before editing it.',{eventId:event.id});
  }
}
function validateCurveClip(clip,editedEndpointIds) {
  need(clip&&integer(clip.lengthTicks,1)&&(clip.events===undefined||Array.isArray(clip.events)),'Invalid MIDI clip for controller curves.');
  for(const event of clip.events??[]){
    need(event&&integer(event.order),'Controller source points need integer source orders.');
    if(!integer(event.tick,0,clip.lengthTicks))fail('MIDI_EVENT_OUT_OF_BOUNDS','Raw MIDI events must fit within the clip, including its end tick.',{clipId:clip.id,eventId:event.id});
    validateCurve(event);
  }
  for(const points of lanesOf(clip).values())for(let i=0;i<points.length;i++){
    const event=points[i].event,next=nextPoint(points,i),w=event.curve?.window;
    if(w&&activeSegment(points,i)&&!editedEndpointIds?.has(event.id)){
      if(next&&next.tick<=w.endTick)need(controllerValue(next)===rounded(evaluateCurve(event,next,next.tick)),'A source window endpoint changed without rebasing its incoming curve.',{eventId:event.id,nextEventId:next.id});
      if(w.endTick<clip.lengthTicks)need(next&&next.tick<=w.endTick,'An interior source window requires its visible endpoint.');
    }
  }
  return true;
}
export function validateMidiCurves(clip) { return validateCurveClip(clip); }
function diagnostic(code,message,event,extra={}) { return {code,message,...(event?.id?{eventId:event.id}:{}),...extra}; }
/** Pure detached expansion. Only generated repeated values are omitted. The raw
 * 200k limit is shared with the parser; no implicit downsampling is performed. */
export function materializeMidiCurves(clip,{maxGeneratedEvents=MAX_MATERIALIZED_EVENTS,maxEvaluations=MAX_CURVE_EVALUATIONS,maxEvents=MAX_MATERIALIZED_EVENTS}={}) {
  validateMidiCurves(clip);
  need(integer(maxGeneratedEvents)&&integer(maxEvaluations)&&integer(maxEvents),'Invalid curve materialization budget.');
  const source=clip.events??[],events=[],diagnostics=[],generated=[],suppressed=new Set();
  let evaluations=0,segments=0;
  const segmentsToRun=[];
  for(const points of lanesOf(clip).values())for(let i=0;i<points.length;i++){
    const {event,lane}=points[i],next=nextPoint(points,i);if(!event.curve||!activeSegment(points,i))continue;
    const g=geometry(event,next);
    if(!g){diagnostics.push(diagnostic('CURVE_WITHOUT_ENDPOINT','A non-Step point has no later endpoint; its value holds without interpolation.',event));continue;}
    const end=segmentEnd(clip,event,next),first=event.tick+(event.curve.window?.emitStart==='sample'?0:1);
    const count=Math.max(0,end-first);
    evaluations+=count;
    if(evaluations>maxEvaluations)fail('MIDI_CURVE_TOO_COMPLEX','Controller curves exceed the fixed one-tick evaluation budget.',{evaluations,limit:maxEvaluations});
    segmentsToRun.push({event,next,lane,first,end});segments++;
    if(lane.kind==='cc'&&risky.has(lane.controller))diagnostics.push(diagnostic('CURVE_DISCRETE_CONTROLLER','This explicitly curved bank, sustain, selector or channel-mode CC has discrete musical effects; sampled values are still exported.',event,{controller:lane.controller}));
    if(event.curve.window?.emitStart==='sample'){
      suppressed.add(event);
      diagnostics.push(diagnostic('MIDI_CURVE_FRAGMENT_NOT_CHASED','Curve windows preserve the original sampled stream; playing a fragment alone does not chase preceding controller state.',event));
    }
  }
  for(const event of source)if(!suppressed.has(event))events.push(clone(event));
  for(const {event,next,lane,first,end} of segmentsToRun){
    let previous=first===event.tick?rounded(evaluateCurve(event,next,first-1)):controllerValue(event);
    for(let tick=first;tick<end;tick++){
      const value=Math.max(0,Math.min(lane.max,rounded(evaluateCurve(event,next,tick))));
      if(value===previous)continue;previous=value;
      if(generated.length>=maxGeneratedEvents||events.length+generated.length>=maxEvents)fail('MIDI_CURVE_TOO_COMPLEX','Stored and sampled controller messages exceed the materialized MIDI event budget.',{generated:generated.length+1,limit:Math.min(maxGeneratedEvents,maxEvents)});
      const sample=withControllerValue(event,value);delete sample.id;delete sample.curve;
      Object.assign(sample,{tick,curveGenerated:true,curveSourceId:event.id,curveLane:lane.key});generated.push(sample);
    }
  }
  if(events.length+generated.length>maxEvents)fail('MIDI_CURVE_TOO_COMPLEX','Stored and sampled controller messages exceed the materialized MIDI event budget.',{events:events.length+generated.length,limit:maxEvents});
  if(segments)diagnostics.push(diagnostic('MIDI_CURVES_SAMPLED','Editable controller curves are sampled at integer ticks and rounded to MIDI values; SMF contains sampled messages, not editable curve handles.',null,{segments,generated:generated.length,gridTicks:1}));
  return {events:events.concat(generated),diagnostics,stats:{segments,evaluations,generatedEvents:generated.length,sourceEvents:source.length,materializedEvents:events.length+generated.length,gridTicks:1}};
}

function translated(event,delta) { const result=clone(event);result.tick-=delta;if(result.curve?.window){result.curve.window.startTick-=delta;result.curve.window.endTick-=delta;}return result; }
function orderAllocator(events) {
  let order=-1;for(const e of events)order=Math.max(order,e.order??-1);
  return ()=>{if(order===MAX)fail('MIDI_ORDER_OVERFLOW','No source order remains for a new controller boundary point.');return ++order;};
}
function sourceWindow(event,next,emitStart=event.curve?.window?.emitStart??'raw') { const g=geometry(event,next);return {...g,emitStart}; }
/** Mutates the two clips' events only. The caller owns clip positions/lengths,
 * source-order group, transaction rollback and the complete changes receipt. */
export function splitMidiCurves(clip,right,delta,{chaseControllers=false}={}) {
  validateMidiCurves(clip);need(integer(delta,1)&&delta<clip.lengthTicks,'Curve split must be strictly inside the source clip.');
  if(!Object.hasOwn(clip,'events'))return {createdEventIds:[],movedEventIds:[],updatedEventIds:[],warnings:[]};
  const original=clone(clip),left=[],moved=[],createdEventIds=[],updatedEventIds=[],warnings=[];
  const allocate=orderAllocator([...(clip.events??[]),...(clip.notes??[]).flatMap(n=>[{order:n.onOrder},{order:n.offOrder}])]);
  const leftById=new Map();for(const event of original.events){if(event.tick<delta){const e=clone(event);left.push(e);leftById.set(event.id,e);}else moved.push(translated(event,delta));}
  for(const points of lanesOf(original).values()){
    let index=-1;for(let i=0;i<points.length;i++)if(points[i].event.tick<delta)index=i;else break;
    if(index<0)continue;
    const {event}=points[index],next=nextPoint(points,index),atBoundary=next?.tick===delta;
    if(event.curve&&geometry(event,next)&&segmentEnd(original,event,next)>=delta){
      const old=leftById.get(event.id);old.curve.window=sourceWindow(event,next);updatedEventIds.push(event.id);
      if(!atBoundary&&segmentEnd(original,event,next)>delta){
        const value=rounded(evaluateCurve(event,next,delta)),boundary=withControllerValue(event,value);
        boundary.id=newId();boundary.tick=0;boundary.order=allocate();boundary.curve.window=sourceWindow(event,next,chaseControllers&&value!==0?'raw':'sample');
        boundary.curve.window.startTick-=delta;boundary.curve.window.endTick-=delta;
        moved.push(boundary);createdEventIds.push(boundary.id);
      }
    }else if(chaseControllers&&!atBoundary&&controllerValue(event)!==0){
      const boundary=clone(event);boundary.id=newId();boundary.tick=0;boundary.order=allocate();delete boundary.curve;moved.push(boundary);createdEventIds.push(boundary.id);
    }
  }
  if(!chaseControllers&&createdEventIds.length)warnings.push(diagnostic('MIDI_CURVE_FRAGMENT_NOT_CHASED','Curve windows preserve the original sampled stream; playing a fragment alone does not chase preceding controller state.'));
  clip.events=left;right.events=moved;
  return {createdEventIds,movedEventIds:original.events.filter(e=>e.tick>=delta).map(e=>e.id),updatedEventIds,warnings};
}
function lerpPoint(a,b,t){return{x:a.x+(b.x-a.x)*t,value:a.value+(b.value-a.value)*t};}
function subdivide(points,t){const a=lerpPoint(points[0],points[1],t),b=lerpPoint(points[1],points[2],t),c=lerpPoint(points[2],points[3],t),d=lerpPoint(a,b,t),e=lerpPoint(b,c,t),f=lerpPoint(d,e,t);return[[points[0],a,d,f],[f,e,c,points[3]]];}
function localCurve(event,next,endTick) {
  const curve=event.curve,g=geometry(event,next);if(curve.type==='ramp')return {type:'ramp'};
  const from=(event.tick-g.startTick)/(g.endTick-g.startTick),to=(endTick-g.startTick)/(g.endTick-g.startTick);
  const t0=parameter(from,curve.handles),t1=parameter(to,curve.handles);
  let points=[{x:0,value:g.startValue},...curve.handles,{x:1,value:g.endValue}];
  points=subdivide(points,t1)[0];if(t0>0)points=subdivide(points,t0/t1)[1];
  const span=to-from;
  return {type:'bezier',handles:points.slice(1,3).map(p=>({x:Math.max(0,Math.min(1,(p.x-from)/span)),value:Math.max(0,Math.min(controllerLane(event).max,p.value))}))};
}
/** Prepare affected incoming/outgoing window geometry for an intentional point
 * edit. Geometry is rebased only in the editing transaction, never on read/render.
 * A missing clip-local endpoint becomes an explicit point, reported to the caller. */
export function rebaseMidiCurves(clip,eventIds) {
  validateMidiCurves(clip);const wanted=new Set(eventIds),affected=new Set(),createdEventIds=[],updatedEventIds=[],warnings=[];
  const lanes=lanesOf(clip),allocate=orderAllocator([...(clip.events??[]),...(clip.notes??[]).flatMap(n=>[{order:n.onOrder},{order:n.offOrder}])]);
  for(const points of lanes.values())for(let i=0;i<points.length;i++)if(wanted.has(points[i].event.id)){affected.add(points[i].event);if(i>0)affected.add(points[i-1].event);}
  for(const points of lanes.values())for(let i=0;i<points.length;i++){
    const event=points[i].event,next=nextPoint(points,i);if(!affected.has(event)||!event.curve?.window)continue;
    const end=segmentEnd(clip,event,next);
    if(end<=event.tick){delete event.curve.window;updatedEventIds.push(event.id);continue;}
    const shape=localCurve(event,next,end),endValue=rounded(evaluateCurve(event,next,end));
    if(!next||next.tick>end){const boundary=withControllerValue(event,endValue);boundary.id=newId();boundary.tick=end;boundary.order=allocate();delete boundary.curve;clip.events.push(boundary);createdEventIds.push(boundary.id);}
    event.curve=shape;updatedEventIds.push(event.id);
  }
  if(updatedEventIds.length)warnings.push(diagnostic('MIDI_CURVE_WINDOW_REBASED','Editing a split curve rebased its visible geometry to the editable integer MIDI endpoints.',null,{eventIds:updatedEventIds}));
  return {createdEventIds,updatedEventIds,warnings};
}

/** Change existing numeric values without adding/removing/reordering raw points.
 * Split windows are rebased to their visible local geometry in this explicit
 * edit only. A missing right endpoint remains a window ending at the clip edge,
 * rather than becoming a new MIDI point. */
export function setMidiControllerValues(clip,updates) {
  validateMidiCurves(clip);
  need(Array.isArray(updates)&&updates.length>0,'Provide existing controller value updates.');
  const byId=new Map((clip.events??[]).map(event=>[event.id,event])),values=new Map();
  for(const update of updates){
    need(update&&typeof update.eventId==='string'&&!values.has(update.eventId),'Controller value updates require unique existing IDs.');
    const event=byId.get(update.eventId),lane=controllerLane(event);
    need(lane&&integer(update.value,0,lane.max),'Controller value is outside its existing event range.',{eventId:update.eventId});
    values.set(update.eventId,update.value);
  }
  const changed=new Map([...values].filter(([id,value])=>controllerValue(byId.get(id))!==value));
  if(!changed.size)return {createdEventIds:[],updatedEventIds:[],warnings:[]};
  const plans=[],rebased=[];
  for(const points of lanesOf(clip).values())for(let i=0;i<points.length;i++){
    const event=points[i].event,next=nextPoint(points,i);
    if(!event.curve?.window||!changed.has(event.id)&&!changed.has(next?.id))continue;
    const end=segmentEnd(clip,event,next);let shape;
    if(end<=event.tick){shape=clone(event.curve);delete shape.window;}
    else{
      shape=localCurve(event,next,end);
      if(!next||next.tick>end)shape.window={startTick:event.tick,endTick:end,startValue:changed.get(event.id)??controllerValue(event),endValue:rounded(evaluateCurve(event,next,end)),emitStart:'raw'};
    }
    plans.push({event,shape});rebased.push(event.id);
  }
  for(const {event,shape}of plans)event.curve=shape;
  for(const [id,value]of changed){const event=byId.get(id);event.data=withControllerValue(event,value).data;}
  validateMidiCurves(clip);
  return {createdEventIds:[],updatedEventIds:[...new Set([...changed.keys(),...rebased])],warnings:rebased.length?[diagnostic('MIDI_CURVE_VALUES_REBASED','Changing existing values rebased affected split curves without inserting or deleting MIDI points; edited virtual anchors now emit their explicit value.',null,{eventIds:rebased})]:[]};
}

/** Explicit paste/move reconciliation on a detached editing candidate only.
 * Loading and rendering never use this exception to strict endpoint validation.
 * Valid copied windows stay byte-for-byte intact; only selected inconsistent
 * endpoints are retargeted, and an absent interior end gets its own raw point. */
export function reconcileEditedMidiCurves(clip,eventIds) {
  need(Array.isArray(eventIds)&&eventIds.every(id=>typeof id==='string')&&new Set(eventIds).size===eventIds.length,'Edited curve IDs must be a unique array.');
  need(clip&&(clip.events===undefined||Array.isArray(clip.events)),'Invalid MIDI clip for edited curve reconciliation.');
  const wanted=new Set(eventIds),present=new Set((clip.events??[]).map(event=>event.id));
  for(const id of wanted)need(present.has(id),'An edited curve point does not exist.',{eventId:id});
  validateCurveClip(clip,wanted);
  const createdEventIds=[],updatedEventIds=[],retargetedEventIds=[],warnings=[];
  const allocate=orderAllocator([...(clip.events??[]),...(clip.notes??[]).flatMap(n=>[{order:n.onOrder},{order:n.offOrder}])]);
  for(const points of lanesOf(clip).values())for(let i=0;i<points.length;i++){
    const event=points[i].event,next=nextPoint(points,i),window=event.curve?.window;
    if(!wanted.has(event.id)||!window||!activeSegment(points,i))continue;
    if(next&&next.tick<=window.endTick){
      if(controllerValue(next)!==rounded(evaluateCurve(event,next,next.tick))){
        event.curve=localCurve(event,next,next.tick);
        updatedEventIds.push(event.id);retargetedEventIds.push(event.id);
      }
    }else if(window.endTick<clip.lengthTicks){
      const boundary=withControllerValue(event,rounded(evaluateCurve(event,next,window.endTick)));
      boundary.id=newId();boundary.tick=window.endTick;boundary.order=allocate();delete boundary.curve;
      clip.events.push(boundary);createdEventIds.push(boundary.id);updatedEventIds.push(event.id);
    }
  }
  validateMidiCurves(clip);
  if(updatedEventIds.length)warnings.push(diagnostic('MIDI_CURVE_EDIT_RECONCILED','The explicit controller edit retargeted affected curve endpoints or added a missing local endpoint; unrelated source windows were preserved.',null,{retargetedEventIds,createdEventIds}));
  return {createdEventIds,updatedEventIds,warnings};
}

// The direct bend gesture and engine share the existing split-window subdivision.
export {localCurve as localControllerCurve};
