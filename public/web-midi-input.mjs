/** Explicit browser-device connection. No MIDI access is requested before the connect click. */
export function setupBrowserMidiInput({notify=()=>{},filterSupported=false,onFilterChange=null,getContext=()=>({})}={}){
 const host=document.createElement('div');host.className='midi-input-controls';host.innerHTML='<button id="browser-midi-connect" type="button">MIDI 입력 연결</button><select id="browser-midi-device" aria-label="MIDI 입력 장치" disabled></select><details id="browser-midi-filter" hidden><summary>프로젝트 입력 필터</summary><label>채널<select id="browser-midi-filter-channel"><option value="all">전체</option></select></label><div id="browser-midi-filter-types"></div><button id="browser-midi-filter-reset" type="button">필터 초기화</button></details><label><input id="browser-midi-monitor" type="checkbox">내장 음원 모니터</label><label>모니터 dB<input id="browser-midi-level" type="number" min="-60" max="0" step="1" value="-18"></label><button id="browser-midi-panic" type="button">입력 음 정지</button><span id="browser-midi-status" role="status">연결 전 · SysEx 권한 미사용</span>';document.querySelector('#recording-panel').append(host);
 const $=id=>host.querySelector('#'+id),subscribers=new Set(),stateSubscribers=new Set();let access=null,input=null,generation=0,context=null,master=null,documentId=getContext().documentId;
 let playbackGeneration=0,recordingPlaybackNodes=[];
 const voices=new Set(),keys=new Map(),channels=Array.from({length:16},()=>createMidiMonitorChannel());
 let filterMatcher=null,filterLocked=false,lastProjectFilterKey=null,customChannels=[];
 function getFilter(){if(!filterSupported||!filterMatcher)return undefined;const value=$('browser-midi-filter-channel').value;return {channels:value==='all'?Array.from({length:16},(_,i)=>i):value==='custom'?[...customChannels]:[Number(value)],messageTypes:[...$('browser-midi-filter-types').querySelectorAll('input:checked')].map(i=>i.value)};}
 function syncProjectFilter(force=false){
  if(!filterMatcher||!onFilterChange||filterLocked&&!force)return;const c=getContext(),key=JSON.stringify([c.documentId,c.project?.midiInputFilter??null]);if(!force&&key===lastProjectFilterKey)return;lastProjectFilterKey=key;
  const filter=c.project?.midiInputFilter??{},channels=filter.channels??Array.from({length:16},(_,i)=>i);$('browser-midi-filter-channel').querySelector('[value="custom"]')?.remove();
  if(channels.length===16)$('browser-midi-filter-channel').value='all';else if(channels.length===1)$('browser-midi-filter-channel').value=String(channels[0]);else{customChannels=[...channels];$('browser-midi-filter-channel').add(new Option(channels.length?`Ch ${channels.map(c=>c+1).join(', ')}`:'채널 없음','custom'));$('browser-midi-filter-channel').value='custom';}
  for(const input of $('browser-midi-filter-types').querySelectorAll('input'))input.checked=!filter.messageTypes||filter.messageTypes.includes(input.value);
 }
 function setFilterLocked(locked){filterLocked=locked;const c=getContext();for(const element of $('browser-midi-filter').querySelectorAll('input,select,button'))element.disabled=locked||!!onFilterChange&&(!c.project||c.busy||!c.connected);if(!locked)syncProjectFilter();}
 async function persistFilter(reset=false){
  const c=getContext();if(filterLocked||c.busy){syncProjectFilter(true);return;}panic();
  if(!onFilterChange){if(reset){$('browser-midi-filter-channel').value='all';for(const input of $('browser-midi-filter-types').querySelectorAll('input'))input.checked=true;}return;}
  try{await onFilterChange(reset?null:getFilter(),c.project?.revision,c.documentId);}catch(error){notify(error.message,true);}finally{syncProjectFilter(true);setFilterLocked(filterLocked);}
 }
 if(filterSupported)void import('/media/midi-input-filter.mjs').then(module=>{filterMatcher=module.allowsMidiInput;for(let i=0;i<16;i++)$('browser-midi-filter-channel').add(new Option(`Ch ${i+1}`,String(i)));for(const [type,name] of [['note','노트'],['cc','CC'],['pitchBend','피치벤드'],['program','프로그램'],['channelPressure','채널 압력'],['polyPressure','폴리 압력']]){const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.value=type;input.checked=true;label.append(input,document.createTextNode(name));$('browser-midi-filter-types').append(label);}$('browser-midi-filter').hidden=false;$('browser-midi-filter').onchange=()=>void persistFilter();$('browser-midi-filter-reset').onclick=()=>void persistFilter(true);syncProjectFilter(true);setFilterLocked(filterLocked);}).catch(error=>{filterSupported=false;$('browser-midi-monitor').checked=false;$('browser-midi-monitor').disabled=true;panic();notify(`MIDI 필터 로딩 실패: ${error.message}`,true);});
 function release(voice,immediate=false){if(voice.released)return;voice.released=true;voices.delete(voice);const queue=keys.get(`${voice.channel}/${voice.pitch}`);if(queue){const index=queue.indexOf(voice);if(index>=0)queue.splice(index,1);if(!queue.length)keys.delete(`${voice.channel}/${voice.pitch}`);}const now=context.currentTime;voice.gain.gain.cancelScheduledValues(now);voice.gain.gain.setValueAtTime(voice.gain.gain.value,now);voice.gain.gain.linearRampToValueAtTime(0,now+(immediate ? 0.003 : 0.025));try{voice.osc.stop(now+(immediate ? 0.004 : 0.03));}catch{}}
 function panic(channel=null){for(const voice of [...voices])if(channel===null||voice.channel===channel)release(voice,true);for(let i=0;i<16;i++)if(channel===null||channel===i)channels[i]=createMidiMonitorChannel();}
 function emitState(){for(const callback of stateSubscribers)try{callback({connected:!!input,deviceId:input?.id??null});}catch(error){notify(error.message,true);}}
 function channelGain(channel){for(const voice of voices)if(voice.channel===channel)voice.gain.gain.setTargetAtTime(voice.velocity/127*.08*channels[channel].volume*channels[channel].expression,context.currentTime,.005);}
 function channelPitch(channel){for(const voice of voices)if(voice.channel===channel)voice.osc.frequency.setTargetAtTime(midiMonitorPitch(voice.pitch,channels[channel]),context.currentTime,.005);}
 function receive(event){
  const data=Array.from(event.data??[]);if(!data.length)return;const timestamp=Number.isFinite(event.timeStamp)?event.timeStamp:performance.now();
  for(const callback of subscribers)try{callback({data:[...data],timestamp,deviceId:input?.id??null});}catch(error){notify(error.message,true);}
  const status=data[0],type=status>>4,channel=status&15;if(status<128||status>=240)return;
  $('browser-midi-status').textContent=`${input?.name??'MIDI'} · Ch ${channel+1} · ${data.map(x=>x.toString(16).padStart(2,'0')).join(' ')}`;
  if(filterMatcher&&!filterMatcher(data,getFilter())){$('browser-midi-status').textContent+=' · 필터됨';return;}
  if(!$('browser-midi-monitor').checked||!context||context.state!=='running')return;
  const [_,first,value=0]=data,key=`${channel}/${first}`;
  if(type===9&&value>0){
   if(voices.size>=32)release(voices.values().next().value,true);
   const osc=context.createOscillator(),gain=context.createGain(),voice={osc,gain,channel,pitch:first,velocity:value,keyDown:true,released:false,sostenutoCaptured:false};osc.type='sine';osc.frequency.value=midiMonitorPitch(first,channels[channel]);gain.gain.setValueAtTime(0,context.currentTime);gain.gain.linearRampToValueAtTime(value/127*.08*channels[channel].volume*channels[channel].expression,context.currentTime+.004);osc.connect(gain);gain.connect(master);osc.onended=()=>{osc.disconnect();gain.disconnect();};voices.add(voice);if(!keys.has(key))keys.set(key,[]);keys.get(key).push(voice);osc.start();
  }else if(type===8||type===9&&value===0){const voice=keys.get(key)?.shift();if(voice){voice.keyDown=false;if(!midiMonitorVoiceHeld(channels[channel],voice))release(voice);}if(keys.get(key)?.length===0)keys.delete(key);}
  else if(type===14){channels[channel].bend=((first|(value<<7))-8192)/8192;channelPitch(channel);}
  else if(type===11){
   const actions=applyMidiMonitorCC(channels[channel],first,value);
   if(actions.captureSostenuto)for(const voice of voices)if(voice.channel===channel&&voice.keyDown)voice.sostenutoCaptured=true;
   if(actions.clearSostenuto)for(const voice of voices)if(voice.channel===channel)voice.sostenutoCaptured=false;
   if(actions.allSoundOff)for(const voice of [...voices])if(voice.channel===channel)release(voice,true);
   if(actions.allNotesOff){for(const key of [...keys.keys()])if(key.startsWith(`${channel}/`))keys.delete(key);for(const voice of [...voices])if(voice.channel===channel){voice.keyDown=false;if(!midiMonitorVoiceHeld(channels[channel],voice))release(voice);}}
   if(actions.releaseHeld)for(const voice of [...voices])if(voice.channel===channel&&!voice.keyDown&&!midiMonitorVoiceHeld(channels[channel],voice))release(voice);
   if(actions.gainChanged)channelGain(channel);if(actions.pitchChanged)channelPitch(channel);
  }
 }
 function listDevices(){const selected=input?.id??$('browser-midi-device').value;$('browser-midi-device').replaceChildren();for(const port of access?.inputs.values()??[])if(port.state==='connected')$('browser-midi-device').add(new Option(port.name??port.id,port.id));if([...$('browser-midi-device').options].some(o=>o.value===selected))$('browser-midi-device').value=selected;$('browser-midi-device').disabled=!access||!$('browser-midi-device').options.length;}
 function stopRecordingPlayback(){playbackGeneration++;for(const node of recordingPlaybackNodes){try{node.stop?.();}catch{}try{node.disconnect();}catch{}}recordingPlaybackNodes=[];}
 async function unlockAudio(){context??=new AudioContext();if(!master){master=context.createGain();master.connect(context.destination);}master.gain.value=10**(monitorDb()/20);await context.resume();}
 async function scheduleRecordingPlayback({backingBytes=null,countInBeats=0,beatSeconds=.5,beatsPerBar=4}={}){
  stopRecordingPlayback();const token=playbackGeneration;await unlockAudio();if(token!==playbackGeneration)return null;
  if(!Number.isInteger(countInBeats)||countInBeats<0||countInBeats>128||!Number.isFinite(beatSeconds)||beatSeconds<=0||countInBeats*beatSeconds>120)throw new Error('Invalid MIDI count-in');
  const buffer=backingBytes?await context.decodeAudioData(backingBytes.slice(0)):null;if(token!==playbackGeneration)return null;
  const when=context.currentTime+.08+countInBeats*beatSeconds,startTimestamp=performance.now()+(when-context.currentTime)*1000;
  if(buffer){const source=context.createBufferSource();source.buffer=buffer;source.connect(context.destination);source.start(when);recordingPlaybackNodes.push(source);}
  for(let i=0;i<countInBeats;i++){const osc=context.createOscillator(),env=context.createGain(),at=when-(countInBeats-i)*beatSeconds;osc.frequency.value=i%beatsPerBar===0?1500:1000;env.gain.setValueAtTime(.12,at);env.gain.exponentialRampToValueAtTime(.001,at+.04);osc.connect(env);env.connect(context.destination);osc.start(at);osc.stop(at+.05);osc.onended=()=>{osc.disconnect();env.disconnect();};recordingPlaybackNodes.push(osc,env);}
  return {startTimestamp,audioStartTime:when,clockPolicy:'WebAudio reservation mapped to performance clock; device latency compensation not applied'};
 }
 function monitorDb(){const text=$('browser-midi-level').value,value=Number(text);return text.trim()!==''&&Number.isFinite(value)?Math.max(-60,Math.min(0,value)):-18;}
 async function bindDevice(id){const token=++generation,prior=input;input=null;if(prior){prior.removeEventListener('midimessage',receive);await prior.close();}if(token!==generation)return;panic();emitState();const port=access?.inputs.get(id);if(!port||port.state!=='connected'){$('browser-midi-status').textContent='연결된 MIDI 입력 장치가 없습니다.';return;}await port.open();if(token!==generation){await port.close();return;}input=port;input.addEventListener('midimessage',receive);$('browser-midi-status').textContent=`${port.name??port.id} 입력 연결 · 모니터는 별도 선택`;emitState();}
 async function disconnect(){generation++;const prior=input;input=null;if(prior){prior.removeEventListener('midimessage',receive);await prior.close();}if(access)access.onstatechange=null;access=null;panic();stopRecordingPlayback();listDevices();$('browser-midi-connect').textContent='MIDI 입력 연결';$('browser-midi-status').textContent='MIDI 입력 연결 해제';emitState();}
 $('browser-midi-connect').onclick=async()=>{$('browser-midi-connect').disabled=true;try{if(access){await disconnect();return;}if(!navigator.requestMIDIAccess)throw new Error('이 브라우저는 Web MIDI 입력을 지원하지 않습니다.');access=await navigator.requestMIDIAccess({sysex:false});$('browser-midi-connect').textContent='MIDI 입력 연결 해제';access.onstatechange=()=>{if(input?.state==='disconnected'){const prior=input;input=null;prior.removeEventListener('midimessage',receive);panic();emitState();$('browser-midi-status').textContent='MIDI 장치 연결이 끊겼습니다.';}listDevices();};listDevices();await bindDevice($('browser-midi-device').value);}catch(error){notify(error.message,true);}finally{$('browser-midi-connect').disabled=false;}};
 $('browser-midi-device').onchange=()=>void bindDevice($('browser-midi-device').value).catch(error=>notify(error.message,true));
 $('browser-midi-monitor').onchange=async()=>{try{panic();if(!$('browser-midi-monitor').checked)return;await unlockAudio();}catch(error){$('browser-midi-monitor').checked=false;notify(error.message,true);}};
 $('browser-midi-level').oninput=()=>{if(master)master.gain.setTargetAtTime(10**(monitorDb()/20),context.currentTime,.01);};$('browser-midi-panic').onclick=()=>panic();
 window.addEventListener('beforeunload',()=>{void disconnect();void context?.close();});
 return {host,subscribe(callback){subscribers.add(callback);return()=>subscribers.delete(callback);},subscribeState(callback){stateSubscribers.add(callback);return()=>stateSubscribers.delete(callback);},getFilter,setFilterLocked,accepts:(data,filter)=>filterMatcher?filterMatcher(data,filter):true,panic,disconnect,unlockAudio,scheduleRecordingPlayback,stopRecordingPlayback,get connected(){return !!input;},get deviceId(){return input?.id??null;},update(){syncProjectFilter();setFilterLocked(filterLocked);const next=getContext().documentId;if(next!==documentId){documentId=next;panic();stopRecordingPlayback();}}};
}

