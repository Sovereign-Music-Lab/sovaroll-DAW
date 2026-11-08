/** Source display traversal: onset, pitch, channel, then source array order.
 * Shift adds the traversed note; selection never changes musical data. */
export function navigateNoteSelection(notes,{activeId=null,selectedIds=[],direction,extend=false}={}){
 if(![-1,1].includes(direction))throw new Error('Direction must be -1 or 1');
 const ordered=notes.map((n,index)=>({n,index})).sort((a,b)=>a.n.startTick-b.n.startTick||a.n.pitch-b.n.pitch||(a.n.channel??0)-(b.n.channel??0)||a.index-b.index);
 if(!ordered.length)return {activeId:null,selectedIds:[]};
 const index=ordered.findIndex(x=>x.n.id===activeId),next=index<0?(direction>0?0:ordered.length-1):Math.max(0,Math.min(ordered.length-1,index+direction)),id=ordered[next].n.id;
 const valid=new Set(notes.map(n=>n.id)),selection=extend?new Set([...selectedIds].filter(id=>valid.has(id))):new Set();selection.add(id);
 return {activeId:id,selectedIds:[...selection]};
}

/** Key-display selection spans channels but matches exact MIDI pitch/octave. */
export function selectNotePitch(notes,{pitch,fromTick=0}={}){
 if(!Number.isInteger(pitch)||pitch<0||pitch>127||!Number.isSafeInteger(fromTick)||fromTick<0)throw new Error('Invalid pitch selection');
 return notes.filter(n=>n.pitch===pitch&&n.startTick>=fromTick).map(n=>n.id);
}

export function selectNoteMenu(notes,{mode,selectedIds=[],cursorTick=0,loopRange=null}={}){
 const selected=new Set(selectedIds),anchor=notes.filter(n=>selected.has(n.id));
 if(mode==='inLoop'){if(!loopRange||!Number.isFinite(loopRange.startTick)||!Number.isFinite(loopRange.endTick)||loopRange.startTick>=loopRange.endTick)throw new Error('Locator 범위를 먼저 설정하세요.');return notes.filter(n=>n.durationTicks===0?n.startTick>=loopRange.startTick&&n.startTick<loopRange.endTick:n.startTick<loopRange.endTick&&n.startTick+n.durationTicks>loopRange.startTick).map(n=>n.id);}
 if(mode==='all')return notes.map(n=>n.id);
 if(mode==='none')return [];
 if(mode==='invert')return notes.filter(n=>!selected.has(n.id)).map(n=>n.id);
 if(mode==='beforeCursor'||mode==='afterCursor'){if(!Number.isFinite(cursorTick))throw new Error('Invalid cursor');return notes.filter(n=>mode==='beforeCursor'?n.startTick<cursorTick:n.startTick+n.durationTicks>cursorTick).map(n=>n.id);}
 if(mode==='samePitch'||mode==='pitchClass'){if(anchor.length!==1)throw new Error('같은 음높이 선택은 노트 하나를 먼저 선택하세요.');return notes.filter(n=>mode==='samePitch'?n.pitch===anchor[0].pitch:n.pitch%12===anchor[0].pitch%12).map(n=>n.id);}
 throw new Error('Unknown selection action');
}
