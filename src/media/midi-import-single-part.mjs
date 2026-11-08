/** Merge parsed SMF tracks with source-track priority for same-tick events. */
export function mergeImportedMidiTracks(tracks,name='Imported MIDI'){
 if(!tracks.length)return null;const notes=[],events=[],endpoints=[];let endTick=0,sequence=0;
 const add=(tick,track,order,rank,item,key)=>endpoints.push({tick,track,order:order??Number.MAX_SAFE_INTEGER,rank,sequence:sequence++,item,key});
 tracks.forEach((source,track)=>{endTick=Math.max(endTick,source.endTick??0);
  for(const input of source.notes){const note=structuredClone(input);notes.push(note);endTick=Math.max(endTick,note.startTick+Math.max(1,note.durationTicks));add(note.startTick,track,note.onOrder,0,note,'onOrder');add(note.startTick+note.durationTicks,track,note.offOrder,2,note,'offOrder');}
  for(const input of source.events??[]){const event=structuredClone(input);events.push(event);endTick=Math.max(endTick,event.tick);add(event.tick,track,event.order,1,event,'order');}
 });
 endpoints.sort((a,b)=>a.tick-b.tick||a.track-b.track||a.order-b.order||a.rank-b.rank||a.sequence-b.sequence);endpoints.forEach((point,index)=>point.item[point.key]=index);
 return {name:String(name).slice(0,240),notes,events,endTick};
}
