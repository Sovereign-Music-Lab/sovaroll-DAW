const multiPartMidiOperations=new Set(['transpose','quantize','resetQuantize','freezeQuantize','velocity','length','reverse','deleteOverlaps','legato','glue','pedalsToLength','removeDoubles','split','deleteControllers','restrictPolyphony','thinControllers','repeatLoop','dissolve']);
// GUI adapters only: editing semantics live in the shared command engine.
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export function setupEditingUI({getContext,runCommand,request,notify,selectTracks,selectTrack,selectClip,revealClip,revealClips,download,restoreAsset,onStepMidiChange=()=>{},onStepCursorChange=()=>{},selectNotes=()=>{}}) {
  const $=id=>document.getElementById(id);
  let sourceArchiveRestore=null,stepCursorModule=null;
  let stepContext=null,stepInput=null,stepMidiArmed=false,stepMidiSaving=false,stepMidiDevice=null,stepMidiFilter=null,stepUnsubscribe=null,stepStateUnsubscribe=null;
  const stepHeld=new Map(),stepChord=new Map();let heldDurationTicks=null,stepChordGeneration=0;
  let duplicateContext=null;
  let editContext=null, midiContext=null, mediaResult=null, selectedAssetIds=new Set(), restoreContext=null, mediaBusy=false, mediaRequest=0;
  const clipNow=()=>{const c=getContext();return c.project?.clips.find(clip=>clip.id===c.selectedClip);};
  const noteInputUI=setupNoteInputEditUI({getContext,runCommand,notify,selectNotes,beforeOpen:()=>disarmStepMidi()});
  const trackNow=()=>{const c=getContext();return c.project?.tracks.find(track=>track.id===c.selectedTrack);};
  function publishStepCursor(){
    const c=getContext(),tick=Number($('step-input-tick').value),active=$('step-input-dialog').open&&stepContext?.documentId===c.documentId&&stepContext?.revision===c.project?.revision&&Number.isSafeInteger(tick)&&tick>=0;
    onStepCursorChange(active?{documentId:c.documentId,revision:c.project.revision,clipId:stepContext.clipId,atTick:tick}:null);
  }
  function update(){
    noteInputUI.update();publishStepCursor();
    const c=getContext(), unavailable=!c.project||c.busy||!c.connected;
    if(stepMidiArmed&&!stepMidiSaving&&(unavailable||c.recordingActive||!$('step-input-dialog').open||stepContext?.documentId!==c.documentId||stepContext?.revision!==c.project?.revision))disarmStepMidi();
    $('step-midi-arm').disabled=unavailable||!stepInput?.connected||!!c.recordingActive||!stepContext||stepContext.documentId!==c.documentId||stepContext.revision!==c.project?.revision;
    $('step-input-open').disabled=(!$('step-input-dialog').open&&(unavailable||clipNow()?.type!=='midi'));
    $('step-input-open').textContent=$('step-input-dialog').open?'스텝 입력 끄기':'스텝 입력';$('step-input-open').setAttribute('aria-pressed',String($('step-input-dialog').open));
    for(const id of ['step-midi-velocity','step-midi-release'])$(id).disabled=stepHeld.size>0||stepMidiSaving;
    $('step-input-fields').disabled=stepHeld.size>0||unavailable||!stepContext||stepContext.documentId!==c.documentId||stepContext.revision!==c.project?.revision;
    $('duplicate-track-submit').disabled=unavailable||!duplicateContext||duplicateContext.documentId!==c.documentId||duplicateContext.revision!==c.project?.revision;
    $('clip-tools-button').disabled=unavailable||!clipNow();
    $('midi-tools-button').disabled=unavailable||clipNow()?.type!=='midi';
    $('media-pool-button').disabled=unavailable;
    $('bundle-download').disabled=unavailable;
    $('media-selected-clip').disabled=unavailable||!getContext().project?.clips.some(clip=>getContext().selectedClipIds.has(clip.id)&&clip.type==='audio');
    $('media-refresh').disabled=mediaBusy;
    if(mediaResult&&$('media-dialog').open){
      $('media-revision').textContent=`REV ${mediaResult.projectRevision} · ${mediaResult.assets.length} files${mediaResult.projectRevision!==c.project?.revision?' · 다시 검사 필요':''}`;
      renderReferences();
    }
    for(const button of $('media-content').querySelectorAll('[data-restore-asset],[data-restore-source-archive]'))button.disabled=unavailable||mediaBusy;
  }
  function refreshClipFields(){
    const kind=$('clip-operation').value;
    $('clip-duplicate-fields').hidden=kind!=='duplicate';
    $('clip-split-fields').hidden=kind!=='split';
    $('clip-move-fields').hidden=kind!=='move';
    $('clip-target-row').hidden=kind==='split';
    for(const field of $('clip-tools-form').querySelectorAll('[data-edit-field]'))field.disabled=Boolean(field.closest('[hidden]'));
  }
  let splitOpenGeneration=0;
  async function openClipTools(){
    const c=getContext(),clip=clipNow();if(!clip)return;
    const token=++splitOpenGeneration;let splitProfile=null;
    if(clip.type==='midi')try{splitProfile=await request('/api/workspace/split-settings');}catch(error){notify(error.message,true);return;}
    if(token!==splitOpenGeneration||c.documentId!==getContext().documentId||c.project.revision!==getContext().project?.revision){notify('프로젝트가 바뀌었습니다. 편집 창을 다시 여세요.',true);return;}
    editContext={documentId:c.documentId,revision:c.project.revision,clip:structuredClone(clip),project:c.project,splitProfile};
    $('clip-tools-subtitle').textContent=`${clip.name} · 포커스 클립 1개 · ${clip.type.toUpperCase()} · REV ${c.project.revision}`;
    $('clip-operation').value='duplicate';$('clip-copy-count').value='1';
    $('clip-target-track').innerHTML=c.project.tracks.filter(t=>t.type===clip.type).map(t=>`<option value="${escape(t.id)}"${t.id===clip.trackId?' selected':''}>${escape(t.name)}</option>`).join('');
    const isMidi=clip.type==='midi';
    $('split-unit').textContent=isMidi?'프로젝트 절대 위치 · 박 (1부터)':'프로젝트 절대 위치 · 초';
    $('move-unit').textContent=isMidi?'프로젝트 절대 위치 · 박 (1부터)':'프로젝트 절대 위치 · 초';
    const asset=c.project.assets.find(a=>a.id===clip.assetId);
    const midpoint=isMidi?(clip.startTick+Math.floor(clip.lengthTicks/2))/c.project.ppq+1:clip.startSample/c.project.sampleRate+clip.lengthFrames/(asset.sampleRate*2);
    $('clip-split-notes-label').hidden=!isMidi;
    $('clip-split-notes').checked=splitProfile?.settings.options.splitNotes??true;
    $('clip-split-controllers-label').hidden=!isMidi;
    $('clip-split-controllers').checked=splitProfile?.settings.options.chaseControllers??false;
    $('clip-split-save-defaults').hidden=!isMidi;
    $('clip-split-position').value=String(midpoint);
    $('clip-move-position').value=String(isMidi?clip.startTick/c.project.ppq+1:clip.startSample/c.project.sampleRate);
    $('clip-split-position').min=isMidi?'1':'0';$('clip-move-position').min=isMidi?'1':'0';
    $('clip-split-help').textContent=isMidi?'교차 노트 분할을 끄면 노트는 왼쪽 파트에 원래 길이로 남습니다. 실행 취소로 원래 파트를 복원할 수 있습니다.':'원본 WAV는 유지됩니다. 소스/프로젝트 샘플레이트가 다르면 프레임을 잃지 않는 가장 가까운 공통 경계에 맞춥니다.';
    refreshClipFields();$('clip-tools-dialog').showModal();
  }
  $('clip-split-save-defaults').addEventListener('click',async()=>{
    const draft=editContext;if(!draft?.splitProfile||draft.documentId!==getContext().documentId)return;
    const button=$('clip-split-save-defaults');button.disabled=true;
    try{const p=draft.splitProfile,result=await request('/api/workspace/split-settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedRevision:p.settings.revision,expectedFingerprint:p.fingerprint,options:{splitNotes:$('clip-split-notes').checked,chaseControllers:$('clip-split-controllers').checked}})});if(editContext===draft)draft.splitProfile=result;notify('공통 MIDI 분할 설정을 저장했습니다.');}catch(error){notify(error.message,true);}finally{button.disabled=false;}
  });
  $('clip-tools-button').addEventListener('click',openClipTools);
  $('clip-operation').addEventListener('change',refreshClipFields);
  $('clip-tools-form').addEventListener('submit',async event=>{
    event.preventDefault();if(!editContext)return;
    const {clip,project,revision}=editContext,operation=$('clip-operation').value;
    let args={clipId:clip.id};
    if(operation==='duplicate')args={...args,count:Number($('clip-copy-count').value),targetTrackId:$('clip-target-track').value};
    if(operation==='split')args={...args,...(clip.type==='midi'?{atTick:Math.round((Number($('clip-split-position').value)-1)*project.ppq),splitNotes:$('clip-split-notes').checked,chaseControllers:$('clip-split-controllers').checked}:{atSample:Math.round(Number($('clip-split-position').value)*project.sampleRate)})};
    if(operation==='move')args={...args,trackId:$('clip-target-track').value,...(clip.type==='midi'?{startTick:Math.round((Number($('clip-move-position').value)-1)*project.ppq)}:{startSample:Math.round(Number($('clip-move-position').value)*project.sampleRate)})};
    const result=await runCommand(`clip.${operation}`,args,revision);
    if(result){
      $('clip-tools-dialog').close();
      const created=result.changes?.created??[];
      const newClip=getContext().project.clips.find(item=>created.includes(item.id));
      if(newClip)selectClip(newClip.id);else selectClip(clip.id);
      const split=result.changes?.split;
      notify((operation==='split'?`클립을 분할했습니다.${split?.roundingSamples?` 원본 프레임 경계에 맞춰 ${Math.abs(split.roundingSamples)/project.sampleRate*1000<.001?'<0.001':(Math.abs(split.roundingSamples)/project.sampleRate*1000).toFixed(3)}ms ${split.roundingSamples>0?'뒤':'앞'}로 조정했습니다.`:''}`:operation==='duplicate'?'독립 클립을 복제했습니다.':'클립을 이동했습니다.')+(result.changes?.warnings?.length?' 컨트롤러 상태는 분할 위치에 복사하지 않습니다. 필요한 상태 이벤트를 확인하세요.':''));
    }else if(getContext().project.revision!==revision){
      $('clip-tools-dialog').close();notify('프로젝트가 변경되었습니다. 최신 클립을 확인하고 편집 창을 다시 열어주세요.',true);
    }
  });
  $('inspector-content').addEventListener('click',async event=>{
    const action=event.target.closest('[data-track-edit]')?.dataset.trackEdit;if(!action)return;
    const c=getContext(),track=trackNow();if(!track)return;
    if(action==='duplicate'){
      if(c.busy||!c.connected)return;
      const selected=c.selectedTrackIds?.has(track.id)?c.selectedTrackIds:new Set([track.id]),sources=c.project.tracks.filter(t=>selected.has(t.id));
      duplicateContext={documentId:c.documentId,revision:c.project.revision,sources:sources.map(t=>({id:t.id,name:t.name})),index:Math.max(...sources.map(t=>c.project.tracks.findIndex(item=>item.id===t.id)))};
      $('duplicate-track-source').textContent=`${sources.map(t=>t.name).join(', ')} · ${sources.length}개 트랙 · REV ${c.project.revision}`;
      $('duplicate-track-name-label').textContent=sources.length>1?'각 원본 이름 뒤에 붙일 이름':'새 트랙 이름';
      $('duplicate-track-name').value=sources.length>1?'Copy':`${track.name.slice(0,115)} Copy`;
      $('duplicate-track-count').value='1';$('duplicate-track-clips').checked=true;
      update();$('duplicate-track-dialog').showModal();
    }else{
      const commands=planTrackStep(c.project.tracks,c.selectedTrackIds?.has(track.id)?c.selectedTrackIds:[track.id],action==='up'?-1:1);
      if(commands.length)await runCommand('batch',{commands},c.project.revision);
    }
  });
  $('duplicate-track-form').addEventListener('submit',async event=>{
    event.preventDefault();const draft=duplicateContext,c=getContext();
    if(!draft||c.busy||!c.connected)return;
    if(draft.documentId!==c.documentId||draft.revision!==c.project?.revision){notify('프로젝트가 변경되었습니다. 복제 창을 다시 여세요.',true);return;}
    const count=Number($('duplicate-track-count').value),name=$('duplicate-track-name').value.trim(),includeClips=$('duplicate-track-clips').checked;
    if(!name||name.length>120||!Number.isSafeInteger(count)||count<1||count>32){notify('이름과 1–32개 복제 개수를 확인하세요.',true);return;}
    if(count*draft.sources.length>32){notify('한 번에 최대 32개 트랙을 복제할 수 있습니다. 개수를 줄이세요.',true);return;}
    const commands=[],ids=[];
    for(let i=0;i<count;i++)for(const source of draft.sources){
      const id=`track-${crypto.randomUUID()}`;ids.push(id);
      const suffix=count===1?'':` ${String(i+1).padStart(2,'0')}`,base=draft.sources.length>1?`${source.name.slice(0,Math.max(1,119-name.length-suffix.length))} ${name}`:name;
      commands.push({command:'track.duplicate',arguments:{trackId:source.id,newTrackId:id,includeClips}},
        {command:'track.update',arguments:{trackId:id,name:`${base}${suffix}`.slice(0,120)}},
        {command:'track.reorder',arguments:{trackId:id,index:draft.index+ids.length}});
    }
    const result=await runCommand('batch',{commands},draft.revision);
    if(result&&getContext().documentId===draft.documentId){$('duplicate-track-dialog').close();duplicateContext=null;(selectTracks??(ids=>selectTrack(ids[0])))(ids);notify(`${ids.length}개 트랙을 복제했습니다. 클립 ${includeClips?'포함':'제외'}.`);}
    update();
  });
  $('step-input-open').addEventListener('click',()=>{
    if($('step-input-dialog').open){$('step-input-dialog').close();update();return;}
    const c=getContext(),clip=clipNow();if(!clip||clip.type!=='midi'||c.busy||!c.connected)return;
    stepContext={documentId:c.documentId,revision:c.project.revision,clipId:clip.id};
    $('step-input-target').textContent=`${clip.name} · REV ${c.project.revision}`;
    $('step-input-tick').value=String(Math.max(0,(c.cursorTick??clip.startTick)-clip.startTick));
    for(const id of ['step-cursor-back','step-cursor-forward'])$(id).hidden=c.midiStepCursorNavigationSupported!==true;
    if(c.midiStepCursorNavigationSupported&&!stepCursorModule)void import('/media/step-timing.mjs').then(m=>{stepCursorModule=m;}).catch(error=>notify(error.message,true));
    loadStepSettings(c.project);updateStepSources();update();$('step-input-dialog').classList.toggle('step-floating',c.midiStepCursorClickSupported===true);if(c.midiStepCursorClickSupported)$('step-input-dialog').show();else $('step-input-dialog').showModal();update();publishStepCursor();
  });
  async function inputStep(rest,midiChord=null){
    const draft=stepContext,c=getContext();if(!draft||c.busy||!c.connected||stepHeld.size)return;
    if(draft.documentId!==c.documentId||draft.revision!==c.project?.revision){notify('프로젝트가 변경되었습니다. 스텝 입력 창을 다시 여세요.',true);return;}
    const raw=$('step-input-pitch-enabled').checked?(midiChord?midiChord.map(n=>n.pitch):$('step-input-pitches').value.split(',').map(x=>x.trim()).filter(Boolean).map(Number)):[60];
    const heldOverride=midiChord?heldDurationTicks:null;if(midiChord)heldDurationTicks=null;
    const stepSource=$('step-input-stride-source').value,lengthSource=heldOverride!==null?'ticks':$('step-input-length-source').value;
    const pitches=rest?[]:[...new Set(raw)],atTick=Number($('step-input-tick').value),stepTicks=stepSource==='ticks'?Number($('step-input-stride').value):1,durationTicks=heldOverride??(lengthSource==='ticks'?Number($('step-input-duration').value):1),velocity=midiChord&&$('step-midi-velocity').checked?midiChord[0].velocity:Number($('step-input-velocity').value),channel=Number($('step-input-channel').value)-1;
    if(![atTick,stepTicks,durationTicks,velocity,channel].every(Number.isSafeInteger)||atTick<0||stepTicks<1||durationTicks<1||velocity<1||velocity>127||channel<0||channel>15||!rest&&(!pitches.length||pitches.some(p=>!Number.isSafeInteger(p)||p<0||p>127))){notify('입력 위치·길이·채널·음높이 값을 확인하세요.',true);return;}
    if(midiChord){stepMidiSaving=true;$('step-midi-status').textContent='코드 저장 중 · 다음 입력은 저장 후 진행하세요.';}
    let result;try{result=await runCommand('midi.step',{clipId:draft.clipId,atTick,stepTicks,durationTicks,pitches,velocity,channel,moveInsert:$('step-input-insert').checked,stepSource,lengthSource,lengthDenominator:Number($('step-note-denominator').value),lengthModifier:$('step-note-modifier').value,...(midiChord&&$('step-midi-release').checked?{releaseVelocities:pitches.map(p=>midiChord.find(n=>n.pitch===p)?.releaseVelocity??midiChord[0].releaseVelocity??0)}:{}),...(midiChord&&$('step-midi-velocity').checked?{velocities:pitches.map(p=>midiChord.find(n=>n.pitch===p)?.velocity??midiChord[0].velocity)}:{})},draft.revision);}finally{stepMidiSaving=false;}
    if(midiChord&&!result)disarmStepMidi('입력 적용 실패 · MIDI 스텝 입력을 다시 켜세요.');
    if(result&&getContext().documentId===draft.documentId){const step=result.changes.step;stepContext={documentId:draft.documentId,revision:getContext().project.revision,clipId:step.nextClipId};$('step-input-tick').value=String(step.nextTick);$('step-input-target').textContent=`스텝 입력 · REV ${stepContext.revision} · 다음 프로젝트 tick ${step.nextProjectTick} · 간격 ${step.stepTicks??stepTicks} / 길이 ${step.durationTicks??durationTicks} tick`;selectClip(step.nextClipId);}
    if(midiChord&&result&&stepMidiArmed)$('step-midi-status').textContent='저장 완료 · 다음 코드 입력 대기';
    update();
  }
  function placeStepCursor(atTick){
    const c=getContext();if(!c.midiStepCursorClickSupported||!$('step-input-dialog').open)return false;
    if(c.busy||!c.connected||stepHeld.size||stepMidiSaving||stepContext?.documentId!==c.documentId||stepContext?.revision!==c.project?.revision||stepContext?.clipId!==c.selectedClip)return false;
    if(!Number.isSafeInteger(atTick)||atTick<0){notify('유효한 입력 tick을 선택하세요.',true);return false;}
    $('step-input-tick').value=String(atTick);publishStepCursor();$('step-input-rest').focus({preventScroll:true});return true;
  }
  function disarmStepMidi(message='MIDI 스텝 입력 꺼짐'){stepMidiArmed=false;heldDurationTicks=null;stepChordGeneration++;stepHeld.clear();stepChord.clear();$('step-midi-arm').textContent='MIDI 스텝 입력 켜기';$('step-midi-status').textContent=message;onStepMidiChange();}
  function setMidiInput(input){
    noteInputUI.setMidiInput(input);
    stepUnsubscribe?.();stepStateUnsubscribe?.();disarmStepMidi();stepInput=input;
    stepStateUnsubscribe=input.subscribeState(()=>{if(!input.connected||input.deviceId!==stepMidiDevice)disarmStepMidi('MIDI 장치가 변경되었습니다. 스텝 입력을 다시 켜세요.');update();});
    stepUnsubscribe=input.subscribe(({data,deviceId})=>{
      if(!stepMidiArmed||!$('step-input-dialog').open)return;
      const status=data[0]&240,channel=data[0]&15,pitch=data[1];if(channel!==Number($('step-input-channel').value)-1||![128,144].includes(status)||!input.accepts(data,stepMidiFilter))return;
      const c=getContext();if(stepMidiSaving){disarmStepMidi('저장 중 새 입력이 도착했습니다. 코드를 다시 입력하세요.');return;}
      if(c.busy||c.recordingActive||stepContext?.documentId!==c.documentId||stepContext?.revision!==c.project?.revision||deviceId!==stepMidiDevice){disarmStepMidi('편집 상태가 변경되었습니다. 스텝 입력을 다시 켜세요.');return;}
      if(status===144&&data[2]>0){if(!stepChord.size){heldDurationTicks=null;stepChordGeneration++;}stepHeld.set(pitch,(stepHeld.get(pitch)??0)+1);if(!stepChord.has(pitch))stepChord.set(pitch,{pitch,velocity:data[2],releaseVelocity:0});$('step-midi-status').textContent=`${stepChord.size}음 · 키를 모두 놓으면 입력`;}
      else if(stepHeld.has(pitch)){stepChord.get(pitch).releaseVelocity=status===128?(data[2]??0):0;const count=stepHeld.get(pitch)-1;if(count)stepHeld.set(pitch,count);else stepHeld.delete(pitch);if(!stepHeld.size&&stepChord.size){const chord=[...stepChord.values()];stepChordGeneration++;stepChord.clear();void inputStep(false,chord);}}
      update();
    });update();
  }
  $('step-midi-arm').addEventListener('click',()=>{if(stepMidiArmed){disarmStepMidi();return;}const c=getContext();if(!stepInput?.connected||c.busy||c.recordingActive||stepContext?.documentId!==c.documentId||stepContext?.revision!==c.project?.revision)return;stepHeld.clear();stepChord.clear();stepMidiDevice=stepInput.deviceId;stepMidiFilter=structuredClone(stepInput.getFilter());stepMidiArmed=true;onStepMidiChange();$('step-midi-arm').textContent='MIDI 스텝 입력 끄기';$('step-midi-status').textContent='새로 누르는 코드 입력 대기 · 모든 키를 놓으면 저장';});
  $('step-input-dialog').addEventListener('close',()=>{disarmStepMidi();onStepCursorChange(null);update();});
  $('step-input-tick').addEventListener('input',publishStepCursor);
  $('step-input-dialog').addEventListener('keydown',event=>{if(event.key==='Escape'&&$('step-input-dialog').classList.contains('step-floating')){event.preventDefault();event.stopPropagation();$('step-input-dialog').close();}});
  $('step-input-channel').addEventListener('change',()=>disarmStepMidi('채널이 변경되었습니다. 스텝 입력을 다시 켜세요.'));
  window.addEventListener('blur',()=>disarmStepMidi());
  function loadStepSettings(project){
    const settings={stepSource:'ticks',lengthSource:'ticks',stepTicks:project.ppq,durationTicks:project.ppq,lengthDenominator:16,lengthModifier:'straight',...project.midiStepSettings};
    $('step-input-stride-source').value=settings.stepSource;$('step-input-length-source').value=settings.lengthSource;$('step-input-stride').value=String(settings.stepTicks);$('step-input-duration').value=String(settings.durationTicks);$('step-note-denominator').value=String(settings.lengthDenominator);$('step-note-modifier').value=settings.lengthModifier;
  }
  async function saveStepSettings(reset=false){
    const c=getContext(),draft=stepContext;if(!draft||c.busy||!c.connected||stepHeld.size||stepMidiSaving)return;
    if(draft.documentId!==c.documentId||draft.revision!==c.project?.revision){notify('프로젝트가 변경되었습니다. 스텝 입력을 다시 여세요.',true);return;}
    disarmStepMidi();
    const settings=reset?null:{stepSource:$('step-input-stride-source').value,lengthSource:$('step-input-length-source').value,stepTicks:Number($('step-input-stride').value),durationTicks:Number($('step-input-duration').value),lengthDenominator:Number($('step-note-denominator').value),lengthModifier:$('step-note-modifier').value};
    const result=await runCommand('project.midiStepSettings',{settings},draft.revision);
    if(result&&getContext().documentId===draft.documentId){stepContext={...draft,revision:getContext().project.revision};loadStepSettings(getContext().project);updateStepSources();notify(reset?'프로젝트 스텝 입력 설정을 초기화했습니다.':'프로젝트 스텝 입력 설정을 저장했습니다.');}update();
  }
  $('step-settings-save').addEventListener('click',()=>void saveStepSettings());$('step-settings-reset').addEventListener('click',()=>void saveStepSettings(true));
  function updateStepSources(){$('step-note-value-fields').hidden=$('step-input-length-source').value!=='noteValue';$('step-input-stride').disabled=$('step-input-stride-source').value!=='ticks';$('step-input-duration').disabled=$('step-input-length-source').value!=='ticks';}
  for(const id of ['step-input-stride-source','step-input-length-source'])$(id).addEventListener('change',updateStepSources);
  async function navigateStepCursor(direction){
    const c=getContext(),draft=stepContext;if(!draft||c.busy||!c.connected||stepHeld.size||stepMidiSaving)return;
    if(draft.documentId!==c.documentId||draft.revision!==c.project?.revision){notify('프로젝트가 변경되었습니다. 스텝 입력 창을 다시 여세요.',true);return;}
    if(c.midiStepCursorNavigationSupported!==true)return;
    try{stepCursorModule??=await import('/media/step-timing.mjs');const now=getContext();if(now.documentId!==draft.documentId||now.project?.revision!==draft.revision)return;
      const clip=now.project.clips.find(x=>x.id===draft.clipId),position=stepCursorModule.moveStepCursor(now.project,clip,{atTick:Number($('step-input-tick').value),stepSource:$('step-input-stride-source').value,stepTicks:Number($('step-input-stride').value),lengthSource:$('step-input-length-source').value,durationTicks:Number($('step-input-duration').value),lengthDenominator:Number($('step-note-denominator').value),lengthModifier:$('step-note-modifier').value},direction);
      $('step-input-tick').value=String(position.atTick);$('step-input-target').textContent=`커서 프로젝트 tick ${position.projectTick} · 입력 간격 ${position.stepTicks} tick · 프로젝트 변경 없음`;publishStepCursor();
    }catch(error){notify(error.message,true);}
  }
  async function resizeHeldStepNotes(direction){
    const c=getContext(),draft=stepContext,generation=stepChordGeneration;if(!draft||!stepHeld.size||c.busy||stepMidiSaving||!c.connected||!c.midiStepCursorNavigationSupported)return;
    try{stepCursorModule??=await import('/media/step-timing.mjs');const now=getContext();if(generation!==stepChordGeneration||!stepHeld.size||now.documentId!==draft.documentId||now.project?.revision!==draft.revision)return;
      const clip=now.project.clips.find(x=>x.id===draft.clipId),size=stepCursorModule.resizeHeldStep(now.project,clip,{atTick:Number($('step-input-tick').value),stepSource:$('step-input-stride-source').value,stepTicks:Number($('step-input-stride').value),lengthSource:$('step-input-length-source').value,durationTicks:Number($('step-input-duration').value),lengthDenominator:Number($('step-note-denominator').value),lengthModifier:$('step-note-modifier').value},heldDurationTicks,direction);
      heldDurationTicks=size.durationTicks;$('step-midi-status').textContent=`${stepChord.size}음 · 길이 ${heldDurationTicks} tick · ←/→ ${size.stepTicks} tick 증감 · 모두 놓으면 저장`;
    }catch(error){notify(error.message,true);}
  }
  $('step-cursor-back').addEventListener('click',()=>void navigateStepCursor(-1));$('step-cursor-forward').addEventListener('click',()=>void navigateStepCursor(1));
  $('step-input-form').addEventListener('submit',event=>{event.preventDefault();void inputStep(false);});
  $('step-input-rest').addEventListener('click',()=>void inputStep(true));
  $('step-input-dialog').addEventListener('keydown',event=>{if(['ArrowLeft','ArrowRight'].includes(event.key)&&!event.target.closest('input,select,textarea')&&!event.metaKey&&!event.ctrlKey&&!event.altKey){event.preventDefault();event.stopPropagation();if(stepHeld.size){void resizeHeldStepNotes(event.key==='ArrowRight'?1:-1);return;}if(event.key==='ArrowLeft')void navigateStepCursor(-1);else void inputStep(true);}});
  function refreshMidiFields(){
    const operation=$('midi-operation').value;
    const partsOption=$('midi-scope').querySelector('[value=parts]');partsOption.hidden=!multiPartMidiOperations.has(operation);partsOption.disabled=!multiPartMidiOperations.has(operation)||!midiContext?.clipIds?.length;
    if($('midi-scope').value==='parts'&&partsOption.disabled)$('midi-scope').value='clip';
    $('midi-scope').disabled=false;
    $('midi-scope').querySelector('[value=selection]').disabled=['removeDoubles','deleteControllers','thinControllers','repeatLoop','dissolve'].includes(operation)||!midiContext?.noteIds.length;
    if(['removeDoubles','deleteControllers','thinControllers','repeatLoop','dissolve'].includes(operation)&&$('midi-scope').value==='selection')$('midi-scope').value='clip';
    for(const field of document.querySelectorAll('[data-midi-fields]'))field.hidden=field.dataset.midiFields!==operation;
    for(const input of $('midi-tools-form').querySelectorAll('[data-midi-value]'))input.disabled=Boolean(input.closest('[hidden]'));
    if(operation==='velocity'&&$('velocity-mode').value==='limit')$('velocity-value').disabled=true;
  }
  $('midi-tools-button').addEventListener('click',()=>{
    const c=getContext(),clip=clipNow();if(clip?.type!=='midi')return;
    midiContext={documentId:c.documentId,revision:c.project.revision,clipId:clip.id,clipStartTick:clip.startTick,parts:c.project.clips.filter(part=>part.type==='midi'&&c.selectedClipIds.has(part.id)).map(part=>({id:part.id,startTick:part.startTick,lengthTicks:part.lengthTicks})),cursorTick:c.cursorTick,locators:c.project.locators?{...c.project.locators}:null,ppq:c.project.ppq,clipIds:c.project.clips.filter(part=>part.type==='midi'&&c.selectedClipIds.has(part.id)).map(part=>part.id),noteIds:[...c.selectedNoteIds]};
    $('midi-tools-subtitle').textContent=`${clip.name} · ${clip.notes.length} notes · REV ${c.project.revision}`;
    $('midi-scope').value=midiContext.noteIds.length?'selection':'clip';
    $('midi-scope').querySelector('[value=selection]').disabled=!midiContext.noteIds.length;
    $('midi-selected-count').textContent=`선택 노트 ${midiContext.noteIds.length}개 · MIDI 클립 ${midiContext.clipIds.length}개`; 
    refreshMidiFields();$('midi-tools-dialog').showModal();
  });
  $('midi-operation').addEventListener('change',refreshMidiFields);
  $('velocity-mode').addEventListener('change',refreshMidiFields);
  $('velocity-field').addEventListener('change',()=>{$('velocity-min').value=$('velocity-field').value==='velocity'?'1':'0';});
  $('midi-tools-form').addEventListener('click',event=>{const button=event.target.closest('[data-transpose-value]');if(button)$('transpose-semitones').value=button.dataset.transposeValue;});
  $('note-length-mode').addEventListener('change',()=>{$('note-length-value').value=$('note-length-mode').value==='scale'?'100':$('note-length-mode').value==='add'?'0':'1';});
  $('midi-tools-form').addEventListener('submit',async event=>{
    event.preventDefault();if(!midiContext)return;
    const c=getContext();if(c.busy||!c.connected)return;
    if(c.documentId!==midiContext.documentId||c.project?.revision!==midiContext.revision){notify('프로젝트가 변경되었습니다. MIDI 도구를 다시 여세요.',true);return;}
    const operation=$('midi-operation').value,args={clipId:midiContext.clipId};
    if(operation==='dissolve'){const result=await runCommand('midi.parts.dissolve',{clipIds:$('midi-scope').value==='parts'?midiContext.clipIds:[midiContext.clipId],mode:$('dissolve-mode').value,optimizeDisplay:$('dissolve-optimize').checked},midiContext.revision);if(result){$('midi-tools-dialog').close();notify('MIDI 파트를 분리하고 원본을 뮤트했습니다. 외부 라우팅을 확인하세요.');}return;}
    if($('midi-scope').value==='selection')args.noteIds=midiContext.noteIds;
    if(operation==='quantize')Object.assign(args,{gridTicks:Math.max(1,Math.round(Number($('quantize-grid').value)*midiContext.ppq)),target:$('quantize-target').value,basis:$('quantize-basis').value,strength:Number($('quantize-strength').value)/100,swing:Number($('quantize-swing').value)/100});
    if(operation==='repeatLoop')Object.assign(args,{startTick:Number($('repeat-loop-start').value),endTick:Number($('repeat-loop-end').value)});
    if(operation==='thinControllers')args.tolerance=Number($('thin-controller-tolerance').value);
    if(operation==='restrictPolyphony')Object.assign(args,{voices:Number($('polyphony-voices').value),perChannel:$('polyphony-per-channel').checked});
    if(operation==='deleteControllers')args.mode=$('delete-controller-mode').value;
    if(operation==='transpose'){args.semitones=Number($('transpose-semitones').value);if(!$('transpose-scale-fields').hidden&&$('transpose-scale-enabled').checked)args.scaleCorrection={fromRoot:Number($('transpose-from-root').value),toRoot:Number($('transpose-to-root').value),fromScale:$('transpose-from-scale').value,toScale:$('transpose-to-scale').value};if(!$('transpose-range-fields').hidden&&$('transpose-range-enabled').checked)args.pitchRange={min:Number($('transpose-range-min').value),max:Number($('transpose-range-max').value)};}
    if(operation==='reverse')Object.assign(args,{mode:$('note-reverse-mode').value,extendPart:$('note-reverse-extend').checked});
    if(operation==='deleteOverlaps')args.mode=$('note-overlap-mode').value;
    if(operation==='length'){const mode=$('note-length-mode').value;Object.assign(args,{mode,value:Number($('note-length-value').value)*(mode==='scale'?.01:midiContext.ppq),overflow:$('note-length-overflow').value});}
    if(operation==='velocity'){Object.assign(args,{mode:$('velocity-mode').value,...($('velocity-mode').value==='limit'?{}:{value:Number($('velocity-value').value)/($('velocity-mode').value==='scale'?100:1)})});if(!$('velocity-advanced-fields').hidden)Object.assign(args,{field:$('velocity-field').value,minVelocity:Number($('velocity-min').value),maxVelocity:Number($('velocity-max').value)});}
    if(operation==='split'){
      const mode=$('note-split-position').value;
      const positions=mode==='cursor'?[midiContext.cursorTick-midiContext.clipStartTick]:mode==='locators'?(midiContext.locators?[midiContext.locators.startTick-midiContext.clipStartTick,midiContext.locators.endTick-midiContext.clipStartTick]:[]):$('note-split-ticks').value.split(',').map(x=>x.trim()).filter(Boolean).map(Number);
      if(mode==='ticks'&&positions.some(t=>!Number.isSafeInteger(t)||t<0)||mode==='ticks'&&positions.length>1024){notify('0 이상의 정수 tick을 최대 1024개 입력하세요.',true);return;}
      args.atTicks=[...new Set(positions.filter(t=>Number.isSafeInteger(t)&&t>=0))];
      if(!args.atTicks.length&&$('midi-scope').value!=='parts'){notify('클립 안의 커서/Locator 또는 직접 지정 위치를 확인하세요.',true);return;}
    }
    if(operation==='legato'){args.gapTicks=-Math.round(Number($('legato-gap').value)*midiContext.ppq);if(c.legatoOptionsSupported)args.betweenSelectedOnly=$('legato-selected-only').checked;}
    // Delete Doubles currently acts on the whole clip, explicitly visible in the form.
    if(operation==='removeDoubles')delete args.noteIds;
    const multi=$('midi-scope').value==='parts';
    if(multi&&(!multiPartMidiOperations.has(operation)||!midiContext.clipIds.length)){notify('지원하는 작업과 MIDI 클립 범위를 선택하세요.',true);return;}
    const commands=multi?planMidiPartCommands(midiContext.parts,operation,args,{splitMode:$('note-split-position').value,cursorTick:midiContext.cursorTick,locators:midiContext.locators}):null;
    if(multi&&!commands.length){notify('선택 파트 안에 적용할 분할 위치가 없습니다.',true);return;}
    const result=await runCommand(multi?'batch':operation==='repeatLoop'?'midi.part.repeatLoop':operation==='thinControllers'?'midi.controllers.thin':operation==='deleteControllers'?'midi.controllers.delete':`midi.notes.${operation}`,multi?{commands}:args,midiContext.revision);
    if(result){$('midi-tools-dialog').close();notify('MIDI 편집을 적용했습니다. 실행 취소로 이전 연주를 복원할 수 있습니다.');}
    else if(getContext().project.revision!==midiContext.revision){$('midi-tools-dialog').close();notify('프로젝트가 변경되었습니다. 최신 노트를 확인하고 MIDI 도구를 다시 열어주세요.',true);}
  });
  function mediaMessage(message,error=false){
    $('media-message').textContent=message;$('media-message').hidden=!message;
    $('media-message').classList.toggle('error',error);
  }
  async function loadMedia(){
    const request=++mediaRequest;
    $('media-content').textContent='미디어 파일과 내용 해시를 확인하는 중…';
    $('media-references').replaceChildren();
    try{
      const response=await fetch('/api/assets'),result=await response.json();
      if(request!==mediaRequest)return;
      if(!response.ok)throw new Error(result.errors?.map(e=>e.message).join(' · ')||'미디어 조회에 실패했습니다.');
      mediaResult=result;
      selectedAssetIds=new Set([...selectedAssetIds].filter(id=>result.assets.some(a=>a.id===id)));
      renderMedia();
    }catch(error){if(request===mediaRequest)$('media-content').textContent=error.message;}
  }
  function renderMedia(){
    if(!mediaResult)return;
    const filter=$('media-search').value.trim().toLocaleLowerCase(),assets=mediaResult.assets.filter(a=>a.name.toLocaleLowerCase().includes(filter));
    const stale=mediaResult.projectRevision!==getContext().project.revision;
    $('media-revision').textContent=`REV ${mediaResult.projectRevision} · ${mediaResult.assets.length} files${stale?' · 다시 검사 필요':''}`;
    $('media-content').innerHTML=assets.length?`<table class="media-table"><thead><tr><th>미디어</th><th>사용</th><th>상태</th><th>원본</th></tr></thead><tbody>${assets.map(asset=>`<tr data-asset-id="${escape(asset.id)}" class="${selectedAssetIds.has(asset.id)?'selected':''}"><td><button class="media-name" data-select-asset="${escape(asset.id)}" aria-pressed="${selectedAssetIds.has(asset.id)}">${escape(asset.name)}</button><small>${escape(asset.path)}<br>${asset.bytes===null||asset.bytes===undefined?'—':(asset.bytes/1024).toFixed(1)+' KiB'}</small></td><td>${asset.referenceCount}</td><td class="media-${asset.status}">${escape({ready:'정상',missing:'누락',changed:'내용 변경',unsafe:'경로 오류',unreadable:'읽기 실패'}[asset.status]||asset.status)}${asset.error?`<small>${escape(asset.error.message||asset.error)}</small>`:''}</td><td>${asset.status==='ready'?`<a href="/api/assets/${encodeURIComponent(asset.id)}/file" download>WAV ↓</a>`:['missing','changed'].includes(asset.status)?`<button class="secondary" data-restore-asset="${escape(asset.id)}">원본 찾아 복구</button>`:'—'}</td></tr>`).join('')}</tbody></table>`:'표시할 미디어가 없습니다.';
    const archives=(mediaResult.sourceArchives??[]).filter(a=>a.name.toLocaleLowerCase().includes(filter));
    if(archives.length)$('media-content').insertAdjacentHTML('beforeend',`<h3>변환 전 원본 보관</h3><p>AIFF/AIFC의 원래 파일과 메타데이터입니다. 편집·재생에는 위의 관리 WAV를 사용합니다.</p><table class="media-table"><thead><tr><th>원본</th><th>상태</th><th>파일</th></tr></thead><tbody>${archives.map(a=>`<tr><td>${escape(a.name)}<small>${escape(a.path)} · ${(a.bytes/1024).toFixed(1)} KiB</small></td><td>${escape(a.status==='ready'?'보관됨':a.status==='missing'?'누락':'검사 실패')}${a.error?`<small>${escape(a.error.message)}</small>`:''}</td><td>${a.status==='ready'?`<a href="/api/source-archives/${encodeURIComponent(a.id)}/file" download>원본 ↓</a>`:a.status==='missing'?`<button type="button" data-restore-source-archive="${escape(a.id)}">같은 원본 찾아 복구</button>`:'기존 파일 보존 · 덮어쓰기 안 함'}</td></tr>`).join('')}</tbody></table>`);
    renderReferences();update();
  }
  function renderReferences(){
    const assets=mediaResult?.assets.filter(a=>selectedAssetIds.has(a.id))??[];
    if(!assets.length){$('media-references').innerHTML='<p>미디어 이름을 선택하면 사용 중인 클립을 찾을 수 있습니다. Shift/⌘/Ctrl 클릭으로 여러 원본을 선택하세요.</p>';return;}
    const project=getContext().project,users=assets.flatMap(asset=>asset.users);
    $('media-references').innerHTML=`<h3>원본 ${assets.length}개 · 사용 중인 클립 ${users.length}개</h3>${users.length?`<button id="media-select-events" class="primary">사용 중인 클립 모두 선택</button><div class="media-reference-list">${users.map(user=>`<button class="secondary" data-reveal-clip="${escape(user.clipId)}" ${project.clips.some(c=>c.id===user.clipId)?'':'disabled'}>${escape(project.tracks.find(t=>t.id===user.trackId)?.name||'삭제된 트랙')} / ${escape(user.clipName)} ↗</button>`).join('')}</div>`:'<p>현재 프로젝트에서 사용하는 클립이 없습니다.</p>'}`;
  }
  $('media-content').addEventListener('click',event=>{
    const archiveId=event.target.closest('[data-restore-source-archive]')?.dataset.restoreSourceArchive;if(!archiveId||mediaBusy)return;
    const c=getContext();if(c.busy||!c.connected||c.project?.revision!==mediaResult?.projectRevision)return;
    sourceArchiveRestore={archiveId,documentId:c.documentId,revision:c.project.revision};$('source-archive-restore-file').value='';$('source-archive-restore-file').click();
  });
  $('source-archive-restore-file').addEventListener('cancel',()=>{sourceArchiveRestore=null;});
  $('source-archive-restore-file').addEventListener('change',async event=>{
    const file=event.target.files?.[0],draft=sourceArchiveRestore;sourceArchiveRestore=null;if(!file||!draft||mediaBusy)return;
    const c=getContext();if(c.busy||!c.connected||c.documentId!==draft.documentId||c.project?.revision!==draft.revision){mediaMessage('문서가 변경되었습니다. 원본 목록을 다시 검사하세요.',true);return;}
    if(file.size>128*1024*1024){mediaMessage('원본 파일은 128 MiB 이하여야 합니다.',true);return;}
    mediaBusy=true;update();
    try{await request(`/api/source-archives/${encodeURIComponent(draft.archiveId)}/restore?expectedRevision=${draft.revision}`,{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:file});mediaMessage('등록된 해시와 일치하는 원본을 복구했습니다.');await loadMedia();}catch(error){mediaMessage(error.message,true);}finally{mediaBusy=false;update();}
  });
  $('media-content').addEventListener('click',event=>{
    const selected=event.target.closest('[data-select-asset]')?.dataset.selectAsset;
    if(selected){
      if(event.shiftKey||event.metaKey||event.ctrlKey){if(selectedAssetIds.has(selected))selectedAssetIds.delete(selected);else selectedAssetIds.add(selected);}
      else selectedAssetIds=new Set([selected]);
      renderMedia();return;
    }
    const assetId=event.target.closest('[data-restore-asset]')?.dataset.restoreAsset;
    if(!assetId||mediaBusy)return;
    restoreContext={assetId,expectedRevision:mediaResult.projectRevision};
    $('media-restore-file').value='';$('media-restore-file').click();
  });
  $('media-references').addEventListener('click',event=>{
    if(event.target.closest('#media-select-events')){
      const ids=mediaResult.assets.filter(a=>selectedAssetIds.has(a.id)).flatMap(a=>a.users.map(u=>u.clipId));
      $('media-dialog').close();revealClips(ids);return;
    }
    const clipId=event.target.closest('[data-reveal-clip]')?.dataset.revealClip;
    if(!clipId)return;
    if(!getContext().project.clips.some(c=>c.id===clipId)){mediaMessage('클립이 변경되었습니다. 다시 검사하세요.',true);return;}
    $('media-dialog').close();revealClip(clipId);
  });
  $('media-restore-file').addEventListener('cancel',()=>{restoreContext=null;});
  $('media-restore-file').addEventListener('change',async event=>{
    const file=event.target.files?.[0],context=restoreContext;restoreContext=null;
    if(!file||!context||mediaBusy)return;
    mediaBusy=true;update();mediaMessage(`${file.name}을 원본과 대조하는 중…`);
    try{
      const result=await restoreAsset({...context,file});
      const message=result.status==='unchanged'?'이미 정상인 원본입니다.':`원본 WAV를 복구했습니다. 클립과 편집 내용은 유지됩니다.${result.preservedDamagedCopy?` 변경된 파일 보관: ${result.preservedDamagedCopy.path}`:''}`;
      mediaMessage(message);notify(message);selectedAssetIds=new Set([context.assetId]);await loadMedia();
    }catch(error){mediaMessage(error.message,true);notify(error.message,true);}
    finally{mediaBusy=false;event.target.value='';update();}
  });
  $('media-pool-button').addEventListener('click',()=>{
    selectedAssetIds=new Set(getContext().project.clips.filter(c=>getContext().selectedClipIds.has(c.id)&&c.type==='audio').map(c=>c.assetId));$('media-search').value='';mediaMessage('');
    $('media-dialog').showModal();loadMedia();
  });
  $('media-selected-clip').addEventListener('click',()=>{
    selectedAssetIds=new Set(getContext().project.clips.filter(c=>getContext().selectedClipIds.has(c.id)&&c.type==='audio').map(c=>c.assetId));$('media-search').value='';renderMedia();
    $('media-content').querySelector('tr.selected')?.scrollIntoView({block:'nearest'});
  });
  $('media-refresh').addEventListener('click',()=>{mediaMessage('');loadMedia();});$('media-search').addEventListener('input',renderMedia);
  $('bundle-download').addEventListener('click',()=>{notify('현재 프로젝트와 WAV 원본을 ZIP으로 모읍니다. 내용 검증이 끝나면 다운로드합니다.');download('/api/project/bundle',`${getContext().project.name}.newdaw.zip`);});
  return {update,setMidiInput,placeStepCursor,get stepCursorClickActive(){return $('step-input-dialog').open&&getContext().midiStepCursorClickSupported===true;},get stepMidiArmed(){return stepMidiArmed||noteInputUI.active;},mediaChanged(){if($('media-dialog').open)loadMedia();}};
}

/** Build one atomic batch; relative mode preserves offsets until a track reaches a limit. */
export function planTrackMix(tracks,{trackId,selectedIds=[],field,value,mode='single'}){
 if(!['gainDb','pan'].includes(field)||!['single','relative','same'].includes(mode)||!Number.isFinite(value))throw new Error('잘못된 믹서 조절 값입니다.');
 const focus=tracks.find(t=>t.id===trackId);if(!focus)throw new Error('대상 트랙이 없습니다.');
 const [min,max]=field==='gainDb'?[-60,12]:[-1,1];if(value<min||value>max)throw new Error('믹서 조절 범위를 벗어났습니다.');
 const selected=new Set(selectedIds),targets=mode!=='single'&&selected.has(trackId)?tracks.filter(t=>selected.has(t.id)):[focus];
 const delta=value-focus[field];
 return targets.map(track=>({command:'track.update',arguments:{trackId:track.id,[field]:mode==='relative'?Math.max(min,Math.min(max,Number((track[field]+delta).toFixed(10)))):value}}));
}

/** Move each selected run by one row while preserving both selected and unselected order. */
export function planTrackStep(tracks,selectedIds,direction){
 if(![-1,1].includes(direction))throw new Error('Invalid track move direction.');
 const ids=tracks.map(t=>t.id),selected=new Set(selectedIds),commands=[];
 for(let i=direction<0?1:ids.length-2;direction<0?i<ids.length:i>=0;i-=direction){
  const next=i+direction;
  if(selected.has(ids[i])&&!selected.has(ids[next])){
   commands.push({command:'track.reorder',arguments:{trackId:ids[i],index:next}});
   [ids[i],ids[next]]=[ids[next],ids[i]];
  }
 }
 return commands;
}

/** insertion is a boundary in the original visible order, before removing selected rows. */
export function planTrackDrop(tracks,selectedIds,insertion){
 if(!Number.isInteger(insertion)||insertion<0||insertion>tracks.length)throw new Error('Invalid track insertion.');
 const selected=new Set(selectedIds),original=tracks.map(t=>t.id),moving=original.filter(id=>selected.has(id));
 const remaining=original.filter(id=>!selected.has(id)),slot=original.slice(0,insertion).filter(id=>!selected.has(id)).length;
 const desired=[...remaining.slice(0,slot),...moving,...remaining.slice(slot)],working=[...original],commands=[];
 for(let index=0;index<desired.length;index++)if(working[index]!==desired[index]){
  const from=working.indexOf(desired[index]);working.splice(from,1);working.splice(index,0,desired[index]);
  commands.push({command:'track.reorder',arguments:{trackId:desired[index],index}});
 }
 return commands;
}


export function planMidiPartCommands(parts,operation,args,{splitMode='ticks',cursorTick=0,locators=null}={}){
 if(!multiPartMidiOperations.has(operation))throw new Error('Unsupported multi-part operation.');
 return parts.flatMap(part=>{
  const parameters={...args,clipId:part.id};delete parameters.noteIds;
  if(operation==='split'){
   const positions=splitMode==='cursor'?[cursorTick-part.startTick]:splitMode==='locators'?(locators?[locators.startTick-part.startTick,locators.endTick-part.startTick]:[]):args.atTicks;
   parameters.atTicks=[...new Set((positions??[]).filter(t=>Number.isSafeInteger(t)&&t>0&&t<part.lengthTicks))];
   if(!parameters.atTicks.length)return [];
  }
  return [{command:operation==='repeatLoop'?'midi.part.repeatLoop':operation==='thinControllers'?'midi.controllers.thin':operation==='deleteControllers'?'midi.controllers.delete':`midi.notes.${operation}`,arguments:parameters}];
 });

}

function setupNoteInputEditUI({getContext,runCommand,notify,selectNotes,beforeOpen}){
 const button=document.createElement('button');button.id='note-input-edit-open';button.type='button';button.textContent='선택 노트 MIDI 입력';button.hidden=true;document.getElementById('step-input-open').after(button);
 const dialog=document.createElement('dialog');dialog.id='note-input-edit-dialog';dialog.innerHTML=`<form id="note-input-edit-form"><h2>선택 노트 MIDI 입력</h2><p id="note-input-edit-target"></p><fieldset id="note-input-edit-fields"><label><input id="note-input-edit-pitch" type="checkbox" checked>음높이</label><label><input id="note-input-edit-on" type="checkbox">노트온 벨로시티</label><label><input id="note-input-edit-off" type="checkbox">노트오프 벨로시티</label><label>코드<select id="note-input-edit-mode"><option value="replace">선택 코드 교체</option><option value="add">선택 코드에 추가</option></select></label><label><input id="note-input-edit-next" type="checkbox" checked>적용 후 다음 시작 위치 선택</label><label>수동 음높이 · 쉼표 구분<input id="note-input-edit-pitches" value="60" required></label><label>벨로시티<input id="note-input-edit-velocity" type="number" min="1" max="127" value="90" required></label><label>노트오프 벨로시티<input id="note-input-edit-release" type="number" min="0" max="127" value="0" required></label><label>MIDI 수신 채널 1–16<input id="note-input-edit-channel" type="number" min="1" max="16" value="1" required></label><button type="submit">수동 값 적용</button></fieldset><button id="note-input-edit-arm" type="button">MIDI 입력 켜기</button><button id="note-input-edit-close" type="button">닫기</button><p id="note-input-edit-status" role="status">같은 시작 위치의 노트 또는 코드를 선택하세요. MIDI 키를 모두 놓으면 한 번 적용합니다.</p></form>`;document.body.append(dialog);
 const $=id=>document.getElementById(id);let draft=null,input=null,armed=false,saving=false,device=null,filter=null,unsub=null,unsubState=null;const held=new Map(),chord=new Map();
 const message=text=>{$('note-input-edit-status').textContent=text;};
 const disarm=(text='MIDI 입력 꺼짐')=>{armed=false;held.clear();chord.clear();$('note-input-edit-arm').textContent='MIDI 입력 켜기';message(text);};
 function valid(){const c=getContext();return draft&&c.documentId===draft.documentId&&c.project?.revision===draft.revision&&c.selectedClip===draft.clipId;}
 function update(){const c=getContext();button.hidden=!c.midiNoteInputEditSupported;button.disabled=c.busy||!c.connected||!c.selectedNoteIds?.size||c.project?.clips.find(x=>x.id===c.selectedClip)?.type!=='midi';if(armed&&!saving&&(!valid()||c.busy||!c.connected||c.recordingActive||!dialog.open))disarm('편집 상태가 바뀌었습니다. 다시 입력을 켜세요.');$('note-input-edit-fields').disabled=saving||held.size>0||!valid();$('note-input-edit-arm').disabled=saving||!valid()||!input?.connected||c.busy||c.recordingActive;}
 button.addEventListener('click',()=>{const c=getContext();if(button.disabled)return;beforeOpen();disarm();draft={documentId:c.documentId,revision:c.project.revision,clipId:c.selectedClip,noteIds:[...c.selectedNoteIds]};$('note-input-edit-target').textContent=`선택 ${draft.noteIds.length}음 · REV ${draft.revision}`;dialog.showModal();update();});
 async function apply(notes){const c=getContext(),snapshot=draft;if(saving||held.size||!valid()||c.busy||!c.connected)return;const next=$('note-input-edit-next').checked;saving=true;update();try{const result=await runCommand('midi.notes.inputValues',{clipId:snapshot.clipId,noteIds:snapshot.noteIds,notes,applyPitch:$('note-input-edit-pitch').checked,applyVelocity:$('note-input-edit-on').checked,applyReleaseVelocity:$('note-input-edit-off').checked,chordMode:$('note-input-edit-mode').value},snapshot.revision);if(!result){disarm('적용 실패 · 다시 입력을 켜세요.');return;}const now=getContext();if(now.documentId!==snapshot.documentId||!dialog.open){disarm();return;}const changes=result.changes.inputEdit,ids=next&&changes.nextNoteIds.length?changes.nextNoteIds:changes.noteIds;draft={...snapshot,revision:now.project.revision,noteIds:ids};selectNotes(ids);$('note-input-edit-target').textContent=`선택 ${ids.length}음 · REV ${draft.revision}`;message('적용 완료');if(next&&!changes.nextNoteIds.length)disarm('마지막 시작 위치까지 적용했습니다.');}catch(error){disarm('적용 실패');notify(error.message,true);}finally{saving=false;update();}}
 $('note-input-edit-form').addEventListener('submit',event=>{event.preventDefault();const pitches=$('note-input-edit-pitches').value.split(',').map(x=>Number(x.trim())),velocity=Number($('note-input-edit-velocity').value),releaseVelocity=Number($('note-input-edit-release').value);if(!pitches.length||pitches.length>128||pitches.some(p=>!Number.isInteger(p)||p<0||p>127)){notify('MIDI 음높이 0–127을 입력하세요.',true);return;}void apply(pitches.map(pitch=>({pitch,velocity,releaseVelocity})));});
 $('note-input-edit-close').addEventListener('click',()=>dialog.close());dialog.addEventListener('close',()=>{disarm();draft=null;});
 $('note-input-edit-arm').addEventListener('click',()=>{if(armed){disarm();update();return;}if(!valid()||!input?.connected)return;device=input.deviceId;filter=structuredClone(input.getFilter());armed=true;held.clear();chord.clear();$('note-input-edit-arm').textContent='MIDI 입력 끄기';message('키를 모두 놓으면 적용합니다.');update();});
 function setMidiInput(source){unsub?.();unsubState?.();disarm();input=source;unsubState=source.subscribeState(()=>{if(!source.connected||device!==source.deviceId)disarm('MIDI 장치가 바뀌었습니다.');update();});unsub=source.subscribe(({data,deviceId})=>{if(!armed||!dialog.open)return;const c=getContext();if(saving||c.busy||c.recordingActive||!valid()||deviceId!==device){disarm('입력 중 편집 상태가 바뀌었습니다.');return;}const type=data[0]&240,pitch=data[1];if((data[0]&15)!==Number($('note-input-edit-channel').value)-1||![128,144].includes(type)||!input.accepts(data,filter))return;if(type===144&&data[2]>0){held.set(pitch,(held.get(pitch)??0)+1);if(!chord.has(pitch))chord.set(pitch,{pitch,velocity:data[2],releaseVelocity:0});message(`${chord.size}음 · 모두 놓으면 적용`);}else if(held.has(pitch)){chord.get(pitch).releaseVelocity=type===128?(data[2]??0):0;const count=held.get(pitch)-1;if(count)held.set(pitch,count);else held.delete(pitch);if(!held.size){const notes=[...chord.values()];chord.clear();void apply(notes);}}update();});update();}
 return {update,setMidiInput,get active(){return armed||saving;}};
}
