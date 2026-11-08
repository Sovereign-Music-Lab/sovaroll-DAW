const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const date = value => value ? new Date(value).toLocaleString('ko-KR') : '기록 없음';
const statusText = { ready: '열기 가능', changed: '마지막 열기 이후 변경', missing: '파일 없음', invalid: '프로젝트 형식 오류', unreadable: '읽을 수 없음' };

export function setupProjectsUI({ getContext, request, notify, onOpened }) {
  const $ = id => document.getElementById(id);
  document.body.insertAdjacentHTML('beforeend', `<dialog id="projects-dialog" class="media-dialog projects-dialog">
    <div class="dialog-heading"><div><span class="projects-eyebrow">PROJECT LIBRARY</span><h2>프로젝트 열기</h2></div><button id="projects-close" aria-label="프로젝트 열기 닫기">×</button></div>
    <p class="projects-intro">여러 프로젝트를 열어 두고 작업할 프로젝트를 선택합니다. 비활성 문서는 재생하지 않습니다.</p>
    <p id="projects-message" class="projects-message" role="status" hidden></p>
    <section class="projects-open-documents" aria-label="열린 프로젝트"><div class="projects-section-heading"><div><h3>열린 프로젝트</h3><p id="projects-open-summary" class="projects-muted"></p></div></div><div id="projects-open-list" class="projects-recent-list"></div></section>
    <details class="projects-new"><summary id="projects-new-toggle">새 프로젝트 · Untitled 만들기</summary><form id="projects-new-form"><section class="projects-location-settings"><label>프로젝트 위치 설정<select id="projects-location-mode"><option value="prompt">프로젝트마다 위치 선택</option><option value="default">기본 위치 사용</option></select></label><div id="projects-default-location-row"><label>기본 위치<input id="projects-default-location" readonly placeholder="기본 폴더를 선택하세요"></label><button id="projects-default-change" class="secondary" type="button">변경…</button></div><div class="projects-location-actions"><button id="projects-location-save" class="secondary" type="button">위치 설정 저장</button><button id="projects-location-refresh" class="quiet" type="button">설정 다시 읽기</button></div><p id="projects-location-status" class="projects-muted" role="status"></p></section><label id="projects-folder-name-label">프로젝트 폴더 이름<input id="projects-folder-name" placeholder="비워 두면 Untitled" autocomplete="off"></label><div id="projects-chosen-folder-row"><label>이번 프로젝트의 작업 폴더<input id="projects-chosen-folder" readonly placeholder="폴더를 선택하세요"></label><button id="projects-choose-folder" class="secondary" type="button">프로젝트 폴더 선택…</button></div><details class="projects-direct-location"><summary id="projects-direct-toggle">고급 · 절대 경로 직접 입력</summary><label class="projects-direct-choice"><input id="projects-use-direct-path" type="checkbox"> 이번 프로젝트에 직접 입력한 경로 사용</label><label>작업 폴더<input id="projects-new-folder" placeholder="/Users/…/New-Session" autocomplete="off"></label></details><div class="projects-new-options"><label>샘플 레이트 (Hz)<input id="projects-new-rate" type="number" min="1" step="1" value="48000" required></label><label>만든 뒤<select id="projects-new-mode"><option value="active">활성화하여 작업</option><option value="inactive">현재 작업을 유지하고 비활성으로 열기</option></select></label></div><p class="projects-muted">새 이름은 Untitled 번호로 정해집니다. 작업은 선택한 폴더에 복구용으로 보관되며, 첫 저장 때 프로젝트 파일 이름을 정합니다.</p><button id="projects-new-preview" class="primary" type="submit">새 프로젝트 검토</button></form></details>
    <form id="projects-path-form" class="projects-path-form"><label for="projects-path">프로젝트 파일 경로</label><div><input id="projects-path" type="text" placeholder="/Users/…/My-Project.newdaw.json" required autocomplete="off"><button id="projects-preview" class="primary" type="submit">파일 검토</button></div></form>
    <label class="projects-mode">열기 방식<select id="projects-open-mode"><option value="active">열고 활성화 — 이 프로젝트에서 작업</option><option value="inactive">활성화하지 않고 열기 — 현재 작업 유지</option></select></label>
    <section id="projects-plan" class="projects-plan" hidden aria-label="프로젝트 작업 전 확인"><div id="projects-plan-details"></div>
      <label id="projects-policy-label" class="projects-policy"><span id="projects-policy-title">현재 프로젝트의 저장 이후 변경</span><select id="projects-current-policy"><option value="">계속하기 전에 선택하세요</option><option value="preserve">작업과 기존 저장 기준 그대로 보관</option><option value="save">작업을 명시적으로 저장한 뒤 계속</option></select></label>
      <p id="projects-policy-help" class="projects-muted">보관은 자동으로 저장된 작업 파일과 기존 Save 기준을 유지합니다. 저장은 지금 상태를 새로운 Save·Revert 기준으로 정합니다.</p>
      <label id="projects-policy-output-label" class="projects-policy" hidden>첫 저장할 프로젝트 파일 경로<input id="projects-policy-output" placeholder="/Users/…/My-Project.newdaw.json" autocomplete="off"><span class="projects-muted">아직 이름으로 저장하지 않은 작업입니다. 기존 폴더 안의 새 파일 경로를 지정하면 프로젝트를 저장한 뒤 계속합니다.</span></label>
      <label id="projects-close-confirm-label" class="projects-close-confirm" hidden><input id="projects-close-confirm" type="checkbox"> 이 문서를 닫습니다. 프로젝트와 미디어 파일은 지우지 않습니다.</label>
      <div class="projects-plan-actions"><button id="projects-cancel-plan" class="secondary" type="button">취소</button><button id="projects-open" class="primary" type="button">프로젝트 열기</button></div>
    </section>
    <details class="projects-drafts"><summary id="projects-drafts-toggle">복구 가능한 작업</summary><p class="projects-muted">이름으로 저장하기 전에 보관한 작업을 다시 엽니다. 이미 이름으로 저장한 항목은 이전 작업으로 중복 복구하지 않습니다.</p><label class="projects-mode">복구 방식<select id="projects-drafts-mode"><option value="active">복구하고 활성화</option><option value="inactive">비활성으로 복구</option></select></label><button id="projects-drafts-refresh" class="secondary">복구 목록 새로 고침</button><p id="projects-drafts-summary" class="projects-muted"></p><div id="projects-drafts-list" class="projects-recent-list"></div></details>
    <section class="projects-recents" aria-label="최근 프로젝트"><div class="projects-section-heading"><div><h3>최근 프로젝트</h3><p id="projects-recent-summary" class="projects-muted">목록을 읽는 중입니다.</p></div><div><button id="projects-refresh" class="secondary">새로 고침</button><button id="projects-remove-all" class="quiet">목록 비우기…</button></div></div>
      <div id="projects-clear-confirm" class="projects-clear-confirm" hidden><label><input id="projects-clear-check" type="checkbox"> 최근 목록만 비웁니다. 프로젝트와 미디어 파일은 그대로 둡니다.</label><div><button id="projects-clear-cancel" class="secondary">취소</button><button id="projects-confirm-remove-all" class="secondary">목록 비우기 확인</button></div></div>
      <div id="projects-recent-list" class="projects-recent-list"></div>
    </section>
  </dialog><dialog id="projects-folder-dialog" class="projects-folder-dialog"><div class="dialog-heading"><h2 id="projects-folder-title">프로젝트 폴더 선택</h2><button id="projects-folder-close" aria-label="폴더 선택 닫기">×</button></div><p>이 컴퓨터의 실제 폴더를 탐색합니다. 폴더를 이동해도 파일이나 설정은 바뀌지 않습니다.</p><form id="projects-folder-form"><label for="projects-folder-path">현재 위치</label><div><input id="projects-folder-path" autocomplete="off"><button id="projects-folder-go" type="submit" class="secondary">이동</button></div></form><p id="projects-folder-message" class="projects-muted" role="status"></p><div class="projects-folder-toolbar"><button id="projects-folder-parent" class="secondary">상위 폴더</button><span id="projects-folder-count" class="projects-muted"></span></div><div id="projects-folder-list"></div><button id="projects-folder-more" class="secondary">더 보기</button><div class="projects-plan-actions"><button id="projects-folder-cancel" class="secondary">취소</button><button id="projects-folder-select" class="primary">현재 폴더 선택</button></div></dialog>`);
  let recent = null, drafts = null, plan = null, planKind = 'open', loading = false, generation = 0, renderedWorkspace = null;
  let locations = null, pendingLocation = null, locationConflict = false, incomingLocationsKey = null, savingLocation = false;
  let folder = null, folderLoading = false, folderGeneration = 0, folderPurpose = null, previewAfterFolder = false;
  function message(text = '', error = false) { $('projects-message').textContent = text; $('projects-message').hidden = !text; $('projects-message').classList.toggle('projects-error', error); }
  function guard() { return { expectedWorkspaceRevision: getContext().workspace.revision }; }
  function clearPlan() { plan = null; $('projects-plan').hidden = true; $('projects-current-policy').value = ''; $('projects-close-confirm').checked = false; $('projects-policy-output').value = ''; }
  function needsSavePath() { const affected = plan?.policyTarget === 'target' ? plan?.target : plan?.current; return Boolean(plan && $('projects-current-policy').value === 'save' && (plan.requiresSavePath || affected?.neverSaved)); }
  const displayLocation = entry => entry.neverSaved ? `작업 폴더: ${entry.projectFolder ?? '확인 필요'}` : entry.projectPath ?? entry.path ?? '';
  const saveStatus = entry => entry.neverSaved ? '아직 이름으로 저장하지 않음' : entry.dirty === null ? '저장 기준 확인 필요' : entry.dirty ? '저장 이후 변경' : '저장 상태와 같음';
  function clearConfirmation() { $('projects-clear-confirm').hidden = true; $('projects-clear-check').checked = false; }
  function stale() {
    if (!plan) return false;
    const workspace = getContext().workspace;
    if (plan.expectedWorkspaceRevision !== workspace?.revision) return true;
    if (plan.location && (locationConflict || plan.location.settingsRevision !== (workspace?.locationSettings ?? locations)?.settings?.revision)) return true;
    return [plan.current, plan.target].some(before => {
      if (!before?.id) return false;
      const current = workspace.documents.find(entry => entry.id === before.id);
      return !current || current.projectRevision !== before.projectRevision || current.saveId !== before.saveId;
    });
  }
  function renderWorkspace() {
    const workspace = getContext().workspace, key = JSON.stringify(workspace);
    if (key === renderedWorkspace) return; renderedWorkspace = key;
    const entries = workspace?.documents ?? [], active = entries.find(entry => entry.id === workspace.activeId);
    $('projects-open-summary').textContent = active ? `${entries.length}개 열림 · 활성: ${active.name}` : `활성 프로젝트 없음 · ${entries.length}개 열림. 프로젝트를 활성화하거나 새 파일을 여세요.`;
    $('projects-open-list').innerHTML = entries.length ? `<ul>${entries.map(entry => `<li class="projects-recent-row ${entry.id === workspace.activeId ? 'projects-document-active' : ''}" data-open-document="${esc(entry.id)}"><div class="projects-recent-copy"><strong>${esc(entry.displayName ?? entry.name)}</strong><span class="projects-file-path">${esc(displayLocation(entry))}</span><span class="projects-recent-meta"><span class="projects-status">${entry.id === workspace.activeId ? '활성 · 편집·재생 대상' : '비활성'}</span><span>${saveStatus(entry)}</span><span>${entry.resources === 'deferred' ? '활성화할 때 미디어 검사' : '활성화 리소스 준비'}</span></span></div><div class="projects-row-actions"><button class="secondary" data-document-activate="${esc(entry.id)}" ${entry.id === workspace.activeId ? 'disabled' : ''}>${entry.id === workspace.activeId ? '활성' : '활성화'}</button><button class="quiet" data-document-close="${esc(entry.id)}">닫기…</button></div></li>`).join('')}</ul>` : '<p class="projects-empty">열린 프로젝트가 없습니다. 아래에서 파일을 열거나 최근 프로젝트를 선택하세요.</p>';
    if (drafts) renderDrafts();
  }
  function update() {
    syncLocations(); renderWorkspace();
    const context = getContext(), disabled = loading || folderPurpose !== null || context.busy || !context.connected || !context.workspace;
    $('projects-button').disabled = disabled;
    for (const element of $('projects-dialog').querySelectorAll('button,input,select')) if (element.id !== 'projects-close') element.disabled = disabled;
    for (const element of $('projects-dialog').querySelectorAll('[data-document-activate]')) element.disabled = disabled || element.dataset.documentActivate === context.workspace?.activeId;
    $('projects-policy-output-label').hidden = !needsSavePath(); $('projects-policy-output').required = needsSavePath();
    $('projects-open').disabled = disabled || !plan || stale() || (plan.requiresCurrentPolicy && !$('projects-current-policy').value) || (needsSavePath() && !$('projects-policy-output').value.trim()) || (planKind === 'close' && !$('projects-close-confirm').checked);
    for (const element of $('projects-drafts-list').querySelectorAll('[data-draft-recover]')) element.disabled = disabled || element.dataset.resumable !== 'true';
    $('projects-remove-all').disabled = disabled || !recent?.entries?.length || recent.revision === null;
    $('projects-confirm-remove-all').disabled = disabled || !$('projects-clear-check').checked;
    updateLocations(disabled); if (folderPurpose !== null) updateFolder();
    if (stale() && !loading && $('projects-dialog').open) message(plan.location && plan.location.settingsRevision !== (context.workspace?.locationSettings ?? locations)?.settings?.revision ? '프로젝트 위치 설정이 바뀌었습니다. 새 프로젝트를 다시 검토하세요.' : '열린 프로젝트나 저장 기준이 바뀌었습니다. 작업을 다시 검토하세요.', true);
  }
  const locationsKey = value => JSON.stringify(value ? { status: value.status, settings: value.settings } : null);
  const locationDirty = () => Boolean(pendingLocation && locations?.settings && (pendingLocation.locationMode !== locations.settings.locationMode || pendingLocation.defaultLocation !== locations.settings.defaultLocation));
  function adoptLocations(value) {
    locations = value; pendingLocation = value?.settings ? { locationMode: value.settings.locationMode, defaultLocation: value.settings.defaultLocation } : null; locationConflict = false;
    $('projects-location-mode').value = pendingLocation?.locationMode ?? 'prompt'; $('projects-default-location').value = pendingLocation?.defaultLocation ?? '';
  }
  function syncLocations() {
    const incoming = getContext().workspace?.locationSettings; if (!incoming) return;
    const key = locationsKey(incoming); if (key === incomingLocationsKey) return; incomingLocationsKey = key;
    if (savingLocation) return;
    if (locationDirty()) { locationConflict = true; return; }
    adoptLocations(incoming);
  }
  function updateLocations(disabled) {
    const direct = $('projects-use-direct-path').checked, available = locations?.status !== 'unavailable' && Number.isSafeInteger(locations?.settings?.revision), mode = pendingLocation?.locationMode ?? 'prompt';
    $('projects-default-location-row').hidden = mode !== 'default'; $('projects-folder-name-label').hidden = direct || mode !== 'default'; $('projects-chosen-folder-row').hidden = direct || mode !== 'prompt';
    $('projects-new-folder').required = direct; $('projects-new-folder').disabled = disabled || !direct;
    $('projects-location-mode').disabled = disabled || !available; $('projects-default-change').disabled = disabled || !available;
    $('projects-location-save').disabled = disabled || !available || locationConflict || !locationDirty() || (mode === 'default' && !pendingLocation?.defaultLocation);
    $('projects-new-preview').disabled = disabled || (!direct && (!available || locationConflict || locationDirty() || (mode === 'default' && !pendingLocation?.defaultLocation)));
    $('projects-location-status').textContent = locationConflict ? '다른 곳에서 위치 설정이 바뀌었습니다. 입력은 보관했습니다. 설정을 다시 읽고 선택하세요.' : !available ? '위치 설정을 읽을 수 없습니다. 다시 읽거나 고급 직접 경로를 사용하세요.' : locationDirty() ? '변경한 위치 설정을 저장한 뒤 새 프로젝트를 검토하세요.' : `저장된 설정 · ${mode === 'default' ? '기본 위치 사용' : '프로젝트마다 위치 선택'}`;
  }
  async function getLocations() {
    const response = await fetch('/api/workspace/locations'), value = await response.json();
    if (!response.ok) throw new Error(value.errors?.map(error => error.message).join(' · ') || '위치 설정을 읽지 못했습니다.');
    return value;
  }
  async function refreshLocations() {
    const token = ++generation; loading = true; clearPlan(); update();
    try { const value = await getLocations(); if (token !== generation) return; incomingLocationsKey = locationsKey(getContext().workspace?.locationSettings); adoptLocations(value); }
    catch (error) { if (token === generation) message(error.message, true); }
    finally { if (token === generation) { loading = false; update(); } }
  }
  async function saveLocations() {
    if (!pendingLocation || locationConflict) return;
    const token = ++generation, input = { ...guard(), expectedRevision: locations.settings.revision, ...pendingLocation }; loading = true; savingLocation = true; clearPlan(); update();
    try { await request('/api/workspace/locations', input); const value = await getLocations(); if (token !== generation) return; adoptLocations(value); incomingLocationsKey = locationsKey(getContext().workspace?.locationSettings); message('프로젝트 위치 설정을 저장했습니다.'); }
    catch (error) { if (token === generation) { locationConflict = error.status === 409 || locationConflict; message(`${error.message} 설정을 다시 읽고 확인하세요.`, true); } }
    finally { if (token === generation) { savingLocation = false; loading = false; update(); } }
  }
  function updateFolder() {
    const disabled = folderLoading || !getContext().connected;
    for (const element of $('projects-folder-dialog').querySelectorAll('button,input')) if (!['projects-folder-close','projects-folder-cancel'].includes(element.id)) element.disabled = disabled;
    $('projects-folder-parent').disabled = disabled || !folder?.parentPath;
    $('projects-folder-select').disabled = disabled || !folder || $('projects-folder-path').value !== folder.path;
    $('projects-folder-more').hidden = folder?.nextCursor == null; $('projects-folder-more').disabled = disabled || folder?.nextCursor == null;
  }
  function renderFolder() {
    $('projects-folder-path').value = folder.path; $('projects-folder-count').textContent = `${folder.entries.length} / ${folder.total}개 폴더`;
    $('projects-folder-list').innerHTML = folder.entries.length ? `<ul>${folder.entries.map(entry => `<li data-folder-path="${esc(entry.path)}" tabindex="0"><span>${esc(entry.name)}</span><button type="button" class="secondary" data-folder-enter="${esc(entry.path)}">열기</button></li>`).join('')}</ul>` : '<p class="projects-empty">하위 폴더가 없습니다. 현재 폴더를 선택할 수 있습니다.</p>';
  }
  async function browseFolder(filename, { append = false } = {}) {
    const token = ++folderGeneration, previous = folder; folderLoading = true; if (!append) folder = null; $('projects-folder-message').textContent = '폴더를 읽는 중입니다.'; updateFolder();
    try {
      const query = new URLSearchParams(); if (filename) query.set('path', filename); if (append && previous?.nextCursor != null) query.set('cursor', previous.nextCursor);
      const response = await fetch(`/api/workspace/folders${query.size ? `?${query}` : ''}`), value = await response.json();
      if (token !== folderGeneration || !$('projects-folder-dialog').open) return;
      if (!response.ok) throw new Error(value.errors?.map(error => error.message).join(' · ') || '폴더를 읽지 못했습니다.');
      if (append && value.path !== previous.path) throw new Error('폴더 위치가 바뀌었습니다. 다시 이동하세요.');
      folder = { ...value, entries: append ? [...previous.entries, ...value.entries] : value.entries }; renderFolder(); $('projects-folder-message').textContent = '폴더를 더블클릭하거나 열기를 누르세요. 선택은 현재 폴더에 적용됩니다.';
    } catch (error) { if (token === folderGeneration) $('projects-folder-message').textContent = error.message; }
    finally { if (token === folderGeneration) { folderLoading = false; updateFolder(); } }
  }
  function openFolder(purpose, after = false) {
    folderPurpose = purpose; previewAfterFolder = after; folder = null; $('projects-folder-list').replaceChildren();
    $('projects-folder-title').textContent = purpose === 'default' ? '기본 프로젝트 위치 선택' : '이번 프로젝트의 작업 폴더 선택';
    $('projects-folder-dialog').showModal(); update(); browseFolder(purpose === 'default' ? pendingLocation?.defaultLocation : $('projects-chosen-folder').value || pendingLocation?.defaultLocation);
  }
  function cancelFolder() { folderGeneration++; folderLoading = false; folderPurpose = null; previewAfterFolder = false; folder = null; if ($('projects-folder-dialog').open) $('projects-folder-dialog').close(); update(); }
  async function previewNew() {
    const direct = $('projects-use-direct-path').checked, shared = { sampleRate: Number($('projects-new-rate').value), mode: $('projects-new-mode').value };
    if (direct) return preview({ ...shared, projectFolder: $('projects-new-folder').value }, 'new');
    if (locationConflict || locationDirty() || locations?.status === 'unavailable' || !locations?.settings) { message('먼저 위치 설정을 읽고 저장하세요.', true); return; }
    if (pendingLocation.locationMode === 'prompt' && !$('projects-chosen-folder').value) { openFolder('prompt', true); return; }
    const location = pendingLocation.locationMode === 'default' ? { folderName: $('projects-folder-name').value } : { chosenFolder: $('projects-chosen-folder').value };
    return preview({ ...shared, location, expectedLocationRevision: locations.settings.revision }, 'new');
  }
  async function getRecent() {
    const response = await fetch('/api/document/recent'), result = await response.json();
    if (!response.ok) throw new Error(result.errors?.map(error => error.message).join(' · ') || '최근 프로젝트를 읽지 못했습니다.');
    return result;
  }
  async function getDrafts() {
    const response = await fetch('/api/workspace/drafts'), result = await response.json();
    if (!response.ok) throw new Error(result.errors?.map(error => error.message).join(' · ') || '복구 목록을 읽지 못했습니다.');
    return result;
  }
  function renderDrafts() {
    const entries = drafts?.entries ?? [], opened = new Set((getContext().workspace?.documents ?? []).map(entry => entry.draftId).filter(Boolean));
    $('projects-drafts-summary').textContent = drafts && drafts.status !== 'unavailable' ? `${entries.length}개 작업 기록 · 복구 가능한 항목만 다시 열 수 있습니다.` : '복구 목록을 읽지 못했습니다. 새로 고침을 누르세요.';
    const labels = { published: '이름으로 저장 완료', preserved: '보관된 작업', incomplete: '첫 저장 미완료 · 작업 복구 가능', ambiguous: '첫 저장 상태 확인 필요 · 복구 보류', unavailable: '복구 파일 확인 필요', ready: '복구 가능', recoverable: '복구 가능', missing: '복구 파일 없음', invalid: '복구 파일 확인 필요', active: '열린 작업', open: '열린 작업', pending: '저장 상태 확인 필요' };
    $('projects-drafts-list').innerHTML = entries.length ? `<ul>${entries.map(entry => {
      const alreadyOpen = opened.has(entry.id), resumable = entry.resumable === true && !alreadyOpen;
      return `<li class="projects-recent-row" data-draft-id="${esc(entry.id)}"><div class="projects-recent-copy"><strong>${esc(entry.name)}</strong><span class="projects-file-path">작업 폴더: ${esc(entry.projectFolder)}</span>${entry.status === 'published' && entry.targetPath ? `<span class="projects-file-path">저장된 파일: ${esc(entry.targetPath)}</span>` : ''}<span class="projects-recent-meta"><span>${alreadyOpen ? '이미 열려 있음' : labels[entry.status] ?? (resumable ? '복구 가능' : '상태 확인 필요')}</span><span>${esc(date(entry.updatedAt ?? entry.createdAt))}</span></span></div><button class="secondary" data-draft-recover="${esc(entry.id)}" data-resumable="${resumable}" ${resumable ? '' : 'disabled'}>복구 검토</button></li>`;
    }).join('')}</ul>` : '<p class="projects-empty">복구할 작업 기록이 없습니다.</p>';
  }
  function renderRecent() {
    const entries = recent?.entries ?? [];
    $('projects-recent-summary').textContent = recent?.status === 'unavailable' ? '목록을 읽을 수 없습니다. 파일 경로로 열기는 계속 사용할 수 있습니다.' : `최근 연 ${entries.length}개 · 최대 20개 · 목록에서 제거해도 파일은 지워지지 않습니다.`;
    $('projects-recent-list').innerHTML = entries.length ? `<ul>${entries.map(entry => `<li class="projects-recent-row" data-recent-id="${esc(entry.id)}"><div class="projects-recent-copy"><strong>${esc(entry.currentName ?? entry.name)}</strong><span class="projects-file-path">${esc(entry.projectPath)}</span><span class="projects-recent-meta"><span class="projects-status ${entry.status !== 'ready' ? 'projects-status-warning' : ''}">${esc(statusText[entry.status] ?? '상태 확인 필요')}</span><span>${esc(date(entry.lastOpened))}</span></span></div><div class="projects-row-actions"><button class="secondary" data-recent-preview="${esc(entry.id)}" aria-label="${esc(entry.name)} 검토">검토</button><button class="quiet" data-recent-remove="${esc(entry.id)}" aria-label="${esc(entry.name)} 최근 목록에서 제거">제거</button></div></li>`).join('')}</ul>` : '<p class="projects-empty">아직 최근 프로젝트가 없습니다. 위에서 프로젝트 파일 경로를 지정하세요.</p>';
    if (recent?.warnings?.length) message(recent.warnings.map(warning => warning.message ?? warning).join(' · '), true);
  }
  async function load() {
    const token = ++generation; loading = true; clearPlan(); clearConfirmation(); update();
    try {
      const results = await Promise.allSettled([getRecent(), getDrafts(), getLocations()]); if (token !== generation) return;
      if (results[0].status === 'fulfilled') { recent = results[0].value; renderRecent(); }
      if (results[1].status === 'fulfilled') drafts = results[1].value; else drafts = null;
      if (results[2].status === 'fulfilled') { if (locationDirty() && locationsKey(results[2].value) !== locationsKey(locations)) locationConflict = true; else if (!locationDirty()) adoptLocations(results[2].value); }
      renderDrafts(); const errors = results.filter(result => result.status === 'rejected').map(result => result.reason.message); if (errors.length) message(errors.join(' · '), true);
    }
    finally { if (token === generation) { loading = false; update(); } }
  }
  function renderPlan() {
    const target = plan.target, current = plan.current, counts = target.counts ?? target, media = target.media ?? [], closing = planKind === 'close', inactive = ['open', 'new', 'recover'].includes(planKind) && plan.mode === 'inactive';
    const unavailable = media.filter(asset => !['ready', 'deferred'].includes(asset.status)), deferred = media.filter(asset => asset.status === 'deferred').length, policyTarget = closing ? target : current;
    const existingInactive = inactive && planKind === 'open' && target.id;
    let explanation = closing ? `${target.active ? '활성 문서를 닫으면 편집·재생 대상이 없어집니다. 다른 문서를 직접 활성화할 수 있습니다.' : '비활성 문서를 닫습니다. 현재 활성 프로젝트는 그대로 유지됩니다.'} 프로젝트와 미디어 파일은 보관됩니다.` : existingInactive ? '이미 열린 프로젝트입니다. 활성 상태와 현재 작업은 그대로 유지됩니다.' : inactive ? '활성화하지 않고 엽니다. 현재 편집·재생 대상은 바뀌지 않으며, 이 문서의 미디어는 활성화할 때 준비합니다.' : plan.sameDocument ? '이미 활성 프로젝트입니다. 현재 작업을 유지합니다.' : current ? `현재 <strong>${esc(current.displayName ?? current.name)}</strong>에서 이 프로젝트로 전환합니다. 현재 문서는 열린 상태로 남습니다.` : '이 프로젝트를 활성화하여 편집과 재생을 시작합니다.';
    if (planKind === 'new') explanation = `새 Untitled 작업을 만듭니다. 이름으로 저장하기 전까지 선택한 폴더에 복구용으로 보관됩니다. ${explanation}`;
    if (planKind === 'recover') explanation = `보관된 작업과 편집 이력을 복구합니다. ${explanation}`;
    const heading = { close: '문서 닫기 전 확인', activate: '활성화 전 확인', new: '새 프로젝트 만들기 전 확인', recover: '작업 복구 전 확인' }[planKind] ?? '열기 전 확인';
    $('projects-plan-details').innerHTML = `<span class="projects-eyebrow">${heading}</span><h3>${esc(target.displayName ?? target.name)}</h3><p class="projects-file-path">${esc(displayLocation(target))}</p>${closing ? '' : `<div class="projects-counts"><span>${counts.tracks ?? 0} 트랙</span><span>${counts.clips ?? 0} 클립</span><span>${counts.assets ?? media.length} 오디오 원본</span><span>REV ${target.projectRevision ?? target.revision ?? 0}</span>${target.sampleRate ? `<span>${target.sampleRate} Hz</span>` : ''}</div>`}<p>${explanation}</p>${plan.requiresCurrentPolicy ? `<p class="projects-policy-warning">${esc(policyTarget?.displayName ?? policyTarget?.name ?? '')} · ${policyTarget?.neverSaved ? '아직 이름으로 저장하지 않은 작업입니다.' : policyTarget?.dirty === null ? '저장 기준을 확인할 수 없습니다.' : '저장 기준 이후 변경이 있습니다.'} 아래에서 보관 방법을 선택하세요.</p>` : ''}${media.length ? `<details ${unavailable.length ? 'open' : ''}><summary>오디오 원본 ${media.length}개 · 사용 불가 ${unavailable.length}개${deferred ? ` · 활성화 때 확인 ${deferred}개` : ''}</summary><ul class="projects-media-list">${media.map(asset => `<li><span>${esc(asset.name)}</span><span class="projects-status ${asset.status !== 'ready' ? 'projects-status-warning' : ''}">${esc(({ ready: '준비됨', deferred: '활성화 때 확인', missing: '누락', changed: '내용 변경', unreadable: '읽기 불가', unsafe: '안전하지 않은 경로' })[asset.status] ?? asset.status)}</span></li>`).join('')}</ul></details>` : ''}${plan.warnings?.length ? `<p class="projects-plan-warnings">${esc(plan.warnings.map(warning => warning.message ?? warning).join(' · '))}</p>` : ''}`;
    $('projects-policy-title').textContent = closing ? '닫을 프로젝트의 작업 보관 방법' : '현재 프로젝트의 작업 보관 방법';
    $('projects-policy-help').textContent = policyTarget?.neverSaved ? '보관을 선택하면 이름으로 저장하지 않고 복구 목록에 작업을 유지합니다. 저장은 아래 경로에 프로젝트 파일과 첫 Save·Revert 기준을 만듭니다.' : '보관은 자동으로 저장된 작업 파일과 기존 Save 기준을 유지합니다. 저장은 지금 상태를 새로운 Save·Revert 기준으로 정합니다.';
    $('projects-policy-label').hidden = !plan.requiresCurrentPolicy; $('projects-policy-help').hidden = !plan.requiresCurrentPolicy; $('projects-close-confirm-label').hidden = !closing;
    $('projects-current-policy').value = ''; $('projects-close-confirm').checked = false; $('projects-policy-output').value = '';
    $('projects-open').textContent = closing ? '문서 닫기' : planKind === 'new' ? '새 프로젝트 만들기' : planKind === 'recover' ? '작업 복구' : existingInactive ? '열린 상태 유지' : inactive ? '비활성으로 열기' : plan.sameDocument ? '현재 프로젝트 유지' : planKind === 'activate' ? '프로젝트 활성화' : '프로젝트 열기'; $('projects-plan').hidden = false;
  }
  async function preview(target, kind = 'open') {
    const token = ++generation, frozen = guard(); loading = true; clearPlan(); clearConfirmation(); message(); update();
    try {
      const result = await request(`/api/workspace/${kind}/plan`, { ...frozen, ...target, ...(kind === 'open' ? { mode: $('projects-open-mode').value } : {}) });
      if (token !== generation || !$('projects-dialog').open) return;
      planKind = kind; plan = { ...result, expectedWorkspaceRevision: result.workspaceRevision ?? frozen.expectedWorkspaceRevision }; renderPlan();
    } catch (error) { if (token === generation) message(error.message, true); }
    finally { if (token === generation) { loading = false; update(); } }
  }
  async function remove(input) {
    const token = ++generation, expectedRegistryRevision = recent.revision; loading = true; clearPlan(); message(); update();
    try {
      await request('/api/workspace/recent/remove', { ...guard(), expectedRegistryRevision, ...input });
      if (token !== generation) return; recent = await getRecent(); if (token !== generation) return;
      clearConfirmation(); renderRecent(); message(input.clear ? '최근 목록을 비웠습니다. 프로젝트 파일은 그대로 있습니다.' : '최근 목록에서 제거했습니다. 프로젝트 파일은 그대로 있습니다.');
    } catch (error) { if (token === generation) message(`${error.message} 목록을 새로 고친 뒤 다시 시도하세요.`, true); }
    finally { if (token === generation) { loading = false; update(); } }
  }
  function close() { generation++; loading = false; savingLocation = false; cancelFolder(); clearPlan(); clearConfirmation(); $('projects-dialog').close(); update(); }
  $('projects-button').addEventListener('click', () => { message(); $('projects-dialog').showModal(); load(); });
  $('projects-close').addEventListener('click', close);
  $('projects-dialog').addEventListener('cancel', () => { generation++; loading = false; savingLocation = false; cancelFolder(); clearPlan(); clearConfirmation(); update(); });
  $('projects-path-form').addEventListener('submit', event => { event.preventDefault(); preview({ projectPath: $('projects-path').value }); });
  $('projects-new-form').addEventListener('submit', event => { event.preventDefault(); previewNew(); });
  for (const id of ['projects-new-folder', 'projects-new-rate', 'projects-new-mode', 'projects-drafts-mode']) $(id).addEventListener(id.endsWith('mode') ? 'change' : 'input', () => { clearPlan(); update(); });
  $('projects-location-mode').addEventListener('change', () => { if (pendingLocation) pendingLocation.locationMode = $('projects-location-mode').value; clearPlan(); update(); });
  $('projects-location-save').addEventListener('click', saveLocations); $('projects-location-refresh').addEventListener('click', refreshLocations);
  $('projects-default-change').addEventListener('click', () => openFolder('default')); $('projects-choose-folder').addEventListener('click', () => openFolder('prompt'));
  $('projects-folder-name').addEventListener('input', () => { clearPlan(); update(); }); $('projects-use-direct-path').addEventListener('change', () => { clearPlan(); update(); });
  $('projects-folder-form').addEventListener('submit', event => { event.preventDefault(); browseFolder($('projects-folder-path').value); });
  $('projects-folder-path').addEventListener('input', updateFolder); $('projects-folder-parent').addEventListener('click', () => browseFolder(folder.parentPath));
  $('projects-folder-more').addEventListener('click', () => browseFolder(folder.path, { append: true }));
  $('projects-folder-list').addEventListener('click', event => { const target = event.target.closest('[data-folder-enter]'); if (target) browseFolder(target.dataset.folderEnter); });
  $('projects-folder-list').addEventListener('dblclick', event => { const row = event.target.closest('[data-folder-path]'); if (row && !folderLoading) browseFolder(row.dataset.folderPath); });
  $('projects-folder-list').addEventListener('keydown', event => { if (event.key === 'Enter' && event.target.matches('[data-folder-path]')) { event.preventDefault(); browseFolder(event.target.dataset.folderPath); } });
  for (const id of ['projects-folder-close','projects-folder-cancel']) $(id).addEventListener('click', cancelFolder);
  $('projects-folder-dialog').addEventListener('cancel', cancelFolder); $('projects-folder-dialog').addEventListener('close', () => { if (folderPurpose !== null) cancelFolder(); });
  $('projects-folder-select').addEventListener('click', () => {
    if (!folder || folderLoading) return; const purpose = folderPurpose, selected = folder.path, after = previewAfterFolder;
    if (purpose === 'default' && pendingLocation) { pendingLocation.defaultLocation = selected; $('projects-default-location').value = selected; }
    else $('projects-chosen-folder').value = selected;
    clearPlan(); cancelFolder(); if (after) previewNew();
  });
  $('projects-policy-output').addEventListener('input', update);
  for (const id of ['projects-path', 'projects-open-mode']) $(id).addEventListener(id === 'projects-path' ? 'input' : 'change', () => { clearPlan(); update(); });
  $('projects-refresh').addEventListener('click', () => { message(); load(); });
  $('projects-drafts-refresh').addEventListener('click', () => { message(); load(); });
  for (const id of ['projects-current-policy', 'projects-close-confirm']) $(id).addEventListener('change', update);
  $('projects-cancel-plan').addEventListener('click', () => { clearPlan(); message('취소했습니다. 열린 프로젝트와 활성 상태는 그대로 유지됩니다.'); update(); });
  $('projects-open-list').addEventListener('click', event => {
    const activate = event.target.closest('[data-document-activate]')?.dataset.documentActivate, closed = event.target.closest('[data-document-close]')?.dataset.documentClose;
    if (activate) preview({ documentId: activate }, 'activate'); else if (closed) preview({ documentId: closed }, 'close');
  });
  $('projects-recent-list').addEventListener('click', event => {
    const selected = event.target.closest('[data-recent-preview]')?.dataset.recentPreview, removed = event.target.closest('[data-recent-remove]')?.dataset.recentRemove;
    if (selected) { $('projects-path').value = recent.entries.find(entry => entry.id === selected)?.projectPath ?? ''; preview({ recentId: selected }); }
    else if (removed) remove({ entryId: removed });
  });
  $('projects-drafts-list').addEventListener('click', event => { const button = event.target.closest('[data-draft-recover]'); if (button && !button.disabled) preview({ draftId: button.dataset.draftRecover, mode: $('projects-drafts-mode').value }, 'recover'); });
  $('projects-remove-all').addEventListener('click', () => { clearPlan(); $('projects-clear-confirm').hidden = false; $('projects-clear-check').checked = false; update(); });
  $('projects-clear-check').addEventListener('change', update);
  $('projects-clear-cancel').addEventListener('click', () => { clearConfirmation(); update(); });
  $('projects-confirm-remove-all').addEventListener('click', () => remove({ clear: true }));
  $('projects-open').addEventListener('click', async () => {
    if (!plan || stale()) return;
    const kind = planKind, inactive = ['open', 'new', 'recover'].includes(kind) && plan.mode === 'inactive', frozen = { expectedWorkspaceRevision: plan.expectedWorkspaceRevision, planId: plan.id, ...(plan.requiresCurrentPolicy ? { currentPolicy: $('projects-current-policy').value } : {}), ...(needsSavePath() ? { saveOutputPath: $('projects-policy-output').value.trim() } : {}) };
    loading = true; message(); update();
    try {
      const result = await request(`/api/workspace/${kind}`, frozen);
      if (kind === 'new' && result.applied) { $('projects-chosen-folder').value = ''; $('projects-folder-name').value = ''; }
      const activated = result.activated ?? (kind !== 'close' && !inactive && result.applied && result.status !== 'unchanged');
      const success = kind === 'close' ? '문서를 닫았습니다. 프로젝트 파일은 그대로 있습니다.' : inactive && result.status === 'unchanged' ? '이미 열린 프로젝트를 유지했습니다. 활성 상태는 바뀌지 않았습니다.' : inactive ? '프로젝트를 비활성 상태로 열었습니다. 현재 작업은 그대로입니다.' : activated ? '선택한 프로젝트를 활성화했습니다.' : '현재 프로젝트를 유지했습니다.';
      if (kind !== 'close' && !inactive) close();
      else { clearPlan(); message(success); try { [recent, drafts] = await Promise.all([getRecent(), getDrafts()]); renderRecent(); renderDrafts(); } catch (error) { message(`${success} 최근 목록을 읽지 못했습니다. ${error.message}`, true); } }
      notify(success);
      if (result.warnings?.length) { notify(result.warnings.map(warning => warning.message ?? warning).join(' · '), true); if ($('projects-dialog').open) message(`${success} ${result.warnings.map(warning => warning.message ?? warning).join(' · ')}`, true); }
      if (activated) try { await onOpened?.(result); } catch (error) { notify(`프로젝트는 활성화했지만 미디어 확인을 완료하지 못했습니다. ${error.message}`, true); }
    } catch (error) { message(error.message, true); notify(error.message, true); }
    finally { loading = false; update(); }
  });
  return { update };
}
