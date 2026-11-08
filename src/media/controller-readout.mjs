import { controllerLane, controllerValue, materializeMidiCurves } from './midi-curves.mjs';

// Cursor values, signed/semitone displays, rounding and clip boundaries use
// explicit application policies.
// This is a lane-message readout, not the synth state engine: other-lane
// channel-mode resets, instrument RPN range and device input are not inferred.
const MAX = Number.MAX_SAFE_INTEGER;
const stores = new WeakMap();
const kinds = new Set(['cc','pitchBend','channelPressure','polyPressure','program']);
const normalZero = value => Object.is(value,-0) ? 0 : value;
function fail(code,message,details) { throw Object.assign(new Error(message),{name:'ControllerReadoutError',code,...(details?{details}:{})}); }
function need(value,message,details) { if(!value)fail('INVALID_CONTROLLER_READOUT',message,details); }
const integer=(value,min=0,max=MAX)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
function descriptor(lane,allowAll=true) {
  need(lane&&kinds.has(lane.kind),'Choose a numeric MIDI controller lane.');
  need(integer(lane.channel,0,15)||(allowAll&&lane.channel==='all'),'Choose MIDI channel 0..15 or all channels.');
  if(lane.kind==='cc')need(integer(lane.controller,0,127),'CC number must be 0..127.');
  if(lane.kind==='polyPressure')need(integer(lane.pitch,0,127),'Poly pressure pitch must be 0..127.');
  return {kind:lane.kind,channel:lane.channel,...(lane.kind==='cc'?{controller:lane.controller}:{}),...(lane.kind==='polyPressure'?{pitch:lane.pitch}:{})};
}
const laneKey=lane=>`${lane.kind}:${lane.channel}:${lane.controller??lane.pitch??''}`;
const familyKey=lane=>`${lane.kind}:${lane.controller??lane.pitch??''}`;
const rowCompare=(a,b)=>a.tick-b.tick||Number(!a.generated)-Number(!b.generated)||a.order-b.order||a.sequence-b.sequence;
function diagnosticsSummary(items) {
  const values=new Map();
  for(const item of items){const key=`${item.code}:${item.message}`;let value=values.get(key);if(!value){value={code:item.code,message:item.message,count:0};values.set(key,value);}value.count++;}
  return Object.freeze([...values.values()].map(Object.freeze));
}

/** Build once per clip/revision, never once per animation frame. The immutable
 * public handle owns private detached per-lane arrays. Materialization shares
 * playback/export's one-tick sampling, source order and complexity limits. */
export function buildControllerReadoutIndex(clip,{revision=null,documentId=null}={}) {
  need(clip?.type==='midi'&&integer(clip.startTick)&&integer(clip.lengthTicks,1)&&integer(clip.startTick+clip.lengthTicks),'Readout requires a bounded MIDI clip.');
  need(clip.events===undefined||Array.isArray(clip.events),'MIDI events must be an array.');
  need(revision===null||integer(revision),'Readout revision must be a nonnegative integer.');
  need(documentId===null||(typeof documentId==='string'&&documentId.length>0),'Readout document identity must be a nonempty string.');
  const lanes=new Map(),families=new Map(),orders=new Set();
  for(const event of clip.events??[]){
    need(event&&integer(event.tick,0,clip.lengthTicks)&&integer(event.order),'Readout events need bounded integer ticks and source orders.');
    const orderKey=`${event.tick}:${event.order}`;need(!orders.has(orderKey),'Source orders must be unique at the same tick.');orders.add(orderKey);
    const type=event.status>>4,lane=controllerLane(event);
    if(event.kind==='channel'&&[10,11,12,13,14].includes(type))need(lane,'Numeric controller messages must contain their exact 7-bit MIDI payload.');
    if(!lane)continue;
    if(!lanes.has(lane.key))lanes.set(lane.key,{lane:descriptor(lane,false),rows:[]});
  }
  const expanded=materializeMidiCurves(clip);
  for(const [sequence,event]of expanded.events.entries()){
    const lane=controllerLane(event);if(!lane)continue;
    let entry=lanes.get(lane.key);if(!entry){entry={lane:descriptor(lane,false),rows:[]};lanes.set(lane.key,entry);}
    entry.rows.push({tick:event.tick,value:controllerValue(event),order:event.order,sequence,generated:event.curveGenerated===true,eventId:event.id??null,sourceEventId:event.curveSourceId??event.id??null});
  }
  let sampleCount=0;
  for(const entry of lanes.values()){
    entry.rows.sort(rowCompare);const compact=[];
    // A query at a tick observes the final message at that tick. Original
    // duplicates are not changed in the project; only the readout index folds them.
    for(const row of entry.rows){if(compact.at(-1)?.tick===row.tick)compact[compact.length-1]=row;else compact.push(row);}
    entry.rows=compact;sampleCount+=compact.length;
    const key=familyKey(entry.lane);let group=families.get(key);if(!group){group=[];families.set(key,group);}group.push(entry.lane.channel);
  }
  for(const group of families.values())group.sort((a,b)=>a-b);
  const index=Object.freeze({schemaVersion:1,scope:'clip',policy:'sampled-midi-1tick-clip-inclusive-v1',clipId:clip.id??null,startTick:clip.startTick,lengthTicks:clip.lengthTicks,endTick:clip.startTick+clip.lengthTicks,revision,documentId,
    sourceEventCount:(clip.events??[]).length,sampleCount,lanes:Object.freeze([...lanes.values()].map(entry=>Object.freeze({...entry.lane}))),diagnostics:diagnosticsSummary(expanded.diagnostics),stats:Object.freeze({...expanded.stats})});
  stores.set(index,{lanes,families});return index;
}
function upperBound(rows,tick){let low=0,high=rows.length;while(low<high){const mid=Math.floor((low+high)/2);if(rows[mid].tick<=tick)low=mid+1;else high=mid;}return low;}
function concrete(index,store,lane,projectTick) {
  const relativeTick=normalZero(projectTick-index.startTick),base={scope:'clip',lane:{...lane},projectTick:normalZero(projectTick),relativeTick,sampleTick:null,value:null,hasData:false,eventId:null,sourceEventId:null,generated:false};
  if(projectTick<index.startTick)return {...base,status:'before-clip'};
  if(projectTick>index.endTick)return {...base,status:'after-clip'};
  const sampleTick=Math.floor(relativeTick),rows=store.lanes.get(laneKey(lane))?.rows??[],at=upperBound(rows,sampleTick);
  if(!at)return {...base,sampleTick,status:lane.kind==='pitchBend'?'default-center':'no-data',value:lane.kind==='pitchBend'?8192:null};
  const row=rows[at-1];return {...base,sampleTick,status:'value',value:row.value,hasData:true,eventTick:row.tick,eventProjectTick:index.startTick+row.tick,eventId:row.eventId,sourceEventId:row.sourceEventId,generated:row.generated};
}
/** Query only the selected clip's emitted messages. Before/after the clip returns
 * no data; its exact end is included because raw end-of-clip events are valid.
 * Missing PB history is explicitly a display-only center default, not a claim
 * about earlier clips, track controller chase or the instrument's current state. */
