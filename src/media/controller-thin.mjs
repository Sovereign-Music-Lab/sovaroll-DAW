import {controllerLane} from './midi-curves.mjs';
const protectedCC=new Set([0,6,32,38,64,65,66,67,68,69,96,97,98,99,100,101,120,121,122,123,124,125,126,127]);
/** Held-value error, not a linear-curve approximation. Preserve protocol/state boundaries. */
export function planControllerThinning(clip,tolerance=0){
 if(!Number.isInteger(tolerance)||tolerance<0||tolerance>127)throw Object.assign(new Error('CC tolerance must be 0..127.'),{code:'INVALID_TOLERANCE'});
 const key=lane=>`${lane.channel}:${lane.controller}`,curved=new Set(),present=new Set(),paired=new Set(),groups=new Map(),removedEventIds=[];
 for(const event of clip.events??[]){const lane=controllerLane(event);if(lane?.kind==='cc'&&event.curve)curved.add(key(lane));}
 for(const event of clip.events??[]){const lane=controllerLane(event);if(lane?.kind==='cc')present.add(key(lane));}
 for(const laneId of present){const [channel,cc]=laneId.split(':').map(Number);if(cc<64&&present.has(`${channel}:${cc<32?cc+32:cc-32}`))paired.add(laneId);}
 const flush=channel=>{for(const [laneId,events]of groups){if(channel!==undefined&&!laneId.startsWith(`${channel}:`))continue;
  let held=events[0];for(let i=1;i<events.length-1;i++){const event=events[i];if(event.tick!==events[i-1].tick&&event.tick!==events[i+1].tick&&Math.abs(event.data[1]-held.data[1])<=tolerance)removedEventIds.push(event.id);else held=event;}
  groups.delete(laneId);
 }};
 for(const event of [...(clip.events??[])].sort((a,b)=>a.tick-b.tick||a.order-b.order)){
  if(event.kind==='sysex'){flush();continue;}
  const lane=controllerLane(event);if(!lane)continue;
  if(lane.kind==='program'||lane.kind==='cc'&&lane.controller>=120){flush(lane.channel);continue;}
  if(lane.kind!=='cc'||protectedCC.has(lane.controller)||curved.has(key(lane))||paired.has(key(lane)))continue;
  const laneId=key(lane);if(!groups.has(laneId))groups.set(laneId,[]);groups.get(laneId).push(event);
 }
 flush();return {removedEventIds,tolerance,policy:'held-value-maximum-error',protectedControllers:[...protectedCC],skippedCurvedLanes:[...curved],skippedPairedLanes:[...paired]};
}
