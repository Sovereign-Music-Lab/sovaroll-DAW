// Half-open project-sample intervals. Later source-array order breaks priority ties.
export function compileAudioFrontSpans(project){
 const result=new Map(),assets=new Map(project.assets.map(a=>[a.id,a])),front=new Set(project.tracks.filter(t=>t.type==='audio'&&t.audioOverlapMode==='front').map(t=>t.id));
 for(const trackId of front){const clips=project.clips.map((clip,index)=>({clip,index})).filter(x=>x.clip.type==='audio'&&x.clip.trackId===trackId&&!x.clip.mute),events=[],active=new Set(),heap=[];
  const higher=(a,b)=>(a.clip.frontOrder??0)>(b.clip.frontOrder??0)||((a.clip.frontOrder??0)===(b.clip.frontOrder??0)&&a.index>b.index);
  const push=item=>{heap.push(item);let i=heap.length-1;while(i){const p=(i-1)>>1;if(!higher(heap[i],heap[p]))break;[heap[i],heap[p]]=[heap[p],heap[i]];i=p;}};
  const pop=()=>{const tail=heap.pop();if(!heap.length)return;heap[0]=tail;let i=0;while(true){let best=i,l=i*2+1,r=l+1;if(l<heap.length&&higher(heap[l],heap[best]))best=l;if(r<heap.length&&higher(heap[r],heap[best]))best=r;if(best===i)break;[heap[i],heap[best]]=[heap[best],heap[i]];i=best;}};
  for(const item of clips){const asset=assets.get(item.clip.assetId);if(!asset)throw new Error('Audio overlap requires asset metadata.');const start=item.clip.startSample,end=start+Math.ceil(item.clip.lengthFrames*project.sampleRate/asset.sampleRate);events.push({at:start,item,start:true},{at:end,item,start:false});result.set(item.clip.id,[]);}
  events.sort((a,b)=>a.at-b.at);let previous=events[0]?.at??0,i=0;
  while(i<events.length){const at=events[i].at;while(heap.length&&!active.has(heap[0].clip.id))pop();if(at>previous&&heap.length){const spans=result.get(heap[0].clip.id),last=spans.at(-1);if(last&&last.end===previous)last.end=at;else spans.push({start:previous,end:at});}while(i<events.length&&events[i].at===at){const e=events[i++];if(e.start){active.add(e.item.clip.id);push(e.item);}else active.delete(e.item.clip.id);}previous=at;}
 }
 return result;
}
