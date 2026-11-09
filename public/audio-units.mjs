// On-demand offline Audio Unit probe. Default playback stays unchanged; only explicit import edits the project.
export function setupAudioUnits({request,getContext,renderCurrentMix,onImported,notify}){
 const button=document.createElement('button');button.id='audio-units-open';button.type='button';button.textContent='Audio Units';document.querySelector('.top-actions').prepend(button);
 const dialog=document.createElement('dialog');dialog.id='audio-units-dialog';dialog.innerHTML='<div class="dialog-heading"><h2>Audio Unit · 오프라인 probe</h2><button id="audio-units-close" type="button" aria-label="Audio Unit 닫기">×</button></div><p>선택한 구성요소만 명시적으로 인스턴스화하고 현재 믹스를 오프라인 처리합니다. 기본 재생은 바꾸지 않고, 처리와 다운로드는 프로젝트를 변경하지 않습니다. 가져오기 버튼만 새 클립을 추가합니다. 플러그인 호환성·음질은 별도 검증이 필요합니다.</p><div class="session-toolbar"><button id="audio-units-list" type="button">구성요소 검색</button><button id="audio-units-release" type="button">인스턴스 해제</button></div><select id="audio-units-component" aria-label="Audio Unit 구성요소"></select><div class="dialog-actions"><button id="audio-units-instantiate" type="button">선택 인스턴스화</button><button id="audio-units-render" type="button">현재 믹스 오프라인 처리</button></div><p id="audio-units-status" role="status"></p><p id="audio-units-result" role="status"></p><a id="audio-units-download" hidden>처리 WAV 다운로드</a><button id="audio-units-import" type="button" hidden>처리본을 클립으로 가져오기</button>';document.body.append(dialog);
 const $=id=>dialog.querySelector('#'+id);let supported=false,loading=false,components=[],selectedId='',state={status:'idle',instantiated:false};
 const post=(route,input)=>request(route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...input,expectedRevision:getContext().project.revision})});
 const update=()=>{
  button.disabled=!supported||!getContext().project||getContext().busy||!getContext().connected;
  $('audio-units-component').disabled=loading||!components.length;$('audio-units-list').disabled=loading||!supported;
  $('audio-units-instantiate').disabled=loading||!selectedId;$('audio-units-render').disabled=loading||!state.instantiated;$('audio-units-release').disabled=loading||!state.instantiated;
  const download=$('audio-units-download'),output=state.lastRender?.outputUrl;download.hidden=!output;if(output){download.href=output;download.download=`audio-unit-r${state.lastRender?.revision??getContext().project.revision}.wav`;}
  const importButton=$('audio-units-import');importButton.hidden=!output;importButton.disabled=loading||!output||getContext().busy||!getContext().connected;
  $('audio-units-status').textContent=loading?'처리 중…':`${state.status}${state.instantiated?' · 인스턴스 있음':''}${state.error?' · '+state.error:''}`;
 };
 const accept=value=>{if(value?.capabilities)supported=value.capabilities.audioUnitOfflineProbe===true;if(value?.audioUnits)state=value.audioUnits;else if(value?.status)state=value;update();};
 async function run(action){loading=true;update();try{return await action();}catch(error){state={...state,error:error.message};notify(`Audio Unit probe: ${error.message}`,true);return null;}finally{loading=false;update();}}
 $('audio-units-list').onclick=()=>run(async()=>{const result=await post('/api/audio-units/list',{limit:256});components=result.components;selectedId=components[0]?.id??'';$('audio-units-component').replaceChildren(...components.map(component=>{const option=new Option(`${component.name} · ${component.manufacturer}`,component.id);option.dataset.audioUnitType=String(component.type);return option;}));if(selectedId)$('audio-units-component').value=selectedId;return result;});
 $('audio-units-component').onchange=()=>{selectedId=$('audio-units-component').value;state={...state,instantiated:false,status:'selected'};update();};
 $('audio-units-instantiate').onclick=()=>run(async()=>{const result=await post('/api/audio-units/instantiate',{id:selectedId});accept({audioUnits:{...state,selected:result.component.id,instantiated:true,status:'instantiated',error:null}});return result;});
 $('audio-units-render').onclick=()=>run(async()=>{
  const job=await renderCurrentMix(),result=await post('/api/audio-units/render',{jobId:job.id});
  accept({audioUnits:{...state,lastRender:result,status:'rendered',error:null}});
  $('audio-units-result').textContent=`완료 · ${result.frames} frames · ${result.sampleRate} Hz · ${result.channels} ch · 출력 ${result.pcmSha256}`;return result;
 });
 $('audio-units-release').onclick=()=>run(async()=>{await post('/api/audio-units/release',{});state={...state,instantiated:false,status:'released'};return true;});
 $('audio-units-import').onclick=()=>run(async()=>{
  const output=state.lastRender?.outputUrl;if(!output)return null;
  const response=await fetch(output);if(!response.ok)throw new Error(`처리 WAV 읽기 실패: HTTP ${response.status}`);
  const bytes=await response.arrayBuffer(),context=getContext();
  const params=new URLSearchParams({name:'Audio Unit processed.wav',expectedRevision:String(context.project.revision),atSample:String(Math.max(0,Math.round((context.cursorSeconds??0)*context.project.sampleRate))),audioUnitOutput:'1'});
  const imported=await request(`/api/import/wav?${params}`,{method:'POST',headers:{'Content-Type':'audio/wav'},body:bytes});
  await onImported();$('audio-units-result').textContent+=` · 클립 추가 REV ${imported.projectRevision}`;return imported;
 });
 button.onclick=()=>{dialog.showModal();};$('audio-units-close').onclick=()=>dialog.close();dialog.addEventListener('cancel',()=>dialog.close());
 return{update,snapshot:accept,event:accept,get active(){return state.instantiated;}};
}
