/** Split format-0 source channels; do not assign opaque messages to an invented channel. */
export function splitImportedMidiChannels(track){
 const channels=new Set(track.notes.map(n=>n.channel??0));for(const e of track.events??[])if(e.kind==='channel')channels.add(e.status&15);
 const outputs=[...channels].sort((a,b)=>a-b).map(channel=>({...track,name:`${String(track.name??'MIDI').slice(0,240)} · Ch ${channel+1}`,notes:track.notes.filter(n=>(n.channel??0)===channel),events:(track.events??[]).filter(e=>e.kind==='channel'&&(e.status&15)===channel)}));
 const common=(track.events??[]).filter(e=>e.kind!=='channel');if(common.length)outputs.push({...track,name:`${String(track.name??'MIDI').slice(0,240)} · Common`,notes:[],events:common});
 return {tracks:outputs,report:{sourceName:track.name,channels:[...channels].sort((a,b)=>a-b),commonEvents:common.length,sourceOrderPolicy:'retained within each channel; common opaque data has a separate endpoint'}};
}
