// Explicit opt-in native audio preview. The existing built-in preview remains the default.
export function setupNativeAudio({request,getContext,notify}){
 const button=document.createElement('button');button.id='native-audio-open';button.type='button';button.textContent='Native audio';document.querySelector('.top-actions').prepend(button);
 const dialog=document.createElement('dialog');dialog.id='native-audio-dialog';dialog.innerHTML='<div class="dialog-heading"><h2>Native audio</h2><button id="native-audio-close" type="button" aria-label="Native audio 닫기">×</button></div><label><input id="native-audio-enabled" type="checkbox">네이티브 오디오 프리뷰 사용 (macOS)</label><p>선택한 경우에만 렌더된 WAV를 네이티브 helper로 재생합니다. 기본 내장 프리뷰와 native MIDI 설정은 유지합니다. 실제 장치 품질·지연은 별도 검증이 필요합니다.</p><p id="native-audio-status" role="status"></p>';document.body.append(dialog);
 const $=id=>dialog.querySelector('#'+id),enabledInput=$('native-audio-enabled');let enabled=false,supported=false,state={status:'idle',jobId:null};
 try{enabled=localStorage.getItem('sovaroll.nativeAudio.enabled.v1')==='true';}catch{}
 enabledInput.checked=enabled;
 const update=()=>{button.disabled=!supported||!getContext().project||getContext().busy||!getContext().connected;enabledInput.disabled=!supported;$('native-audio-status').textContent=supported?`${enabled?'사용':'사용 안 함'} · ${state.status}${state.offline?' · offline':''}${state.error?' · '+state.error:''}`:'이 플랫폼에서는 native audio를 사용할 수 없습니다.';};
 const post=(route,input)=>request(route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
 const accept=value=>{if(value?.capabilities)supported=value.capabilities.nativeAudioPreview===true;if(value?.nativeAudio)state=value.nativeAudio;else if(value?.status)state=value;update();if(enabled||active())document.getElementById('playback-status').textContent=`Native audio · ${state.status}`;};
 const active=()=>['playing','stopping'].includes(state.status);
 enabledInput.onchange=async()=>{enabled=enabledInput.checked;try{localStorage.setItem('sovaroll.nativeAudio.enabled.v1',String(enabled));}catch{}if(!enabled&&active())await stop();update();};
 button.onclick=()=>{dialog.showModal();};$('native-audio-close').onclick=()=>dialog.close();dialog.addEventListener('cancel',()=>dialog.close());
 async function stop(){if(active()&&state.jobId)accept(await post('/api/native/audio/stop',{jobId:state.jobId}));}
 return{
  update,snapshot:accept,event:accept,
  get enabled(){return enabled&&supported;},get active(){return active();},
  async play(rendered){
   if(!this.enabled)return false;
   const revision=rendered.revision??getContext().project.revision;
   try{accept(await post('/api/native/audio/play',{jobId:rendered.id,expectedRevision:revision}));document.getElementById('playback-status').textContent=`Native audio · ${state.status}`;return true;}
   catch(error){document.getElementById('playback-status').textContent='Native audio · 오류';notify(error.message,true);return true;}
  },
  async stop(){try{await stop();}catch(error){notify(error.message,true);}},
 };
}
