// One profile client shared by lane menus and the raw MIDI event editor.
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const route = '/api/workspace/controller-settings', listeners = new Set();
let current = null, serial = 0, loading = null, dialog = null, context = null, draft = null, saving = false;
const emit = () => { for (const listener of listeners) listener(current); };
async function request(options) {
  const response = await fetch(route, options), result = await response.json();
  if (!response.ok) throw new Error(result.errors?.map(e => `${e.code}: ${e.message}`).join('; ') || '설정을 읽을 수 없습니다.');
  return result;
}
export function controllerProfile() { return current; }
export function subscribeControllerSettings(listener) { listeners.add(listener); return () => listeners.delete(listener); }
export async function refreshControllerSettings() {
  if (loading) return loading;
  const token = ++serial;
  loading = request().then(result => { if (token === serial) { current = result; emit(); } return result; }).finally(() => { loading = null; });
  return loading;
}
export function fillControllerMenu(menu, selected = '', used = () => false) {
  if (!menu) return;
  menu.innerHTML = `<option value="">${current ? '표시 CC 선택' : '설정 읽는 중'}</option>` + (current?.settings.visibleControllers ?? []).map(n => `<option value="${n}">CC ${n}${used(n) ? ' ◆' : ''}</option>`).join('');
  menu.value = current?.settings.visibleControllers.includes(Number(selected)) && selected !== '' ? String(selected) : '';
}
function ensureDialog() {
  if (dialog) return;
  dialog = document.createElement('dialog'); dialog.id = 'controller-settings-dialog'; dialog.className = 'controller-settings-dialog';
  dialog.innerHTML = `<div class="dialog-heading"><h2>제어 레인 공통 설정</h2><button type="button" id="cs-close">닫기 / 취소</button></div>
    <p>같은 프로필의 모든 프로젝트와 창에서 공유합니다. 메뉴에서 숨겨도 MIDI 이벤트와 직접 번호 입력은 유지됩니다.</p>
    <p id="cs-status" role="status"></p><button type="button" id="cs-reload">초안 버리고 다시 읽기</button>
    <div class="controller-settings-columns"><label>표시 CC<select id="cs-visible" multiple size="8" aria-label="표시 CC"></select></label>
    <div><button type="button" id="cs-hide">숨김 →</button><button type="button" id="cs-show">← 표시</button></div>
    <label>숨김 CC<select id="cs-hidden" multiple size="8" aria-label="숨김 CC"></select></label></div>
    <label>프로그램 기본 새 이벤트<select id="cs-new-type"><option value="step">Step</option><option value="ramp">Ramp</option></select></label>
    <p>수동 Draw/Line에서 ‘프로그램 설정’을 선택하면 적용합니다. 실시간 MIDI 녹음은 아직 지원하지 않습니다.</p>
    <button type="button" id="cs-apply">공통 설정 적용</button>
    <hr><h3>레인 프리셋</h3><p>표시 중인 레인의 개수·순서·종류·채널·CC/음높이를 저장합니다. 높이·격자·음악 데이터는 바꾸지 않습니다.</p>
    <label>프리셋<select id="cs-presets"></select></label><label>이름<input id="cs-name" maxlength="80"></label>
    <div class="controller-settings-actions"><button type="button" id="cs-save-preset">현재 레인 저장</button><button type="button" id="cs-load-preset">프리셋 표시</button><button type="button" id="cs-rename-preset">이름 변경</button><button type="button" id="cs-delete-preset">프리셋 삭제</button><button type="button" id="cs-velocity">Velocity만 표시</button></div>`;
  document.body.append(dialog);
  const $ = id => dialog.querySelector('#'+id);
  const close = () => { if (!saving) { dialog.close(); context = null; draft = null; } };
  $('cs-close').onclick = close;
  dialog.addEventListener('cancel', e => { e.preventDefault(); close(); });
  $('cs-reload').onclick = () => void loadDraft();
  $('cs-hide').onclick = () => { const remove = new Set([...$('cs-visible').selectedOptions].map(o => Number(o.value))); draft.visibleControllers = draft.visibleControllers.filter(n => !remove.has(n)); renderLists(); };
  $('cs-show').onclick = () => { draft.visibleControllers = [...new Set([...draft.visibleControllers,...[...$('cs-hidden').selectedOptions].map(o => Number(o.value))])].sort((a,b) => a-b); renderLists(); };
  $('cs-new-type').onchange = () => { draft.newEventType = $('cs-new-type').value; };
  $('cs-apply').onclick = () => void save({ visibleControllers: draft.visibleControllers, newEventType: draft.newEventType });
  $('cs-presets').onchange = () => { $('cs-name').value = draft.presets.find(p => p.id === $('cs-presets').value)?.name ?? ''; };
  $('cs-save-preset').onclick = () => { try { void save({ preset: { action: 'save', name: $('cs-name').value, lanes: context.getLanes() } }); } catch(e) { $('cs-status').textContent = e.message; } };
  $('cs-rename-preset').onclick = () => void save({ preset: { action: 'rename', id: $('cs-presets').value, name: $('cs-name').value } });
  $('cs-delete-preset').onclick = () => void save({ preset: { action: 'delete', id: $('cs-presets').value } });
  $('cs-load-preset').onclick = () => { const p = draft.presets.find(p => p.id === $('cs-presets').value); if (p) { try { context.applyLanes(structuredClone(p.lanes)); $('cs-status').textContent = '레인 표시를 적용했습니다. MIDI 데이터는 유지됩니다.'; } catch(e) { $('cs-status').textContent = e.message; } } };
  $('cs-velocity').onclick = () => { try { context.applyLanes([{kind:'velocity',channel:'all'}]); $('cs-status').textContent = 'Velocity만 표시했습니다.'; } catch(e) { $('cs-status').textContent = e.message; } };
}
function renderLists() {
  const visible = new Set(draft.visibleControllers), option = n => `<option value="${n}">CC ${n}</option>`;
  dialog.querySelector('#cs-visible').innerHTML = draft.visibleControllers.map(option).join('');
  dialog.querySelector('#cs-hidden').innerHTML = Array.from({length:128},(_,i)=>i).filter(n=>!visible.has(n)).map(option).join('');
  dialog.querySelector('#cs-new-type').value = draft.newEventType;
}
function renderPresets(selected = '') {
  const menu = dialog.querySelector('#cs-presets');
  menu.innerHTML = '<option value="">프리셋 선택</option>'+draft.presets.map(p=>`<option value="${p.id}">${esc(p.name)} · ${p.lanes.length} 레인</option>`).join('');
  menu.value = selected;
}
async function loadDraft() {
  const target = context; if (!target || saving) return;
  setBusy(true);
  try {
    const result = await refreshControllerSettings(); if (context !== target) return;
    draft = { ...structuredClone(result.settings), fingerprint: result.fingerprint }; renderLists(); renderPresets();
    dialog.querySelector('#cs-status').textContent = `공통 설정 REV ${draft.revision}`;
  } catch(e) { dialog.querySelector('#cs-status').textContent = e.message; }
  finally { setBusy(false); }
}
function setBusy(value) {
  saving = value;
  for (const el of dialog.querySelectorAll('button,input,select')) el.disabled = value || !draft;
  dialog.querySelector('#cs-close').disabled = value;
  dialog.querySelector('#cs-reload').disabled = value;
}
async function save(change) {
  if (saving || !draft) return;
  const selected = dialog.querySelector('#cs-presets').value; setBusy(true);
  try {
    const result = await request({ method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({expectedRevision:draft.revision,expectedFingerprint:draft.fingerprint,...change}) });
    serial++; current = result; emit();
    // Preset operations preserve any un-applied CC/type draft for later Apply.
    draft.revision = result.settings.revision; draft.fingerprint = result.fingerprint; draft.presets = structuredClone(result.settings.presets);
    renderPresets(change.preset?.action === 'save' ? draft.presets.at(-1)?.id : selected);
    dialog.querySelector('#cs-status').textContent = `저장됨 · REV ${draft.revision}${result.warnings?.length ? ' · '+result.warnings.map(w=>w.message).join('; ') : ''}`;
  } catch(e) { dialog.querySelector('#cs-status').textContent = e.message; }
  finally { setBusy(false); }
}
export async function openControllerSettings(callbacks) {
  ensureDialog(); context = callbacks; draft = null; dialog.showModal(); await loadDraft();
}
window.addEventListener('focus', () => { void refreshControllerSettings().catch(()=>{}); });
window.addEventListener('newdaw-controller-settings', () => { void refreshControllerSettings().catch(()=>{}); });
void refreshControllerSettings().catch(()=>{});