/** Capture stays in memory until Stop; a portable command JSON is exposed before committing. */
export function setupBrowserMidiRecording(inputUI,{getContext,commitTake,stopPlayback,prepareBacking,notify,autoQuantizeSupported=false,onCommitted=()=>{}}){
 const host=document.createElement('span');host.className='browser-midi-recording';host.innerHTML='<select id="midi-record-mode" aria-label="MIDI 녹음 모드"><option value="new">새 파트</option><option value="merge">파트에 Merge</option><option value="replace">트랙 구간 Replace</option></select><select id="midi-record-part" aria-label="Merge 대상 파트" hidden></select><select id="midi-record-target" aria-label="MIDI 녹음 대상"><option value="">새 MIDI 트랙</option></select><input id="midi-record-name" aria-label="MIDI 테이크 이름" placeholder="MIDI 테이크 이름" maxlength="120"><span id="midi-record-autoq-controls" hidden><label><input id="midi-record-autoq" type="checkbox">자동 Q</label><select id="midi-record-autoq-grid" aria-label="녹음 자동 퀀타이즈 그리드"><option value="0.25">1/16</option><option value="0.5">1/8</option><option value="1">1/4</option><option value="2">1/2</option></select><label>강도 %<input id="midi-record-autoq-strength" type="number" min="0" max="100" step="1" value="100"></label></span><select id="midi-record-count-in" aria-label="MIDI 카운트인"><option value="0">카운트인 없음</option><option value="1">1마디 준비</option><option value="2">2마디 준비</option></select><label><input id="midi-record-backing" type="checkbox">반주 재생</label><select id="midi-take-import-position" aria-label="MIDI 테이크 복구 위치"><option value="original">JSON 원래 위치</option><option value="cursor">현재 커서 위치</option></select><button id="midi-take-history" type="button">보관된 테이크</button><button id="midi-take-import" type="button" title="현재 모드·대상을 사용해 저장된 입력 JSON 복구">테이크 JSON 복구</button><input id="midi-take-import-file" type="file" accept=".json,application/json" hidden><button id="midi-record-start" type="button">● MIDI 녹음</button><button id="midi-record-stop" type="button" disabled>테이크 저장</button><button id="midi-record-cancel" type="button" disabled>취소</button><span id="midi-record-mode-help"></span><span id="midi-record-status" role="status"></span><a id="midi-record-download" hidden>입력 JSON 보관</a>';inputUI.host.append(host);
 const $=id=>host.querySelector('#'+id);$('midi-record-autoq-controls').hidden=!autoQuantizeSupported;$('midi-record-autoq-grid').value=String(getContext().project?.snapGrid?.primary?.quarterNotes??.25);
 function quantizeOptions(){if(!autoQuantizeSupported||!$('midi-record-autoq').checked)return undefined;const strength=Number($('midi-record-autoq-strength').value)/100;if(!Number.isFinite(strength)||strength<0||strength>1)throw new Error('자동 Q 강도는 0~100%입니다.');return {gridTicks:Math.max(1,Math.round(getContext().project.ppq*Number($('midi-record-autoq-grid').value))),strength,origin:'project'};}
 const takeStore=createMidiTakeStore();
 let active=false,preparing=false,saving=false,generation=0,draft=null,messages=[],beganAt=0,timer=null,url=null,targetKey='',recoveryDraft=null,journal=null;
 function takeArguments(take,events,durationSeconds){return {...(take.inputFilter?{inputFilter:take.inputFilter}:{}),...(take.autoQuantize?{autoQuantize:take.autoQuantize}:{}),mode:take.mode,...(take.mode==='merge'?{targetClipId:take.targetClipId}:{}),name:take.name,startTick:take.startTick,durationSeconds,events,...(take.mode!=='merge'&&take.trackId?{trackId:take.trackId}:{})};}
 function takeMetadata(take){return {projectName:take.sourceProject.name,sourceProject:take.sourceProject,revision:take.revision,deviceId:take.deviceId};}
 function checkpoint(entry,duration){
  if(!entry)return Promise.resolve();const end=entry.source.length,seconds=Math.min(600,Math.max(.000001,duration,entry.source[end-1]?.timeSeconds??0));
  entry.queue=entry.queue.catch(()=>{}).then(async()=>{if(!end&&!entry.id)return;if(!entry.id)entry.id=await takeStore.begin(takeArguments(entry.draft,[],seconds),takeMetadata(entry.draft));const chunk=entry.source.slice(entry.cursor,end);await takeStore.append(entry.id,entry.sequence,chunk,seconds);entry.cursor=end;entry.savedThrough=seconds;if(chunk.length)entry.sequence++;});return entry.queue;
 }
 function update(){
  if(active||preparing||saving)document.querySelector('#recording-panel').open=true;
  const c=getContext(),locked=active||preparing||saving,key=JSON.stringify([c.documentId,c.project?.tracks.filter(t=>t.type==='midi').map(t=>[t.id,t.name]),c.project?.clips.filter(p=>p.type==='midi').map(p=>[p.id,p.name,p.trackId])]);
  inputUI.setFilterLocked(locked);
  if(!locked&&key!==targetKey){targetKey=key;const selected=$('midi-record-target').value;$('midi-record-target').replaceChildren(new Option('새 MIDI 트랙',''));for(const t of c.project?.tracks??[])if(t.type==='midi')$('midi-record-target').add(new Option(t.name,t.id));if([...$('midi-record-target').options].some(o=>o.value===selected))$('midi-record-target').value=selected;}
  if(!locked&&key!==$('midi-record-part').dataset.key){$('midi-record-part').dataset.key=key;const prior=$('midi-record-part').value;$('midi-record-part').replaceChildren();for(const p of c.project?.clips??[])if(p.type==='midi')$('midi-record-part').add(new Option(p.name,p.id));if([...$('midi-record-part').options].some(o=>o.value===(prior||c.selectedClip)))$('midi-record-part').value=prior||c.selectedClip;}
  $('midi-record-mode-help').textContent=$('midi-record-mode').value==='replace'?'Replace: 대상 트랙의 녹음 구간을 대체 · 구간 밖 보존 · Undo 가능':'';
  const merging=$('midi-record-mode').value==='merge';$('midi-record-mode').disabled=locked;$('midi-record-part').hidden=!merging;$('midi-record-part').disabled=locked||!merging;$('midi-record-target').hidden=merging;
  $('midi-take-history').disabled=locked||c.busy;$('midi-take-import').disabled=locked||!c.project||!c.connected||c.busy;$('midi-take-import-position').disabled=locked;
  for(const id of ['midi-record-autoq','midi-record-autoq-grid','midi-record-autoq-strength'])$(id).disabled=locked;
  $('midi-record-target').disabled=locked;$('midi-record-name').disabled=locked;$('midi-record-count-in').disabled=locked;$('midi-record-backing').disabled=locked;$('midi-record-start').disabled=locked||!inputUI.connected||!c.project||!c.connected||c.busy||merging&&!$('midi-record-part').value||$('midi-record-mode').value==='replace'&&!$('midi-record-target').value;$('midi-record-stop').disabled=!active;$('midi-record-cancel').disabled=!active&&!preparing;
  if(active&&c.documentId!==draft.documentId)void finish(false,'문서가 바뀜 · JSON을 보관하세요.');
 }
 async function finish(shouldCommit=true,reason=''){
  if(!active)return;active=false;saving=true;clearInterval(timer);timer=null;update();inputUI.panic();inputUI.stopRecordingPlayback();
  try{
   const durationSeconds=Math.min(600,Math.max(.000001,(performance.now()-beganAt)/1000,...messages.slice(-1).map(e=>e.timeSeconds))),args=takeArguments(draft,messages,durationSeconds);
   if(url)URL.revokeObjectURL(url);url=URL.createObjectURL(new Blob([JSON.stringify(args,null,2)],{type:'application/json'}));const link=$('midi-record-download');link.href=url;link.download=`${draft.name.replace(/[\\/]/g,'_')}.midi-take.json`;link.hidden=false;
   let localTakeId=null;if(messages.length)try{if(journal){await checkpoint(journal,durationSeconds);if(journal.id&&journal.cursor===messages.length){await takeStore.complete(journal.id,durationSeconds);localTakeId=journal.id;}}if(!localTakeId)localTakeId=await takeStore.save(args,takeMetadata(draft));}catch(error){try{localTakeId=await takeStore.save(args,takeMetadata(draft));}catch(saveError){notify(`브라우저 원본 보관 실패: ${saveError.message}. 입력 JSON을 내려받으세요.`,true);}}
   const c=getContext();if(!shouldCommit||c.documentId!==draft.documentId||c.project?.revision!==draft.revision){$('midi-record-status').textContent=reason||'프로젝트 변경 · 입력 JSON을 보관하세요.';return;}
   if(!messages.some(message=>inputUI.accepts(message.data,draft.inputFilter))){$('midi-record-status').textContent='필터를 통과한 입력 없음 · 원본 보관';return;}
   if(!messages.length){$('midi-record-status').textContent='입력 메시지가 없어 프로젝트를 바꾸지 않았습니다.';return;}
   $('midi-record-status').textContent='MIDI 테이크 저장 중…';const result=await commitTake(args,draft.revision);if(!result)throw new Error('테이크를 저장하지 못했습니다. 입력 JSON을 보관하세요.');if(localTakeId)try{await takeStore.markCommitted(localTakeId,result.changes?.recording?.clipId);}catch(error){notify(`테이크 적용은 완료됐지만 보관 상태 갱신 실패: ${error.message}`,true);}await onCommitted(result);$('midi-record-status').textContent=`저장 완료 · ${messages.length} 입력 메시지`;
  }catch(error){notify(error.message,true);$('midi-record-status').textContent='저장 실패 · 입력 JSON을 보관하세요.';}finally{messages=[];journal=null;saving=false;update();}
 }
 inputUI.subscribe(message=>{
  if(!active||message.deviceId!==draft.deviceId||message.data[0]<128||message.data[0]>=240)return;
  const elapsed=(message.timestamp-beganAt)/1000;if(elapsed<0)return;if(elapsed>600){void finish();return;}
  messages.push({timeSeconds:elapsed,data:message.data});if(messages.length>=180000)void finish();
 });
 inputUI.subscribeState(state=>{if(active&&(!state.connected||state.deviceId!==draft.deviceId))void finish(false,'입력 장치 변경 · JSON을 보관하세요.');update();});
 $('midi-record-start').onclick=async()=>{
  const c=getContext();if(active||preparing||saving||c.busy||!c.connected||!inputUI.connected||!c.project)return;let autoQuantize;try{autoQuantize=quantizeOptions();}catch(error){notify(error.message,true);return;}const token=++generation;preparing=true;draft={inputFilter:inputUI.getFilter(),sourceProject:{id:c.project.id,name:c.project.name,ppq:c.project.ppq,tempoMap:structuredClone(c.project.tempoMap)},autoQuantize,mode:$('midi-record-mode').value,targetClipId:$('midi-record-part').value,backing:$('midi-record-backing').checked,countInBars:Number($('midi-record-count-in').value),documentId:c.documentId,revision:c.project.revision,deviceId:inputUI.deviceId,trackId:$('midi-record-target').value,name:$('midi-record-name').value.trim()||`MIDI Take ${new Date().toISOString().replace(/[:.]/g,'-')}`,startTick:Math.max(0,Math.round(c.cursorTick??0))};update();
  try{
   await inputUI.unlockAudio();await stopPlayback();if(token!==generation)return;
   let latest=getContext();if(latest.documentId!==draft.documentId||latest.project?.revision!==draft.revision||inputUI.deviceId!==draft.deviceId)throw new Error('프로젝트 또는 입력 장치가 바뀌었습니다. 다시 시작하세요.');
   let backingBytes=null;if(draft.backing){$('midi-record-status').textContent='MIDI 반주 준비 중…';if(!prepareBacking)throw new Error('반주 준비 경로가 없습니다.');const backing=await prepareBacking();if(token!==generation)return;backingBytes=backing.bytes;}
   latest=getContext();if(latest.documentId!==draft.documentId||latest.project?.revision!==draft.revision||inputUI.deviceId!==draft.deviceId)throw new Error('준비 중 프로젝트 또는 장치가 바뀌었습니다.');
   const project=latest.project,bpm=(project.tempoMap.filter(p=>p.tick<=draft.startTick).at(-1)??project.tempoMap[0]).bpm,scheduled=await inputUI.scheduleRecordingPlayback({backingBytes,countInBeats:draft.countInBars*project.timeSignature.numerator,beatSeconds:60/bpm*4/project.timeSignature.denominator,beatsPerBar:project.timeSignature.numerator});
   if(token!==generation||!scheduled)return;
   messages=[];beganAt=scheduled.startTimestamp;journal={id:null,cursor:0,sequence:0,queue:Promise.resolve(),source:messages,draft,lastCheckpoint:0,warned:false};active=true;$('midi-record-status').textContent=draft.countInBars?'MIDI 준비 중…':'MIDI 녹음 중';timer=setInterval(()=>{if(!active)return;const seconds=(performance.now()-beganAt)/1000;$('midi-record-status').textContent=seconds<0?`준비 · ${(-seconds).toFixed(1)}초`:`MIDI ${seconds.toFixed(1)}초 · ${messages.length} 메시지${journal.savedThrough?` · 보관 ${journal.savedThrough.toFixed(0)}초`:' · 보관 대기'}`;if(seconds>=600)void finish();else if(seconds>=0&&seconds-journal.lastCheckpoint>=5){const entry=journal;entry.lastCheckpoint=seconds;void checkpoint(entry,seconds).catch(error=>{if(!entry.warned){entry.warned=true;notify(`MIDI 체크포인트 보관 실패: ${error.message}. 녹음 중 원본은 메모리에 유지됩니다.`,true);}});}},100);
  }
  catch(error){if(token===generation)inputUI.stopRecordingPlayback();notify(error.message,true);}finally{if(token===generation)preparing=false;update();}
 };
 $('midi-take-import').onclick=()=>{const c=getContext();if(active||preparing||saving||c.busy||!c.project||!c.connected)return;let autoQuantize;try{autoQuantize=quantizeOptions();}catch(error){notify(error.message,true);return;}recoveryDraft={inputFilter:inputUI.getFilter(),autoQuantize,documentId:c.documentId,revision:c.project.revision,cursorTick:Math.max(0,Math.round(c.cursorTick??0)),position:$('midi-take-import-position').value,mode:$('midi-record-mode').value,trackId:$('midi-record-target').value,targetClipId:$('midi-record-part').value};$('midi-take-import-file').value='';$('midi-take-import-file').click();};
 $('midi-take-import-file').onchange=async()=>{
  const file=$('midi-take-import-file').files?.[0],target=recoveryDraft;if(!file||!target)return;if(file.size>32*1024*1024){notify('테이크 JSON은 32 MiB 이하여야 합니다.',true);return;}saving=true;update();
  try{
   const source=JSON.parse(await file.text());if(!source||Array.isArray(source)||typeof source!=='object'||Object.keys(source).some(k=>!['inputFilter','autoQuantize','mode','targetClipId','trackId','clipId','name','startTick','durationSeconds','events'].includes(k))||!Array.isArray(source.events))throw new Error('MIDI 테이크 명령 JSON이 아닙니다.');
   const c=getContext();if(c.documentId!==target.documentId||c.project?.revision!==target.revision)throw new Error('파일을 고르는 사이 프로젝트가 바뀌었습니다. 다시 복구하세요.');
   if(target.mode==='merge'&&!target.targetClipId)throw new Error('Merge 대상 파트를 선택하세요.');if(target.mode==='replace'&&!target.trackId)throw new Error('Replace 대상 MIDI 트랙을 선택하세요.');
   const args={...(target.inputFilter?{inputFilter:target.inputFilter}:{}),...(target.autoQuantize?{autoQuantize:target.autoQuantize}:{}),mode:target.mode,name:source.name??file.name.replace(/\.json$/i,''),startTick:target.position==='cursor'?target.cursorTick:source.startTick,durationSeconds:source.durationSeconds,events:source.events,...(target.mode==='merge'?{targetClipId:target.targetClipId}:target.trackId?{trackId:target.trackId}:{})};
   const result=await commitTake(args,target.revision);if(!result)throw new Error('JSON 테이크를 적용하지 못했습니다. 원본 파일은 유지됩니다.');await onCommitted(result);$('midi-record-status').textContent='JSON 테이크 복구 완료';
  }catch(error){notify(error.message,true);$('midi-record-status').textContent='JSON 테이크 복구 실패 · 원본 파일 유지';}finally{saving=false;update();}
 };
 const historyDialog=document.createElement('dialog');historyDialog.id='midi-take-recovery-dialog';historyDialog.innerHTML='<div class="dialog-heading"><h2>보관된 MIDI 입력 테이크</h2><button id="midi-take-history-close" type="button">닫기</button></div><p>이 브라우저·앱 주소의 로컬 보관입니다. 복구는 현재 녹음 모드·대상·위치·자동 Q 설정을 사용합니다. JSON 다운로드로 별도 보관할 수 있습니다.</p><div id="midi-take-history-list"></div>';document.body.append(historyDialog);historyDialog.querySelector('#midi-take-history-close').onclick=()=>historyDialog.close();
 async function renderTakeHistory(){
  const list=historyDialog.querySelector('#midi-take-history-list');list.textContent='보관 목록 읽는 중…';const records=await takeStore.list();list.replaceChildren();if(!records.length){list.textContent='보관된 테이크가 없습니다.';return;}
  for(const record of records){const row=document.createElement('div');row.className='midi-take-history-row';const label=document.createElement('span');label.textContent=`${record.name} · ${record.messages} 메시지 · ${({committed:'프로젝트 반영됨',pending:'미반영',recording:'중간 체크포인트',cancelled:'취소된 중간본'})[record.status]??record.status} · ${record.projectName} · ${new Date(record.capturedAt).toLocaleString()}`;row.append(label);for(const [action,text] of [['restore','현재 설정으로 복구'],['download','JSON 다운로드'],['remove','보관 삭제']]){const button=document.createElement('button');button.type='button';button.dataset.takeId=record.id;button.dataset.takeAction=action;button.textContent=text;if(action==='restore'&&!record.messages)button.disabled=true;row.append(button);}list.append(row);}
 }
 $('midi-take-history').onclick=()=>{historyDialog.showModal();void renderTakeHistory().catch(error=>{historyDialog.querySelector('#midi-take-history-list').textContent=error.message;notify(error.message,true);});};
 historyDialog.addEventListener('click',async event=>{
  const button=event.target.closest('[data-take-action]');if(!button||active||preparing||saving)return;const id=button.dataset.takeId,action=button.dataset.takeAction;
  try{
   if(action==='remove'){await takeStore.remove(id);await renderTakeHistory();return;}
   const c=getContext(),target={documentId:c.documentId,revision:c.project?.revision,cursorTick:Math.max(0,Math.round(c.cursorTick??0)),position:$('midi-take-import-position').value,mode:$('midi-record-mode').value,trackId:$('midi-record-target').value,targetClipId:$('midi-record-part').value,autoQuantize:action==='restore'?quantizeOptions():undefined,inputFilter:inputUI.getFilter()},record=await takeStore.get(id);if(!record)throw new Error('보관된 테이크가 없습니다.');if(action==='restore'&&record.recoveryStatus==='recording'&&Date.now()-Date.parse(record.checkpointUpdatedAt)<15000)throw new Error('최근 갱신된 녹음 체크포인트입니다. 녹음 정지 후 복구하세요.');
   if(action==='download'){const href=URL.createObjectURL(new Blob([JSON.stringify(record.args,null,2)],{type:'application/json'})),anchor=document.createElement('a');anchor.href=href;anchor.download=`${(record.args.name??'MIDI Take').replace(/[\\/]/g,'_')}.midi-take.json`;anchor.click();setTimeout(()=>URL.revokeObjectURL(href),10000);return;}
   if(!c.project||!c.connected||c.busy)throw new Error('프로젝트를 열고 연결한 뒤 복구하세요.');saving=true;update();
   const latest=getContext();if(latest.documentId!==target.documentId||latest.project?.revision!==target.revision)throw new Error('복구 준비 중 프로젝트가 바뀌었습니다.');if(target.mode==='merge'&&!target.targetClipId)throw new Error('Merge 대상 파트를 선택하세요.');if(target.mode==='replace'&&!target.trackId)throw new Error('Replace 대상 트랙을 선택하세요.');
   const source=record.args,args={...(target.inputFilter?{inputFilter:target.inputFilter}:{}),mode:target.mode,name:source.name,startTick:target.position==='cursor'?target.cursorTick:source.startTick,durationSeconds:source.durationSeconds,events:source.events,...(target.autoQuantize?{autoQuantize:target.autoQuantize}:{}),...(target.mode==='merge'?{targetClipId:target.targetClipId}:target.trackId?{trackId:target.trackId}:{})};
   const result=await commitTake(args,target.revision);if(!result)throw new Error('테이크 복구 실패. 보관 원본은 유지됩니다.');try{if(record.recoveryStatus!=='recording')await takeStore.markCommitted(id,result.changes?.recording?.clipId);}catch(error){notify(`프로젝트 복구는 완료됐지만 보관 상태 갱신 실패: ${error.message}`,true);}await onCommitted(result);historyDialog.close();$('midi-record-status').textContent='보관된 테이크 복구 완료';
  }catch(error){notify(error.message,true);}finally{saving=false;update();}
 });
 $('midi-record-mode').onchange=update;
 $('midi-record-stop').onclick=()=>void finish();$('midi-record-cancel').onclick=()=>{generation++;active=preparing=false;const prior=journal,cancelledDuration=Math.min(600,Math.max(.000001,(performance.now()-beganAt)/1000,prior?.source.at(-1)?.timeSeconds??0));journal=null;if(prior)void prior.queue.catch(()=>{}).then(()=>prior.id?takeStore.complete(prior.id,cancelledDuration,'cancelled'):null).catch(error=>notify(error.message,true));messages=[];clearInterval(timer);timer=null;inputUI.panic();inputUI.stopRecordingPlayback();void stopPlayback();$('midi-record-status').textContent='MIDI 녹음 취소';update();};
 window.addEventListener('beforeunload',event=>{if(active||preparing||saving){event.preventDefault();event.returnValue='';}});update();
 return {update,get active(){return active||preparing||saving;}};
}

