import {requireValue} from './common.mjs';
export function isFrameSilenced(clip,frame){
 const ranges=clip.silencedRanges??[];let lo=0,hi=ranges.length;
 while(lo<hi){const mid=(lo+hi)>>1;if(ranges[mid].endFrame<=frame)lo=mid+1;else hi=mid;}
 return lo<ranges.length&&ranges[lo].startFrame<=frame;
}
export function editSilenceRanges(ranges,startFrame,endFrame,clear=false){
 let result=[];
 if(clear){for(const range of ranges){if(range.endFrame<=startFrame||range.startFrame>=endFrame)result.push({...range});else{if(range.startFrame<startFrame)result.push({startFrame:range.startFrame,endFrame:startFrame});if(range.endFrame>endFrame)result.push({startFrame:endFrame,endFrame:range.endFrame});}}}
 else{for(const range of [...ranges,{startFrame,endFrame}].sort((a,b)=>a.startFrame-b.startFrame)){const last=result.at(-1);if(last&&range.startFrame<=last.endFrame)last.endFrame=Math.max(last.endFrame,range.endFrame);else result.push({...range});}}
 requireValue(result.length<=4096,'SILENCE_RANGE_LIMIT','At most 4096 silence regions per audio clip.');return result;
}
