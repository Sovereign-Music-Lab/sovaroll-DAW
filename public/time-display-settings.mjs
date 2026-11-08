import {resolveTimeDisplay,TIME_FORMATS,TIME_FORMAT_LABELS} from '/media/time-display.mjs';

export function setupTimeDisplaySettings({getContext,runCommand,notify}) {
  const button=document.createElement('button');button.id='time-display-open';button.type='button';button.textContent='시간 표시';document.querySelector('.top-actions').prepend(button);
  const choices=inherit=>(inherit?'<option value="inherit">전역 형식 따르기</option>':'')+TIME_FORMATS.map(k=>`<option value="${k}">${TIME_FORMAT_LABELS[k]}</option>`).join('');
  const modes='<option value="beat-linear">박자 기준 · Bars+Beats Linear</option><option value="time-linear">시간 기준 · Time Linear</option>';
  const dialog=document.createElement('dialog');dialog.id='time-display-dialog';dialog.className='midi-modifiers-dialog';
  dialog.innerHTML=`<div class="dialog-heading"><h2>프로젝트 시간 표시</h2><button type="button" id="time-display-close">닫기 / 취소</button></div><p>전역 형식은 transport와 클립 정보에 적용합니다. 각 ruler는 별도 형식을 선택할 수 있습니다. 설정은 프로젝트와 함께 저장하며 Undo로 되돌릴 수 있습니다.</p><p id="time-display-status" role="status"></p><button type="button" id="time-display-reload">초안 버리고 다시 읽기</button><form id="time-display-form"><label>전역 형식<select name="primaryFormat">${choices(false)}</select></label><label>Timeline ruler<select name="timelineFormat">${choices(true)}</select></label><label>Piano ruler · 노트 정보<select name="pianoFormat">${choices(true)}</select></label><label>Timeline 배치<select name="timelineMode">${modes}</select></label><label>Piano · Controller 배치<select name="pianoMode">${modes}</select></label><label>Timecode · 표시 프레임 수 / 초<input name="nominalFps" type="number" min="1" max="120" step="1" required></label><label>실제 프레임률 · 분자<input name="numerator" type="number" min="1" max="1000000000" step="1" required></label><label>실제 프레임률 · 분모<input name="denominator" type="number" min="1" max="1000000000" step="1" required></label><p>예: 29.97 fps는 표시 수 30, 실제 속도 30000 / 1001입니다. 30 fps는 30 / 1입니다. 영상과 정확히 맞추려면 실제 속도를 확인하세요.</p><label><input name="dropFrame" type="checkbox">Drop-frame 번호 (표시 수 30)</label><label>fps (User) · 프레임 / 초<input name="userFps" type="number" min="1" max="120" step="1" required></label><label><input name="showSubframes" type="checkbox">서브프레임 표시 · 프레임당 80</label><p>숫자 정보는 표시 단위 아래로 내립니다. 저장된 노트·오디오 위치는 바꾸지 않습니다. 시간 기준은 같은 초 간격, 박자 기준은 같은 박 간격으로 배치합니다. 확대율의 시간 기준은 120 BPM입니다. 초·샘플·프레임 눈금은 확대율에 맞춰 자동 배치합니다. 눈금 간격과 별개로 피아노의 노트 격자 설정에서 음악 또는 시간 격자를 선택합니다. 컨트롤러 Draw·Line 끝점과 이동도 피아노 격자를 따릅니다. 설정을 저장하면 재생과 진행 중인 드래그가 멈춥니다. Inspector는 노트·클립의 시간 형식별 숫자 편집을 지원합니다. Offset과 다른 편집 영역은 개발 중입니다.</p><button type="submit" id="time-display-apply">표시 설정 저장</button></form>`;
  document.body.append(dialog);
  const $=id=>dialog.querySelector('#'+id),form=$('time-display-form');let snapshot=null,saving=false,stale=false;
  const field=n=>form.elements.namedItem(n);
  function update(){const c=getContext();button.disabled=!c.project||!c.connected||c.busy;if(!dialog.open)return;
    if(snapshot&&(c.documentId!==snapshot.documentId||c.project?.id!==snapshot.projectId||c.project?.revision!==snapshot.revision))stale=true;
    if(stale)$('time-display-status').textContent='프로젝트가 바뀌었습니다. 입력 초안을 보존했습니다. 다시 읽은 뒤 적용하세요.';
    $('time-display-apply').disabled=saving||stale||!snapshot||!c.connected||c.busy;$('time-display-reload').disabled=saving||!c.project||!c.connected||c.busy;$('time-display-close').disabled=saving;
    for(const input of form.elements)if(input.tagName!=='BUTTON')input.disabled=saving;
  }
  function load(){const c=getContext();if(!c.project)return;const value=resolveTimeDisplay(c.project.timeDisplay);snapshot={projectId:c.project.id,revision:c.project.revision,documentId:c.documentId};stale=false;
    for(const k of ['primaryFormat','timelineFormat','pianoFormat','timelineMode','pianoMode','userFps'])field(k).value=String(value[k]);
    for(const k of ['nominalFps','numerator','denominator'])field(k).value=String(value.frameRate[k]);
    field('dropFrame').checked=value.frameRate.dropFrame;field('showSubframes').checked=value.showSubframes;
    $('time-display-status').textContent=`프로젝트 REV ${snapshot.revision}`;update();
  }
  const close=()=>{if(!saving)dialog.close();};button.onclick=()=>{dialog.showModal();load();};$('time-display-close').onclick=close;$('time-display-reload').onclick=load;dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  form.onsubmit=async event=>{event.preventDefault();update();if($('time-display-apply').disabled)return;
    try{const options=resolveTimeDisplay({primaryFormat:field('primaryFormat').value,timelineFormat:field('timelineFormat').value,pianoFormat:field('pianoFormat').value,timelineMode:field('timelineMode').value,pianoMode:field('pianoMode').value,userFps:Number(field('userFps').value),showSubframes:field('showSubframes').checked,frameRate:{nominalFps:Number(field('nominalFps').value),numerator:Number(field('numerator').value),denominator:Number(field('denominator').value),dropFrame:field('dropFrame').checked}});
      saving=true;update();const result=await runCommand('project.timeDisplay',{options},snapshot.revision);if(result){load();$('time-display-status').textContent='표시 설정 저장됨';}
    }catch(e){$('time-display-status').textContent=e.message;notify(e.message,true);}finally{saving=false;update();}
  };
  return{update};
}