/** Immutable raw takes plus small list metadata; no device access and no automatic eviction. */
export function createMidiTakeStore(){
 let connection=null;
 function open(){
  if(connection)return connection;
  connection=new Promise((resolve,reject)=>{if(!globalThis.indexedDB){reject(new Error('브라우저 테이크 저장소를 사용할 수 없습니다.'));return;}const request=indexedDB.open('newdaw-midi-take-recovery',2);let settled=false;
   request.onupgradeneeded=()=>{for(const name of ['takes','summaries'])if(!request.result.objectStoreNames.contains(name))request.result.createObjectStore(name,{keyPath:'id'});if(!request.result.objectStoreNames.contains('chunks')){const chunks=request.result.createObjectStore('chunks',{keyPath:['takeId','sequence']});chunks.createIndex('takeId','takeId');}};
   request.onerror=()=>{settled=true;reject(request.error);};request.onblocked=()=>{settled=true;reject(new Error('다른 창이 테이크 저장소 갱신을 막고 있습니다.'));};request.onsuccess=()=>{if(settled){request.result.close();return;}const db=request.result;db.onversionchange=()=>{db.close();connection=null;};resolve(db);};}).catch(error=>{connection=null;throw error;});return connection;
 }
 async function transaction(names,mode,work){const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction(names,mode);let result;const fail=error=>{reject(error);tx.abort();};tx.oncomplete=()=>resolve(result);tx.onabort=tx.onerror=()=>reject(tx.error??new Error('테이크 저장소 작업 실패'));try{work(tx,value=>{result=value;},fail);}catch(error){fail(error);}});}
 async function save(args,metadata={},chunked=false){const id=crypto.randomUUID(),capturedAt=new Date().toISOString(),summary={id,capturedAt,updatedAt:capturedAt,name:args.name??'MIDI Take',messages:chunked?0:args.events.length,durationSeconds:args.durationSeconds,status:chunked?'recording':'pending',projectName:metadata.projectName??'',sourceRevision:metadata.revision??null};await transaction(['takes','summaries'],'readwrite',tx=>{tx.objectStore('takes').put({id,args:chunked?{...args,events:[]}:args,metadata,capturedAt,chunked});tx.objectStore('summaries').put(summary);});return id;}
 function updateSummary(id,values){return transaction(['summaries'],'readwrite',tx=>{const store=tx.objectStore('summaries'),request=store.get(id);request.onsuccess=()=>{if(request.result)store.put({...request.result,...values,updatedAt:new Date().toISOString()});};});}
 return {
  save:(args,metadata)=>save(args,metadata),begin:(args,metadata)=>save(args,metadata,true),
  append:(id,sequence,events,durationSeconds)=>transaction(['takes','summaries','chunks'],'readwrite',(tx,set,fail)=>{const header=tx.objectStore('takes').get(id);header.onsuccess=()=>{if(!header.result?.chunked){fail(new Error('녹음 체크포인트 원본이 없습니다.'));return;}const summaries=tx.objectStore('summaries'),request=summaries.get(id);request.onsuccess=()=>{if(!request.result){fail(new Error('녹음 체크포인트 목록이 없습니다.'));return;}if(events.length)tx.objectStore('chunks').add({takeId:id,sequence,events});summaries.put({...request.result,messages:request.result.messages+events.length,durationSeconds,updatedAt:new Date().toISOString()});};};}),
  complete:(id,durationSeconds,status='pending')=>updateSummary(id,{durationSeconds,status}),
  list:()=>transaction(['summaries'],'readonly',(tx,set)=>{const request=tx.objectStore('summaries').getAll();request.onsuccess=()=>set(request.result.sort((a,b)=>b.capturedAt.localeCompare(a.capturedAt)));}),
  get:id=>transaction(['takes','summaries','chunks'],'readonly',(tx,set)=>{const request=tx.objectStore('takes').get(id);request.onsuccess=()=>{const record=request.result;if(!record?.chunked){set(record);return;}let summary=null,chunks=null;const finish=()=>{if(summary&&chunks)set({...record,recoveryStatus:summary.status,checkpointUpdatedAt:summary.updatedAt,args:{...record.args,durationSeconds:summary.durationSeconds,events:chunks.sort((a,b)=>a.sequence-b.sequence).flatMap(c=>c.events)}});};const meta=tx.objectStore('summaries').get(id);meta.onsuccess=()=>{summary=meta.result;finish();};const data=tx.objectStore('chunks').index('takeId').getAll(id);data.onsuccess=()=>{chunks=data.result;finish();};};}),
  markCommitted:(id,clipId)=>updateSummary(id,{status:'committed',clipId}),
  remove:id=>transaction(['takes','summaries','chunks'],'readwrite',(tx,set,fail)=>{const request=tx.objectStore('summaries').get(id);request.onsuccess=()=>{if(request.result?.status==='recording'&&Date.now()-Date.parse(request.result.updatedAt)<15000){fail(new Error('최근 갱신된 녹음 체크포인트입니다. 녹음을 정지한 뒤 삭제하세요.'));return;}tx.objectStore('takes').delete(id);tx.objectStore('summaries').delete(id);tx.objectStore('chunks').delete(IDBKeyRange.bound([id,0],[id,Number.MAX_SAFE_INTEGER]));};})
 };
}

