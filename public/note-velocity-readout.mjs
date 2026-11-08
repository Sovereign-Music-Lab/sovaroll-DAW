/** Source-note cursor readout; independent of synth sustain/chase state.
 * The latest onset holds until the next onset. Coincident differing values are
 * reported as multiple values, never silently replaced by array order. */
export function buildNoteVelocityReadout(clip){
 const points=clip.notes.map(n=>({tick:n.startTick,channel:n.channel??0,velocity:n.velocity,releaseVelocity:n.releaseVelocity??0})).sort((a,b)=>a.tick-b.tick);
 return {startTick:clip.startTick,endTick:clip.startTick+clip.lengthTicks,points};
}
export function queryNoteVelocityReadout(index,{projectTick,channel='all',field='velocity'}){
 if(!Number.isFinite(projectTick)||!['velocity','releaseVelocity'].includes(field)||!(channel==='all'||Number.isInteger(channel)&&channel>=0&&channel<16))throw new Error('Invalid note cursor query');
 if(projectTick<index.startTick||projectTick>index.endTick)return {status:'outside-clip',values:[]};
 const tick=projectTick-index.startTick;let lo=0,hi=index.points.length;while(lo<hi){const mid=(lo+hi)>>1;if(index.points[mid].tick<=tick)lo=mid+1;else hi=mid;}
 let onset=null;const values=new Set();for(let i=lo-1;i>=0;i--){const p=index.points[i];if(onset!==null&&p.tick!==onset)break;if(channel!=='all'&&p.channel!==channel)continue;onset=p.tick;values.add(p[field]);}
 return {status:values.size>1?'multiple-values':values.size?'value':'no-data',values:[...values].sort((a,b)=>a-b),onset};
}
