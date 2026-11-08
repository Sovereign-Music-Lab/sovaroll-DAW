const active=s=>['preparing','playing','stopping','resetting'].includes(s?.status);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
/** Shared server transport; browser cursor is a view of its current project job. */
export function setupNativeMidi({request,getContext,stopPreview,onTransport,notify}){
 const button=document.createElement('button');button.id='native-midi-open';button.type='button';button.textContent='MIDI 출력';document.querySelector('.top-actions').prepend(button);
 const dialog=document.createElement('dialog');dialog.id='native-midi-dialog';dialog.className='midi-modifiers-dialog';dialog.innerHTML=`<div class="dialog-heading"><h2>MIDI 출력 · 프로젝트별 설정</h2><button id="native-midi-close" type="button">닫기 / 취소</button></div><p>Play와 Stop 상태는 이 서버의 GUI·CLI에서 공유합니다. 창을 닫아도 native MIDI 재생은 계속됩니다.</p><p id="native-midi-status" role="status"></p><p id="native-midi-ports-status" role="status"></p><button id="native-midi-reload" type="button">초안 버리고 다시 읽기</button><form id="native-midi-form"><label>재생 방식 <select id="native-midi-mode"><option value="preview">내장 악기 + 오디오 프리뷰</option><option value="native-midi">외부 MIDI 포트 · MIDI만 재생</option></select></label><div id="native-midi-routes"></div><p>Native 모드에서는 오디오 클립을 재생하지 않습니다. 포트는 ID로 지정하며 자동 대체하지 않습니다. 채널의 ‘원본 유지’는 MIDI 이벤트의 채널을 사용합니다.</p><p>중단 시 사용한 채널에 note-off와 All Sound Off(CC120)를 보냅니다. 같은 포트·채널을 쓰는 다른 악기의 소리에도 영향을 줄 수 있습니다. MIDI Reset 공통 설정에서 자동·수동 Reset을 조절합니다. Native audio 동기화는 아직 지원하지 않습니다.</p><button id="native-midi-apply" type="submit">출력 설정 저장</button></form>`;document.body.append(dialog);
 const $=id=>dialog.querySelector('#'+id);let current=null,loading=false,saving=false,stale=false,generation=0,transport={status:'idle',jobId:null},polling=false,pending=false,playGeneration=0,sessionId=null,lastSequence=-1;
 const post=(route,input)=>request(route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
 const update=()=>{const ctx=getContext();button.disabled=!ctx.project||ctx.busy||!ctx.connected;$('native-midi-apply').disabled=!current||loading||saving||stale;$('native-midi-reload').disabled=loading||saving;$('native-midi-close').disabled=saving;for(const field of dialog.querySelectorAll('select'))field.disabled=loading||saving;};
 const invalidate=message=>{generation++;loading=false;stale=true;if(dialog.open){$('native-midi-status').textContent=message;update();}};
 function accept(value){
  if(value?.portsChanged&&dialog.open)$('native-midi-ports-status').textContent='포트 상태가 바뀌었습니다. 다시 읽으면 목록을 갱신합니다. 지정된 ID는 유지합니다.';
  if(!value||Number.isSafeInteger(value.sequence)&&value.sequence<=lastSequence)return;
  if(Number.isSafeInteger(value.sequence))lastSequence=value.sequence;
  const positionChanged=!value.preserveCursor&&(active(value)||active(transport));transport=value;if(active(value))stopPreview();onTransport(value,{positionChanged});
 }
 async function load(){
  const token=++generation,context=getContext();loading=true;current=null;$('native-midi-ports-status').textContent='';$('native-midi-status').textContent='포트와 설정 읽는 중…';update();
  try{
   const profile=await request('/api/native/settings');let ports={destinations:[]},portError='';try{ports=await request('/api/native/ports');}catch(e){portError=e.message;}
   if(token!==generation||context.documentId!==getContext().documentId)return;
   current=profile;stale=false;$('native-midi-mode').value=profile.config.mode;
   const routes=new Map(profile.config.routes.map(r=>[r.trackId,r]));
   $('native-midi-routes').innerHTML=context.project.tracks.filter(t=>t.type==='midi').map(t=>{
    const route=routes.get(t.id),id=route?.destinationId??null,options=[{id:null,name:'출력 안 함'},...ports.destinations];if(id!==null&&!options.some(p=>p.id===id))options.push({id,name:'연결되지 않은 포트'});
    return `<fieldset data-native-track="${esc(t.id)}"><legend>${esc(t.name)}</legend><label>포트 <select data-native-destination>${options.map(p=>`<option value="${p.id??''}"${p.id===id?' selected':''}>${esc(p.name)}${p.id===null?'':` · ID ${p.id}`}</option>`).join('')}</select></label><label>채널 <select data-native-channel><option value="">원본 유지</option>${Array.from({length:16},(_,i)=>`<option value="${i}"${route?.channel===i?' selected':''}>${i+1}</option>`).join('')}</select></label></fieldset>`;
   }).join('')||'<p>MIDI 트랙이 없습니다.</p>';
   $('native-midi-status').textContent=`설정 REV ${profile.settings.revision}${portError?' · 포트 조회 실패: '+portError:''}`;
  }catch(e){if(token===generation){current=null;$('native-midi-status').textContent=e.message;}}
  finally{if(token===generation){loading=false;update();}}
 }
 const close=()=>{if(saving)return;generation++;loading=false;current=null;dialog.close();};button.onclick=()=>{dialog.showModal();void load();};$('native-midi-close').onclick=close;dialog.addEventListener('cancel',e=>{e.preventDefault();close();});$('native-midi-reload').onclick=()=>void load();
 $('native-midi-form').onsubmit=async e=>{e.preventDefault();if(!current||loading||saving||stale)return;const ctx=getContext(),revision=ctx.project?.revision;saving=true;update();try{
  const routes=[...dialog.querySelectorAll('[data-native-track]')].map(row=>{const destination=row.querySelector('[data-native-destination]').value,channel=row.querySelector('[data-native-channel]').value;return{trackId:row.dataset.nativeTrack,destinationId:destination===''?null:Number(destination),channel:channel===''?null:Number(channel)};});
  const result=await post('/api/native/settings',{projectId:current.projectId,expectedProjectRevision:current.projectRevision,expectedRevision:current.settings.revision,expectedFingerprint:current.fingerprint,mode:$('native-midi-mode').value,routes});
  if(ctx.documentId!==getContext().documentId||revision!==getContext().project?.revision){invalidate('프로젝트가 바뀌었습니다. 다시 읽으세요.');return;}
  current=result;stale=false;$('native-midi-status').textContent=`저장됨 · REV ${result.settings.revision}`;stopPreview();
 }catch(e){stale=e.status===409;$('native-midi-status').textContent=e.message;notify(e.message,true);}finally{saving=false;update();}};
 const timer=setInterval(async()=>{if(polling||!active(transport))return;polling=true;const id=sessionId;try{const value=await request('/api/native/transport');if(id===sessionId)accept(value);}catch(e){notify(e.message,true);}finally{polling=false;}},250);
 window.addEventListener('beforeunload',()=>clearInterval(timer));
 return {update,get active(){return active(transport)||pending;},
  snapshot(value,id){if(id!==sessionId){sessionId=id;lastSequence=-1;transport={status:'idle',jobId:null};playGeneration++;pending=false;}accept(value);},
  event:accept,
  settingsChanged(){playGeneration++;stopPreview();if(!saving)invalidate('다른 창에서 출력 설정이 바뀌었습니다. 초안을 보존했습니다. 다시 읽으세요.');},
  documentChanged(){playGeneration++;pending=false;invalidate('프로젝트가 바뀌었습니다. 다시 읽으세요.');},
  projectChanged(){if(dialog.open&&!saving)invalidate('프로젝트가 편집되었습니다. 초안을 보존했습니다. 다시 읽으세요.');},
  async previewAllowed(){const [p,s]=await Promise.all([request('/api/native/settings'),request('/api/native/transport')]);return p.config.mode==='preview'&&!active(s);},
  async playAt(startTick){
   if(pending||active(transport)){await this.stop();return true;}
   const token=++playGeneration,ctx=getContext();pending=true;update();
   try{
    const [profile,chase,reset,timing]=await Promise.all([request('/api/native/settings'),request('/api/workspace/chase-settings'),request('/api/workspace/reset-settings'),request('/api/workspace/timing-settings')]);
    if(token!==playGeneration||ctx.documentId!==getContext().documentId||ctx.project.revision!==getContext().project?.revision)return true;
    if(profile.config.mode==='preview')return false;
    const value=await post('/api/native/play',{expectedRevision:ctx.project.revision,expectedSettingsRevision:profile.settings.revision,expectedSettingsFingerprint:profile.fingerprint,expectedChaseRevision:chase.settings.revision,expectedChaseFingerprint:chase.fingerprint,expectedResetRevision:reset.settings.revision,expectedResetFingerprint:reset.fingerprint,expectedTimingRevision:timing.settings.revision,expectedTimingFingerprint:timing.fingerprint,startTick});
    if(token!==playGeneration){await post('/api/native/stop',{jobId:value.jobId});return true;}
    accept(value);if(value.warnings?.length)notify(value.warnings.map(x=>x.message??String(x)).join(' · '));return true;
   }catch(e){if(token===playGeneration)notify(e.message,true);return true;}finally{pending=false;update();}
  },
  async manualReset(){
   const ctx=getContext();if(!ctx.project||ctx.busy||!ctx.connected)throw new Error('프로젝트를 열고 연결 상태를 확인하세요.');
   playGeneration++;stopPreview();const [profile,chase,reset,timing]=await Promise.all([request('/api/native/settings'),request('/api/workspace/chase-settings'),request('/api/workspace/reset-settings'),request('/api/workspace/timing-settings')]);
   if(ctx.documentId!==getContext().documentId||ctx.project.revision!==getContext().project?.revision)throw new Error('프로젝트가 바뀌었습니다. 다시 시도하세요.');
   const result=await post('/api/native/reset',{expectedRevision:ctx.project.revision,expectedSettingsRevision:profile.settings.revision,expectedSettingsFingerprint:profile.fingerprint,expectedChaseRevision:chase.settings.revision,expectedChaseFingerprint:chase.fingerprint,expectedResetRevision:reset.settings.revision,expectedResetFingerprint:reset.fingerprint,expectedTimingRevision:timing.settings.revision,expectedTimingFingerprint:timing.fingerprint});accept(result);return result;
  },
  async stop(reason='stop'){playGeneration++;pending=false;const state=await request('/api/native/transport');if(active(state)&&state.jobId)accept(await post('/api/native/stop',{jobId:state.jobId,reason}));}
 };
}
