import {formatDisplayTicks} from '/media/display-time-edit.mjs';
import {readTimingProfile} from './timing-settings.mjs';
import {fillControllerMenu,subscribeControllerSettings} from './controller-settings.mjs';
// Event-list UI only. Validation, persistence and undo use the shared command engine.
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const names={note:'노트',cc:'CC',pitch:'피치벤드',program:'프로그램 변경',channelPressure:'채널 프레셔',poly:'폴리 프레셔',sysex:'SysEx',meta:'메타데이터',noteOff:'단독 Note Off'};
const typeOf=item=>item.notesType?'note':item.kind==='sysex'?'sysex':item.kind==='meta'?'meta':({8:'noteOff',9:'noteOff',10:'poly',11:'cc',12:'program',13:'channelPressure',14:'pitch'}[item.status>>4]);
const hex=bytes=>bytes.map(n=>n.toString(16).padStart(2,'0').toUpperCase()).join(' ');
const numberField=(label,name,value,min=0,max=Number.MAX_SAFE_INTEGER,required=true)=>`<label>${label}<input name="${name}" type="number" step="1" min="${min}" max="${max}" value="${esc(value)}" ${required?'required':''}></label>`;
export function setupMidiEventsUI({getContext,runCommand,notify}){
 const timeField=(label,name,value)=>`<label>${label}<input name="${name}" type="text" inputmode="text" maxlength="83" value="${esc(display(value))}" required></label>`;
 const $=id=>document.getElementById(id),pageSize=200;
 const dialog=document.createElement('dialog');dialog.id='midi-events-dialog';dialog.className='midi-events-dialog';
 dialog.innerHTML=`<div class="dialog-heading"><div><span class="eyebrow">MIDI EVENT LIST</span><h2>MIDI 이벤트</h2></div><button id="midi-events-close" type="button" aria-label="MIDI 이벤트 닫기">닫기</button></div><p id="midi-events-context"></p><p class="muted">노트와 제어 이벤트를 편집하고 MIDI 파일로 보존합니다. 내장 신시사이저는 페달(CC64)·볼륨(CC7)·표현(CC11)·팬(CC10)·피치벤드와 RPN 0 범위를 재생합니다. 트랙마다 독립 악기를 사용합니다. 프로그램·프레셔·SysEx와 미지원 CC는 소리에 반영하지 않습니다.</p><div class="midi-event-toolbar"><label>표시 유형<select id="midi-events-filter"><option value="all">전체</option>${Object.entries(names).map(([v,n])=>`<option value="${v}">${n}</option>`).join('')}</select></label><label>채널<select id="midi-events-channel-filter"><option value="all">전체</option><option value="none">채널 없음</option>${Array.from({length:16},(_,i)=>`<option value="${i}">${i+1}</option>`).join('')}</select></label><button id="midi-events-refresh" type="button">최신 상태로 다시 읽기</button></div><p id="midi-events-status" role="status"></p><div class="midi-event-table"><table><thead><tr><th>선택</th><th>클립 내 표시 tick</th><th>순서</th><th>유형</th><th>채널</th><th>데이터</th></tr></thead><tbody id="midi-events-rows"></tbody></table></div><div class="midi-event-toolbar"><button id="midi-events-prev" type="button">이전</button><span id="midi-events-page"></span><button id="midi-events-next" type="button">다음</button></div><div class="midi-event-toolbar"><label>새 이벤트 유형<select id="midi-events-new-type">${Object.entries(names).filter(([v])=>v!=='note').map(([v,n])=>`<option value="${v}">${n}</option>`).join('')}</select></label><button id="midi-events-new" type="button">새 이벤트</button><button id="midi-events-delete" type="button" disabled>선택 삭제</button></div><form id="midi-events-form"><h3 id="midi-events-form-title">CC 추가</h3><div id="midi-events-fields" class="midi-event-fields"></div><p class="muted">표시 tick은 클립 시작을 0으로 셉니다. 정확한 분수는 1/2처럼 입력합니다. 저장 해상도로 표현할 수 없는 값은 거부합니다. 새 이벤트의 빈 순서는 자동 배정하고, 기존 이벤트의 빈 순서는 유지합니다. 같은 tick에서는 작은 순서가 먼저 내보내집니다. 저장된 이벤트 유형은 바꾸지 않습니다.</p><button id="midi-events-apply" class="primary" type="submit">추가</button></form>`;
 document.body.append(dialog);
 let context=null,selected=null,mode='new',page=0,localBusy=false,generation=0,renderedRevision=-1,profile=null,profileStale=false,loading=false,profileError='';
 const display=tick=>profile?formatDisplayTicks(tick,getContext().project.ppq,profile.settings.options.displayPpq):'—';
 const currentClip=()=>getContext().project?.clips.find(x=>x.id===context?.clipId);
 const sameIdentity=()=>{const c=getContext();return c.documentId===context?.documentId&&c.project?.id===context?.projectId&&currentClip()?.type==='midi';};
 const entries=()=>{const clip=currentClip();return clip?[...clip.notes.map(n=>({...n,notesType:true,tick:n.startTick,order:n.onOrder})),...(clip.events??[])].sort((a,b)=>a.tick-b.tick||(a.order??Number.MAX_SAFE_INTEGER)-(b.order??Number.MAX_SAFE_INTEGER)||a.id.localeCompare(b.id)):[];};
 subscribeControllerSettings(()=>{const menu=$('midi-events-cc-menu');if(menu)fillControllerMenu(menu,$('midi-events-fields').querySelector('[name="controller"]')?.value??'');});
 function close(){generation++;context=null;selected=null;profile=null;loading=false;profileStale=false;profileError='';dialog.close();}
 function details(item){const type=typeOf(item),data=item.data??[];if(type==='note')return `음높이 ${item.pitch} · 길이 ${display(item.durationTicks)} 표시 tick · velocity ${item.velocity} / release ${item.releaseVelocity??0}`;if(type==='cc')return `CC ${data[0]} = ${data[1]}`;if(type==='pitch')return `${data[0]+128*data[1]} (${data[0]+128*data[1]-8192>=0?'+':''}${data[0]+128*data[1]-8192})`;if(type==='poly')return `음높이 ${data[0]} = ${data[1]}`;if(type==='sysex'||type==='meta')return `${type==='sysex'?item.status.toString(16).toUpperCase():'FF '+item.metaType.toString(16).toUpperCase()} · ${data.length} bytes · ${hex(data.slice(0,16))}${data.length>16?' …':''}`;return data.join(' · ');}
 function renderRows(){
  const c=getContext(),clip=currentClip();if(!clip)return;
  const all=entries(),kind=$('midi-events-filter').value,channel=$('midi-events-channel-filter').value;
  const filtered=all.filter(item=>{const ch=item.notesType?item.channel:item.kind==='channel'?item.status&15:null;return(kind==='all'||typeOf(item)===kind)&&(channel==='all'||channel==='none'&&ch===null||channel!=='none'&&ch===Number(channel));});
  const count=Math.max(1,Math.ceil(filtered.length/pageSize));page=Math.min(page,count-1);
  $('midi-events-context').textContent=`${clip.name} · ${clip.notes.length} notes / ${clip.events?.length??0} events · REV ${c.project.revision} · 표시 PPQ ${profile?.settings.options.displayPpq??'확인 중'}${profileStale?' (이전 설정 · 다시 읽기 필요)':''}`;
  $('midi-events-rows').innerHTML=filtered.slice(page*pageSize,(page+1)*pageSize).map(item=>`<tr${selected===item.id?' class="selected"':''}><td><button type="button" data-midi-event-id="${esc(item.id)}" aria-label="${esc(names[typeOf(item)])} ${display(item.tick)} 표시 tick 선택" aria-pressed="${selected===item.id}">선택</button></td><td>${display(item.tick)}</td><td>${item.order??'자동'}</td><td>${esc(names[typeOf(item)])}</td><td>${item.notesType?item.channel+1:item.kind==='channel'?(item.status&15)+1:'—'}</td><td>${esc(details(item))}</td></tr>`).join('')||'<tr><td colspan="6">표시할 이벤트가 없습니다.</td></tr>';
  $('midi-events-page').textContent=`${page+1} / ${count} · ${filtered.length}개`;$('midi-events-prev').disabled=page===0;$('midi-events-next').disabled=page+1>=count;renderedRevision=c.project.revision;
 }
 function form(type,item=null){
  const clip=currentClip();if(!clip)return;const data=item?.data??[],isNote=type==='note';
  let fields=timeField('클립 내 표시 tick','tick',item?.tick??0);
  if(!['sysex','meta'].includes(type))fields+=numberField('채널 · 1–16','channel',item?(isNote?item.channel+1:(item.status&15)+1):1,1,16);
  fields+=numberField(isNote?'Note On 순서':'같은 tick 내 순서','order',item?.order??'',0,Number.MAX_SAFE_INTEGER,false);
  if(isNote){fields+=numberField('음높이','pitch',item.pitch,0,127)+timeField('길이 · 표시 tick','durationTicks',item.durationTicks)+numberField('벨로시티','velocity',item.velocity,1,127)+numberField('릴리스 벨로시티','releaseVelocity',item.releaseVelocity??0,0,127)+numberField('Note Off 순서','offOrder',item.offOrder??'',0,Number.MAX_SAFE_INTEGER,false);fields+=`<label>Note Off 형식<select name="noteOffEncoding"><option value="noteOff"${item.noteOffEncoding!=='zeroVelocityNoteOn'?' selected':''}>Note Off</option><option value="zeroVelocityNoteOn"${item.noteOffEncoding==='zeroVelocityNoteOn'?' selected':''}>Note On · velocity 0</option></select></label>`;}
  else if(type==='cc')fields+='<label>표시 CC<select id="midi-events-cc-menu"></select></label>'+numberField('CC 번호','controller',data[0]??64,0,127)+numberField('값','value',data[1]??127,0,127);
  else if(type==='poly'||type==='noteOff')fields+=numberField('음높이','pitch',data[0]??60,0,127)+numberField(type==='poly'?'프레셔':'릴리스 벨로시티','value',data[1]??0,0,127);
  else if(type==='pitch')fields+=numberField('피치벤드 · 중심 8192','value',item?data[0]+128*data[1]:8192,0,16383);
  else if(type==='program'||type==='channelPressure')fields+=numberField(type==='program'?'프로그램 · 0–127':'프레셔','value',data[0]??0,0,127);
  else {
   if(type==='sysex')fields+=`<label>SMF 프레임<select name="frame" ${item?'disabled':''}><option value="240"${!item||item.status===240?' selected':''}>F0 · 시작</option><option value="247"${item?.status===247?' selected':''}>F7 · 계속 / escape</option></select></label>`;
   else fields+=numberField('메타 유형 · 0–127','metaType',item?.metaType??1,0,127);
   fields+=`<label class="midi-event-payload">원본 데이터 · 16진수 바이트<textarea name="payload" rows="4" spellcheck="false">${esc(hex(data))}</textarea></label>`;
  }
  $('midi-events-fields').innerHTML=fields;if(item?.kind==='meta')$('midi-events-fields').querySelector('[name="metaType"]').disabled=true;
  if(type==='cc'){const menu=$('midi-events-cc-menu');fillControllerMenu(menu,data[0]??64);menu.onchange=()=>{if(menu.value!=='')$('midi-events-fields').querySelector('[name="controller"]').value=menu.value;};}
  $('midi-events-form').dataset.type=type;$('midi-events-form-title').textContent=`${names[type]} ${item?'편집':'추가'}`;$('midi-events-apply').textContent=item?'적용':'추가';
 }
 function adopt(selectedId=selected){
  const c=getContext(),clip=currentClip();if(!clip)return;context.revision=c.project.revision;selected=selectedId;
  const item=entries().find(e=>e.id===selected);if(item){mode='edit';form(typeOf(item),item);}else{mode='new';selected=null;form($('midi-events-new-type').value);}
  $('midi-events-status').textContent='';renderRows();update();
 }
 async function loadProfile(){const token=++generation;loading=true;profileError='';update();try{const value=await readTimingProfile();if(token!==generation||!context||!sameIdentity())return;profile=value;profileStale=false;adopt(selected);}catch(error){if(token===generation){profileStale=true;profileError=error.message;}}finally{if(token===generation){loading=false;if(profile&&!profileStale)$('midi-events-status').textContent='';update();}}}
 function open(){const c=getContext(),clip=c.project?.clips.find(x=>x.id===c.selectedClip);if(clip?.type!=='midi'||c.busy||!c.connected)return;generation++;context={documentId:c.documentId,projectId:c.project.id,clipId:clip.id,revision:c.project.revision};page=0;selected=null;profile=null;profileStale=false;$('midi-events-filter').value='all';$('midi-events-channel-filter').value='all';$('midi-events-fields').replaceChildren();$('midi-events-rows').replaceChildren();dialog.showModal();void loadProfile();}
 window.addEventListener('newdaw-timing-settings',()=>{if(!dialog.open||!context)return;generation++;loading=false;profileStale=true;profileError='';renderRows();update();});
 function update(){
  const c=getContext(),available=c.connected&&!!c.project&&!c.busy;
  $('midi-events-button').disabled=!available||c.project?.clips.find(x=>x.id===c.selectedClip)?.type!=='midi';
  if(!dialog.open||!context)return;if(!sameIdentity()){close();return;}
  const stale=c.project.revision!==context.revision,blocked=!available||localBusy||stale||loading||profileStale||!profile;
  if(renderedRevision!==c.project.revision)renderRows();
  if(stale)$('midi-events-status').textContent='다른 편집으로 프로젝트가 변경되었습니다. 입력은 유지됩니다. 최신 상태로 다시 읽고 적용하세요.';
  if(loading)$('midi-events-status').textContent='표시 해상도를 읽는 중입니다.';else if(profileStale)$('midi-events-status').textContent=profileError?`설정 읽기 실패: ${profileError} · 입력은 보존했습니다. 다시 읽으세요.`:'표시 설정이 변경되었습니다. 입력은 이전 단위로 보존했습니다. 최신 상태로 다시 읽으세요.';
  for(const el of $('midi-events-form').querySelectorAll('input,textarea,select,button'))el.disabled=blocked||el.name==='metaType'&&mode==='edit'||el.name==='frame'&&mode==='edit';
  $('midi-events-delete').disabled=blocked||!selected;$('midi-events-new').disabled=blocked;$('midi-events-refresh').disabled=!available||localBusy||loading;
  for(const el of $('midi-events-rows').querySelectorAll('button'))el.disabled=blocked;
 }
 const fail=message=>{$('midi-events-status').textContent=message;};
 function payload(text){if(text.length>3*1024*1024)throw new Error('원본 데이터는 최대 1 MiB입니다.');const compact=text.trim();if(!compact)return[];const tokens=compact.split(/\s+/);if(tokens.some(t=>! /^[0-9a-fA-F]{2}$/.test(t)))throw new Error('각 바이트를 두 자리 16진수로 입력하고 공백으로 구분하세요.');return tokens.map(t=>parseInt(t,16));}
 async function mutate(command,args,displayTimes=null){
  if(!context||!sameIdentity()||localBusy||loading||profileStale||!profile||getContext().project.revision!==context.revision)return;
  const token=generation,revision=context.revision;localBusy=true;update();
  try{const result=await runCommand(command,args,revision,displayTimes?{profile,displayTimes}:null);if(token!==generation||!context||!sameIdentity())return;if(result){adopt(selected);notify('MIDI 이벤트를 저장했습니다. 실행 취소로 되돌릴 수 있습니다.');}else if(getContext().project.revision===revision)fail('저장하지 못했습니다. 입력값과 알림을 확인하세요.');}
  finally{localBusy=false;update();}
 }
 $('midi-events-button').addEventListener('click',open);$('midi-events-close').addEventListener('click',close);dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
 $('midi-events-refresh').addEventListener('click',()=>void loadProfile());
 for(const id of ['midi-events-filter','midi-events-channel-filter'])$(id).addEventListener('change',()=>{page=0;renderRows();update();});
 $('midi-events-prev').addEventListener('click',()=>{page--;renderRows();update();});$('midi-events-next').addEventListener('click',()=>{page++;renderRows();update();});
 $('midi-events-rows').addEventListener('click',event=>{const id=event.target.closest('[data-midi-event-id]')?.dataset.midiEventId;if(id)adopt(id);});
 $('midi-events-new').addEventListener('click',()=>adopt(null));
 $('midi-events-new-type').addEventListener('change',()=>{if(mode==='new')form($('midi-events-new-type').value);update();});
 $('midi-events-delete').addEventListener('click',()=>{const item=entries().find(e=>e.id===selected);if(!item)return;mutate(item.notesType?'midi.notes.remove':'midi.events.remove',{clipId:context.clipId,...(item.notesType?{noteIds:[item.id]}:{eventIds:[item.id]})});});
 $('midi-events-form').addEventListener('submit',event=>{
  event.preventDefault();if(!context)return;
  try{
   const values=Object.fromEntries(new FormData(event.target)),type=event.target.dataset.type,item=entries().find(e=>e.id===selected),order=values.order===''?{}:{order:Number(values.order)};
   if(type==='note'){
    if(!item?.notesType)return;const fields={clipId:context.clipId,noteId:item.id,channel:Number(values.channel)-1,pitch:Number(values.pitch),velocity:Number(values.velocity),releaseVelocity:Number(values.releaseVelocity),noteOffEncoding:values.noteOffEncoding,...(values.order===''?{}:{onOrder:Number(values.order)}),...(values.offOrder===''?{}:{offOrder:Number(values.offOrder)})};
    if(fields.noteOffEncoding==='zeroVelocityNoteOn'&&fields.releaseVelocity!==0)throw new Error('velocity 0 Note On 형식의 릴리스 값은 0이어야 합니다.');return void mutate('midi.notes.update',fields,{startTick:values.tick,durationTicks:values.durationTicks});
   }
   const channel=Number(values.channel)-1,value=Number(values.value);let raw;
   if(type==='sysex'||type==='meta')raw={kind:type,status:type==='sysex'?(item?.status??Number(values.frame)):255,data:payload(values.payload),...(type==='meta'?{metaType:item?.metaType??Number(values.metaType)}:{})};
   else {const high={cc:11,pitch:14,program:12,channelPressure:13,poly:10,noteOff:8}[type];raw={kind:'channel',status:item?.status??(high<<4|channel),data:type==='cc'?[Number(values.controller),value]:type==='pitch'?[value%128,Math.floor(value/128)]:type==='poly'||type==='noteOff'?[Number(values.pitch),value]:[value]};if(type==='noteOff'&&item?.status>>4===9&&value!==0)throw new Error('velocity 0 Note On 형식은 릴리스 값 0만 사용할 수 있습니다.');}
   if(mode==='edit'&&item)void mutate('midi.events.update',{clipId:context.clipId,eventId:item.id,data:raw.data,...order,...(raw.kind==='channel'?{channel}:{})},{tick:values.tick});
   else void mutate('midi.events.add',{clipId:context.clipId,events:[{...raw,...order}]},{'events.0.tick':values.tick});
  }catch(error){fail(error.message);}
 });
 update();return{update,documentChanged:close};
}
