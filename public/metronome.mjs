/** Optional preview click. Scheduled against the same project-time projection. */
export function setupMetronome({getContext}){
 const label=document.createElement('label');label.className='metronome-control';label.innerHTML='<input id="metronome-enabled" type="checkbox">메트로놈 <input id="metronome-volume" type="range" min="0" max="1" step="0.01" value="0.35" aria-label="메트로놈 볼륨">';document.querySelector('.transport-buttons').after(label);
 const enabled=label.querySelector('#metronome-enabled'),volume=label.querySelector('#metronome-volume');let context=null,gain=null,lastPosition=-1,lastBeat=null,identity='',nodes=new Set();
 const preferenceKey='newdaw.metronome.v1';
 try{const saved=JSON.parse(localStorage.getItem(preferenceKey));if(saved&&typeof saved.enabled==='boolean')enabled.checked=saved.enabled;if(saved&&typeof saved.volume==='number'&&Number.isFinite(saved.volume)&&saved.volume>=0&&saved.volume<=1)volume.value=String(saved.volume);}catch{/* Unavailable or malformed browser preferences use defaults. */}
 function persist(){try{localStorage.setItem(preferenceKey,JSON.stringify({enabled:enabled.checked,volume:Number(volume.value)}));}catch{/* Playback also works without browser storage. */}}
 function reset(){for(const node of nodes){try{node.stop();}catch{}node.disconnect();}nodes.clear();lastBeat=null;lastPosition=-1;}
 async function unlock(){context??=new AudioContext();if(!gain){gain=context.createGain();gain.connect(context.destination);}gain.gain.value=Number(volume.value)*.18;await context.resume();}
 function click(when,accent){const node=context.createOscillator(),envelope=context.createGain();node.frequency.value=accent?1500:1000;envelope.gain.setValueAtTime(0,when);envelope.gain.linearRampToValueAtTime(1,when+.001);envelope.gain.exponentialRampToValueAtTime(.001,when+.035);node.connect(envelope);envelope.connect(gain);nodes.add(node);node.onended=()=>{nodes.delete(node);node.disconnect();envelope.disconnect();};node.start(when);node.stop(when+.04);}
 enabled.onchange=()=>{reset();persist();if(enabled.checked)void unlock().then(pump).catch(()=>{enabled.checked=false;persist();});};volume.oninput=()=>{persist();if(gain)gain.gain.setTargetAtTime(Number(volume.value)*.18,context.currentTime,.01);};
 function pump(){
  const c=getContext();if(!enabled.checked||!context||!c.playing||!c.project){if(lastBeat!==null)reset();return;}
  const key=`${c.project.id}:${c.project.revision}`;if(key!==identity||c.positionSeconds<lastPosition-.05){reset();identity=key;}
  const pos=c.positionSeconds;lastPosition=pos;const ppq=c.project.ppq,step=ppq*4/c.project.timeSignature.denominator,beat=c.secondsToTick(pos)/step,first=Math.ceil(beat-1e-7),last=Math.floor(c.secondsToTick(pos+.12)/step);
  for(let index=first;index<=last&&index<first+64;index++){
   if(lastBeat!==null&&index<=lastBeat)continue;
   const seconds=c.tickToSeconds(index*step);if(c.project.cycleEnabled&&c.project.locators&&index*step>=c.project.locators.endTick)break;
   const when=context.currentTime+Math.max(0,seconds-pos);click(when,index%c.project.timeSignature.numerator===0);lastBeat=index;
  }
 }
 const timer=setInterval(pump,25);
 window.addEventListener('beforeunload',()=>{clearInterval(timer);reset();void context?.close();});return {stop:reset,start:()=>{if(enabled.checked)void unlock().then(pump).catch(()=>{enabled.checked=false;persist();reset();});}};
}
