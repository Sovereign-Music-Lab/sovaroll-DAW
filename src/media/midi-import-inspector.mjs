/** Extract one-channel Inspector setup, preserving unrepresentable source events. */
export function extractMidiInspector(track,{patch=false,volumePan=false}={}){
 const events=track.events??[],fields=new Map();
 for(const event of [...events].sort((a,b)=>a.tick-b.tick||a.order-b.order)){
  if(event.kind!=='channel')continue;const type=event.status>>4,key=type===12?'program':type===11?({0:'bankMsb',32:'bankLsb',7:'volume',10:'pan'})[event.data[0]]:null;
  if(!key||!((['program','bankMsb','bankLsb'].includes(key)&&patch)||(['volume','pan'].includes(key)&&volumePan))||fields.has(key))continue;fields.set(key,event);
 }
 const first=[...fields.values()].find(e=>!e.curve),channel=first?(first.status&15):null,settings=channel===null?null:{setupChannel:channel},removed=new Set(),extracted=[],skipped=[];
 for(const [key,event]of fields){if(event.curve||(event.status&15)!==channel){skipped.push({field:key,tick:event.tick,channel:event.status&15,reason:event.curve?'editable-curve':'different-inspector-channel'});continue;}
  settings[key]=event.data.at(-1);removed.add(event);extracted.push({field:key,sourceEvent:structuredClone(event)});
 }
 return {track:{...track,events:events.filter(e=>!removed.has(e))},settings:extracted.length?settings:null,report:{extracted,skipped,setupChannel:channel,movesToTickZero:extracted.some(e=>e.sourceEvent.tick!==0)}};
}
