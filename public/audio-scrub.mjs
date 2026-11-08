/** Mouse speed is source seconds per wall second; rate changes pitch too. */
export function scrubMotion(previous,current,maxRate=4){
 const elapsed=(current.time-previous.time)/1000,delta=current.seconds-previous.seconds;
 if(!Number.isFinite(elapsed)||elapsed<=0||!Number.isFinite(delta)||delta===0)return {direction:0,rate:0};
 return {direction:Math.sign(delta),rate:Math.min(maxRate,Math.max(.05,Math.abs(delta)/elapsed))};
}
/** Short overlapping grains, silence when the pointer stops. Not a time stretcher. */
export function createBufferScrubber(context,buffer,destination){
 if(buffer.length*buffer.numberOfChannels*4>64*1024*1024)throw new Error('스크럽은 최대64MiB decoded audio를 지원합니다. 클립을 나누어 사용하세요.');
 let reversed=null,disposed=false,lastTime=-Infinity;const grains=new Set();
 function reverse(){if(reversed)return reversed;reversed=context.createBuffer(buffer.numberOfChannels,buffer.length,buffer.sampleRate);for(let c=0;c<buffer.numberOfChannels;c++){const source=buffer.getChannelData(c),target=reversed.getChannelData(c);for(let i=0;i<buffer.length;i++)target[i]=source[buffer.length-1-i];}return reversed;}
 function move(seconds,{direction,rate}){
  if(disposed||!direction||!Number.isFinite(rate)||rate<=0)return false;
  const now=context.currentTime;if(now-lastTime<.016)return false;lastTime=now;
  for(const grain of grains){grain.gain.gain.cancelScheduledValues(now);grain.gain.gain.setTargetAtTime(0,now,.003);try{grain.source.stop(now+.012);}catch{}}
  const audio=direction<0?reverse():buffer,position=Math.min(buffer.duration,Math.max(0,seconds)),offset=direction<0?buffer.duration-position:position;
  const duration=Math.min(.08,(buffer.duration-offset)/rate);if(duration<=0)return false;
  const source=context.createBufferSource(),gain=context.createGain(),grain={source,gain};source.buffer=audio;source.playbackRate.value=rate;gain.gain.setValueAtTime(0,now);gain.gain.linearRampToValueAtTime(1,now+Math.min(.005,duration/3));gain.gain.setValueAtTime(1,now+Math.max(duration/3,duration-.01));gain.gain.linearRampToValueAtTime(0,now+duration);source.connect(gain);gain.connect(destination);grains.add(grain);source.onended=()=>{source.disconnect();gain.disconnect();grains.delete(grain);};source.start(now,offset);source.stop(now+duration);return true;
 }
 return {move,dispose(){if(disposed)return;disposed=true;for(const {source,gain}of grains){source.onended=null;try{source.stop();}catch{}source.disconnect();gain.disconnect();}grains.clear();reversed=null;}};
}