/** Pure controller state shared by live-monitor handlers and focused checks. */
export function createMidiMonitorChannel(){return {sustain:false,sostenuto:false,bend:0,semitones:2,cents:0,volume:1,expression:1,selector:null,rpnMSB:127,rpnLSB:127};}
export function midiMonitorVoiceHeld(channel,voice){return channel.sustain||channel.sostenuto&&voice.sostenutoCaptured;}
export function midiMonitorPitch(pitch,channel){return 440*2**((pitch-69+channel.bend*(channel.semitones+channel.cents/100))/12);}
export function applyMidiMonitorCC(channel,controller,value){
 const actions={};
 if(controller===64){channel.sustain=value>=64;actions.releaseHeld=!channel.sustain;}
 else if(controller===66){const next=value>=64;actions.captureSostenuto=next&&!channel.sostenuto;actions.clearSostenuto=!next;actions.releaseHeld=!next;channel.sostenuto=next;}
 else if(controller===7||controller===11){channel[controller===7?'volume':'expression']=value/127;actions.gainChanged=true;}
 else if(controller===101||controller===100){channel[controller===101?'rpnMSB':'rpnLSB']=value;channel.selector=channel.rpnMSB===127&&channel.rpnLSB===127?null:'rpn';}
 else if(controller===99||controller===98)channel.selector='nrpn';
 else if((controller===6||controller===38)&&channel.selector==='rpn'&&channel.rpnMSB===0&&channel.rpnLSB===0){channel[controller===6?'semitones':'cents']=value;actions.pitchChanged=true;}
 else if(controller===120)actions.allSoundOff=true;
 else if(controller===123||controller>=124&&controller<=127)actions.allNotesOff=true;
 else if(controller===121){channel.sustain=channel.sostenuto=false;channel.bend=0;channel.expression=1;channel.selector=null;channel.rpnMSB=channel.rpnLSB=127;actions.clearSostenuto=actions.releaseHeld=actions.pitchChanged=actions.gainChanged=true;}
 return actions;
}