export function queryControllerReadout(index,{lane,projectTick}={}) {
  const store=stores.get(index);need(store,'Use an index returned by buildControllerReadoutIndex.');
  need(Number.isFinite(projectTick)&&Math.abs(projectTick)<=MAX,'Project cursor tick must be finite and within the safe range.');
  const wanted=descriptor(lane);
  if(wanted.channel!=='all')return concrete(index,store,wanted,projectTick);
  const channels=(store.families.get(familyKey(wanted))??[]).map(channel=>concrete(index,store,{...wanted,channel},projectTick));
  if(channels.length===0)return {...concrete(index,store,wanted,projectTick),channels:[]};
  if(channels.length===1)return {...channels[0],lane:wanted,channels};
  const base=concrete(index,store,wanted,projectTick);
  if(base.status==='before-clip'||base.status==='after-clip')return {...base,channels};
  // Independent channels are never collapsed into a fictitious single MIDI state,
  // even when their current numeric values happen to coincide.
  return {...base,status:'multiple-channels',value:null,hasData:channels.some(value=>value.hasData),channels};
}

/** Display policy matches the existing grid: signed/8192 times the configured
 * positive/negative range. The top raw value is one 14-bit step below +range.
 * Round to nearest cent, ties away from zero, using a bounded integer numerator.
 * Signed semitone and cent components avoid a displayed negative zero. */
export function formatPitchBendValue(raw,{enabled=false,up=2,down=2}={}) {
  need(integer(raw,0,16383),'Pitchbend raw value must be 0..16383.');
  need(typeof enabled==='boolean'&&integer(up,1,96)&&integer(down,1,96),'Pitchbend grid needs enabled and independent integer up/down ranges 1..96.');
  const signed=raw-8192,range=signed<0?down:up,semitones=normalZero(signed*range/8192);
  const magnitude=Math.floor((Math.abs(signed)*range*100+4096)/8192),totalCents=normalZero(Math.sign(signed)*magnitude);
  const wholeSemitones=normalZero(Math.trunc(totalCents/100)),cents=normalZero(totalCents-wholeSemitones*100);
  const signedText=value=>value>0?`+${value}`:String(value);
  return {raw,signed,mode:enabled?'semitones':'raw',up,down,semitones,roundedSemitones:normalZero(totalCents/100),totalCents,wholeSemitones,cents,
    text:enabled?`${signedText(wholeSemitones)} st ${signedText(cents)} ct`:signedText(signed),policy:'signed-8192-nearest-cent-away-from-zero-v1'};
}

/** Small revision cache for GUI use. Document identity is mandatory because two
 * open projects can share a revision and clip ID. A new document/revision clears
 * old arrays; within it the least recently used clip is evicted at maxEntries.
 * The caller must advance revision after edits; same-revision external mutation
 * is deliberately not detected by an expensive per-frame content scan. */
export function createControllerReadoutCache({maxEntries=8}={}) {
  need(integer(maxEntries,1,64),'Readout cache holds between 1 and 64 clips.');
  let identity=null;const entries=new Map();
  return Object.freeze({
    get(clip,{documentId,revision}={}){
      need(typeof documentId==='string'&&documentId.length>0&&integer(revision),'A cache lookup requires document identity and revision.');
      need(typeof clip?.id==='string'&&clip.id.length>0,'A cached MIDI clip requires a stable ID.');
      const stamp=JSON.stringify([documentId,revision]);if(stamp!==identity){entries.clear();identity=stamp;}
      if(entries.has(clip.id)){const index=entries.get(clip.id);entries.delete(clip.id);entries.set(clip.id,index);return index;}
      const index=buildControllerReadoutIndex(clip,{documentId,revision});entries.set(clip.id,index);if(entries.size>maxEntries)entries.delete(entries.keys().next().value);return index;
    },
    clear(){entries.clear();identity=null;},
    get size(){return entries.size;},
  });
}
