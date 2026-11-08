// Session history and recovery controls. All edits go through the shared engine/API.
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const actionLabels={'project.rename':'프로젝트 이름 변경','project.settings':'프로젝트 설정','tempo.set':'템포 변경','track.add':'트랙 추가','track.update':'트랙 속성 변경','track.remove':'트랙 삭제','track.duplicate':'트랙 복제','track.reorder':'트랙 순서 변경','clip.add':'클립 추가','clip.update':'클립 속성 변경','clip.remove':'클립 삭제','clip.duplicate':'클립 복제','clip.split':'클립 분할','clip.move':'클립 이동','midi.notes.add':'노트 추가','midi.notes.update':'노트 수정','midi.notes.remove':'노트 삭제','midi.notes.quantize':'퀀타이즈','midi.notes.resetQuantize':'퀀타이즈 원복','midi.notes.freezeQuantize':'퀀타이즈 기준 확정','midi.notes.transpose':'전조','midi.notes.velocity':'벨로시티 변경','midi.notes.legato':'레가토','midi.notes.removeDoubles':'중복 노트 제거','asset.add':'오디오 원본 추가','asset.relink':'오디오 원본 재연결','asset.removeMissing':'누락 원본과 클립 제거','batch':'여러 편집 묶음'};
const label=e=>actionLabels[e.action]||e.label||e.action;
const date=value=>value?new Date(value).toLocaleString('ko-KR'):'시각 정보 없음';
export function setupSessionUI({getContext,runCommand,request,notify}){
 const $=id=>document.getElementById(id);
 let historyResult,backupResult,selectedEntry=null;
 function message(id,text,error=false){$(id).textContent=text;$(id).hidden=!text;$(id).classList.toggle('error',error);}
 function update(){
  const c=getContext(),unavailable=!c.project||c.busy||!c.connected;
  $('history-button').disabled=unavailable;$('backups-button').disabled=unavailable;
  for(const id of ['history-refresh','backup-refresh','backup-now'])$(id).disabled=unavailable;
  if(historyResult&&$('history-dialog').open&&historyResult.projectRevision!==c.project?.revision)$('history-revision').textContent=`REV ${historyResult.projectRevision} · 프로젝트 변경됨 — 다시 읽기`;
 }
 async function get(url){const response=await fetch(url),body=await response.json();if(!response.ok)throw new Error(body.errors?.map(e=>e.message).join(' · ')||'조회 실패');return body;}
 async function loadHistory(){
  try{
   historyResult=await get('/api/history');const h=historyResult.history;
   $('history-revision').textContent=`REV ${historyResult.projectRevision} · ${h.cursor}/${h.entries.length}개 적용`;
   $('history-boundary').max=h.entries.length;$('history-boundary').value=h.cursor;$('history-boundary-label').textContent=`현재 경계 ${h.cursor} / ${h.entries.length}`;
   $('history-max').value=h.maxSteps;
   $('history-persistence').textContent=`이력 저장: ${({new:'첫 이력 저장 대기',saved:'저장됨',restored:'복원됨','restored-previous':'이전 저장 세대에서 복원됨',reset:'확인 필요 · 원본 보존'})[historyResult.persistence.status]||historyResult.persistence.status}${historyResult.persistence.warnings?.length?' · '+historyResult.persistence.warnings.map(w=>typeof w==='string'?w:w.message).join(' · '):''}`;
   $('history-list').innerHTML=h.entries.length?`<table class="session-table"><thead><tr><th>상태 / 작업</th><th>시각</th><th>상세</th></tr></thead><tbody>${h.entries.map((e,i)=>`<tr class="${i<h.cursor?'history-applied':'history-undone'} ${i+1===h.cursor?'history-boundary-row':''}"><td><button class="history-entry" data-history-entry="${esc(e.id)}">${i<h.cursor?'●':'○'} ${i+1}. ${esc(label(e))}</button></td><td>${esc(date(e.time))}</td><td>${esc(e.description||`${e.summary.created}개 추가 · ${e.summary.updated}개 변경 · ${e.summary.removed}개 제거`)}</td></tr>`).join('')}</tbody></table>`:'<p>아직 편집 이력이 없습니다. 이 버전부터 저장한 편집은 재시작 후에도 복원됩니다.</p>';
   if(!h.entries.some(e=>e.id===selectedEntry))selectedEntry=null;
   renderDescription();update();
  }catch(error){message('history-message',error.message,true);}
 }
 function renderDescription(){
  const entry=historyResult?.history.entries.find(e=>e.id===selectedEntry);
  $('history-description-form').hidden=!entry;
  if(entry){$('history-description-label').textContent=label(entry);$('history-description').value=entry.description;}
 }
 $('history-button').addEventListener('click',()=>{message('history-message','');$('history-dialog').showModal();loadHistory();});
 $('history-refresh').addEventListener('click',()=>{message('history-message','');loadHistory();});
 $('history-list').addEventListener('click',event=>{const id=event.target.closest('[data-history-entry]')?.dataset.historyEntry;if(id){selectedEntry=id;renderDescription();}});
 $('history-boundary').addEventListener('input',()=>{$('history-boundary-label').textContent=`이동할 경계 ${$('history-boundary').value} / ${historyResult.history.entries.length}`;});
 $('history-boundary').addEventListener('change',async()=>{
  if(!historyResult)return;const index=Number($('history-boundary').value),h=historyResult.history;
  const boundaryId=index===0?h.baseBoundaryId:h.entries[index-1]?.boundaryId;if(!boundaryId)return;
  const result=await runCommand('history.goTo',{boundaryId},historyResult.projectRevision);
  message('history-message',result?'실행취소 경계를 이동했습니다. 다시 앞으로 이동할 수 있습니다.':'프로젝트가 변경되었거나 경계를 이동하지 못했습니다. 최신 이력을 다시 읽었습니다.',!result);await loadHistory();
 });
 $('history-description-form').addEventListener('submit',async event=>{
  event.preventDefault();if(!selectedEntry)return;
  const result=await runCommand('history.describe',{entryId:selectedEntry,description:$('history-description').value},historyResult.projectRevision);
  message('history-message',result?'이력 설명을 저장했습니다.':'설명을 저장하지 못했습니다. 최신 이력을 다시 읽었습니다.',!result);await loadHistory();
 });
 $('history-limit-form').addEventListener('submit',async event=>{
  event.preventDefault();const result=await runCommand('history.settings',{maxSteps:Number($('history-max').value)},historyResult.projectRevision);
  message('history-message',result?'이력 보관 한도를 저장했습니다.':'한도를 저장하지 못했습니다. 최신 이력을 다시 읽었습니다.',!result);await loadHistory();
 });
 async function loadBackups(){
  try{
   backupResult=await get('/api/backups');const settings=backupResult.settings.autoBackup;
   $('backup-enabled').checked=settings.enabled;$('backup-interval').value=settings.intervalMinutes;$('backup-count').value=settings.maxCount;
   const a=backupResult.automation;
   $('backup-status').textContent=`${a.dirty?'아직 백업하지 않은 변경 있음':backupResult.files.length?'새로운 편집 없음':'아직 백업 없음'} · ${settings.enabled?'자동백업 사용':'자동백업 꺼짐'}${a.lastCreatedAt?' · 마지막 '+date(a.lastCreatedAt):''}${a.lastError?' · 백업 실패: '+a.lastError.message:''}`;
   $('backup-list').innerHTML=backupResult.files.length?`<table class="session-table"><thead><tr><th>백업</th><th>시각</th><th>프로젝트</th></tr></thead><tbody>${backupResult.files.map(b=>`<tr><td>${b.valid?`<a href="/api/backups/${encodeURIComponent(b.id)}/file" download>백업 ${b.sequence} ↓</a>`:`<span class="media-changed">백업 ${b.sequence} · 확인 필요</span><small>${esc(b.error?.message||'파일을 확인할 수 없습니다.')}</small>`}</td><td>${esc(date(b.createdAt))}</td><td>REV ${b.projectRevision??b.revision??'—'}</td></tr>`).join('')}</tbody></table>`:'<p>아직 순환 백업이 없습니다.</p>';
   if(backupResult.warnings?.length)message('backup-message',backupResult.warnings.map(w=>typeof w==='string'?w:w.message).join(' · '),true);
   update();
  }catch(error){message('backup-message',error.message,true);}
 }
 $('backups-button').addEventListener('click',()=>{message('backup-message','');$('backups-dialog').showModal();loadBackups();});
 $('backup-refresh').addEventListener('click',()=>{message('backup-message','');loadBackups();});
 $('backup-settings-form').addEventListener('submit',async event=>{
  event.preventDefault();if(!backupResult)return;
  try{
   await request('/api/backups/settings',{expectedRevision:backupResult.projectRevision,expectedSettingsRevision:backupResult.settings.revision,autoBackup:{enabled:$('backup-enabled').checked,intervalMinutes:Number($('backup-interval').value),maxCount:Number($('backup-count').value)}});
   message('backup-message','자동백업 설정을 저장했습니다.');
  }catch(error){message('backup-message',error.message,true);}
  await loadBackups();
 });
 $('backup-now').addEventListener('click',async()=>{
  try{
   const result=await request('/api/backups/create',{expectedRevision:backupResult.projectRevision});
   const text=result.status==='created'?'프로젝트 백업을 만들었습니다.':'변경이 없어 중복 백업을 만들지 않았습니다.';
   message('backup-message',text);notify(text);
  }catch(error){message('backup-message',error.message,true);}
  await loadBackups();
 });
 return {update};
}
