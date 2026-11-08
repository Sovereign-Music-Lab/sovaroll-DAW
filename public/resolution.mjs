const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function setupResolutionUI({getContext,request,notify}){
  const $=id=>document.getElementById(id);
  document.body.insertAdjacentHTML('beforeend',`<dialog id="resolve-dialog" class="media-dialog"><div class="dialog-heading"><h2>누락 미디어 해결</h2><button id="resolve-close" aria-label="누락 미디어 해결 닫기">×</button></div>
  <p>원본 위치를 찾거나 다른 WAV로 재연결합니다. 닫으면 누락 상태로 프로젝트를 계속 편집할 수 있습니다.</p>
  <p id="resolve-status" role="status"></p><div class="media-toolbar"><label>대상 <select id="resolve-asset" aria-label="해결할 미디어"></select></label><button id="resolve-refresh">다시 검사</button><button id="resolve-remove" class="secondary">누락 항목 모두 제거…</button></div>
  <form id="resolve-search-form"><div class="resolve-inputs"><label>찾는 방법<select id="resolve-mode"><option value="search">폴더와 하위 폴더 검색</option><option value="folder">지정 폴더에서 찾기</option><option value="file">파일 경로 직접 지정</option></select></label><label class="resolve-location">파일 또는 폴더 경로<input id="resolve-location" placeholder="/Users/…/Audio" required></label><label>검색 파일명<input id="resolve-name" required></label></div><div class="media-toolbar"><label><input id="resolve-case" type="checkbox"> 대소문자 구분</label><button id="resolve-start" class="primary" type="submit">검색 시작</button><button id="resolve-stop" type="button" disabled>검색 중지</button></div></form>
  <div id="resolve-results"></div><div class="media-toolbar"><label><input id="resolve-automap" type="checkbox" checked> 같은 폴더의 다른 누락 원본도 찾기</label><label><input id="resolve-round" type="checkbox"> 샘플레이트 변환 시 프레임 반올림 허용</label><button id="resolve-preview" disabled>선택 후보 검토</button></div>
  <div id="resolve-plan" hidden></div><div id="resolve-confirm" class="media-toolbar" hidden><label id="resolve-consent-label"><input id="resolve-consent" type="checkbox"> 다른 내용의 WAV로 바꾸는 것을 확인했습니다</label><button id="resolve-accept" class="primary">적용</button></div>
  <p class="media-recovery-help">원본 파일은 복사해서 보관합니다. 재연결과 목록 제거는 실행 취소할 수 있습니다. 디스크의 원본 파일은 삭제하지 않습니다.</p></dialog>`);
  let inventory=null,job=null,plan=null,removal=null,timer=null,requestNumber=0,documentGeneration=0,loading=false;
  function message(text,error=false){$('resolve-status').textContent=text;$('resolve-status').classList.toggle('error',error);}
  async function get(route){const response=await fetch(route),value=await response.json();if(!response.ok)throw new Error(value.errors?.map(e=>e.message).join(' · ')||'미디어 조회 실패');return value;}
  const context=()=>({expectedRevision:inventory?.projectRevision,expectedMediaRevision:inventory?.mediaRevision});
  function resetPlan(){plan=null;removal=null;$('resolve-plan').hidden=true;$('resolve-confirm').hidden=true;$('resolve-consent').checked=false;}
  function update(){
    const c=getContext(),unavailable=!c.project||c.busy||!c.connected;
    $('media-resolve-button').disabled=unavailable||loading;
    for(const id of ['resolve-refresh','resolve-asset','resolve-mode','resolve-location','resolve-name','resolve-case','resolve-automap','resolve-round','resolve-consent'])$(id).disabled=unavailable||loading;
    for(const input of $('resolve-results').querySelectorAll('input'))input.disabled=unavailable||loading;
    const missing=inventory?.assets.filter(a=>['missing','changed'].includes(a.status))??[];
    $('resolve-start').disabled=unavailable||loading||!missing.length||job?.status==='running';
    $('resolve-remove').disabled=unavailable||loading||!inventory?.assets.some(a=>a.status==='missing');
    $('resolve-preview').disabled=unavailable||loading||!$('resolve-results').querySelector('input[name=resolve-candidate]:checked');
    $('resolve-stop').disabled=job?.status!=='running';
    $('resolve-accept').disabled=unavailable||loading||Boolean(plan?.requiresReplacementConsent&&!$('resolve-consent').checked);
  }
  async function stop(){clearTimeout(timer);timer=null;if(job?.status==='running'){try{job=await request(`/api/media/search/${job.id}/stop`,{});}catch(error){message(error.message,true);}}if(job?.status==='running'&&$('resolve-dialog').open){const id=job.id;timer=setTimeout(()=>poll(id),100);}update();}
  async function load({open=false}={}){
    await stop();resetPlan();job=null;$('resolve-results').replaceChildren();
    const generation=++requestNumber;loading=true;update();
    try{
      const value=await get('/api/assets');if(generation!==requestNumber)return;inventory=value;
      const missing=value.assets.filter(a=>['missing','changed'].includes(a.status)),previous=$('resolve-asset').value;
      $('resolve-asset').innerHTML=missing.map(a=>`<option value="${escape(a.id)}">${escape(a.name)} · ${a.status==='missing'?'누락':'내용 변경'} · ${a.referenceCount}클립</option>`).join('');
      if(missing.some(a=>a.id===previous))$('resolve-asset').value=previous;
      nameFromAsset();message(`REV ${value.projectRevision} · 누락 ${value.assets.filter(a=>a.status==='missing').length}개 · 내용 변경 ${value.assets.filter(a=>a.status==='changed').length}개`);
      if(open&&!$('resolve-dialog').open)$('resolve-dialog').showModal();
    }catch(error){message(error.message,true);}finally{if(generation===requestNumber){loading=false;update();}}
  }
  function nameFromAsset(){const asset=inventory?.assets.find(a=>a.id===$('resolve-asset').value);$('resolve-name').value=asset?.name??'';}
  function renderJob(){
    if(!job)return;
    const target=$('resolve-asset').value,selected=$('resolve-results').querySelector('input[name=resolve-candidate]:checked')?.value;
    const candidates=job.candidates.filter(c=>c.matches?.some(m=>m.assetId===target));
    const labels={running:'검색 중',completed:'검색 완료',stopped:'검색 중지됨',failed:'검색 실패'};
    message(`${labels[job.status]??job.status} · 검사 ${job.progress?.scannedFiles??0}파일 · 후보 ${candidates.length}개${job.stale?' · 프로젝트가 변경되어 새 검색 필요':''}${job.truncated?' · 검색 한도 도달':''}${job.warnings?.length?' · 일부 경로 또는 대상 생략':''}`,job.status==='failed'||job.stale);
    $('resolve-results').innerHTML=`${candidates.length?`<div class="resolve-candidates">${candidates.map(c=>{const match=c.matches.find(m=>m.assetId===target);return `<label class="resolve-candidate"><input type="radio" name="resolve-candidate" value="${escape(c.id)}" ${c.id===selected?'checked':''}><span><strong>${escape(c.name)}</strong><small>${escape(c.path)}</small><small>${(c.size/1024).toFixed(1)} KiB · ${c.sampleRate} Hz · ${c.channels} ch · ${c.frames} frames · ${match.exactHash?'원본 내용 일치':'다른 내용 — 적용 전 확인 필요'}</small>${match.reasons?.length?`<small>${escape(match.reasons.map(r=>r.message??r).join(' · '))}</small>`:''}</span></label>`;}).join('')}</div>`:'<p>선택한 대상의 후보가 없습니다. 경로·파일명·대소문자 옵션을 확인하세요.</p>'}${job.errors?.length?`<details><summary>검사하지 못한 파일 ${job.errors.length}개</summary><p>${escape(job.errors.slice(0,10).map(e=>e.message).join(' · '))}</p></details>`:''}`;
    update();
  }
  async function poll(id){
    try{const value=await get(`/api/media/search/${id}`);if(job?.id!==id||!$('resolve-dialog').open)return;job=value;renderJob();if(job.status==='running')timer=setTimeout(()=>poll(id),250);}
    catch(error){message(error.message,true);}
  }
  $('resolve-search-form').addEventListener('submit',async event=>{
    event.preventDefault();await stop();resetPlan();loading=true;update();
    try{
      job=await request('/api/media/search',{...context(),assetId:$('resolve-asset').value,mode:$('resolve-mode').value,location:$('resolve-location').value,queryName:$('resolve-name').value,caseSensitive:$('resolve-case').checked});
      renderJob();if(job.status==='running')timer=setTimeout(()=>poll(job.id),100);
    }catch(error){message(error.message,true);}finally{loading=false;update();}
  });
  $('resolve-stop').addEventListener('click',async()=>{await stop();renderJob();});
  $('resolve-asset').addEventListener('change',async()=>{await stop();job=null;resetPlan();$('resolve-results').replaceChildren();nameFromAsset();update();});
  $('resolve-results').addEventListener('change',()=>{resetPlan();update();});
  for(const id of ['resolve-automap','resolve-round'])$(id).addEventListener('change',()=>{resetPlan();update();});
  $('resolve-preview').addEventListener('click',async()=>{
    loading=true;resetPlan();update();
    try{
      plan=await request('/api/media/plan',{...context(),searchId:job.id,candidateId:$('resolve-results').querySelector('input[name=resolve-candidate]:checked').value,autoMap:$('resolve-automap').checked,framePolicy:$('resolve-round').checked?'nearest':'exact'});
      $('resolve-plan').innerHTML=`<h3>적용 전 확인 · ${plan.rows.length}개 원본</h3><ul>${plan.rows.map(r=>`<li>${escape(r.name)} → ${r.exactHash?'동일 원본 복구':'다른 내용 재연결'} · 사용 클립 ${r.clipIds.length}개${r.automatic?' · 자동 찾기':''}<small>${escape(r.source)}</small></li>`).join('')}</ul><p>남은 누락·변경 원본 ${plan.unresolved.length}개. ${escape(plan.warnings.map(w=>w.message??w).join(' · '))}</p>${plan.changes?.relinked?.conversions?.some(c=>c.fromSampleRate!==c.toSampleRate)?`<p>프레임 변환: ${plan.changes.relinked.conversions.filter(c=>c.fromSampleRate!==c.toSampleRate).map(c=>`${c.fromSampleRate} → ${c.toSampleRate} Hz${c.rounding==='nearest'?' · 경계를 가장 가까운 프레임으로 조정':' · 시간 유지'}`).join(' / ')}</p>`:''}`;
      $('resolve-plan').hidden=false;$('resolve-confirm').hidden=false;$('resolve-consent-label').hidden=!plan.requiresReplacementConsent;message('후보와 적용 범위를 확인한 뒤 적용하세요.');
    }catch(error){message(error.message,true);}finally{loading=false;update();}
  });
  $('resolve-remove').addEventListener('click',async()=>{
    resetPlan();loading=true;update();
    try{
      const assetIds=inventory.assets.filter(a=>a.status==='missing').map(a=>a.id);
      const input={...context(),expectedAssetIds:assetIds};const result=await request('/api/media/remove-missing',{...input,dryRun:true});
      if(result.status==='error')throw new Error(result.errors.map(e=>e.message).join(' · '));
      removal=input;const assets=inventory.assets.filter(a=>assetIds.includes(a.id));
      $('resolve-plan').innerHTML=`<h3>누락 항목 모두 제거</h3><p>Pool 원본 ${assets.length}개와 사용 클립 ${assets.reduce((n,a)=>n+a.referenceCount,0)}개를 제거합니다. 실행 취소로 되돌릴 수 있습니다. 디스크 파일은 삭제하지 않습니다.</p><ul>${assets.map(a=>`<li>${escape(a.name)} · ${a.referenceCount}클립</li>`).join('')}</ul>`;
      $('resolve-plan').hidden=false;$('resolve-confirm').hidden=false;$('resolve-consent-label').hidden=true;message('제거할 전체 누락 목록을 확인한 뒤 적용하세요.');
    }catch(error){message(error.message,true);}finally{loading=false;update();}
  });
  $('resolve-consent').addEventListener('change',update);
  $('resolve-accept').addEventListener('click',async()=>{
    loading=true;update();
    try{
      const result=removal?await request('/api/media/remove-missing',{...removal,dryRun:false}):await request('/api/media/accept',{...context(),planId:plan.id,allowReplacement:$('resolve-consent').checked});
      if(result.status==='error')throw new Error(result.errors.map(e=>e.message).join(' · '));
      const text=removal?'누락 원본과 사용 클립을 제거했습니다. 실행 취소로 복원할 수 있습니다.':'미디어를 적용했습니다. 남은 누락 목록을 다시 확인하세요.';
      await load();message(text);notify(text);
    }catch(error){message(error.message,true);notify(error.message,true);}finally{loading=false;update();}
  });
  function close(){stop();$('resolve-dialog').close();}
  $('resolve-close').addEventListener('click',close);$('resolve-dialog').addEventListener('cancel',()=>stop());
  $('resolve-refresh').addEventListener('click',()=>load());
  $('media-resolve-button').addEventListener('click',()=>{if($('media-dialog').open)$('media-dialog').close();load({open:true});});
  // Read-only open-time inventory. Close preserves every unresolved reference.
  function checkOpen(){if(!getContext().project)return Promise.resolve();const generation=documentGeneration;return get('/api/assets').then(value=>{if(generation!==documentGeneration)return;if(value.assets.some(a=>a.status==='missing')&&!document.querySelector('dialog[open]'))return load({open:true});}).catch(error=>notify(error.message,true));}
  function documentChanged(){documentGeneration++;requestNumber++;loading=false;clearTimeout(timer);timer=null;job=null;inventory=null;resetPlan();$('resolve-results').replaceChildren();$('resolve-dialog').close();checkOpen();}
  checkOpen();
  return {update,checkOpen,documentChanged};
}
