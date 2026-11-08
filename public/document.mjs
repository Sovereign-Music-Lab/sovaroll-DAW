const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=value=>value?new Date(value).toLocaleString('ko-KR'):'없음';
export function setupDocumentUI({getContext,request,notify}){
 const $=id=>document.getElementById(id);
 document.body.insertAdjacentHTML('beforeend',`<dialog id="document-dialog" class="media-dialog"><div class="dialog-heading"><h2>프로젝트 저장·버전</h2><button id="document-close" aria-label="프로젝트 저장 창 닫기">×</button></div><p id="document-path" class="document-path"></p><p id="document-checkpoint"></p><p id="document-message" role="status" hidden></p>
 <div class="media-toolbar"><button id="document-save" class="primary">저장</button><button id="document-version">새 버전 저장</button><button id="document-refresh" class="secondary">다시 읽기</button></div><p id="document-save-help">편집은 자동으로 복구 저장됩니다. ‘저장’은 Revert로 돌아올 지점을 정합니다. 새 버전은 번호가 붙은 파일을 만들고 그 파일로 작업을 이어갑니다.</p>
 <form id="document-save-as-form"><label><span id="document-output-label">다른 이름으로 저장할 경로</span><input id="document-output" placeholder="/Users/…/My-Project.newdaw.json" required></label><button type="submit" id="document-save-as">다른 이름으로 저장</button></form><p>존재하는 폴더 안의 새 파일 경로를 지정하세요. 기존 파일을 덮어쓰지 않습니다. 다른 폴더에 저장하면 등록된 WAV도 함께 복사합니다.</p>
 <hr><div class="media-toolbar"><button id="document-revert-plan">저장 상태로 되돌리기…</button><span>Revert</span></div><p id="document-first-save-help" hidden>첫 저장 전에는 새 버전과 Revert를 사용할 수 없습니다. 위에서 프로젝트 파일 이름을 정해 저장하세요.</p><div id="document-revert-preview" hidden></div><form id="document-revert-form" hidden><label><input id="document-revert-confirm" type="checkbox" required> 저장 이후 편집을 버리고 undo/redo 이력을 초기화하는 것을 확인했습니다</label><label>새로 만든 관리 오디오 파일<select id="document-media-policy" required><option value="">보관 방법을 선택하세요</option><option value="keep">파일 보관</option><option value="trash">복원 가능한 프로젝트 휴지통으로 이동</option></select></label><button id="document-revert-apply" type="submit">Revert 적용</button></form>
 <section id="document-trash-section"><hr><div class="media-toolbar"><h3>프로젝트 미디어 휴지통</h3><button id="document-trash-refresh">목록 새로 고침</button></div><div id="document-trash-list"></div><p class="media-recovery-help">외부 원본과 다른 프로젝트가 사용하는 파일은 보존합니다. 휴지통 복원은 기존 파일을 덮어쓰지 않습니다.</p></section></dialog>`);
 let current=null,plan=null,loading=false,switchingDocument=false,generation=0;
 const guards=()=>({expectedRevision:getContext().project.revision,expectedDocumentId:getContext().document.id});
 const matches=(token,id)=>token===generation&&id===getContext().document?.id;
 function message(text='',error=false){$('document-message').textContent=text;$('document-message').hidden=!text;$('document-message').classList.toggle('error',error);}
 async function get(route){const response=await fetch(route),value=await response.json();if(!response.ok)throw new Error(value.errors?.map(e=>e.message).join(' · ')||'저장 상태를 읽지 못했습니다.');return value;}
 function clearPlan(){plan=null;$('document-revert-preview').hidden=true;$('document-revert-form').hidden=true;$('document-revert-confirm').checked=false;$('document-media-policy').value='';}
 function render(){if(!current)return;
  const draft=current.neverSaved===true;
  $('document-path').textContent=draft?`${current.displayName??current.fileName} · 작업 폴더: ${current.projectFolder}`:current.projectPath;
  $('document-checkpoint').textContent=draft?'아직 이름으로 저장하지 않음 · 작업 복구 저장됨':`${current.dirty===null?'저장 기준 확인 필요':current.dirty?'저장 이후 변경 있음':'저장 상태와 같음'} · 기준: ${date(current.savedAt)}${current.origin==='opened-project'?' · 처음 연 상태':''}`;
  $('document-save').textContent=draft?'이름으로 저장…':'저장';$('document-save-as').textContent=draft?'첫 저장':'다른 이름으로 저장';$('document-output-label').textContent=draft?'처음 저장할 프로젝트 파일 경로':'다른 이름으로 저장할 경로';
  $('document-save-help').textContent=draft?'작업은 복구용으로 보관됩니다. 첫 저장에서 프로젝트 파일 이름을 정하면 이후 저장과 Revert의 기준이 생깁니다.':'편집은 자동으로 복구 저장됩니다. ‘저장’은 Revert로 돌아올 지점을 정합니다. 새 버전은 번호가 붙은 파일을 만들고 그 파일로 작업을 이어갑니다.';
  $('document-first-save-help').hidden=!draft;$('document-trash-section').hidden=draft;
  const warnings=current.persistence?.warnings??[];if(warnings.length)message(warnings.map(w=>w.message??w).join(' · '),true);update();
 }
 function update(){const c=getContext(),disabled=!c.project||!c.connected||c.busy||loading,meta=current?.id===c.document?.id?current:c.document;$('document-button').disabled=disabled;
  for(const item of $('document-dialog').querySelectorAll('button,input,select'))if(item.id!=='document-close')item.disabled=disabled;
  $('document-version').disabled=disabled||Boolean(meta?.neverSaved);$('document-revert-plan').disabled=disabled||!meta?.available||Boolean(meta?.neverSaved);
  const stale=plan&&(plan.documentId!==c.document?.id||plan.projectRevision!==c.project?.revision||plan.saveId!==c.document?.saveId);
  $('document-revert-apply').disabled=disabled||!plan||stale||!$('document-revert-confirm').checked||!$('document-media-policy').value;
  if(current&&c.document?.id!==current.id&&$('document-dialog').open)message('활성 파일이 바뀌었습니다. 다시 읽은 뒤 계속하세요.',true);
 }
 async function trash(token=generation,id=getContext().document?.id){const result=await get('/api/document/trash');if(!matches(token,id))return false;
  $('document-trash-list').innerHTML=result.operations?.length?`<ul>${result.operations.map(op=>`<li><span>${date(op.createdAt)} · ${op.files.length}파일 · ${esc(op.status)}</span><button class="secondary" data-restore-operation="${esc(op.operationId)}">미디어 복원</button></li>`).join('')}</ul>`:'<p>보관된 Revert 미디어가 없습니다.</p>';if(result.warnings?.length)message(result.warnings.map(w=>w.message??w).join(' · '),true);update();return true;
 }
 async function load(token=++generation){const id=getContext().document?.id;loading=true;clearPlan();update();
  try{const result=await get('/api/document');if(!matches(token,id)||result.id!==id)return false;current=result;render();if(!current.neverSaved)await trash(token,id);return matches(token,id);}
  catch(error){if(matches(token,id))message(error.message,true);return false;}
  finally{if(token===generation){loading=false;update();}}
 }
 async function operation(work,success,{switchesDocument=false}={}){const token=++generation;switchingDocument=switchesDocument;loading=true;clearPlan();update();message();
  try{const result=await work();if(token!==generation)return result;
   if(result.document?.id&&result.document.id!==getContext().document?.id){$('document-dialog').close();current=null;notify(`${success} 활성 프로젝트는 이후 변경되었습니다.`);return result;}
   const loaded=await load(token);if(token!==generation)return result;const warnings=result.warnings??[];
   if(loaded)message(`${success}${warnings.length?' · '+warnings.map(w=>w.message??w).join(' · '):''}`);notify(success);
   if(result.failures?.length)message('일부 파일을 처리하지 못했습니다. '+result.failures.map(f=>f.message??f.code).join(' · '),true);
   else if(result.skipped?.length)message(`${success} · 이미 있거나 보호되는 파일 ${result.skipped.length}개는 건너뛰었습니다.`);return result;
  }catch(error){if(token===generation){message(error.message,true);notify(error.message,true);}return null;}
  finally{if(token===generation){loading=false;switchingDocument=false;update();}}
 }
 async function showFirstSave(){if(cannotSave())return;message();if(!$('document-dialog').open)$('document-dialog').showModal();const loaded=await load();if(loaded&&getContext().document?.neverSaved&&$('document-dialog').open){message('처음 저장할 프로젝트 파일 경로를 입력하세요. 아직 저장 요청을 보내지 않았습니다.');$('document-output').focus();}}
 function close(){generation++;loading=false;switchingDocument=false;current=null;$('document-dialog').close();clearPlan();update();}
 $('document-button').addEventListener('click',()=>{message();$('document-dialog').showModal();load();});
 $('document-close').addEventListener('click',close);$('document-dialog').addEventListener('cancel',()=>{generation++;loading=false;switchingDocument=false;current=null;clearPlan();update();});
 $('document-refresh').addEventListener('click',()=>{message();load();});
 $('document-save').addEventListener('click',()=>{if(getContext().document?.neverSaved)showFirstSave();else operation(()=>request('/api/document/save',guards()),'현재 상태를 저장 기준으로 정했습니다.');});
 $('document-version').addEventListener('click',()=>operation(()=>request('/api/document/save-as',{...guards(),mode:'version'}),'새 버전 파일을 저장하고 활성화했습니다.',{switchesDocument:true}));
 $('document-save-as-form').addEventListener('submit',event=>{event.preventDefault();const first=getContext().document?.neverSaved;operation(()=>request('/api/document/save-as',{...guards(),mode:'saveAs',outputPath:$('document-output').value}),first?'프로젝트를 이름으로 저장했습니다.':'새 경로에 저장하고 활성화했습니다.',{switchesDocument:true});});
 $('document-revert-plan').addEventListener('click',async()=>{
  const token=++generation,id=getContext().document?.id;loading=true;clearPlan();update();message();
  try{const result=await request('/api/document/revert/plan',guards());if(!matches(token,id))return;plan=result;const m=plan.media,changes=plan.changes;
   $('document-revert-preview').innerHTML=`<h3>${date(plan.savedAt)} 저장 상태로 되돌리기</h3><p>현재 변경을 버립니다. undo/redo 이력도 초기화됩니다.</p><ul>${Object.entries(changes).map(([kind,c])=>`<li>${({tracks:'트랙',clips:'클립',assets:'원본'})[kind]}: ${c.added}개 복원 · ${c.removed}개 제거 · ${c.changed}개 변경</li>`).join('')}</ul><p>새 관리 파일 ${m.candidates.length}개 · 보호되는 파일 ${m.protected.length}개</p>${m.candidates.length?`<ul>${m.candidates.map(a=>`<li>${esc(a.path)} · ${(a.bytes/1024).toFixed(1)} KiB</li>`).join('')}</ul>`:''}${m.protected.length?`<details><summary>보호되는 파일 보기</summary><ul>${m.protected.map(a=>`<li>${esc(a.path)} · ${esc(a.reason??a.reasonCode??'공유되거나 저장 기준에 포함됨')}</li>`).join('')}</ul></details>`:''}${m.warnings?.length?`<p>${esc(m.warnings.map(w=>w.message??w).join(' · '))}</p>`:''}`;
   $('document-revert-preview').hidden=false;$('document-revert-form').hidden=false;
  }catch(error){if(matches(token,id))message(error.message,true);}finally{if(token===generation){loading=false;update();}}
 });
 for(const id of ['document-revert-confirm','document-media-policy'])$(id).addEventListener('change',update);
 $('document-revert-form').addEventListener('submit',async event=>{event.preventDefault();if(!plan)return;const frozen={expectedRevision:plan.projectRevision,expectedDocumentId:plan.documentId,planId:plan.id,confirm:$('document-revert-confirm').checked,mediaPolicy:$('document-media-policy').value};
  const result=await operation(()=>request('/api/document/revert',frozen),'저장 상태로 되돌렸습니다.');if(result?.media?.failures?.length)message('프로젝트는 되돌렸지만 일부 미디어 처리가 끝나지 않았습니다. 휴지통 목록과 파일 상태를 확인하세요. '+result.media.failures.map(f=>f.message??f.code).join(' · '),true);
 });
 $('document-trash-refresh').addEventListener('click',async()=>{const token=++generation;loading=true;update();try{await trash(token);}catch(error){if(token===generation)message(error.message,true);}finally{if(token===generation){loading=false;update();}}});
 $('document-trash-list').addEventListener('click',event=>{const id=event.target.closest('[data-restore-operation]')?.dataset.restoreOperation;if(id)operation(()=>request(`/api/document/trash/${id}/restore`,guards()),'휴지통 미디어 복원을 처리했습니다.');});
 document.addEventListener('keydown',event=>{if(!(event.metaKey||event.ctrlKey)||event.key.toLowerCase()!=='s'||event.altKey)return;event.preventDefault();if(event.target.matches('input,textarea,select')){notify('입력 중인 값을 먼저 적용한 뒤 저장하세요.');return;}if(cannotSave())return;if(getContext().document.neverSaved)showFirstSave();else operation(()=>request('/api/document/save',guards()),'현재 상태를 저장했습니다.');});
 function cannotSave(){const c=getContext();return loading||c.busy||!c.connected||!c.document;}
 function documentChanged(){clearPlan();if(!switchingDocument){generation++;loading=false;current=null;$('document-output').value='';$('document-dialog').close();}update();}
 return {update,documentChanged};
}
