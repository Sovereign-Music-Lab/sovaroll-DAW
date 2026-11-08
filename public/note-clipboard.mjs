/** Prepare ordinary Paste without moving or splitting destination material. */
export function prepareNotePaste(notes,{atTick,lengthTicks}={}){
 if(!Number.isSafeInteger(atTick)||atTick<0||!Number.isSafeInteger(lengthTicks)||lengthTicks<1)throw new Error('Invalid paste position');
 return notes.map(source=>{
  const n=structuredClone(source);n.startTick+=atTick;
  if(!Number.isSafeInteger(n.startTick)||n.startTick<0||!Number.isSafeInteger(n.startTick+n.durationTicks)||n.startTick+n.durationTicks>lengthTicks)throw new Error('붙여넣을 노트가 클립 범위를 벗어납니다.');
  delete n.id;delete n.onOrder;delete n.offOrder;delete n.quantizeReference;return n;
 });
}

export function captureNoteClipboard(notes){
 if(!Array.isArray(notes)||!notes.length||notes.length>200000)throw new Error('복사할 노트를 선택하세요.');
 let first=Infinity,last=0;for(const n of notes){if(!Number.isSafeInteger(n.startTick)||n.startTick<0||!Number.isSafeInteger(n.durationTicks)||n.durationTicks<0||!Number.isSafeInteger(n.startTick+n.durationTicks))throw new Error('Invalid clipboard note timing');first=Math.min(first,n.startTick);last=Math.max(last,n.startTick+n.durationTicks);}
 if(last<=first)throw new Error('양의 길이가 있는 노트를 선택하세요.');
 return {lengthTicks:last-first,notes:notes.map(n=>({...structuredClone(n),startTick:n.startTick-first}))};
}
