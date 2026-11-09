const audioLaneViews=new Map();
let audioOverlapFrontSupported=false;
let trackFoldersSupported=false,trackFoldersUI=null;
let defaultTrackTimeBaseSupported=false;
let midiLinearAffineCurvesSupported=false;
let midiTrackTimeBaseSupported=false;
let audioTrackTimeBaseSupported=false;
let audioTempoFromEventSupported=false,tempoFromAudioModule=null,tempoFromAudioLoading=false;
let tempoCursorChangeSupported=false;
let tapTempoUI=null,tapTempoLoading=false,lastPlaybackStartTick=null,lastPlaybackDocumentId=null;
let midiStepCursorClickSupported=false;
let midiNoteInputEditSupported=false;
let stepInputCursor=null;
let midiStepCursorNavigationSupported=false;
let midiPartStartResizeSupported=false;
let midiImportSinglePartSupported=false;
let midiImportLocatorSupported=false;
let midiImportDissolveSupported=false;
let midiImportInspectorSupported=false;
let midiImportTimingSupported=false;
let clipGroupMuteSupported=false;
let automaticEffectTailSupported=false,delayTailEstimator=null,delayTailLoading=false;
const effectClipboard={pre:null,eq:null,delay:null};
let trackEffectTransferSupported=false,effectPresetsSupported=false,effectPresetSelection='';
let eqGraphOverlay=null;
let trackPreFilterBypassSupported=false;
let trackPreSupported=false,trackPreFiltersSupported=false,preEffectTransferSupported=false;
let noteAuditionTrackEffectsSupported=false;
let trackEqSupported=false,trackEqTypesSupported=false,trackEqGraphSupported=false,eqGraphModule=null,eqGraphLoading=false,eqGraphDragging=false;
let trackDelaySupported=false,trackDelayFiltersSupported=false,trackDelaySyncSupported=false;
let clipClipboard=null,clipSnapshotPasteSupported=false;
let moveClipsTrackDraft=null;
let repeatClipsDraft=null;
let midiExportDraft=null,midiExportDownloading=false;
let midiTrackExportSupported=false;
import {setupMetronome} from './metronome.mjs';
import {setupRecording} from './recording-ui.mjs';
import {setupI18n,applyLanguage} from './i18n.mjs';
import {navigateNoteSelection,selectNotePitch,selectNoteMenu} from './note-keyboard-selection.mjs';
import {compileEditorSnap,resolveSnapGrid} from '/media/snap-grid.mjs';
import {setupSnapGridSettings} from './snap-grid-settings.mjs';
import {assignAudioEventLanes,compileEditorGeometry,playbackFollowScroll,selectProjectClips,parseClipClipboard,planAudioSlip,planAudioTrim,snapAudioEventStart,planZeroCrossingSplits,planZeroCrossingBoundarySplits,refineZeroCrossingTrims,repeatedSplitTicks,planAudioStretchResize,planMidiPartEndResize,planMidiPartStartResize,sortProjectMarkers,navigateMarkerRows,resolveMarkerListView,recoverMarkerRowFocus} from '/media/editor-geometry.mjs';
import {compileTempoMap} from '/media/time.mjs';
import {setupTimeDisplaySettings} from './time-display-settings.mjs';
import {setupInspectorTime} from './inspector-time.mjs';
import {setupMusicalTimeDisplay} from './musical-time-display.mjs';
import {setupTimingSettings,readTimingProfile} from './timing-settings.mjs';
import {setupResetSettings} from './reset-settings.mjs';
import {setupNativeMidi} from './native-midi.mjs';
import {setupNativeAudio} from './native-audio.mjs';
import {setupAudioUnits} from './audio-units.mjs';
import {setupChaseSettings,readChaseProfile} from './chase-settings.mjs';
import {setupMidiMerge} from './midi-merge.mjs';
import {setupMidiModifiers} from './midi-modifiers.mjs';
import { setupControllerLanes } from './controller-lanes.mjs';
import { setupMidiEventsUI } from './midi-events.mjs';
import { setupEditingUI, planTrackMix, planTrackStep, planTrackDrop } from './editing.mjs';
let mixExportDitherSeed=0x6d2b79f5;
let stemSplitSupported=false;
let renderTrackSelectionSupported=false;
let legatoOptionsSupported=false;
let soloDefeatSupported=false;
let globalMuteSoloSupported=false;
let trackRenameClipsSupported=false;
let removeTracksDraft=null;
let importBatchCancelled=false,importReportUrl=null;
let importOptionsDraft=null,importFileDraft=null,wavImportTargetSupported=false;
let mixExportDraft=null,renderMaxSeconds=120;
let wavExportFormats=[],wavExportChannelModes=[];
let audioSilenceSupported=false;
let cutClipsAtCursorSupported=false;
let splitClipsRangeSupported=false,splitRepeatDraft=null;
let audioDcCorrectionSupported=false;
let splitClipsAtCursorSupported=false;
let audioStatisticsSupported=false;
let clipNudgeSupported=false;
let clipCopyToSupported=false;
let projectMarkersSupported=false,markerDraft=null,markerListContext=null;
let audioTrimSupported=false;
let audioRangeFadesSupported=false;
let aiffImportSupported=false;
let wavUploadLimit=32*1024*1024,midiUploadLimit=32*1024*1024;
let audioBulkFadesSupported=false;
let audioVolumeEnvelopeSupported=false;
let audioFadeShapesSupported=false;
let explicitSplitClipIdsSupported=false,audioResizeMovesContentsSupported=false;
let audioProcessingRestoreSupported=false,audioTimeStretchBatchSupported=false;
let audioTimeStretchSupported=false,stretchRequest=null;
let audioZeroCrossingSupported=false,audioZeroCrossingTrimSupported=false;
let audioEventSnapPointSupported=false,audioSnapPointPasteSupported=false;
let audioSlipSupported=false,audioCrossfadeSupported=false;
let audioFadeSupported=false,locatorCycleSupported=false,audioNormalizeSupported=false;
const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = (prefix) => `${prefix}-${crypto.randomUUID()}`;
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const palette = ['#b6edc4', '#efab76', '#a7c4ed', '#d3b4e8', '#edce8c'];
const color = (track) => /^#[0-9a-f]{6}$/i.test(track?.color ?? '') ? track.color : palette[0];
const pitchNames = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const pitchName = (pitch) => `${pitchNames[pitch % 12]}${Math.floor(pitch / 12) - 1}`;
const isBlack = (pitch) => [1, 3, 6, 8, 10].includes(pitch % 12);
const dbLabel = (db) => `${db > 0 ? '+' : ''}${Number(db).toFixed(1)} dB`;
const panLawLabel=law=>({legacy:'기존 믹싱',equalPower:'Equal Power','0dB':'0dB','-3dB':'−3dB','-4.5dB':'−4.5dB','-6dB':'−6dB'})[law??'legacy']??'기존 믹싱';
const monoLawLabel=law=>({legacy:'½ (−6.02dB)',equalPower:'√½ (−3.01dB)','0dB':'1 (0dB)','-3dB':'−3dB','-4.5dB':'−4.5dB','-6dB':'−6dB'})[law??'legacy'];
const panLabel = (pan) => pan === 0 ? 'C' : `${pan < 0 ? 'L' : 'R'}${Math.round(Math.abs(pan) * 100)}`;
function notePitchBounds(notes, low = 128, high = -1) {
  for (const note of notes) {
    low = Math.min(low, note.pitch);
    high = Math.max(high, note.pitch);
  }
  return {low, high};
}

let project = null;
let workspaceState = null;
let mediaRevision = null;
let serverSessionId=null,lastSequence=-1;const retiredSessions=new Set();
let mediaGeneration = 0;
let history = {canUndo:false, canRedo:false};
let selectedTrack = null;
let selectedTrackIds=new Set(),trackSelectionAnchor=null,trackSelectClips=false;
let trackRowHeight=106,expandSelectedTracks=false;
const trackRowOverrides=new Map();
const trackBaseHeight=id=>trackRowOverrides.get(id)??trackRowHeight;
const trackRowStyle=id=>`--lane:${trackBaseHeight(id)*(expandSelectedTracks&&selectedTrackIds.has(id)?2:1)}px`;
let selectedClip = null;
let selectedClipIds = new Set();
let selectedNote = null;
let selectedNoteIds = new Set();
let recordingUI,metronomeUI;
let snapGridUI,timeDisplayUI,inspectorTime,musicalDisplay,timingUI,nativeMidiUI,nativeAudioUI,audioUnitsUI,midiMergeUI,midiModifiersUI,controllerLanesUI,midiEventsUI,editingUI,sessionUI,resolutionUI,documentUI,projectsUI,documentState=null,sessionUILoading=false,resolutionUILoading=false,documentUILoading=false,projectsUILoading=false;
let busy = false;
let connected = false;
let pxPerBeat = Number($('zoom').value);
let pianoRange = {low:48, high:84};
let pianoClipId = null;
let transportSeconds = 0;
let followSuspended=false,followDocument=null,locatorDragging=false;
let browserMidiInputUI=null,browserMidiRecordingUI=null;
let audioContext = null;
let audioSource = null;
let auditionGainNode=null,stopScrub=null,scrubBufferCache=null;
let playbackStarted = 0;
let playbackOffset = 0;
let playbackDuration = 0;
let animationId = null;
let previewToken = 0;
let previewPreparing = false;
let transportSeeking=false,seekGeneration=0,userStops=0;
let activeJob = null;
let renderResult = null;
let initializedSelection = false;
const waveforms = new Map();
const waveformPending = new Set();

let geometryCache=null,geometryProject=null,geometryZoom=null,geometryClip=null,tempoCache=null,tempoMapCache=null,tempoPpq=null;
function geometry(){const clip=currentClip();if(project!==geometryProject||pxPerBeat!==geometryZoom||clip!==geometryClip){geometryCache=compileEditorGeometry(project,{zoom:pxPerBeat,clip});geometryProject=project;geometryZoom=pxPerBeat;geometryClip=clip;}return geometryCache;}
function tempo(map=project.tempoMap,ppq=project.ppq){if(map!==tempoMapCache||ppq!==tempoPpq){tempoCache=compileTempoMap(map,ppq);tempoMapCache=map;tempoPpq=ppq;}return tempoCache;}
function tickToSeconds(tick,map=project.tempoMap,ppq=project.ppq){return tempo(map,ppq).tickToSeconds(Math.max(0,tick));}
function secondsToTick(seconds){return tempo().secondsToTick(Math.max(0,seconds));}
let snapProject=null,snapClip=null,snapCompiled=null;
function noteSnap(){const clip=currentClip();if(project!==snapProject||clip!==snapClip){snapCompiled=compileEditorSnap(project,{scope:'piano',clipId:clip.id});snapProject=project;snapClip=clip;}return snapCompiled;}
function timeGridBackground(element,view,snap,endTick,width){
 const lines=snap.lines(endTick),path=lines.map(p=>`M${view.tickToX(p.tick).toFixed(3)},0V1`).join('');
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="1" viewBox="0 0 ${width} 1" preserveAspectRatio="none"><path d="${path}" stroke="#3c5041"/></svg>`;
 element.style.backgroundImage=`url("data:image/svg+xml,${encodeURIComponent(svg)}")`;element.style.backgroundSize=`${width}px 100%`;element.style.backgroundPosition='0 0';element.dataset.gridLines=String(lines.length);
}
function gridBackground(element,view,endTick,step,barStep,width){
  if(view.mode==='beat-linear'){element.style.removeProperty('background-image');element.style.removeProperty('background-size');element.style.removeProperty('background-position');return;}
  const lines=view.grid(0,endTick,step),bars=view.grid(0,endTick,barStep),path=a=>a.map(p=>`M${p.x.toFixed(3)},0V1`).join('');
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="1" viewBox="0 0 ${width} 1" preserveAspectRatio="none"><path d="${path(lines)}" stroke="#2a3b2f"/><path d="${path(bars)}" stroke="#3c5041"/></svg>`;
  element.style.backgroundImage=`url("data:image/svg+xml,${encodeURIComponent(svg)}")`;element.style.backgroundSize=`${width}px 100%`;element.style.backgroundPosition='0 0';
}
function clipTiming(clip) {
  if (clip.type === 'midi') return {start:clip.startTick, end:clip.startTick + clip.lengthTicks};
  const asset = project.assets.find((item) => item.id === clip.assetId);
  const seconds = clip.startSample / project.sampleRate;
  return {start:secondsToTick(seconds), end:secondsToTick(seconds + clip.lengthFrames / (asset?.sampleRate || project.sampleRate))};
}
function projectEnd() {
  return Math.max(project.clips.reduce((end, clip) => Math.max(end, clipTiming(clip).end), project.ppq * 16),...(project.markers??[]).map(m=>m.endTick??m.tick));
}
function realProjectSeconds() {
  return project.clips.reduce((end, clip) => Math.max(end, tickToSeconds(clipTiming(clip).end)), 0);
}
function timeText(seconds) {
  const value = Math.max(0, seconds);
  return `${String(Math.floor(value / 60)).padStart(2,'0')}:${String(Math.floor(value % 60)).padStart(2,'0')}.${String(Math.floor(value % 1 * 1000)).padStart(3,'0')}`;
}
function currentTrack() { return project?.tracks.find((track) => track.id === selectedTrack); }
function currentClip() { return project?.clips.find((clip) => clip.id === selectedClip); }
function currentNote() { return currentClip()?.notes?.find((note) => note.id === selectedNote); }
function notice(message, error = false) {
  $('notice-text').textContent = message;
  $('notice').classList.toggle('error', error);
  $('notice').hidden = false;
}
function errorMessage(body, fallback = '요청을 처리하지 못했습니다.') {
  return body?.errors?.map((error) => `${error.message}${error.code ? ` (${error.code})` : ''}`).join(' · ') || body?.error?.message || body?.error || body?.message || fallback;
}
async function jsonFetch(url, options = {}) {
  const response = await fetch(url, {...options,...(options.method==='POST'&&documentState?.id?{headers:{...options.headers,'X-Newdaw-Document':documentState.id}}:{})});
  let body;
  try { body = await response.json(); } catch { throw new Error(`서버 응답을 읽지 못했습니다. HTTP ${response.status}`); }
  if (!response.ok || body.status === 'error') {
    const error = new Error(errorMessage(body, `요청 실패 · HTTP ${response.status}`));
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}
function saveStateLabel(){return documentState?`${documentState.displayName??documentState.fileName} · ${documentState.neverSaved?'첫 저장 전 · 자동 복구 저장됨':documentState.dirty===null?'저장 기준 확인 필요':documentState.dirty?'저장 이후 변경 · 자동 복구 저장됨':'저장됨'}`:'활성 프로젝트 없음';}
function setConnection(value) {
  if(!value)controllerLanesUI?.cancelAudition();
  connected = value;
  $('connection-dot').classList.toggle('connected', value);
  $('connection-status').textContent = value ? 'GUI + CLI 동기화됨' : '연결 재시도 중';
  if (!busy) $('save-state').textContent = value ? saveStateLabel() : '서버 연결 대기';
  updateButtons();
}
function applySnapshot(snapshot, {force = false} = {}) {
  if(snapshot?.capabilities){defaultTrackTimeBaseSupported=snapshot.capabilities.defaultTrackTimeBase===true;$('default-track-time-base-fields').hidden=!defaultTrackTimeBaseSupported;$('new-track-time-base-field').hidden=!defaultTrackTimeBaseSupported;}
  if(snapshot?.capabilities)midiLinearAffineCurvesSupported=snapshot.capabilities.midiLinearAffineCurves===true;
  if(snapshot?.capabilities)midiTrackTimeBaseSupported=snapshot.capabilities.midiTrackTimeBase===true;
  if(snapshot?.capabilities)audioTrackTimeBaseSupported=snapshot.capabilities.audioTrackTimeBase===true;
  if(snapshot?.capabilities){audioTempoFromEventSupported=snapshot.capabilities.audioTempoFromEvent===true;if(audioTempoFromEventSupported&&!tempoFromAudioModule&&!tempoFromAudioLoading){tempoFromAudioLoading=true;import('/media/tempo-from-audio.mjs').then(module=>{tempoFromAudioModule=module;if(project)renderInspector();}).catch(error=>notice(error.message,true)).finally(()=>{tempoFromAudioLoading=false;});}}

  if(snapshot?.capabilities)tempoCursorChangeSupported=snapshot.capabilities.tempoCursorChange===true;
  if(snapshot?.capabilities)$('tempo-mode-toggle').hidden=snapshot.capabilities.tempoTrackMode!==true;
  if(snapshot?.capabilities?.tapTempo&&!tapTempoUI&&!tapTempoLoading){tapTempoLoading=true;import('./tap-tempo-ui.mjs').then(({setupTapTempo})=>{tapTempoUI=setupTapTempo({getContext:()=>({project,documentId:documentState?.id,busy,connected,cursorTick:project?Math.max(0,Math.round(secondsToTick(transportSeconds))):0,selectionStartTick:project&&selectedClipIds.size?Math.min(...project.clips.filter(c=>selectedClipIds.has(c.id)).map(c=>Math.max(0,Math.round(clipTiming(c).start)))):undefined,lastPlaybackStartTick:lastPlaybackDocumentId===documentState?.id?lastPlaybackStartTick:undefined,playing:Boolean(audioSource)||Boolean(nativeMidiUI?.active)}),runCommand,notify:notice});tapTempoUI.update();}).catch(error=>notice(error.message,true)).finally(()=>{tapTempoLoading=false;});}

  if(snapshot?.capabilities)aiffImportSupported=snapshot.capabilities.aiffImport===true;
  if(snapshot?.capabilities)$('mix-export-file-format').hidden=!(snapshot.capabilities.audioExportFileFormats??[]).includes('aiff');
  if(snapshot?.capabilities)$('mix-export-dither-field').hidden=!(snapshot.capabilities.wavDitherModes??[]).includes('tpdf');
  if(snapshot?.capabilities)$('mix-export-presets').hidden=snapshot.capabilities.projectExportPresets!==true;
  if(snapshot?.capabilities){stemSplitSupported=snapshot.capabilities.stemSplitExport===true;$('mix-export-split-field').hidden=!stemSplitSupported;for(const option of $('mix-export-channels').options)option.hidden=!(snapshot.capabilities.wavExportChannelModes??[]).includes(option.value);}
  if(snapshot?.capabilities){const rates=snapshot.capabilities.wavOutputSampleRates??[],field=$('mix-export-sample-rate'),key=rates.join(',');field.hidden=!rates.length;if(field.dataset.rates!==key){field.innerHTML='<option value="project">프로젝트 샘플레이트</option>'+rates.map(rate=>`<option value="${rate}">${rate} Hz</option>`).join('');field.dataset.rates=key;}}
  if(snapshot?.capabilities){$('mix-export-range').querySelector('[value=cycles]').hidden=snapshot.capabilities.stemCycleExport!==true;$('mix-export-target').querySelector('[value=stems]').hidden=snapshot.capabilities.stemExport!==true;$('mix-export-target').querySelector('[value=cycleMix]').hidden=snapshot.capabilities.stemCycleExport!==true;}
  if(snapshot?.capabilities){renderTrackSelectionSupported=snapshot.capabilities.renderTrackSelection===true;$('mix-export-track-options').hidden=!renderTrackSelectionSupported;}
  if(snapshot?.capabilities)$('midi-operation').querySelector('[value=reverse]').hidden=snapshot.capabilities.midiNoteReverse!==true;
  if(snapshot?.capabilities){automaticEffectTailSupported=snapshot.capabilities.automaticEffectTail===true;$('mix-export-auto-tail-field').hidden=!automaticEffectTailSupported;}
  if(automaticEffectTailSupported&&!delayTailLoading&&!delayTailEstimator){delayTailLoading=true;import(snapshot.capabilities.trackEqAutomaticTail?'/media/track-effects.mjs':'/media/track-delay.mjs').then(module=>{delayTailEstimator=module.estimateTrackEffectsTail??((track,rate,tempoMap)=>module.estimateTrackDelayTail(track.delay,tempoMap));updateMixExportSummary();}).catch(error=>notice('효과 꼬리 계산 모듈: '+error.message,true)).finally(()=>{delayTailLoading=false;});}
  if(snapshot?.capabilities)trackPreFilterBypassSupported=snapshot.capabilities.trackPreFilterBypass===true;
  if(snapshot?.capabilities)preEffectTransferSupported=snapshot.capabilities.trackPreEffectPresets===true;
  if(snapshot?.capabilities)trackPreFiltersSupported=snapshot.capabilities.trackPreFilters===true;
  if(snapshot?.capabilities)trackPreSupported=snapshot.capabilities.trackPreGainPolarity===true;
  if(snapshot?.capabilities)effectPresetsSupported=snapshot.capabilities.projectEffectPresets===true;
  if(snapshot?.capabilities)trackEffectTransferSupported=snapshot.capabilities.trackEffectTransfer===true;
  if(snapshot?.capabilities)trackEqGraphSupported=snapshot.capabilities.trackEqGraph===true;
  if(trackEqGraphSupported&&!eqGraphModule&&!eqGraphLoading){eqGraphLoading=true;import('/media/track-eq.mjs').then(module=>{eqGraphModule=module;updateTrackEqGraph();}).catch(error=>notice('EQ 그래프 모듈: '+error.message,true)).finally(()=>{eqGraphLoading=false;});}
  if(snapshot?.capabilities)trackEqTypesSupported=snapshot.capabilities.trackEqFilterTypes===true;
  if(snapshot?.capabilities)noteAuditionTrackEffectsSupported=snapshot.capabilities.noteAuditionTrackEffects===true;
  if(snapshot?.capabilities)$('fill-loop-controls').hidden=snapshot.capabilities.clipFillLoop!==true;
  if(snapshot?.capabilities)$('glue-selected-audio-clips').hidden=snapshot.capabilities.audioClipGlue!==true;
  if(snapshot?.capabilities)$('midi-glue-tool-field').dataset.audioSupported=String(snapshot.capabilities.audioClipGlueFollowing===true);
  if(snapshot?.capabilities)$('midi-glue-tool-field').hidden=snapshot.capabilities.midiClipGlueFollowing!==true;
  if(snapshot?.capabilities)$('glue-selected-midi-clips').hidden=snapshot.capabilities.midiClipGlue!==true;
  if(snapshot?.capabilities)$('audio-scrub-tool-field').hidden=snapshot.capabilities.audioScrubPreview!==true;
  if(snapshot?.capabilities)$('audition-effect-bypass-field').hidden=snapshot.capabilities.previewEffectBypass!==true;
  if(snapshot?.capabilities)$('audition-selected-clips').hidden=snapshot.capabilities.clipSelectionPreview!==true;
  if(snapshot?.capabilities)trackEqSupported=snapshot.capabilities.trackFourBandEq===true;
  if(snapshot?.capabilities)trackDelaySupported=snapshot.capabilities.trackFeedbackDelay===true;
  if(snapshot?.capabilities)trackDelaySyncSupported=snapshot.capabilities.trackDelayTempoSync===true;
  if(snapshot?.capabilities)trackDelayFiltersSupported=snapshot.capabilities.trackDelayFilters===true;
  if(snapshot?.capabilities)$('clip-paste-track-options').hidden=snapshot.capabilities.clipPasteTrackMapping!==true;
  if(snapshot?.capabilities){clipSnapshotPasteSupported=snapshot.capabilities.clipSnapshotPaste===true;$('clip-clipboard-controls').hidden=!clipSnapshotPasteSupported;}
  if(snapshot?.capabilities)$('move-clips-track').hidden=snapshot.capabilities.clipGroupTrackMove!==true;
  if(snapshot?.capabilities)$('move-clips-cursor').hidden=snapshot.capabilities.clipGroupMove!==true;
  if(snapshot?.capabilities){clipGroupMuteSupported=snapshot.capabilities.clipGroupMute===true;$('mute-selected-clips').hidden=!clipGroupMuteSupported;}
  if(snapshot?.capabilities)$('repeat-selected-clips').hidden=snapshot.capabilities.clipGroupRepeat!==true;
  if(snapshot?.capabilities)$('locator-operation-field').hidden=snapshot.capabilities.locatorRangeEditing!==true;
  if(snapshot?.capabilities)for(const id of ['locators-from-clips','cycle-from-clips'])$(id).hidden=snapshot.capabilities.locatorsFromClips!==true;
  if(snapshot?.capabilities){midiImportSinglePartSupported=snapshot.capabilities.midiImportSinglePart===true;$('midi-import-single-part-field').hidden=!midiImportSinglePartSupported;}
  if(snapshot?.capabilities){midiImportLocatorSupported=snapshot.capabilities.midiImportLeftLocator===true;$('midi-import-position-field').hidden=!midiImportLocatorSupported;}
  if(snapshot?.capabilities){midiImportDissolveSupported=snapshot.capabilities.midiImportAutoDissolve===true;$('midi-import-dissolve-field').hidden=!midiImportDissolveSupported;}
  if(snapshot?.capabilities){midiImportInspectorSupported=snapshot.capabilities.midiImportInspectorOptions===true;$('midi-import-inspector-fields').hidden=!midiImportInspectorSupported;}
  if(snapshot?.capabilities)$('project-signature-fields').hidden=snapshot.capabilities.fixedProjectSignature!==true;
  if(snapshot?.capabilities){midiImportTimingSupported=snapshot.capabilities.midiImportTimingOptions===true;$('midi-import-timing-fields').hidden=!midiImportTimingSupported;}
  if(snapshot?.capabilities)$('midi-export-options').hidden=snapshot.capabilities.midiExportOptions!==true;
  if(snapshot?.capabilities)$('midi-export-range').hidden=snapshot.capabilities.midiExportLocators!==true;
  if(snapshot?.capabilities)$('midi-export-ppq').hidden=snapshot.capabilities.midiExportPpq!==true;
  if(snapshot?.capabilities){midiTrackExportSupported=snapshot.capabilities.midiTrackExportSelection===true;$('midi-export-scope').hidden=!midiTrackExportSupported;}
  if(snapshot?.capabilities){$('project-pan-law-field').hidden=snapshot.capabilities.projectPanLaw!==true;$('pan-law-status').hidden=snapshot.capabilities.projectPanLaw!==true;const modes=snapshot.capabilities.projectPanLawModes??['legacy','equalPower','0dB'];for(const option of $('project-pan-law').options)option.hidden=!modes.includes(option.value);}
  if(snapshot?.capabilities){$('velocity-advanced-fields').hidden=snapshot.capabilities.midiVelocityLimits!==true;$('velocity-mode').querySelector('[value=limit]').hidden=snapshot.capabilities.midiVelocityLimits!==true;}
  if(snapshot?.capabilities)$('transpose-scale-fields').hidden=snapshot.capabilities.midiTransposeScale!==true;
  if(snapshot?.capabilities)$('transpose-range-fields').hidden=snapshot.capabilities.midiTransposeRange!==true;
  if(snapshot?.capabilities)$('midi-operation').querySelector('[value=dissolve]').hidden=snapshot.capabilities.midiDissolveParts!==true;
  if(snapshot?.capabilities)$('midi-operation').querySelector('[value=repeatLoop]').hidden=snapshot.capabilities.midiRepeatLoop!==true;
  if(snapshot?.capabilities)$('midi-operation').querySelector('[value=thinControllers]').hidden=snapshot.capabilities.midiThinControllers!==true;
  if(snapshot?.capabilities)$('midi-operation').querySelector('[value=restrictPolyphony]').hidden=snapshot.capabilities.midiRestrictPolyphony!==true;
  if(snapshot?.capabilities)$('midi-operation').querySelector('[value=deleteControllers]').hidden=snapshot.capabilities.midiDeleteControllers!==true;
  if(snapshot?.capabilities)$('midi-operation').querySelector('[value=pedalsToLength]').hidden=snapshot.capabilities.midiPedalsToLength!==true;
  if(snapshot?.capabilities)$('midi-operation').querySelector('[value=deleteOverlaps]').hidden=snapshot.capabilities.midiDeleteOverlaps!==true;
  if(snapshot?.capabilities)$('step-input-open').hidden=snapshot.capabilities.midiStepInput!==true;
  if(snapshot?.capabilities){legatoOptionsSupported=snapshot.capabilities.midiLegatoOptions===true;$('legato-selected-only-field').hidden=!legatoOptionsSupported;}
  if(snapshot?.capabilities)$('midi-operation').querySelector('[value=length]').hidden=snapshot.capabilities.midiNoteLength!==true;
  if(snapshot?.capabilities)$('midi-operation').querySelector('[value=split]').hidden=snapshot.capabilities.midiNoteSplit!==true;
  if(snapshot?.capabilities)$('midi-operation').querySelector('[value=glue]').hidden=snapshot.capabilities.midiNoteGlue!==true;
  if(snapshot?.capabilities)soloDefeatSupported=snapshot.capabilities.soloDefeat===true;
  if(snapshot?.capabilities){globalMuteSoloSupported=snapshot.capabilities.globalMuteSolo===true;$('global-mute-solo').hidden=!globalMuteSoloSupported;}
  if(snapshot?.capabilities)trackRenameClipsSupported=snapshot.capabilities.trackRenameClips===true;
  if(snapshot?.capabilities)$('remove-empty-tracks').hidden=snapshot.capabilities.removeEmptyTracks!==true;
  if(snapshot?.capabilities)wavImportTargetSupported=snapshot.capabilities.recordingTargetTracks===true;
  if(snapshot?.capabilities){renderMaxSeconds=snapshot.capabilities.maxRenderSeconds??120;wavExportChannelModes=snapshot.capabilities.wavExportChannelModes??[];$('mix-export-channels').hidden=!wavExportChannelModes.length;wavExportFormats=snapshot.capabilities.wavExportFormats??[];$('mix-export-format').hidden=!wavExportFormats.length;wavUploadLimit=snapshot.capabilities.maxWavUploadBytes??snapshot.capabilities.maxUploadBytes??32*1024*1024;midiUploadLimit=snapshot.capabilities.maxMidiUploadBytes??32*1024*1024;}
  if(snapshot?.capabilities)audioFadeSupported=snapshot.capabilities.audioClipFades===true;
  if(snapshot?.capabilities)audioSilenceSupported=snapshot.capabilities.audioSilence===true;
  if(snapshot?.capabilities){cutClipsAtCursorSupported=snapshot.capabilities.cutClipsAtCursor===true;for(const id of ['cut-clips-head','cut-clips-tail'])$(id).hidden=!cutClipsAtCursorSupported;}
  if(snapshot?.capabilities){splitClipsRangeSupported=snapshot.capabilities.splitClipsRange===true;for(const id of ['split-clips-locators','split-clips-repeat'])$(id).hidden=!splitClipsRangeSupported;}
  if(snapshot?.capabilities)audioDcCorrectionSupported=snapshot.capabilities.audioDcCorrection===true;
  if(snapshot?.capabilities){splitClipsAtCursorSupported=snapshot.capabilities.splitClipsAtCursor===true;$('split-clips-cursor').hidden=!splitClipsAtCursorSupported;}
  if(snapshot?.capabilities)audioStatisticsSupported=snapshot.capabilities.audioStatistics===true;
  if(snapshot?.capabilities)clipNudgeSupported=snapshot.capabilities.clipNudge===true;
  if(snapshot?.capabilities)clipCopyToSupported=snapshot.capabilities.clipCopyTo===true;
  if(snapshot?.capabilities)audioOverlapFrontSupported=snapshot.capabilities.audioOverlapFront===true;
  if(snapshot?.capabilities){trackFoldersSupported=snapshot.capabilities.trackFolders===true;trackFoldersUI?.update();}
  if(snapshot?.capabilities){projectMarkersSupported=snapshot.capabilities.projectMarkers===true;$('project-markers-open').hidden=!projectMarkersSupported;}
  if(snapshot?.capabilities)audioTrimSupported=snapshot.capabilities.audioTrim===true;
  if(snapshot?.capabilities)audioRangeFadesSupported=snapshot.capabilities.audioRangeFades===true;
  if(snapshot?.capabilities)audioBulkFadesSupported=snapshot.capabilities.audioBulkFades===true;
  if(snapshot?.capabilities)audioVolumeEnvelopeSupported=snapshot.capabilities.audioVolumeEnvelope===true;
  if(snapshot?.capabilities)audioFadeShapesSupported=snapshot.capabilities.audioFadeShapes===true;
  if(snapshot?.capabilities)audioCrossfadeSupported=snapshot.capabilities.audioCrossfade===true;
  if(snapshot?.capabilities)$('zero-crossing-split-field').hidden=snapshot.capabilities.audioZeroCrossingQuery!==true;
  if(snapshot?.capabilities){audioResizeMovesContentsSupported=snapshot.capabilities.audioResizeMovesContents===true;$('audio-resize-mode-field').hidden=!audioResizeMovesContentsSupported;}
  if(snapshot?.capabilities)explicitSplitClipIdsSupported=snapshot.capabilities.explicitSplitClipIds===true;
  if(snapshot?.capabilities)midiStepCursorClickSupported=snapshot.capabilities.midiStepCursorClick===true;
  if(snapshot?.capabilities)midiNoteInputEditSupported=snapshot.capabilities.midiNoteInputEdit===true;
  if(snapshot?.capabilities)midiStepCursorNavigationSupported=snapshot.capabilities.midiStepCursorNavigation===true;
  if(snapshot?.capabilities)midiPartStartResizeSupported=snapshot.capabilities.midiPartStartResize===true;
  if(snapshot?.capabilities){audioTimeStretchBatchSupported=snapshot.capabilities.audioTimeStretchBatch===true;const help=$('audio-stretch-mode-help');if(help)help.textContent=audioTimeStretchBatchSupported?'내용 이동·타임스트레치는 Zero Crossing 보정 제외. 타임스트레치 최대128개·전체 처리 후 한 번 저장':'내용 이동·타임스트레치는 Zero Crossing 보정 제외. 타임스트레치는 현재 단일 클립만 지원';}
  if(snapshot?.capabilities)audioProcessingRestoreSupported=snapshot.capabilities.audioProcessingRestore===true;
  if(snapshot?.capabilities){audioTimeStretchSupported=snapshot.capabilities.audioTimeStretchProcessing===true;const option=$('audio-resize-mode').querySelector('[value=timeStretch]');option.hidden=!audioTimeStretchSupported;option.disabled=!audioTimeStretchSupported;}
  if(snapshot?.capabilities)audioZeroCrossingTrimSupported=snapshot.capabilities.audioZeroCrossingTrim===true;
  if(snapshot?.capabilities)audioZeroCrossingSupported=snapshot.capabilities.audioZeroCrossingQuery===true;
  if(snapshot?.capabilities)audioSnapPointPasteSupported=snapshot.capabilities.audioSnapPointPaste===true;
  if(snapshot?.capabilities)audioEventSnapPointSupported=snapshot.capabilities.audioEventSnapPoint===true;
  if(snapshot?.capabilities)audioSlipSupported=snapshot.capabilities.audioSlip===true;
  if(snapshot?.capabilities)audioNormalizeSupported=snapshot.capabilities.audioNormalize===true;
  if(snapshot?.capabilities)locatorCycleSupported=snapshot.capabilities.locatorCycle===true;
  if (!snapshot || !Object.hasOwn(snapshot,'project')) return;
  if(snapshot.session?.id){
    const id=snapshot.session.id;if(retiredSessions.has(id))return;
    if(serverSessionId!==id){if(serverSessionId)retiredSessions.add(serverSessionId);serverSessionId=id;lastSequence=-1;}
    if(Number.isSafeInteger(snapshot.sequence)){if(snapshot.sequence<lastSequence)return;lastSequence=snapshot.sequence;}
  }
  const documentChanged=(documentState?.id??null)!==(snapshot.session?.document?.id??null);
  if (!documentChanged&&project && snapshot.project && snapshot.project.id === project.id && snapshot.project.revision < project.revision) return;
  const changed = documentChanged || !project || !snapshot.project || project.id !== snapshot.project.id || project.revision !== snapshot.project.revision;
  const anchors=changed&&!documentChanged&&project&&snapshot.project?.id===project.id?{timeline:geometry().timeline.xToTick($('timeline-scroll').scrollLeft),piano:geometry().piano.xToTick($('piano-scroll').scrollLeft),clipId:selectedClip}:null;
  if(changed)cancelNoteDrag();
  if(documentChanged){
    stretchRequest?.controller.abort();
    timingUI?.invalidate();nativeMidiUI?.documentChanged();midiMergeUI?.documentChanged();midiModifiersUI?.documentChanged();
    controllerLanesUI?.documentChanged();
    if(activeJob){activeJob.cancelled=true;activeJob=null;$('job-bar').hidden=true;}
    if(drag&&$('note-grid').hasPointerCapture(drag.pointerId))$('note-grid').releasePointerCapture(drag.pointerId);drag=null;
    initializedSelection=false;trackRowOverrides.clear();selectedTrackIds.clear();trackSelectionAnchor=null;selectedTrack=null;selectedClip=null;selectedNote=null;selectedNoteIds.clear();selectedClipIds.clear();pianoClipId=null;transportSeconds=0;renderResult=null;
    for(const dialog of document.querySelectorAll('dialog[open]'))if(!['projects-dialog','document-dialog'].includes(dialog.id))dialog.close();
  }
  const mediaChanged = mediaRevision !== null && snapshot.mediaRevision !== undefined && snapshot.mediaRevision !== mediaRevision;
  if (snapshot.mediaRevision !== undefined) mediaRevision = snapshot.mediaRevision;
  if(changed||mediaChanged)scrubBufferCache=null;
  if (mediaChanged) { mediaGeneration++; waveforms.clear(); waveformPending.clear(); renderResult = null; }
  if (project && (changed || mediaChanged)) {
    const wasPlaying = Boolean(audioSource || previewPreparing || activeJob?.purpose === 'preview');
    stopPreview(false);
    if (wasPlaying) $('playback-status').textContent = mediaChanged ? '미디어 복구 반영 · 재생 중지' : '편집 반영 · 재생 중지';
  }
  project = snapshot.project;
  documentState=snapshot.session?.document??null;
  workspaceState=snapshot.workspace??workspaceState;
  nativeMidiUI?.snapshot(snapshot.nativeTransport,snapshot.session?.id);
  nativeAudioUI?.snapshot(snapshot);
  audioUnitsUI?.snapshot(snapshot);
  if(changed){nativeMidiUI?.projectChanged();timingUI?.invalidate();}
  if (snapshot.capabilities?.projectOpen && !projectsUI && !projectsUILoading) loadProjectsUI();
  if(!project){history={canUndo:false,canRedo:false};renderUI(true);if(documentChanged){documentUI?.documentChanged();resolutionUI?.documentChanged();}return;}
  if (snapshot.history) history = snapshot.history;
  if (!initializedSelection) {
    selectedTrack = project.tracks[0]?.id || null;
    selectedClip = project.clips.find((clip) => clip.trackId === selectedTrack)?.id || null;
    initializedSelection = true;
  }
  const survivingTrackIds=new Set(project.tracks.map(track=>track.id));
  selectedTrackIds=new Set([...selectedTrackIds].filter(id=>survivingTrackIds.has(id)));
  if (!survivingTrackIds.has(selectedTrack)) selectedTrack = [...selectedTrackIds].at(-1) ?? project.tracks[0]?.id ?? null;
  if(trackSelectionAnchor&&!survivingTrackIds.has(trackSelectionAnchor))trackSelectionAnchor=selectedTrack;
  if (!project.clips.some((clip) => clip.id === selectedClip)) {
    selectedClip = project.clips.find((clip) => clip.trackId === selectedTrack)?.id || null;
    selectedNote = null;
  }
  selectedClipIds = new Set([...selectedClipIds].filter(id => project.clips.some(clip => clip.id === id)));
  if (selectedClip) selectedClipIds.add(selectedClip);
  const validNotes = new Set(currentClip()?.notes?.map(note => note.id) ?? []);
  selectedNoteIds = new Set([...selectedNoteIds].filter(id => validNotes.has(id)));
  if (!validNotes.has(selectedNote)) selectedNote = selectedNoteIds.values().next().value ?? null;
  renderUI(force||documentChanged);
  if(anchors){$('timeline-scroll').scrollLeft=geometry().timeline.tickToX(anchors.timeline);if(anchors.clipId===selectedClip)$('piano-scroll').scrollLeft=geometry().piano.tickToX(anchors.piano);}
  if (snapshot.capabilities?.historyBrowser && !sessionUI && !sessionUILoading) loadSessionUI();
  if (snapshot.capabilities?.projectOpen && !projectsUI && !projectsUILoading) loadProjectsUI();
  if (snapshot.capabilities?.documentSave && !documentUI && !documentUILoading) loadDocumentUI();
  if (snapshot.capabilities?.mediaResolution && !resolutionUI && !resolutionUILoading) loadResolutionUI();
  if (mediaChanged) editingUI?.mediaChanged();
  if(documentChanged){documentUI?.documentChanged();resolutionUI?.documentChanged();}
}
async function refreshState({forceInspector=false}={}) {
  const body = await jsonFetch('/api/state');
  applySnapshot(body,{force:forceInspector});
  setConnection(true);
}
async function runCommand(command, arguments_ = {}, expectedRevision = project?.revision, timeEdit = null) {
  if (!project || busy) return null;
  if (!connected) { notice('서버 연결을 복구한 뒤 다시 편집하세요.', true); return null; }
  busy = true;
  stopPreview(false);
  $('save-state').textContent = '저장 중…';
  updateButtons();
  try {
    const body = await jsonFetch(timeEdit?.formattedTimes?'/api/time/command':timeEdit&&!timeEdit.sourceOnly?'/api/midi/time/command':'/api/command', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({command, arguments:arguments_, expectedRevision, requestId:uid('gui'),...(timeEdit?{...(timeEdit.formattedTimes?{formattedTimes:timeEdit.formattedTimes,timeOptions:timeEdit.timeOptions}:timeEdit.sourceOnly?{}:{displayTimes:timeEdit.displayTimes}),expectedTimingRevision:timeEdit.profile.settings.revision,expectedTimingFingerprint:timeEdit.profile.fingerprint}:{})})});
    await refreshState({forceInspector:!timeEdit});
    return body;
  } catch (error) {
    if (timeEdit && error.body?.errors?.some(item=>item.code==='TIMING_SETTINGS_CONFLICT')) {
      notice('표시 설정이 변경되었습니다. 입력은 이전 단위로 보존했습니다. 최신 설정을 다시 읽으세요.',true);
      window.dispatchEvent(new Event('newdaw-timing-settings'));
    } else if (error.status === 409 || error.body?.errors?.some((item) => /revision|conflict/i.test(item.code))) {
      notice('다른 편집으로 프로젝트가 변경되었습니다. 최신 상태를 불러왔습니다. 값을 확인하고 다시 적용하세요.', true);
      try { await refreshState({forceInspector:!timeEdit}); if(!timeEdit)renderUI(true); } catch { setConnection(false); }
    } else notice(error.message, true);
    return null;
  } finally {
    busy = false;
    $('save-state').textContent = connected ? saveStateLabel() : '서버 연결 대기';
    updateButtons();
  }
}
function updateButtons() {
  trackFoldersUI?.update();
  if($('project-markers-dialog').open&&markerListContext){if(markerListContext.documentId!==documentState?.id){$('project-markers-dialog').close();markerListContext=null;markerDraft=null;markerFocusId=null;}else if(project&&markerListContext.revision!==project.revision)renderMarkerList();}

  $('tempo-mode-toggle').disabled=!project||busy||!connected;$('tempo-mode-toggle').textContent=project?.tempoTrackEnabled===false?'고정 템포':'Tempo Track';$('tempo-mode-toggle').setAttribute('aria-pressed',String(project?.tempoTrackEnabled!==false));
  tapTempoUI?.update();
  $('cycle-playback').disabled=!locatorCycleSupported||!project?.locators||busy||!connected;
  $('cycle-playback').setAttribute('aria-pressed',String(!!project?.cycleEnabled));
  updateEffectClipboardUI();
  recordingUI?.update();
  browserMidiInputUI?.update();
  browserMidiRecordingUI?.update();
  for(const id of ['copy-selected-clips','cut-selected-clips'])$(id).disabled=busy||!connected||!selectedClipIds.size;
  $('clip-clipboard-import').disabled=busy||!connected||!project;
  $('clip-clipboard-export').disabled=!clipClipboard;
  for(const id of ['paste-clips-cursor','paste-clips-original'])$(id).disabled=busy||!connected||!clipClipboard||clipClipboard.documentId!==documentState?.id||clipClipboard.sourceProjectId!==project?.id;
  $('move-clips-track').disabled=busy||!connected||!selectedClipIds.size;
  $('move-clips-cursor').disabled=busy||!connected||!selectedClipIds.size;
  $('mute-selected-clips').disabled=busy||!connected||!selectedClipIds.size;
  $('mute-selected-clips').textContent=project?.clips.filter(c=>selectedClipIds.has(c.id)).every(c=>c.mute)&&selectedClipIds.size?'선택 음소거 해제':'선택 음소거';
  for(const id of ['repeat-selected-clips','locators-from-clips','cycle-from-clips'])$(id).disabled=busy||!connected||!selectedClipIds.size;
  const range=project?.locators;
  $('note-select-menu').querySelector('[value="inLoop"]').hidden=!range;
  $('locators-status').textContent=range?`Locator ${range.startTick}–${range.endTick} tick`:'';
  $('locators-from-notes').disabled=busy||!connected||!selectedNoteIds.size;
  $('locators-edit').disabled=busy||!connected||!project;
  for(const id of ['cut-clips-head','cut-clips-tail'])$(id).disabled=busy||!connected||!project||!cutClipsAtCursorSupported;
  for(const id of ['split-clips-locators','split-clips-repeat'])$(id).disabled=busy||!connected||!project?.locators||!splitClipsRangeSupported;
  $('split-clips-cursor').disabled=busy||!connected||!project||!splitClipsAtCursorSupported;
  $('project-markers-open').disabled=busy||!connected||!project||!projectMarkersSupported;
  $('locators-clear').disabled=busy||!connected||!range;

  const unavailable = busy || !project || !connected;
  $('clear-all-mute').disabled=unavailable||!globalMuteSoloSupported||!project?.tracks.some(t=>t.mute);
  $('clear-all-solo').disabled=unavailable||!globalMuteSoloSupported||!project?.tracks.some(t=>t.solo);
  for (const id of ['add-track','empty-add','import-button','midi-export-open','midi-download','midi-export-scope','midi-export-range','midi-export-ppq','midi-export-format','project-download','tempo-map-button','project-name','snap']) $(id).disabled = unavailable;
  $('add-clip').disabled = unavailable || currentTrack()?.type !== 'midi';
  $('add-note').disabled = unavailable || currentClip()?.type !== 'midi';
  $('delete-note').disabled = unavailable || !currentNote();
  $('undo').disabled = unavailable || !history.canUndo;
  $('redo').disabled = unavailable || !history.canRedo;
  if($('mix-export-dialog').open)updateMixExportSummary();
  $('mix-export-channels').disabled=unavailable||Boolean(activeJob);
  $('mix-export-format').disabled=unavailable||Boolean(activeJob);
  $('mix-export-range').disabled=unavailable||Boolean(activeJob);$('mix-export-tail').disabled=unavailable||Boolean(activeJob);
  $('render-button').disabled = unavailable || Boolean(activeJob) || !project?.clips.length;
  $('play').disabled = unavailable || transportSeeking || userStops>0 || Boolean(activeJob) || previewPreparing || !project?.clips.length;
  $('glue-selected-midi-clips').disabled=unavailable||selectedClipIds.size<2;
  $('glue-selected-audio-clips').disabled=unavailable||selectedClipIds.size<2;
  $('fill-loop-clips').disabled=unavailable||!selectedClipIds.size||!project?.locators;
  for(const action of ['stretch-audio','audio-processing','restore-audio-processing'])for(const button of document.querySelectorAll(`[data-action="${action}"]`))button.disabled=unavailable;
  for(const button of document.querySelectorAll('[data-action="cancel-stretch-audio"]'))button.disabled=!stretchRequest;
  updateToolbarModes();
  $('play-selected-range').disabled=$('play').disabled||!selectedClipIds.size;
  $('audition-selected-clips').disabled=$('play-selected-range').disabled;
  $('track-audition-tool').disabled=!renderTrackSelectionSupported||unavailable||Boolean(activeJob)&&activeJob.purpose!=='preview';
  $('stop').disabled = !nativeMidiUI?.active && !nativeAudioUI?.active && !audioSource && !previewPreparing && activeJob?.purpose !== 'preview';
  $('midi-download').disabled=unavailable||midiExportDownloading||!midiExportDraft||midiExportDraft.documentId!==documentState?.id||midiExportDraft.revision!==project?.revision;
  if($('midi-export-dialog').open&&midiExportDraft&&midiExportDraft.revision!==project?.revision)$('midi-export-project').textContent='프로젝트가 변경되었습니다. 닫고 다시 열어 내보낼 범위를 확인하세요.';
  $('master-gain').disabled = unavailable;$('project-pan-law').disabled=unavailable;$('pan-law-status').disabled=unavailable;
  $('tempo').disabled = unavailable;
  $('play').classList.toggle('playing', Boolean(audioSource)||Boolean(nativeMidiUI?.active)||Boolean(nativeAudioUI?.active));
  nativeMidiUI?.update();nativeAudioUI?.update();audioUnitsUI?.update();
  $('history-button').disabled = !sessionUI || unavailable;
  $('backups-button').disabled = !sessionUI || unavailable;
  $('projects-button').disabled = !projectsUI || busy || !connected;
  $('workspace-open-button').disabled = !projectsUI || busy || !connected;
  editingUI?.update();
  midiEventsUI?.update();
  midiMergeUI?.update();midiModifiersUI?.update();
  controllerLanesUI?.update();
  inspectorTime?.update();
  sessionUI?.update();
  projectsUI?.update();
  $('media-resolve-button').disabled=!resolutionUI||unavailable;
  resolutionUI?.update();
  timeDisplayUI?.update();snapGridUI?.update();
  $('document-button').disabled=!documentUI||unavailable;
  documentUI?.update();
}
function renderUI(forceInspector = false) {
  queueMicrotask(applyLanguage);  $('main-workspace').hidden=!project;$('workspace-empty').hidden=Boolean(project);
  $('workspace-status').textContent=`열린 프로젝트 ${workspaceState?.documents?.length??(project?1:0)}개 · ${project?'활성: '+project.name:'활성 없음'}`;
  if (!project) {
    document.title='활성 프로젝트 없음 — newdaw';$('project-name').value='활성 프로젝트 없음';
    $('save-state').textContent=saveStateLabel();$('position-bars').textContent='—';$('position-time').textContent='00:00.000';
    $('tempo').value='';$('signature').textContent='—';$('timeline-lanes').replaceChildren();$('track-heads').replaceChildren();$('note-layer').replaceChildren();
    $('inspector-content').replaceChildren();$('clip-select').replaceChildren();$('job-bar').hidden=true;updateButtons();return;
  }
  const validTrackIds=new Set(project.tracks.map(t=>t.id));selectedTrackIds=new Set([...selectedTrackIds].filter(id=>validTrackIds.has(id)));if(selectedTrack&&!selectedTrackIds.has(selectedTrack))selectedTrackIds=new Set([selectedTrack]);
  if (document.activeElement !== $('project-name')) $('project-name').value = project.name;
  document.title = `${project.name} — newdaw`;
  if (document.activeElement !== $('tempo')) $('tempo').value = tempoCursorChangeSupported?tempo().bpmAtTick(Math.max(0,secondsToTick(transportSeconds))):project.tempoMap[0].bpm;
  $('signature').textContent = `${project.timeSignature.numerator}/${project.timeSignature.denominator}`;
  $('tempo-map-label').textContent = project.tempoTrackEnabled===false?'FIXED TEMPO':project.tempoMap.length > 1 ? `${project.tempoMap.length} TEMPOS` : 'TEMPO MAP';
  $('sample-rate').textContent = `${project.sampleRate / 1000} kHz`;
  $('revision-label').textContent = `REV ${String(project.revision).padStart(3,'0')}`;
  $('track-count').textContent = `${project.tracks.length} tracks`;
  $('project-summary').textContent = `${project.clips.length} clips · ${timeText(realProjectSeconds())}`;
  $('master-gain').value = project.masterGainDb;$('project-pan-law').value=project.panLaw??'legacy';$('pan-law-status').textContent=`팬: ${panLawLabel(project.panLaw)}`;
  $('master-value').textContent = dbLabel(project.masterGainDb);
  renderTracks();
  renderTimeline();
  renderPianoRoll();
  if (forceInspector || !$('inspector-content').contains(document.activeElement)) renderInspector();
  renderClipSelect();
  musicalDisplay?.update();
  updatePosition();
  updateButtons();
}
let folderDataView=(()=>{try{const v=JSON.parse(localStorage.getItem('newdaw.folderDataView')??'{}');return{visibility:['always','never','collapsed'].includes(v.visibility)?v.visibility:'always',style:v.style==='blocks'?'blocks':'events'};}catch{return{visibility:'always',style:'events'};}})();
function folderDescendantTracks(folderId){const ids=new Set([folderId]);let grew=true;while(grew){grew=false;for(const f of project.trackFolders??[])if(ids.has(f.parentFolderId)&&!ids.has(f.id)){ids.add(f.id);grew=true;}}return project.tracks.filter(t=>ids.has(t.parentFolderId));}
function folderOverviewMarkup(folder,tracks){if(folderDataView.visibility==='never'||folderDataView.visibility==='collapsed'&&!folder.collapsed)return '';const ids=new Set(tracks.map(t=>t.id)),view=geometry().timeline,clips=project.clips.filter(c=>ids.has(c.trackId));if(folderDataView.style==='blocks'){const spans=clips.map(c=>clipTiming(c)).sort((a,b)=>a.start-b.start),merged=[];for(const span of spans){const last=merged.at(-1);if(last&&span.start<=last.end)last.end=Math.max(last.end,span.end);else merged.push({...span});}return merged.map(span=>`<span class="folder-overview-block" style="left:${view.tickToX(span.start)}px;width:${Math.max(2,view.span(span.start,span.end))}px" title="${esc(folder.name)} 클립 범위"></span>`).join('');}return clips.map(c=>{const timing=clipTiming(c),index=tracks.findIndex(t=>t.id===c.trackId),height=Math.max(2,Math.min(10,34/Math.max(1,tracks.length)));return `<span class="folder-overview-event" style="left:${view.tickToX(timing.start)}px;width:${Math.max(2,view.span(timing.start,timing.end))}px;top:${5+index*height}px;height:${height}px;background:${color(tracks[index])}" title="${esc(c.name)} · ${esc(tracks[index].name)}"></span>`;}).join('');}
function arrangementFolderRows(){
 const folders=trackFoldersSupported?(project.trackFolders??[]):[],tracks=project.tracks,rows=[];
 const walk=(parent,depth,hidden)=>{const folderIds=new Set(folders.map(f=>f.id));const siblings=[...folders,...tracks].filter(n=>(n.parentFolderId??null)===parent).sort((a,b)=>(a.arrangementOrder??Number.MAX_SAFE_INTEGER)-(b.arrangementOrder??Number.MAX_SAFE_INTEGER));for(const item of siblings){if(folderIds.has(item.id)){rows.push({folder:item,depth,hidden});walk(item.id,depth+1,hidden||item.collapsed);}else rows.push({track:item,depth,hidden});}};
 walk(null,0,false);return rows;
}
function audioLaneTrackIds(){const key=documentState?.id??project?.id;if(!audioLaneViews.has(key))audioLaneViews.set(key,new Set());return audioLaneViews.get(key);}
function layoutAudioEventLanes(){if(!audioOverlapFrontSupported)return;for(const track of project.tracks){if(track.type!=='audio'||!audioLaneTrackIds().has(track.id))continue;const clips=project.clips.filter(c=>c.trackId===track.id),layout=assignAudioEventLanes(clips,project.assets,project.sampleRate),height=Math.max(trackBaseHeight(track.id),layout.laneCount*44+16);for(const parent of [$('track-heads'),$('timeline-lanes')]){const row=[...parent.children].find(n=>n.dataset.trackId===track.id);if(!row)continue;row.style.setProperty('--lane',`${height}px`);if(parent===$('timeline-lanes')){row.classList.add('audio-event-lanes');for(const clipNode of row.querySelectorAll('[data-clip-id]')){const id=clipNode.dataset.clipId;clipNode.style.top=`${8+layout.rows.get(id)*44}px`;clipNode.style.height='34px';const choose=document.createElement('span');choose.dataset.audioLaneChoose=id;choose.className='audio-lane-choose';choose.setAttribute('role','button');choose.tabIndex=0;choose.setAttribute('aria-label',`${project.clips.find(c=>c.id===id)?.name??id} 전면 테이크 선택`);choose.textContent='전면';clipNode.append(choose);}}}}
}
function renderArrangementFolders(){
 const rows=arrangementFolderRows();for(const [id,head] of [['track-heads',true],['timeline-lanes',false]]){const parent=$(id),trackRows=new Map([...parent.children].filter(n=>n.dataset.trackId).map(n=>[n.dataset.trackId,n]));for(const old of parent.querySelectorAll(':scope > [data-arrangement-folder]'))old.remove();
  for(const entry of rows){if(entry.track){const node=trackRows.get(entry.track.id);if(!node)continue;node.style.display=entry.hidden?'none':'';if(head){node.querySelector('.track-name')?.setAttribute('draggable','false');}if(head)node.style.paddingLeft=`${12+entry.depth*12}px`;parent.append(node);}else{const f=entry.folder,node=document.createElement('div');node.dataset.arrangementFolder=f.id;node.className=head?'arrangement-folder-head':'arrangement-folder-lane';node.style.cssText=`height:44px;min-height:44px;box-sizing:border-box;${entry.hidden?'display:none;':''}`;if(head){node.style.paddingLeft=`${12+entry.depth*12}px`;node.innerHTML=`<button type="button" data-arrangement-folder-toggle="${esc(f.id)}" draggable="false" aria-expanded="${!f.collapsed}" title="폴더 접기/펼치기">${f.collapsed?'▸':'▾'} ${esc(f.name)}</button>${(()=>{const ts=folderDescendantTracks(f.id);return `<button type="button" data-folder-arrangement-select="${esc(f.id)}" title="하위 트랙 전체 선택">${ts.length}</button>${['mute','solo'].map(key=>{const count=ts.filter(t=>t[key]).length;return `<button type="button" data-folder-arrangement-state="${key}" data-folder-id="${esc(f.id)}" aria-label="${esc(f.name)} ${key}" aria-pressed="${count===0?'false':count===ts.length?'true':'mixed'}" ${ts.length?'':'disabled'}>${key==='mute'?'M':'S'}</button>`;}).join('')}`;})()}`;}else{node.style.position='relative';node.innerHTML=folderOverviewMarkup(f,folderDescendantTracks(f.id));}parent.append(node);}}
 }
}
function renderTracks() {
  $('track-selection-count').textContent=`${selectedTrackIds.size} 선택`;
  $('track-heads').innerHTML = project.tracks.map((track, index) => `<div class="track-head ${selectedTrackIds.has(track.id) ? 'selected' : ''} ${track.mute ? 'muted' : ''}" data-track-id="${esc(track.id)}" style="--track-color:${color(track)};${trackRowStyle(track.id)}"><div class="track-head-top"><button type="button" class="track-number track-reorder-handle" data-track-reorder aria-label="${esc(track.name)} 순서 변경: 드래그 또는 위·아래 방향키" title="선택 트랙 묶음 드래그 · 방향키로 한 행 이동">${String(index + 1).padStart(2,'0')}</button><span class="track-type-icon" aria-hidden="true">${track.type === 'midi' ? '▥' : '≋'}</span><button class="track-name" aria-pressed="${selectedTrackIds.has(track.id)}" data-action="select" title="${esc(track.name)} 선택">${esc(track.name)}</button><span class="track-type">${track.type.toUpperCase()}</span>${track.type==='midi'?midiTrackTimeBaseSupported?`<span class="track-time-base" aria-label="MIDI 시간 기준: ${track.midiTimeBase==='linear'?'Linear':'Musical'}">${track.midiTimeBase==='linear'?'◷':'♪'}</span>`:'':audioTrackTimeBaseSupported?`<span class="track-time-base" aria-label="오디오 시간 기준: ${track.audioTimeBase==='musical'?'Musical':'Linear'}">${track.audioTimeBase==='musical'?'♪':'◷'}</span>`:''}</div><div class="track-controls"><button class="track-toggle ${track.mute ? 'active' : ''}" data-action="mute" title="${selectedTrackIds.has(track.id)?selectedTrackIds.size:1}개 트랙 뮤트 적용" aria-label="${esc(track.name)} 뮤트" aria-pressed="${track.mute}">M</button><button class="track-toggle ${track.solo ? 'active' : ''}" data-action="solo" title="${selectedTrackIds.has(track.id)?selectedTrackIds.size:1}개 트랙 솔로 적용 · Shift+클릭: 이 트랙만 솔로" aria-label="${esc(track.name)} 솔로" aria-pressed="${track.solo}">S</button><label class="mini-range"><input data-action="gain" aria-label="${esc(track.name)} 게인 dB" type="range" min="-60" max="12" step="0.5" value="${track.gainDb}"><output>${track.gainDb.toFixed(1)}</output></label><label class="mini-range pan-control"><input class="pan-range" data-action="pan" aria-label="${esc(track.name)} 팬" type="range" min="-1" max="1" step="0.05" value="${track.pan}"><output>${panLabel(track.pan)}</output></label></div><button type="button" data-track-resize role="separator" aria-orientation="horizontal" aria-label="${esc(track.name)} 높이" aria-valuemin="88" aria-valuemax="212" aria-valuenow="${trackBaseHeight(track.id)}" title="드래그: 높이 · Alt: 1px · 방향키: 8px · Home/두 번 클릭: 기본 높이"></button></div>`).join('');
}
function rulerMarkup(bars,view){
  const barTicks=project.ppq*project.timeSignature.numerator*4/project.timeSignature.denominator,endTick=bars*barTicks;
  const points=view.grid(0,endTick,barTicks,{minPixels:20});
  return points.filter(p=>p.tick<endTick).map((p,i)=>{const number=String(Math.round(p.tick/barTicks)+1).padStart(2,'0'),end=points[i+1]?.x??view.tickToX(endTick);return `<span class="bar-number" data-ruler-tick="${p.tick}" data-bar-number="${number}" style="position:absolute;bottom:0;left:${p.x}px;width:${Math.max(1,end-p.x)}px">${number}</span>`;}).join('');
}
function renderTimeline() {
  const beatsPerBar = project.timeSignature.numerator * 4 / project.timeSignature.denominator;
  const bars = Math.max(8, Math.ceil(projectEnd() / project.ppq / beatsPerBar) + 2);
  const view=geometry().timeline;
  const width = Math.max(view.tickToX(bars * beatsPerBar * project.ppq), $('timeline-scroll').clientWidth);
  const surface = $('timeline-surface');
  surface.style.width = `${width}px`;
  surface.style.setProperty('--beat-width',`${pxPerBeat}px`);
  surface.style.setProperty('--bar-width',`${pxPerBeat * beatsPerBar}px`);
  $('timeline-ruler').innerHTML = rulerMarkup(bars, view);
  if(project.locators){const range=project.locators,left=view.tickToX(range.startTick),width=Math.max(2,view.span(range.startTick,range.endTick));$('timeline-ruler').insertAdjacentHTML('beforeend',`<div class="locator-drag-bar" data-locator-drag="move" style="left:${left}px;width:${width}px" title="Locator 구간 이동 · Alt: 스냅 해제"><button type="button" data-locator-drag="start" aria-label="왼쪽 Locator 드래그" title="왼쪽 Locator">L</button><button type="button" data-locator-drag="end" aria-label="오른쪽 Locator 드래그" title="오른쪽 Locator">R</button></div>`);}

  surface.dataset.linearMode=view.mode;
  gridBackground(surface,view,view.xToTick(width),project.ppq,project.ppq*beatsPerBar,width);
  $('timeline-empty').hidden = project.tracks.length > 0;
  $('timeline-lanes').innerHTML = project.tracks.map((track) => `<div class="timeline-lane ${selectedTrackIds.has(track.id) ? 'selected' : ''}" data-track-id="${esc(track.id)}" style="${trackRowStyle(track.id)}">${project.clips.filter((clip) => clip.trackId === track.id).map((clip) => {
    const timing = clipTiming(clip);
    const left=view.tickToX(timing.start),width=view.span(timing.start,timing.end);
    let contents = '';
    if (clip.type === 'midi') {
      const {low, high} = notePitchBounds(clip.notes, 48, 72);
      contents = `<div class="clip-notes">${clip.notes.map((note) => `<i class="clip-mini-note" style="left:${(view.tickToX(clip.startTick+note.startTick)-left)/width*100}%;width:${Math.min(100, view.span(clip.startTick+note.startTick,clip.startTick+note.startTick+note.durationTicks)/width*100)}%;top:${(high - note.pitch) / Math.max(1, high - low) * 90}%"></i>`).join('')}</div>`;
      if(midiPartStartResizeSupported)contents+=`<span class="audio-trim-handle left" data-midi-part-end="left" title="드래그: MIDI 파트 시작 · 내부 이벤트 곡 위치 유지"></span>`;
      contents+=`<span class="audio-trim-handle right" data-midi-part-end="right" title="드래그: MIDI 파트 끝 · 노트/컨트롤러 보존 · Alt: 스냅 해제"></span>`;
    } else {
      const asset = project.assets.find((item) => item.id === clip.assetId);
      contents = waveformMarkup(clip) || `<span class="audio-clip-info">WAV · ${(clip.lengthFrames / (asset?.sampleRate || project.sampleRate)).toFixed(2)}s</span>`;
      if(audioEventSnapPointSupported&&asset&&clip.snapPointFrame!==undefined){const frame=clip.snapPointFrame-clip.offsetFrames;if(frame>=0&&frame<=clip.lengthFrames){const x=view.secondsToX(clip.startSample/project.sampleRate+frame/asset.sampleRate)-left;contents+=`<span class="audio-snap-point" style="position:absolute;left:${x}px;top:0;bottom:0;border-left:2px solid #ffe18b;pointer-events:none" title="이벤트 스냅 포인트"><small>S</small></span>`;}}
      if(audioFadeSupported){
        const rate=asset?.sampleRate??project.sampleRate,window=clip.fadeWindow??clip;
        const inFrames=clamp(window.offsetFrames+(clip.fadeInFrames??0)-clip.offsetFrames,0,clip.lengthFrames),outFrames=clamp(clip.offsetFrames+clip.lengthFrames-(window.offsetFrames+window.lengthFrames-(clip.fadeOutFrames??0)),0,clip.lengthFrames);
        const inX=view.secondsToX(clip.startSample/project.sampleRate+inFrames/rate)-left,outX=view.secondsToX(clip.startSample/project.sampleRate+(clip.lengthFrames-outFrames)/rate)-left;
        contents+=`<span class="audio-fade-line in" style="width:${inX}px"></span><span class="audio-fade-line out" style="width:${Math.max(0,width-outX)}px"></span><span class="audio-fade-handle" data-audio-fade="in" style="left:${clamp(inX,0,Math.max(0,width-10))}px" title="페이드 인 드래그 · ${(inFrames/rate).toFixed(3)}초"></span><span class="audio-fade-handle" data-audio-fade="out" style="left:${clamp(outX-10,0,Math.max(0,width-10))}px" title="페이드 아웃 드래그 · ${(outFrames/rate).toFixed(3)}초"></span>`;
      }
      contents+=`<span class="audio-gain-handle" data-audio-gain tabindex="0" role="slider" aria-label="${esc(clip.name)} 클립 게인" aria-valuemin="-60" aria-valuemax="12" aria-valuenow="${clip.gainDb??0}" title="위아래 드래그: 게인 · Shift: 미세조정 · 더블클릭/Home: 0dB">${(clip.gainDb??0).toFixed(1)} dB</span>`;
      if(audioTrimSupported)contents+=`<span class="audio-trim-handle left" data-audio-trim="left" title="드래그: 시작 트림"></span><span class="audio-trim-handle right" data-audio-trim="right" title="드래그: 끝 트림"></span>`;
      requestWaveform(clip.assetId);
    }
    return `<button class="timeline-clip ${clip.mute?'muted-clip':''} ${selectedClipIds.has(clip.id) ? 'selected' : ''}" data-clip-id="${esc(clip.id)}" aria-pressed="${selectedClipIds.has(clip.id)}" style="--track-color:${color(track)};left:${left}px;width:${width}px" aria-label="${esc(clip.name)} ${clip.type === 'midi' ? 'MIDI' : '오디오'} 클립 선택"><span class="clip-name">${esc(clip.name)}</span>${contents}</button>`;
  }).join('')}</div>`).join('');
  $('timeline-marker-strip').innerHTML=(project.markers??[]).map(m=>`<button type="button" class="timeline-marker" data-marker-drag="start" data-locate-marker="${esc(m.id)}" style="position:absolute;left:${view.tickToX(m.tick)}px;pointer-events:auto;max-width:150px;overflow:hidden;white-space:nowrap;font-size:10px;line-height:15px;padding:0 3px;background:#203c51;color:#c7eeff;touch-action:none" title="${esc(m.name)} · ${m.tick}${m.endTick===undefined?'':'–'+m.endTick} tick">${m.endTick===undefined?'⚑':'↔'} ${m.number} ${esc(m.name)}</button>${m.endTick===undefined?'':`<span class="marker-cycle-line" style="position:absolute;pointer-events:none;top:17px;left:${view.tickToX(m.tick)}px;width:${Math.max(1,view.span(m.tick,m.endTick))}px;border-top:2px solid #8ac9eb"></span><button type="button" data-marker-drag="end" data-locate-marker="${esc(m.id)}" class="timeline-marker-end" style="position:absolute;pointer-events:auto;left:${view.tickToX(m.endTick)-5}px;top:7px;width:10px;height:13px;padding:0;background:#90c5e7;cursor:ew-resize;touch-action:none" title="${esc(m.name)} 사이클 끝 조절">┤</button>`}`).join('');
  const overlay=$('timeline-range-overlay'),range=project.locators;overlay.hidden=!range;if(range){overlay.style.left=`${view.tickToX(range.startTick)}px`;overlay.style.width=`${view.span(range.startTick,range.endTick)}px`;}
  renderArrangementFolders();
  layoutAudioEventLanes();
  musicalDisplay?.update();
}
function waveformMarkup(clip) {
  const waveform = waveforms.get(clip.assetId);
  if (!waveform?.peaks?.length) return '';
  const asset = project.assets.find((item) => item.id === clip.assetId);
  const frames = waveform.frames || asset?.frames;
  if (!frames) return '';
  const peaks = waveform.peaks;
  const count = Math.min(160, peaks.length);
  let path = '';
  const view=geometry().timeline,start=clip.startSample/project.sampleRate,duration=clip.lengthFrames/(asset?.sampleRate||project.sampleRate),left=view.secondsToX(start),width=view.secondsToX(start+duration)-left;
  for (let i = 0; i < count; i++) {
    const position=clip.offsetFrames+i/Math.max(1,count-1)*Math.max(0,clip.lengthFrames-1);
    const reverseWindow=clip.reverseWindow??clip;
    const frame=clip.reverse?2*reverseWindow.offsetFrames+reverseWindow.lengthFrames-1-position:position;
    const index=clamp(Math.floor(frame/frames*peaks.length),0,peaks.length-1);
    const window=clip.fadeWindow??clip,local=position-window.offsetFrames;
    const curve=(value,shape)=>{const x=clamp(value,0,1);return shape==='equalPower'?Math.sin(x*Math.PI/2):shape==='sCurve'?x*x*(3-2*x):x;};
    const fade=(clip.fadeInFrames?curve(local/clip.fadeInFrames,clip.fadeInShape):1)*(clip.fadeOutFrames?curve((window.lengthFrames-1-local)/clip.fadeOutFrames,clip.fadeOutShape):1);
    const points=clip.volumeEnvelope??[];let envelope=1;if(points.length){const right=points.findIndex(p=>p.frame>=position);if(right<=0)envelope=points[right===0?0:points.length-1].gain;else{const a=points[right-1],b=points[right];envelope=a.gain+(b.gain-a.gain)*(position-a.frame)/(b.frame-a.frame);}}
    const ranges=clip.silencedRanges??[];let lo=0,hi=ranges.length;while(lo<hi){const mid=(lo+hi)>>1;if(ranges[mid].endFrame<=position)lo=mid+1;else hi=mid;}const silenced=lo<ranges.length&&ranges[lo].startFrame<=position;
    const height=clamp((Number(peaks[index])||0)*(silenced?0:1)*envelope*fade*10**((clip.gainDb??0)/20),0,1)*21;
    const x=(view.secondsToX(start+i/Math.max(1,count-1)*duration)-left)/Math.max(Number.MIN_VALUE,width)*300;
    path += `M${x},${22 - height}v${height * 2} `;
  }
  return `<svg class="clip-waveform" viewBox="0 0 300 44" preserveAspectRatio="none" aria-hidden="true"><path d="${path}" fill="none" stroke="currentColor" stroke-width="1.1"/></svg>`;
}
async function requestWaveform(assetId) {
  if (waveforms.has(assetId) || waveformPending.has(assetId)) return;
  waveformPending.add(assetId);
  const generation = mediaGeneration;
  try {
    const response = await fetch(`/api/assets/${encodeURIComponent(assetId)}/waveform`);
    if (!response.ok) { if (generation === mediaGeneration) waveforms.set(assetId, null); return; }
    const value = await response.json();
    if (generation !== mediaGeneration) return;
    waveforms.set(assetId, value);
    if (project) renderTimeline();
  } catch { if (generation === mediaGeneration) waveforms.set(assetId, null); }
  finally { if (generation === mediaGeneration) waveformPending.delete(assetId); }
}
function renderClipSelect() {
  const clips = project.clips.filter((clip) => clip.type === 'midi');
  $('clip-select').innerHTML = `<option value="">MIDI 클립 선택</option>${clips.map((clip) => `<option value="${esc(clip.id)}">${esc(project.tracks.find((track) => track.id === clip.trackId)?.name)} / ${esc(clip.name)}</option>`).join('')}`;
  $('clip-select').value = currentClip()?.type === 'midi' ? selectedClip : '';
}
function renderStepInputCursor(){
  document.getElementById('piano-step-cursor')?.remove();document.getElementById('piano-step-ruler-cursor')?.remove();
  const c=stepInputCursor,clip=currentClip();if(!c||!project||c.documentId!==documentState?.id||c.revision!==project.revision||clip?.id!==c.clipId||clip.type!=='midi')return;
  const marker=document.createElement('div');marker.id='piano-step-cursor';marker.setAttribute('aria-label',`스텝 입력 커서 ${c.atTick} tick`);marker.dataset.tick=String(c.atTick);marker.style.cssText=`position:absolute;left:${geometry().piano.tickToX(c.atTick)}px;top:0;bottom:0;border-left:2px solid #56b8ff;pointer-events:none;z-index:9`;marker.innerHTML='<span style="position:absolute;top:0;left:-5px;color:#56b8ff;font-size:13px">▼</span>';$('note-grid').append(marker);const handle=document.createElement('span');handle.id='piano-step-ruler-cursor';handle.textContent='▼';handle.style.cssText=`position:absolute;left:${geometry().piano.tickToX(c.atTick)}px;top:0;color:#56b8ff;pointer-events:none;z-index:9`;handle.setAttribute('aria-hidden','true');$('piano-ruler').append(handle);
}
function renderPianoRoll() {
  const clip = currentClip();
  const midi = clip?.type === 'midi';
  $('piano-empty').hidden = midi;
  $('piano-scroll').hidden = !midi;
  $('note-count').textContent = `${midi ? clip.notes.length : 0} notes`;
  if (!midi) { pianoClipId = null; return; }
  const snap=noteSnap();$('snap').value=String(snap.config.quarterNotes);
  const pitches = notePitchBounds(clip.notes);
  pianoRange = {low:0, high:127};
  const rows = pianoRange.high - pianoRange.low + 1;
  const view=geometry().piano,width = Math.max(view.tickToX(clip.lengthTicks), 1);
  const beatsPerBar = project.timeSignature.numerator * 4 / project.timeSignature.denominator;
  $('piano-surface').style.width = `${Math.max(width + 54, $('piano-scroll').clientWidth)}px`;
  $('piano-surface').style.height = `${rows * 19 + 25}px`;
  $('piano-ruler').innerHTML = rulerMarkup(Math.ceil(clip.lengthTicks / project.ppq / beatsPerBar), view);
  $('piano-keys').innerHTML = Array.from({length:rows}, (_, index) => {
    const pitch = pianoRange.high - index;
    return `<button type="button" class="piano-key ${isBlack(pitch) ? 'black' : ''} ${pitch % 12 === 0 ? 'root' : ''}" data-piano-pitch="${pitch}" aria-label="${pitchName(pitch)} · MIDI ${pitch} 건반 선택" title="${pitchName(pitch)} · MIDI ${pitch}">${pitch % 12 === 0 || pitch === 60 ? pitchName(pitch) : ''}</button>`;
  }).join('');
  const grid = $('note-grid');
  grid.style.width = `${width}px`;
  grid.style.height = `${rows * 19}px`;
  grid.style.setProperty('--bar-width',`${pxPerBeat * beatsPerBar}px`);
  grid.style.setProperty('--snap-width',`${pxPerBeat * Number($('snap').value)}px`);
  grid.dataset.linearMode=view.mode;
  grid.dataset.snapMode=snap.mode;grid.dataset.snapGrid=snap.gridType??String(snap.stepTicks);
  try{if(snap.mode==='time')timeGridBackground(grid,view,snap,clip.lengthTicks,width);else gridBackground(grid,view,clip.lengthTicks,snap.stepTicks,project.ppq*beatsPerBar,width);delete grid.dataset.gridError;}catch(error){grid.style.backgroundImage='none';grid.dataset.gridError=error.code??'GRID_ERROR';}
  grid.innerHTML = Array.from({length:rows}, (_, index) => `<div class="note-row ${isBlack(pianoRange.high - index) ? 'black' : ''} ${(pianoRange.high - index) % 12 === 0 ? 'root' : ''}"></div>`).join('') + `<div id="note-layer">${clip.notes.map((note) => `<button class="midi-note ${selectedNoteIds.has(note.id) ? 'selected' : ''}" data-note-id="${esc(note.id)}" style="left:${view.tickToX(note.startTick)}px;top:${(pianoRange.high - note.pitch) * 19 + 2}px;width:${Math.max(5, view.span(note.startTick,note.startTick+note.durationTicks) - 1)}px;opacity:${0.55 + note.velocity / 127 * .45}" aria-label="${pitchName(note.pitch)}, ${note.startTick / project.ppq + 1}박, 길이 ${note.durationTicks / project.ppq}박, 벨로시티 ${note.velocity}" title="${pitchName(note.pitch)} · velocity ${note.velocity}"><span>${pitchName(note.pitch)}</span></button>`).join('')}</div>`;
  if (pianoClipId !== clip.id) {
    const center = clip.notes.length ? (pitches.low + pitches.high) / 2 : 64;
    $('piano-scroll').scrollTop = Math.max(0, (pianoRange.high - center) * 19 - 90);
    $('piano-scroll').scrollLeft = 0;
    pianoClipId = clip.id;
  }
  renderStepInputCursor();
  musicalDisplay?.update();
}
function tempoFromAudioMarkup(clip){
 if(!audioTempoFromEventSupported)return '';let plan=null,error='계산 모듈 준비 중';try{if(tempoFromAudioModule)plan=tempoFromAudioModule.planTempoFromAudio(project,{clipId:clip.id});}catch(e){error=e.message;}
 return `<details id="audio-tempo-from-event" data-tempo-document="${esc(documentState?.id)}" data-tempo-revision="${project.revision}" data-tempo-clip="${esc(clip.id)}"><summary>오디오 루프에서 템포 설정</summary><p class="form-help">왼쪽 Locator를 루프 시작, 오른쪽을 원하는 마지막 마디 끝에 놓으세요. 오디오 원본과 길이는 유지합니다.</p><output id="audio-tempo-calculation">${plan?`${plan.bpm.toFixed(3)} BPM · ${plan.beats}박 / ${plan.durationSeconds.toFixed(3)}초 · ${plan.startTick}–${plan.endTick} tick`:esc(error)}</output><button type="button" data-action="tempo-from-audio-project" ${!plan||busy?'disabled':''}>프로젝트 전체에 적용</button><button type="button" data-action="tempo-from-audio-event" ${!plan||busy?'disabled':''}>Locator 구간에 적용</button><p class="form-help">구간 적용은 Tempo Track을 켜고 오른쪽 Locator에서 이전 BPM을 복원합니다. 한 Undo로 되돌릴 수 있습니다.</p></details>`;
}
const field = (label, name, value, attrs = '') => `<div class="field"><label>${label}<input name="${name}" value="${esc(value)}" ${attrs}></label></div>`;
function inspectorTimeHelp(){return '<div class="field"><label>시간 입력<select data-time-input-mode><option value="ticks">표시 tick</option><option value="format">편집기 시간 형식</option></select></label></div><div class="field" data-time-rounding-label hidden><label>저장 tick 변환<select data-time-rounding><option value="exact">정확한 값만</option><option value="nearest">가장 가까운 tick</option><option value="floor">이전 tick</option><option value="ceil">다음 tick</option></select></label></div><p class="form-help" data-time-status role="status">시간 설정 읽는 중</p><button type="button" data-time-reload>초안 버리고 시간 다시 읽기</button>';}
function envelopeGraphMarkup(clip,points=clip.volumeEnvelope??[]){
  const first=clip.offsetFrames,last=first+clip.lengthFrames-1,span=Math.max(1,last-first);
  const x=frame=>12+(frame-first)/span*276,y=gain=>108-gain*24;
  const gainAt=frame=>{if(!points.length)return 1;const i=points.findIndex(p=>p.frame>=frame);if(i<=0)return points[i===0?0:points.length-1].gain;const a=points[i-1],b=points[i];return a.gain+(b.gain-a.gain)*(frame-a.frame)/(b.frame-a.frame);};
  const visible=points.map((p,index)=>({...p,index})).filter(p=>p.frame>=first&&p.frame<=last);
  const line=[{frame:first,gain:gainAt(first)},...visible,{frame:last,gain:gainAt(last)}];
  return `<rect x="12" y="12" width="276" height="96" fill="#1c2028"/><path d="M12 84H288" stroke="#657080" stroke-dasharray="4 4"/><polyline points="${line.map(p=>`${x(p.frame)},${y(p.gain)}`).join(' ')}" fill="none" stroke="#76dfc1" stroke-width="2"/>${visible.map(p=>`<circle data-envelope-index="${p.index}" cx="${x(p.frame)}" cy="${y(p.gain)}" r="5" fill="#d5fff2"><title>${p.frame} · ${p.gain}</title></circle>`).join('')}<text x="14" y="10" fill="currentColor" font-size="9">4×</text><text x="14" y="119" fill="currentColor" font-size="9">0 · ${clip.lengthFrames} frames</text>`;
}
function renderInspector() {
  const timeDrafts=inspectorTime?.captureDrafts()??[];
  const track = currentTrack(), clip = currentClip(), note = currentNote();
  const revision = project.revision;
  let html = '';
  if (track) {
    html = `<span class="type-pill" style="--track-color:${color(track)}">${track.type === 'midi' ? 'MIDI INSTRUMENT' : 'AUDIO TRACK'}</span><h3 class="inspector-track-name">${esc(track.name)}</h3><p class="form-help">${selectedTrackIds.size}개 트랙 선택 · 아래 속성은 포커스 트랙에 적용 · 화살표는 선택 트랙 이동</p><p class="muted">${track.type === 'midi' ? 'Editable notes · built-in synth' : 'Nondestructive audio clip'}</p><hr class="inspector-divider"><form id="track-form" class="inspector-form" data-revision="${revision}" data-track-id="${esc(track.id)}">${field('트랙 이름','name',track.name,'type="text" maxlength="120" required')}${field('트랙 색상','color',color(track),'type="color" required')}${soloDefeatSupported?`<label class="field"><input type="checkbox" name="soloDefeat" ${track.soloDefeat?'checked':''}>Solo Defeat · 다른 트랙의 솔로에도 재생</label><p class="form-help">직접 설정한 뮤트는 유지합니다.</p>`:''}<div class="track-color-swatches" aria-label="기본 색상 팔레트">${palette.map(value=>`<button type="button" data-track-color="${value}" style="background:${value}" aria-label="트랙 색상 ${value}" title="${value}"></button>`).join('')}</div>${trackRenameClipsSupported?'<label class="field">클립 이름 동기화<select name="renameClips"><option value="none">기존 이름 유지</option><option value="matching">이전 트랙 이름과 같은 클립만</option><option value="all">이 트랙의 모든 클립</option></select></label>':''}<div class="fields-two">${field('게인 · dB','gainDb',track.gainDb,'type="number" min="-60" max="12" step="0.1" required')}${field('팬 · −1 L / +1 R','pan',track.pan,'type="number" min="-1" max="1" step="0.05" required')}</div>${track.type === 'midi' ? `<div class="field"><label>악기 파형<select name="instrument">${['sine','triangle','sawtooth'].map((instrument) => `<option ${track.instrument === instrument ? 'selected' : ''}>${instrument}</option>`).join('')}</select></label></div>` : ''}${trackPreSupported?`<details><summary>Pre · 입력 게인/극성</summary>${preEffectTransferSupported?effectTransferMarkup('pre'):''}${field('오디오 Pre 게인 · dB','preGainDb',track.pre?.gainDb??0,'type="number" min="-48" max="48" step="any" required')}<label><input type="checkbox" name="preInvertPolarity" ${track.pre?.invertPolarity?'checked':''}>극성 반전 · 양쪽 채널</label>${trackPreFiltersSupported?['lowCut','highCut'].map(key=>{const filter=track.pre?.[key]??{enabled:false,frequencyHz:key==='lowCut'?100:12000,slope:12};return `<fieldset><legend>${key==='lowCut'?'Low Cut':'High Cut'}</legend><label><input name="pre${key}Enabled" type="checkbox" ${filter.enabled?'checked':''}>필터 켜기</label>${trackPreFilterBypassSupported?`<label><input name="pre${key}Bypass" type="checkbox" ${filter.bypass?'checked':''}>Bypass · 설정/곡선 유지</label>`:''}${field('주파수 · Hz',`pre${key}Hz`,filter.frequencyHz,`type="number" min="${key==='lowCut'?20:50}" max="20000" step="any" required`)}<label>기울기<select name="pre${key}Slope">${[6,12,24,36,48].map(value=>`<option value="${value}" ${filter.slope===value?'selected':''}>${value}dB/oct</option>`).join('')}</select></label></fieldset>`;}).join(''):''}<p class="form-help">내장 프리뷰·파일·노트 미리듣기의 선형 게인/극성입니다. 마이크 입력 gain·외부 MIDI·MIDI Input Transformer는 바꾸지 않습니다.</p></details>`:''}${effectPresetsMarkup()}${trackEqSupported?`<details><summary>4밴드 EQ · 내장 오디오</summary><button type="button" data-invert-eq-draft>폼 게인 반전</button>${effectTransferMarkup('eq')}<label><input type="checkbox" name="eqEnabled" ${track.eq?.enabled?'checked':''}>EQ 켜기</label>${trackEqGraphSupported?'<button type="button" data-eq-graph-enlarge>EQ 그래프 확대</button><div id="track-eq-graph-host"><p class="form-help">전체: 녹색 · Pre: 파랑 · Bypass: 회색 점선 · 비활성: 숨김</p><svg id="track-eq-response" viewBox="0 0 300 160" role="img" aria-label="트랙 EQ 응답 · 가로 로그 주파수/세로 ±24dB" style="width:100%;height:auto;aspect-ratio:300/160;display:block;background:#14201b;border:1px solid #355143"></svg><div class="eq-keyboard-bands"><button type="button" data-eq-band-key="0">밴드1 · 방향키</button><button type="button" data-eq-band-key="1">밴드2</button><button type="button" data-eq-band-key="2">밴드3</button><button type="button" data-eq-band-key="3">밴드4</button></div><p id="track-eq-response-status" class="form-help">미적용 폼 값을 표시합니다. 표시 범위 ±24dB.</p></div>':''}${[100,400,1600,6400].map((frequency,index)=>{const band=track.eq?.bands[index]??{enabled:true,frequencyHz:frequency,gainDb:0,q:1};return `<fieldset><legend>밴드 ${index+1}</legend><label><input type="checkbox" name="eq${index}Enabled" ${band.enabled?'checked':''}>밴드 켜기</label>${trackEqTypesSupported?`<label>종류<select name="eq${index}Type">${[['peaking','Peaking'],['lowShelf','Low Shelf'],['highShelf','High Shelf'],['lowPass','Low Pass'],['highPass','High Pass'],['notch','Notch']].map(([value,label])=>`<option value="${value}" ${(band.type??'peaking')===value?'selected':''}>${label}</option>`).join('')}</select></label>`:''}${field('주파수 · Hz / 음이름(A3=440Hz)',`eq${index}Frequency`,band.frequencyHz,'type="text" maxlength="64" required')}${field('게인 · dB',`eq${index}Gain`,band.gainDb,'type="number" min="-24" max="24" step="0.1" required')}${field('Q',`eq${index}Q`,band.q,'type="number" min="0.1" max="10" step="any" required')}</fieldset>`;}).join('')}<p class="form-help">EQ → 딜레이 순서. Shelf는 고정 slope1(Q 무시), Pass/Notch는 gain 무시. 주파수는 sample rate의49%까지 제한합니다. ${noteAuditionTrackEffectsSupported?'노트 미리듣기도 적용합니다(짧은 구간으로 제한). 외부 MIDI에는 미적용이며':'외부 MIDI·노트 미리듣기에는 미적용이며'} 구간 앞 필터 상태는 재구성하지 않습니다.</p></details>`:''}${trackDelaySupported?`<fieldset><legend>트랙 딜레이 · 내장 오디오</legend>${effectTransferMarkup('delay')}<label><input type="checkbox" name="delayEnabled" ${track.delay?.enabled?'checked':''}>효과 켜기</label>${field('시간 · ms','delayTimeMs',track.delay?.timeMs??250,'type="number" min="1" max="2000" step="1" required')}${trackDelaySyncSupported?`<label><input type="checkbox" name="delaySync" ${track.delay?.sync?'checked':''}>템포 동기화 · 켜면 ms 값 대신 음표 사용</label><label>음표<select name="delayDivision">${['1/1','1/2','1/4','1/8','1/16','1/32'].map(value=>`<option value="${value}" ${(track.delay?.division??'1/4')===value?'selected':''}>${value}</option>`).join('')}</select></label><label>리듬<select name="delayRhythm">${[['straight','일반'],['dotted','점음표'],['triplet','셋잇단']].map(([value,label])=>`<option value="${value}" ${(track.delay?.rhythm??'straight')===value?'selected':''}>${label}</option>`).join('')}</select></label><p class="form-help">템포 변화 지점에서 반복 간격을 즉시 바꿉니다. 테이프식 전환 보간은 지원하지 않습니다.</p>`:''}${field('피드백 · 0~0.9','delayFeedback',track.delay?.feedback??.3,'type="number" min="0" max="0.9" step="0.01" required')}${field('Wet · 0~1','delayWet',track.delay?.wet??.25,'type="number" min="0" max="1" step="0.01" required')}${trackDelayFiltersSupported?`<label><input type="checkbox" name="delayLowCutEnabled" ${track.delay?.lowCutEnabled?'checked':''}>피드백 Low Cut</label>${field('Low Cut · Hz','delayLowCutHz',track.delay?.lowCutHz??120,'type="number" min="10" max="20000" step="1" required')}<label><input type="checkbox" name="delayHighCutEnabled" ${track.delay?.highCutEnabled?'checked':''}>피드백 High Cut</label>${field('High Cut · Hz','delayHighCutHz',track.delay?.highCutHz??8000,'type="number" min="10" max="20000" step="1" required')}<p class="form-help">반복 피드백에만 1차 필터 적용. 최초 echo는 유지하며 주파수는 렌더 sample rate의 49%까지로 제한합니다.</p>`:''}<p class="form-help">외부 MIDI·노트 미리듣기에는 적용하지 않습니다. 내보내기 꼬리를 늘려 반복음을 보존하세요. 구간 앞의 효과 꼬리는 재구성하지 않습니다.</p></fieldset>`:''}<button class="secondary" type="submit">트랙 적용</button></form>`;
  }
  if (clip) {
    html += `<hr class="inspector-divider"><div class="inspector-label">FOCUSED CLIP · ${selectedClipIds.size} SELECTED</div><form id="clip-form" class="inspector-form" data-revision="${revision}" data-clip-id="${esc(clip.id)}" ${clip.type==='midi'?'data-display-time':''}>${field('클립 이름','name',clip.name,'type="text" maxlength="120" required')}`;
    if (clip.type === 'midi') html += `<div class="fields-two">${field('프로젝트 시작 · 표시 tick','startDisplayTick','','type="text" maxlength="83" data-display-field required')}${field('길이 · 표시 tick','lengthDisplayTicks','','type="text" maxlength="83" data-display-field required')}</div>`;
    else {
      const asset = project.assets.find((item) => item.id === clip.assetId);
      html += `${tempoFromAudioMarkup(clip)}${field('시작 · 초','startSeconds',clip.startSample / project.sampleRate,'type="number" min="0" step="any" required')}<div class="fields-two">${field('소스 시작 · 프레임','offsetFrames',clip.offsetFrames,'type="number" min="0" step="1" required')}${field('길이 · 프레임','lengthFrames',clip.lengthFrames,'type="number" min="1" step="1" required')}</div>${field('클립 게인 · dB','gainDb',clip.gainDb ?? 0,'type="number" min="-60" max="12" step="0.1" required')}<label ${audioFadeSupported?'':'hidden'}><input name="audioMute" type="checkbox" ${clip.mute?'checked':''}>클립 음소거</label><label ${audioFadeSupported?'':'hidden'}><input name="invertPolarity" type="checkbox" ${clip.invertPolarity?'checked':''}>극성 반전</label><label ${audioFadeSupported?'':'hidden'}><input name="reverse" type="checkbox" ${clip.reverse?'checked':''}>역재생</label><div class="fields-two" ${audioFadeSupported?'':'hidden'}>${field('페이드 인 · 초','fadeInSeconds',(clip.fadeInFrames??0)/(asset?.sampleRate??project.sampleRate),'type="number" min="0" step="0.001"')}${field('페이드 아웃 · 초','fadeOutSeconds',(clip.fadeOutFrames??0)/(asset?.sampleRate??project.sampleRate),'type="number" min="0" step="0.001"')}</div><div class="fields-two" ${audioFadeShapesSupported?'':'hidden'}>${['fadeInShape','fadeOutShape'].map((key,i)=>`<label>${i?'페이드 아웃 곡선':'페이드 인 곡선'}<select name="${key}">${[['linear','선형'],['equalPower','Equal power'],['sCurve','S 곡선']].map(([value,label])=>`<option value="${value}" ${(clip[key]??'linear')===value?'selected':''}>${label}</option>`).join('')}</select></label>`).join('')}</div><div ${audioRangeFadesSupported?'':'hidden'}><label>Locator 범위로 페이드<select id="audio-range-fade-mode"><option value="in">인: 범위 시작까지</option><option value="out">아웃: 범위 끝부터</option><option value="adjust">양쪽: 중앙 범위 기준</option></select></label><button type="button" data-action="range-audio-fades">선택 오디오에 적용</button></div><fieldset ${audioBulkFadesSupported?'':'hidden'}><legend>선택 오디오 클립 페이드</legend><p class="form-help">선택된 오디오 클립에 적용. 빈 길이는 유지.</p><div class="fields-two"><label>인 · ms<input id="bulk-fade-in" type="number" min="0" max="120000" step="0.1"></label><label>아웃 · ms<input id="bulk-fade-out" type="number" min="0" max="120000" step="0.1"></label></div><label>곡선<select id="bulk-fade-shape"><option value="linear">선형</option><option value="equalPower">Equal power</option><option value="sCurve">S 곡선</option></select></label><button type="button" data-action="bulk-audio-fades">선택 클립에 적용</button><button type="button" data-action="remove-audio-fades-in">인 제거</button><button type="button" data-action="remove-audio-fades-out">아웃 제거</button><button type="button" data-action="remove-audio-fades-both">양쪽 제거</button></fieldset><div ${audioVolumeEnvelopeSupported?'':'hidden'}><svg id="audio-envelope-graph" viewBox="0 0 300 122" style="width:100%;height:140px;touch-action:none;cursor:crosshair" role="img" aria-label="볼륨 엔벌로프: 클릭 추가, 드래그 이동, Alt 클릭 삭제">${envelopeGraphMarkup(clip)}</svg><p class="form-help">클릭 추가 · 드래그 이동 · Alt/Option 클릭 삭제 · Esc 취소. 점선은 1×.</p><label>볼륨 점 · 소스 프레임, 게인<textarea id="audio-envelope-points" rows="5" aria-label="볼륨 엔벌로프 점">${esc((clip.volumeEnvelope??[]).map(p=>`${p.frame}, ${p.gain}`).join('\n'))}</textarea></label><p class="form-help">한 줄에 원본 프레임, 선형 게인(0~4). 프레임 오름차순. 빈 입력으로 제거.</p><button type="button" data-action="apply-audio-envelope">볼륨 엔벌로프 적용</button></div><div ${audioSilenceSupported?'':'hidden'}><label>무음 처리 범위<select id="audio-silence-scope"><option value="clip">선택 오디오 클립 전체</option><option value="locators">Locator와 겹친 부분</option></select></label><button type="button" data-action="silence-audio">무음 처리</button><button type="button" data-action="clear-silence-audio">무음 해제</button><p class="form-help">포커스 클립 저장 구간: ${clip.silencedRanges?.length??0}개 · 원본 유지</p></div><div ${audioDcCorrectionSupported?'':'hidden'}><button type="button" data-action="remove-dc">DC 오프셋 제거</button><button type="button" data-action="reset-dc">DC 보정 해제</button><p class="form-help">채널별 보정: ${esc((clip.dcOffsets??[]).map(x=>Number(x).toFixed(6)).join(', ')||'없음')}<br>보정값은 선택 원본 구간에서 계산합니다. 파형은 원본 peak 근사입니다.</p></div><div ${audioStatisticsSupported?'':'hidden'}><label>분석 기준<select id="audio-statistics-mode"><option value="event">클립 처리 후 · 트랙 전</option><option value="raw">원본 trim 구간</option></select></label><button type="button" data-action="audio-statistics">피크 · RMS · DC 분석</button><div id="audio-statistics-result" role="status"></div></div><div ${audioNormalizeSupported?'':'hidden'}><label>노멀라이즈 dBFS<input id="audio-normalize-target" type="number" min="-60" max="0" step="0.1" value="-1"></label><button type="button" data-action="normalize-audio">클립 노멀라이즈</button></div><div ${audioCrossfadeSupported?'':'hidden'}><label>크로스페이드 대상<select id="audio-crossfade-right">${project.clips.filter(c=>c.type==='audio'&&c.trackId===clip.trackId&&c.startSample>clip.startSample&&c.startSample<clip.startSample+clip.lengthFrames/(asset?.sampleRate??project.sampleRate)*project.sampleRate).sort((a,b)=>a.startSample-b.startSample).map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select></label><label ${audioFadeShapesSupported?'':'hidden'}>곡선<select id="audio-crossfade-shape"><option value="linear">선형</option><option value="equalPower">Equal power</option></select></label><button type="button" data-action="crossfade-audio">겹친 구간 크로스페이드</button></div>${audioTimeStretchSupported?`<details><summary>타임스트레치 · 처리본 생성</summary><label>목표 길이 · 초<input id="audio-stretch-seconds" type="number" min="0.000001" max="600" step="any" value="${clip.lengthFrames/(asset?.sampleRate??project.sampleRate)}"></label><p class="form-help">원본 WAV는 보존합니다. 현재 이벤트의 게인·페이드·역재생·엔벌로프 등은 처리본에 합쳐집니다. 트랙 효과는 유지하며 한 번의 Undo로 원본 편집 상태를 복원합니다.</p><button type="button" data-action="stretch-audio">목표 길이로 처리·저장</button><button type="button" data-action="cancel-stretch-audio" disabled>처리 취소</button><button type="button" data-action="audio-processing">처리 이력 조회</button>${audioProcessingRestoreSupported?'<button type="button" data-action="restore-audio-processing">직전 처리의 원본 설정 복원</button><small>원래 길이·이벤트 효과로 돌아갑니다. 현재 위치·이름·뮤트는 유지합니다.</small>':''}<p id="audio-processing-result" class="form-help"></p></details>`:''}${audioZeroCrossingSupported?'<button type="button" data-action="seek-audio-zero">가까운 Zero Crossing으로 커서 이동</button><p class="form-help">±10ms · 모든 채널 공통 교차 · 소스/DC/역재생 기준</p>':''}${audioEventSnapPointSupported?'<button type="button" data-action="snap-audio-cursor">스냅 포인트→커서</button><p class="form-help">커서를 이 오디오 이벤트 안에 놓으세요. 소스 파일의 기본 스냅 포인트는 바꾸지 않습니다.</p>':''}<div ${audioSlipSupported?'':'hidden'}><label>소스 이동 · 프레임<input id="audio-slip-frames" type="number" step="1" value="0"></label><button type="button" data-action="slip-audio">클립 위치 유지하고 소스 이동</button><p class="form-help">타임라인 Ctrl/Cmd+Alt 드래그: 선택 오디오 내용만 이동 · Esc 취소 · 가장자리 자동 스크롤</p></div><p class="form-help">${esc(asset?.name || 'WAV')}<br>${asset?.sampleRate || '—'} Hz · ${asset?.channels || '—'} ch · ${asset?.frames || '—'} frames</p>`;
    }
    if(clip.type==='midi')html+=inspectorTimeHelp();
    html += `<button class="secondary" type="submit">클립 적용</button><button class="danger" type="button" data-action="remove-clip">클립 삭제</button></form>`;
  }
  if (note) {
    const noteHtml = `<div class="inspector-label">SELECTED NOTE</div><div class="selection-note"><span class="note-pitch-badge">${pitchName(note.pitch)}</span><small>MIDI ${note.pitch}<br>CHANNEL ${note.channel + 1}</small></div><form id="note-form" class="inspector-form" data-revision="${revision}" data-clip-id="${esc(clip.id)}" data-note-id="${esc(note.id)}" data-display-time><div class="fields-two">${field('음높이 · MIDI','pitch',note.pitch,'type="number" min="0" max="127" step="1" required')}${field('벨로시티','velocity',note.velocity,'type="number" min="1" max="127" step="1" required')}</div><div class="fields-two">${field('클립 내 시작 · 표시 tick','startDisplayTick','','type="text" maxlength="83" data-display-field required')}${field('길이 · 표시 tick','durationDisplayTicks','','type="text" maxlength="83" data-display-field required')}</div>${inspectorTimeHelp()}<button class="primary" type="submit">노트 적용</button></form>`;
    html = `<p class="note-selection-count">${selectedNoteIds.size}개 선택 · 아래 속성은 포커스 노트에 적용</p>${noteHtml}<hr class="inspector-divider">${html}`;
  } else if (clip?.type === 'midi') html += `<hr class="inspector-divider"><p class="muted">피아노롤에서 노트를 선택하면 길이와 벨로시티를 조절할 수 있습니다.</p>`;
  if(project)html+='<hr class="inspector-divider"><button type="button" data-midi-merge-open>Merge MIDI in Loop</button>';
  if(clip?.type==='midi')html+=`<button type="button" data-midi-part-mute>${clip.mute?'파트 음소거 해제':'파트 음소거'}</button>${clip.allowNoteTails?'<p class="form-help">파트 끝을 넘는 노트 꼬리를 보존합니다.</p>':''}`;
  if(track?.type==='midi')html+='<hr class="inspector-divider"><button type="button" data-midi-modifiers-open>MIDI 재생 설정 / Freeze</button>';
  if(track?.type==='midi'&&midiTrackTimeBaseSupported)html+=`<label>MIDI 트랙 시간 기준<select id="midi-track-time-base" data-track="${esc(track.id)}" data-revision="${revision}" data-document="${esc(documentState?.id)}"><option value="musical" ${(track.midiTimeBase??'musical')==='musical'?'selected':''}>♪ Musical · 박 위치 유지</option><option value="linear" ${track.midiTimeBase==='linear'?'selected':''}>◷ Linear · 절대 시간 유지</option></select></label><p class="form-help">Linear는 노트 시작·끝과 이벤트 시간을 새 tick으로 환산합니다. 반올림으로 정밀도가 달라질 수 있습니다. ${midiLinearAffineCurvesSupported?'곡선은 일정 템포 비율로 정수 tick에 정확 변환될 때 지원합니다. 나머지는 변경을 거부합니다.':'곡선 컨트롤러가 있으면 현재 템포 변경을 거부합니다.'}</p>`;
  if(track?.type==='audio'&&audioOverlapFrontSupported)html+=`<label><input type="checkbox" data-audio-lanes-view data-track="${esc(track.id)}" ${audioLaneTrackIds().has(track.id)?'checked':''}>오디오 이벤트 레인 펼치기</label>`;
  if(track?.type==='audio'&&audioOverlapFrontSupported)html+=`<label>오디오 겹침 재생<select data-audio-overlap-mode data-track="${esc(track.id)}" data-revision="${revision}" data-document="${esc(documentState?.id)}"><option value="mix" ${(track.audioOverlapMode??'mix')==='mix'?'selected':''}>모두 합산 · 기존 방식</option><option value="front" ${track.audioOverlapMode==='front'?'selected':''}>앞쪽 이벤트 하나</option></select></label>`;
  if(clip?.type==='audio'&&audioOverlapFrontSupported){const selectedTiming=clipTiming(clip),candidates=project.clips.filter(c=>{if(c.type!=='audio'||c.trackId!==clip.trackId)return false;const t=clipTiming(c);return t.start<selectedTiming.end&&t.end>selectedTiming.start;}).sort((a,b)=>(b.frontOrder??0)-(a.frontOrder??0)||project.clips.indexOf(b)-project.clips.indexOf(a));html+=`<label>겹친 이벤트 · 전면 테이크 선택<select data-audio-stack-select data-revision="${revision}" data-document="${esc(documentState?.id)}"><option value="">재생할 이벤트 선택…</option>${candidates.map(c=>`<option value="${esc(c.id)}" ${c.mute?'disabled':''}>${esc(c.name)} · ${c.startSample} sample${c.mute?' · 음소거':''}</option>`).join('')}</select></label><p class="form-help">선택하면 트랙을 전면 재생 모드로 바꿉니다. 선택 이벤트가 없는 구간은 다른 이벤트가 재생됩니다.</p>`;}
  if(clip?.type==='audio'&&audioOverlapFrontSupported)html+=`<button type="button" data-audio-to-front="${esc(clip.id)}" data-revision="${revision}" data-document="${esc(documentState?.id)}">이벤트 앞으로 가져오기</button><p class="form-help">앞쪽 이벤트 모드에서 적용 · 음소거 이벤트는 뒤의 이벤트를 가리지 않습니다.</p>`;
  if(track?.type==='audio'&&audioTrackTimeBaseSupported)html+=`<label>오디오 트랙 시간 기준<select id="audio-track-time-base" data-track="${esc(track.id)}" data-revision="${revision}" data-document="${esc(documentState?.id)}"><option value="linear" ${(track.audioTimeBase??'linear')==='linear'?'selected':''}>◷ Linear · 절대 시간 유지</option><option value="musical" ${track.audioTimeBase==='musical'?'selected':''}>♪ Musical · 시작 박 위치 유지</option></select></label><p class="form-help">Musical은 템포 변경 시 시작 위치만 이동합니다. 오디오 내용과 길이는 늘어나지 않습니다.</p>`;
  if (track) html += `<div class="track-edit-actions"><button class="small-button" data-track-edit="duplicate">선택 트랙 복제</button><button class="small-button" data-track-edit="up" aria-label="선택 트랙 위로" ${!planTrackStep(project.tracks,selectedTrackIds,-1).length?'disabled':''}>↑</button><button class="small-button" data-track-edit="down" aria-label="선택 트랙 아래로" ${!planTrackStep(project.tracks,selectedTrackIds,1).length?'disabled':''}>↓</button></div><hr class="inspector-divider"><button class="danger" type="button" data-action="remove-track">선택 트랙 ${selectedTrackIds.size}개와 클립 삭제</button>`;
  if (renderResult) html += `<div class="render-result"><a href="${esc(renderResult.url)}" download="${esc(project.name)}.${renderResult.stats?.kind==='stems'?'zip':renderResult.stats?.fileFormat==='aiff'?'aiff':'wav'}">↓ ${renderResult.stats?.kind==='stems'?(renderResult.stats?.manifest?.options?.stemMixdown?'구간별 믹스 ZIP':'트랙별 WAV ZIP'):(renderResult.stats?.fileFormat==='aiff'?'렌더된 AIFF':'렌더된 WAV')} 다운로드</a><small>REV ${renderResult.revision} · ${Number(renderResult.stats?.durationSeconds || 0).toFixed(2)}s<br>${renderResult.stats?.sampleRate || project.sampleRate} Hz · ${renderResult.stats?.channels===1?'mono':'stereo'} · ${esc(renderResult.stats?.sampleFormat??'pcm16')}${renderResult.stats?.clippedSamples ? `<br>클리핑 ${renderResult.stats.clippedSamples} samples` : ''}</small></div>`;
  closeEqGraphOverlay();
  $('inspector-content').innerHTML = html || '<p class="muted">MIDI 트랙을 추가하거나 오디오를 가져오세요.</p>';
  inspectorTime?.bind();
  inspectorTime?.restoreDrafts(timeDrafts);
  updateTrackEqGraph();
  musicalDisplay?.update();
}
function syncTrackClipSelection(){
 selectedClip=project.clips.find(c=>c.trackId===selectedTrack)?.id??null;
 selectedClipIds=new Set(trackSelectClips?project.clips.filter(c=>selectedTrackIds.has(c.trackId)).map(c=>c.id):selectedClip?[selectedClip]:[]);
 selectedNote=null;selectedNoteIds.clear();
}
function selectTrack(id,{toggle=false,range=false}={}){
 if(!project.tracks.some(t=>t.id===id))return;
 if(range){
  const anchor=project.tracks.findIndex(t=>t.id===(trackSelectionAnchor??selectedTrack)),index=project.tracks.findIndex(t=>t.id===id),from=Math.max(0,Math.min(anchor,index)),to=Math.max(anchor,index);
  const ids=project.tracks.slice(from,to+1).map(t=>t.id);selectedTrackIds=new Set(toggle?[...selectedTrackIds,...ids]:ids);selectedTrack=id;
 }else if(toggle){
  if(selectedTrackIds.has(id)&&selectedTrackIds.size>1){selectedTrackIds.delete(id);selectedTrack=[...selectedTrackIds].at(-1);}else{selectedTrackIds.add(id);selectedTrack=id;}
  trackSelectionAnchor=selectedTrack;
 }else{selectedTrack=id;selectedTrackIds=new Set([id]);trackSelectionAnchor=id;}
 syncTrackClipSelection();renderUI(true);
}
function selectClip(id, {additive=false}={}) {
  const clip = project.clips.find((item) => item.id === id);
  if (!clip) return;
  if (additive) {
    if (selectedClipIds.has(id) && selectedClipIds.size > 1) selectedClipIds.delete(id);
    else selectedClipIds.add(id);
    selectedClip = selectedClipIds.has(id) ? id : [...selectedClipIds].at(-1);
  } else { selectedClip = id; selectedClipIds = new Set([id]); }
  selectedTrack = project.clips.find(item => item.id === selectedClip).trackId;selectedTrackIds=new Set([selectedTrack]);trackSelectionAnchor=selectedTrack;
  selectedNote = null;
  selectedNoteIds.clear();
  renderUI(true);
}
let addTracksDraft=null;
function updateNewTrackFields(){const audio=$('new-track-type').value==='audio';$('new-track-midi-options').hidden=audio;$('new-track-scope').textContent=audio?'빈 오디오 트랙을 만듭니다. WAV 가져오기 또는 녹음 대상 선택으로 오디오를 추가할 수 있습니다.':'현재 내장 파형 음원을 사용합니다. 선택 트랙 바로 아래에 추가합니다.';if(defaultTrackTimeBaseSupported){const preference=$('new-track-time-base').value==='project'?project?.defaultTrackTimeBase:$('new-track-time-base').value,mode=preference==='followTransport'?((project.timeDisplay?.primaryFormat??'bars-beats')==='bars-beats'?'musical':'linear'):preference??(audio?'linear':'musical');$('new-track-scope').textContent+=` 새 트랙 시간 기준: ${mode==='musical'?'♪ Musical':'◷ Linear'}${preference==='followTransport'?' · Follow Transport':''}`;}}
function openAddTracks(){if(!project||busy||!connected)return;addTracksDraft={documentId:documentState?.id,revision:project.revision,index:project.tracks.some(t=>t.id===selectedTrack)?project.tracks.findIndex(t=>t.id===selectedTrack)+1:project.tracks.length,cursorTick:Math.max(0,Math.round(secondsToTick(transportSeconds))),ppq:project.ppq,signature:structuredClone(project.timeSignature),trackCount:project.tracks.length,selectedColor:color(currentTrack())};$('new-track-color-mode').value='cycle';$('new-track-color-field').hidden=true;$('new-track-color').value=addTracksDraft.selectedColor;$('new-track-type').value='midi';$('new-track-time-base').value='project';$('new-track-name').value='MIDI Track';$('new-track-count').value='1';$('new-track-instrument').value='sine';$('new-track-create-part').checked=true;updateNewTrackFields();$('add-tracks-dialog').showModal();}
$('new-track-time-base').addEventListener('change',updateNewTrackFields);
$('new-track-type').addEventListener('change',()=>{if(['MIDI Track','Audio Track'].includes($('new-track-name').value))$('new-track-name').value=$('new-track-type').value==='audio'?'Audio Track':'MIDI Track';updateNewTrackFields();});
$('add-tracks-form').addEventListener('submit',async event=>{
 event.preventDefault();const draft=addTracksDraft;if(!draft||draft.documentId!==documentState?.id){notice('문서가 바뀌었습니다. 트랙 추가 창을 다시 여세요.',true);return;}
 const type=$('new-track-type').value,count=Number($('new-track-count').value),name=$('new-track-name').value.trim(),commands=[],created=[];
 if(!name||!Number.isSafeInteger(count)||count<1||count>64){notice('이름과 1~64개 트랙 개수를 입력하세요.',true);return;}
 for(let i=0;i<count;i++){const trackId=uid('track'),clipId=type==='midi'&&$('new-track-create-part').checked?uid('clip'):null;created.push({trackId,clipId});commands.push({command:'track.add',arguments:{id:trackId,type,name:count>1?`${name} ${String(i+1).padStart(2,'0')}`:name,color:$('new-track-color-mode').value==='custom'?$('new-track-color').value:$('new-track-color-mode').value==='selected'?draft.selectedColor:palette[(draft.trackCount+i)%palette.length],...(type==='midi'?{instrument:$('new-track-instrument').value}:{}),...(defaultTrackTimeBaseSupported&&$('new-track-time-base').value!=='project'?{timeBase:$('new-track-time-base').value}:{})}});commands.push({command:'track.reorder',arguments:{trackId,index:Math.max(0,draft.index)+i}});if(clipId)commands.push({command:'clip.add',arguments:{id:clipId,trackId,type:'midi',name:'New phrase',startTick:draft.cursorTick,lengthTicks:Math.max(1,Math.round(draft.ppq*4/draft.signature.denominator*draft.signature.numerator*4)),notes:[]}});}
 const result=await runCommand('batch',{commands},draft.revision);if(result&&draft.documentId===documentState?.id){$('add-tracks-dialog').close();selectedTrack=created[0].trackId;selectedTrackIds=new Set(created.map(t=>t.trackId));selectedClip=created[0].clipId;selectedClipIds=new Set(created.map(c=>c.clipId).filter(Boolean));selectedNote=null;selectedNoteIds.clear();renderUI(true);}
});
async function addTrack() {
  if (!project) return;
  const id = uid('track'), clipId = uid('clip');
  const response = await runCommand('batch', {commands:[{command:'track.add',arguments:{id,type:'midi',name:`Keys ${String(project.tracks.length + 1).padStart(2,'0')}`,color:palette[project.tracks.length % palette.length],instrument:'sine'}},{command:'clip.add',arguments:{id:clipId,trackId:id,type:'midi',name:'New phrase',startTick:0,lengthTicks:project.ppq * 16,notes:[]}}]});
  if (response) { selectedTrack = id; selectedClip = clipId; selectedClipIds=new Set([clipId]); selectedNote = null; selectedNoteIds.clear(); renderUI(true); }
}
async function addClip() {
  const track = currentTrack();
  if (track?.type !== 'midi') return;
  const id = uid('clip');
  const startTick = project.clips.reduce((end, clip) => clip.trackId === track.id ? Math.max(end, clip.startTick + clip.lengthTicks) : end, 0);
  if (await runCommand('clip.add', {id,trackId:track.id,type:'midi',name:'New phrase',startTick,lengthTicks:project.ppq * 16,notes:[]})) selectClip(id);
}
async function addNoteAt(startTick, pitch, rounding='floor') {
  const clip = currentClip();
  if (clip?.type !== 'midi' || busy) return;
  const id = uid('note');
  let durationTicks;try{const snap=noteSnap();if(snap.mode==='time'){const cell=snap.cell(startTick,rounding);if(cell.collapsed)throw Error('TIME_GRID_COLLAPSED: 이 시간 격자는 저장 해상도에서 길이가 0 tick입니다. 더 큰 격자를 선택하세요.');startTick=cell.start.localTick;durationTicks=cell.durationTicks;if(startTick<0||cell.end.localTick>clip.lengthTicks)throw Error('TIME_GRID_OUT_OF_BOUNDS: 선택한 시간 칸이 클립 밖입니다.');}else{startTick=snap.snap(startTick,rounding).localTick;durationTicks=Math.min(snap.stepTicks,clip.lengthTicks-startTick);}}catch(error){notice(`${error.code??'SNAP_ERROR'}: ${error.message}`,true);return;}
  if (durationTicks <= 0) return;
  const result = await runCommand('midi.notes.add', {clipId:clip.id,notes:[{id,pitch,startTick,durationTicks,velocity:96,channel:0}]});
  if (result) { selectedNote = id; selectedNoteIds = new Set([id]); renderUI(true); }
}
async function removeSelectedNote() {
  if (!selectedNoteIds.size) return;
  await runCommand('midi.notes.remove', {clipId:selectedClip,noteIds:[...selectedNoteIds]});
}
function resetFollowSuspension(){followSuspended=false;followDocument=documentState?.id;$('timeline-follow-resume').hidden=true;$('timeline-follow').closest('label').classList.remove('follow-suspended');}
function followPlaybackPosition(){
 if(followDocument!==documentState?.id)resetFollowSuspension();
 if(!project||!$('timeline-follow').checked||followSuspended||locatorDragging)return;const scroll=$('timeline-scroll');
 scroll.scrollLeft=playbackFollowScroll({x:geometry().timeline.secondsToX(transportSeconds),scrollLeft:scroll.scrollLeft,viewportWidth:scroll.clientWidth,contentWidth:scroll.scrollWidth,mode:$('timeline-follow-mode').value});
}
function updatePosition() {
  if (!project) return;
  const tick = secondsToTick(transportSeconds);
  if(tempoCursorChangeSupported&&document.activeElement!==$('tempo'))$('tempo').value=tempo().bpmAtTick(Math.max(0,tick));
  const beat = tick / project.ppq;
  const beatsPerBar = project.timeSignature.numerator * 4 / project.timeSignature.denominator;
  musicalDisplay?.position(tick);
  $('position-time').textContent = timeText(transportSeconds);
  $('timeline-playhead').style.left = `${geometry().timeline.secondsToX(transportSeconds)}px`;
  controllerLanesUI?.updateCursor?.();
}
let masterMeterNodes=[],masterMeterAnalysers=[],masterMeterArrays=[],masterMeterSource=null,masterMeterPeaks=[0,0],masterMeterPeakTimes=[0,0];
function resetMasterMeter(){masterMeterPeaks=[0,0];masterMeterPeakTimes=[0,0];for(let i=0;i<2;i++){$(`master-rms-${i}`).style.width='0%';$(`master-peak-${i}`).style.left='0%';$(`master-meter-${i}`).setAttribute('aria-valuenow','-60');$(`master-meter-${i}`).classList.remove('at-full-scale');$(`master-level-${i}`).textContent='−∞';}$('master-meter-warning').textContent='';}
function detachMasterMeter(){if(masterMeterSource&&masterMeterNodes[0])try{masterMeterSource.disconnect(masterMeterNodes[0]);}catch{}for(const node of masterMeterNodes)try{node.disconnect();}catch{}masterMeterNodes=[];masterMeterAnalysers=[];masterMeterArrays=[];masterMeterSource=null;resetMasterMeter();}
function attachMasterMeter(context,source,stats){
 detachMasterMeter();const splitter=context.createChannelSplitter(2),silent=context.createGain();silent.gain.value=0;silent.connect(context.destination);source.connect(splitter);masterMeterSource=source;masterMeterNodes=[splitter,silent];
 for(let i=0;i<2;i++){const analyser=context.createAnalyser();analyser.fftSize=2048;analyser.smoothingTimeConstant=0;splitter.connect(analyser,i);analyser.connect(silent);masterMeterAnalysers.push(analyser);masterMeterArrays.push(new Float32Array(analyser.fftSize));masterMeterNodes.push(analyser);}
 if(stats?.clippedSamples)$('master-meter-warning').textContent=`렌더 원신호 ${stats.clippedSamples} 채널 샘플이 0dBFS를 초과했습니다.`;
}
function updateMasterMeter(){
 const now=performance.now(),hold=clamp(Number($('master-peak-hold').value)||1500,500,30000),forever=$('master-peak-forever').checked;
 for(let i=0;i<masterMeterAnalysers.length;i++){
  const data=masterMeterArrays[i];masterMeterAnalysers[i].getFloatTimeDomainData(data);let peak=0,sum=0;for(const value of data){peak=Math.max(peak,Math.abs(value));sum+=value*value;}
  if(peak>=masterMeterPeaks[i]||!forever&&now-masterMeterPeakTimes[i]>=hold){masterMeterPeaks[i]=peak;masterMeterPeakTimes[i]=now;}
  const db=value=>value>0?20*Math.log10(value):-Infinity,rmsDb=db(Math.sqrt(sum/data.length)),peakDb=db(masterMeterPeaks[i]),currentDb=db(peak),percent=value=>clamp((value+60)/60*100,0,100);
  $(`master-rms-${i}`).style.width=`${percent(rmsDb)}%`;$(`master-peak-${i}`).style.left=`${Math.min(99,percent(peakDb))}%`;$(`master-meter-${i}`).setAttribute('aria-valuenow',String(Math.max(-60,Math.min(0,currentDb))));$(`master-level-${i}`).textContent=Number.isFinite(peakDb)?`${peakDb.toFixed(1)} dB`:'−∞';$(`master-meter-${i}`).classList.toggle('at-full-scale',peak>=.9999);
 }
}
$('master-meter-reset').addEventListener('click',resetMasterMeter);
function animatePlayback() {
  if (!audioSource || !audioContext) return;
  const elapsed=audioContext.currentTime-playbackStarted;
  transportSeconds=audioSource.loop?playbackOffset+audioSource.loopStart+elapsed%(audioSource.loopEnd-audioSource.loopStart):Math.min(playbackDuration,playbackOffset+elapsed);
  updatePosition();
  updateMasterMeter();
  followPlaybackPosition();
  animationId = requestAnimationFrame(animatePlayback);
}
function stopPreview(reset = false) {
  const cancelScrub=stopScrub;stopScrub=null;cancelScrub?.(false);
  auditionGainNode?.disconnect();auditionGainNode=null;
  detachMasterMeter();
  metronomeUI?.stop();
  controllerLanesUI?.cancelAudition();
  previewToken++;
  previewPreparing = false;
  if (animationId) cancelAnimationFrame(animationId);
  animationId = null;
  if (audioSource) {
    const old = audioSource;
    audioSource = null;
    old.onended = null;
    try { old.stop(); old.disconnect(); } catch { /* Already ended. */ }
  }
  if (activeJob?.purpose === 'preview') cancelActiveJob();
  if (reset) transportSeconds = 0;
  $('playback-status').textContent = '정지';
  updatePosition();
  updateButtons();
}
async function stopTransport(reset=false,reason=reset?'locate':'stop'){resetFollowSuspension();userStops++;stopPreview(reset);try{await nativeMidiUI?.stop(reason);await nativeAudioUI?.stop();}catch(e){notice(e.message,true);}finally{userStops--;if(reset){transportSeconds=0;updatePosition();}updateButtons();}}
function cancelActiveJob() {
  const job = activeJob;
  if (!job) return;
  job.cancelled = true;
  if (job.id) fetch(`/api/jobs/${encodeURIComponent(job.id)}/cancel`, {method:'POST',headers:{'Content-Type':'application/json',...(documentState?.id?{'X-Newdaw-Document':documentState.id}:{})},body:'{}'}).catch(() => {});
  $('job-text').textContent = '렌더 취소 중…';
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function renderSnapshot(purpose,{previewRange=null,clipIds,bypassTrackEffects=false,ignoreCycle=false,exportRange='all',tailSeconds=0.2,autoEffectTail=true,sampleFormat='pcm16',channelMode='stereo',trackIds,stemBatch=false,cycleMarkerIds,stemMixdown=false,outputSampleRate,stemSplitChannels=false,dither='none',ditherSeed,exportPresetId,fileFormat='wav'}={}) {
  if (activeJob) throw new Error('진행 중인 렌더가 있습니다. 완료하거나 취소한 뒤 다시 시도하세요.');
  const job = {id:null,purpose,cancelled:false,revision:project.revision,mediaRevision,documentId:documentState?.id};
  activeJob = job;
  $('job-bar').hidden = false;
  $('job-text').textContent = `${purpose === 'preview' ? '재생 준비' : 'WAV 렌더'} · REV ${job.revision} 스냅샷`;
  updateButtons();
  try {
    const range=purpose==='preview'&&previewRange?previewRange:purpose==='export'&&exportRange==='locators'?project.locators:null;
    if(purpose==='export'&&exportRange==='locators'&&!range)throw new Error('Locator 범위를 먼저 지정하세요.');
    if(!Number.isFinite(tailSeconds)||tailSeconds<0||tailSeconds>10)throw new Error('추가 꼬리는 0~10초로 지정하세요.');
    const profile=purpose==='preview'||range||cycleMarkerIds?await readChaseProfile():null,timing=await readTimingProfile();
    if(job.cancelled)throw new Error('재생 준비가 취소되었습니다.');
    const startTick=range?range.startTick:purpose==='preview'?Math.max(0,Math.round(secondsToTick(transportSeconds))):null;
    const rangeDuration=range?(Math.ceil(tickToSeconds(range.endTick)*project.sampleRate)-Math.ceil(tickToSeconds(range.startTick)*project.sampleRate))/project.sampleRate+tailSeconds:null;
    const cycleDuration=purpose==='preview'&&!ignoreCycle&&project.cycleEnabled&&project.locators?tickToSeconds(project.locators.endTick)-tickToSeconds(project.locators.startTick):null;
    const started = await jsonFetch('/api/render',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...(bypassTrackEffects?{bypassTrackEffects:true}:{}),...(clipIds?{clipIds}:{}),...(automaticEffectTailSupported?{autoEffectTail}:{}),...(fileFormat!=='wav'||exportPresetId?{fileFormat}:{}),...(exportPresetId?{exportPresetId}:{}),...(dither==='tpdf'||exportPresetId?{dither,ditherSeed:ditherSeed??0x6d2b79f5}:{}),...(stemSplitChannels?{stemSplitChannels:true}:{}),...(outputSampleRate?{outputSampleRate}:{}),...(stemMixdown?{stemMixdown:true}:{}),...(cycleMarkerIds?{cycleMarkerIds}:{}),...(stemBatch?{stemBatch:true}:{}),...(trackIds?{trackIds}:{}),expectedRevision:job.revision,expectedTimingRevision:timing.settings.revision,expectedTimingFingerprint:timing.fingerprint,tailSeconds,...(purpose==='export'&&wavExportChannelModes.includes(channelMode)?{channelMode}:{}),...(purpose==='export'&&wavExportFormats.includes(sampleFormat)?{sampleFormat}:{}),...(rangeDuration!==null?{durationSeconds:rangeDuration}:cycleDuration?{durationSeconds:cycleDuration+.01}:{}),...(profile?{...(purpose==='preview'?{preview:true}:{}),...(startTick!==null?{startTick}:{}),expectedChaseRevision:profile.settings.revision,expectedChaseFingerprint:profile.fingerprint}:{})})});
    job.id = started.jobId || started.id;
    if (!job.id) throw new Error('렌더 작업 ID를 받지 못했습니다.');
    if (job.cancelled) { cancelActiveJob(); throw new Error('렌더가 취소되었습니다.'); }
    const startedAt = Date.now();
    for (;;) {
      if (job.cancelled) throw new Error('렌더가 취소되었습니다.');
      if (Date.now() - startedAt > 180000) { cancelActiveJob(); throw new Error('렌더 대기 시간이 초과되었습니다.'); }
      const state = await jsonFetch(`/api/jobs/${encodeURIComponent(job.id)}`);
      if (job.cancelled) throw new Error('렌더가 취소되었습니다.');
      if (['completed','done','succeeded'].includes(state.status)) {
        if (!state.url) throw new Error('렌더 오디오 주소를 받지 못했습니다.');
        return {...state,revision:state.revision ?? job.revision,mediaRevision:state.mediaRevision ?? job.mediaRevision};
      }
      if (['failed','error','cancelled','canceled'].includes(state.status)) throw new Error(errorMessage(state, state.status.startsWith('cancel') ? '렌더가 취소되었습니다.' : '렌더에 실패했습니다.'));
      await delay(200);
    }
  } finally {
    if (activeJob === job) {activeJob = null;$('job-bar').hidden = true;}
    updateButtons();
  }
}
async function play({selectionRange=null,selectionClipIds=null,selectionTrackIds=null,bypassTrackEffects=false}={}) {
  if(recordingUI?.active||browserMidiRecordingUI?.active){notice('녹음 저장 또는 취소 후 재생하세요.',true);return;}
  controllerLanesUI?.cancelAudition();
  if (!project || busy) return;
  if (nativeMidiUI?.active || nativeAudioUI?.active || audioSource || previewPreparing || activeJob?.purpose === 'preview') { await stopTransport(false); return; }
  const token = ++previewToken;
  previewPreparing = true;
  $('playback-status').textContent = '재생 준비 중…';
  updateButtons();
  try {
    if(transportSeconds>=realProjectSeconds()+.2)transportSeconds=0;
    if(selectionRange){if(!await nativeMidiUI.previewAllowed())throw new Error('선택 범위 재생은 내장 오디오 프리뷰 모드에서 사용하세요.');transportSeconds=tickToSeconds(selectionRange.startTick);}else if(project.cycleEnabled&&project.locators){if(!await nativeMidiUI.previewAllowed())throw new Error('반복 재생은 내장 오디오 프리뷰 모드에서 사용하세요.');transportSeconds=tickToSeconds(project.locators.startTick);}else if(await nativeMidiUI.playAt(Math.max(0,Math.round(secondsToTick(transportSeconds))))){lastPlaybackStartTick=Math.max(0,Math.round(secondsToTick(transportSeconds)));lastPlaybackDocumentId=documentState?.id;return;}
    if(token!==previewToken)return;
    audioContext ||= new AudioContext();
    await audioContext.resume();
    if (token !== previewToken) return;
    if(transportSeconds>=realProjectSeconds()+.2)transportSeconds=0;
    const rendered = await renderSnapshot('preview',selectionRange?{previewRange:selectionRange,bypassTrackEffects,...(selectionTrackIds?{trackIds:selectionTrackIds}:{}),...(selectionClipIds?{clipIds:selectionClipIds}:{}),ignoreCycle:true,tailSeconds:0,autoEffectTail:false}:{});
    if (token !== previewToken || rendered.revision !== project.revision || rendered.mediaRevision !== mediaRevision) return;
    if(nativeAudioUI?.enabled){await nativeAudioUI.play(rendered);return;}
    const response = await fetch(rendered.url);
    if (!response.ok) throw new Error('렌더된 오디오를 가져오지 못했습니다.');
    const decoded = await audioContext.decodeAudioData(await response.arrayBuffer());
    if (token !== previewToken || rendered.revision !== project.revision || rendered.mediaRevision !== mediaRevision) return;
    if(!await nativeMidiUI.previewAllowed())throw new Error('Native MIDI 재생 상태가 바뀌었습니다. 다시 Play하세요.');
    const latestProfile=await readChaseProfile();
    if(token!==previewToken)return;
    if(rendered.chaseProfile?.fingerprint!==latestProfile.fingerprint)throw new Error('재생 준비 중 Chase 설정이 바뀌었습니다. 다시 Play하세요.');
    const latestTiming=await readTimingProfile();if(rendered.timingProfile?.fingerprint!==latestTiming.fingerprint)throw new Error('재생 준비 중 MIDI 시간 설정이 바뀌었습니다. 다시 Play하세요.');
    if(token!==previewToken)return;
    playbackOffset=rendered.stats?.startSeconds??0;
    playbackDuration = playbackOffset+decoded.duration;
    transportSeconds = playbackOffset;
    resetFollowSuspension();
    const source = audioContext.createBufferSource();
    source.buffer = decoded;
    if(!selectionRange&&project.cycleEnabled&&project.locators){source.loop=true;source.loopStart=Math.max(0,tickToSeconds(project.locators.startTick)-playbackOffset);source.loopEnd=tickToSeconds(project.locators.endTick)-playbackOffset;if(source.loopEnd>decoded.duration||source.loopEnd<=source.loopStart)throw new Error('Locator 범위를 프리뷰로 만들 수 없습니다.');}
    if(selectionRange){auditionGainNode=audioContext.createGain();auditionGainNode.gain.value=10**(Number($('audition-level').value)/20);source.connect(auditionGainNode);auditionGainNode.connect(audioContext.destination);}else source.connect(audioContext.destination);
    attachMasterMeter(audioContext,auditionGainNode??source,rendered.stats);
    audioSource = source;
    lastPlaybackStartTick=Math.max(0,Math.round(secondsToTick(playbackOffset)));lastPlaybackDocumentId=documentState?.id;
    playbackStarted = audioContext.currentTime;
    source.onended = () => {
      if (audioSource !== source) return;
      audioSource = null;
      auditionGainNode?.disconnect();auditionGainNode=null;
      metronomeUI?.stop();
      resetFollowSuspension();
      detachMasterMeter();
      source.disconnect();
      cancelAnimationFrame(animationId);
      transportSeconds = playbackDuration;
      $('playback-status').textContent = '재생 완료';
      updatePosition();
      updateButtons();
    };
    source.start(0,source.loop?source.loopStart:0);
    if(!selectionRange)metronomeUI?.start();
    previewPreparing = false;
    $('playback-status').textContent = `재생 중 · REV ${rendered.revision}`;
    updateButtons();
    animatePlayback();
    if (rendered.stats?.warnings?.length) notice(rendered.stats.warnings.map((item) => item.message || String(item)).join(' · '));
  } catch (error) {
    if (token === previewToken) notice(error.message, true);
  } finally {
    if (token === previewToken) previewPreparing = false;
    updateButtons();
  }
}
async function renderWav() {
  const requestedDocumentId=documentState?.id;
  try {
    const result = await renderSnapshot('export',{autoEffectTail:$('mix-export-auto-tail').checked,exportRange:$('mix-export-range').value,tailSeconds:Number($('mix-export-tail').value),sampleFormat:$('mix-export-format').value,fileFormat:$('mix-export-file-format').value,...(!$('mix-export-presets').hidden&&$('export-preset-select').value?{exportPresetId:$('export-preset-select').value}:{}),...(!$('mix-export-dither-field').hidden?{dither:$('mix-export-dither').value,ditherSeed:mixExportDitherSeed}:{}),channelMode:$('mix-export-channels').value,...(stemSplitSupported&&$('mix-export-split').checked&&$('mix-export-channels').value==='stereo'&&['stems','cycleMix'].includes($('mix-export-target').value)?{stemSplitChannels:true}:{}),...(!$('mix-export-sample-rate').hidden?($('mix-export-sample-rate').value!=='project'?{outputSampleRate:Number($('mix-export-sample-rate').value)}:$('export-preset-select').value?{outputSampleRate:null}:{}):{}),...($('mix-export-target').value==='cycleMix'?{stemBatch:true,stemMixdown:true,cycleMarkerIds:[...$('mix-export-cycles').selectedOptions].map(o=>o.value)}:renderTrackSelectionSupported&&$('mix-export-target').value!=='mix'?{trackIds:[...$('mix-export-tracks').selectedOptions].map(o=>o.value),stemBatch:$('mix-export-target').value==='stems',...($('mix-export-range').value==='cycles'?{cycleMarkerIds:[...$('mix-export-cycles').selectedOptions].map(o=>o.value)}:{})}:{})});
    if(requestedDocumentId!==documentState?.id||!project)return;
    renderResult = result;
    renderInspector();
    const warnings = result.stats?.warnings?.map((item) => item.message || String(item)).join(' · ');
    notice(`WAV 렌더 완료 · REV ${result.revision}${result.revision !== project.revision || result.mediaRevision !== mediaRevision ? ' (현재 프로젝트 또는 미디어와 다른 스냅샷)' : ''}. Inspector에서 다운로드할 수 있습니다.${warnings ? ` ${warnings}` : ''}`);
  } catch (error) { if(requestedDocumentId===documentState?.id)notice(error.message, true); }
}
async function download(url, name,{documentId}={}) {
  try {
    const response = await fetch(url,{...(documentId?{headers:{'X-Newdaw-Document':documentId}}:{})});
    if (!response.ok) throw new Error(`다운로드 실패 · HTTP ${response.status}`);
    const blob = await response.blob();
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = href; anchor.download = name; anchor.click();
    setTimeout(() => URL.revokeObjectURL(href), 10000);return true;
  } catch (error) { notice(error.message, true);return false; }
}
function importType(file){return /\.wav$/i.test(file.name)?'wav':/\.(aif|aiff|aifc)$/i.test(file.name)?'aiff':/\.(mid|midi)$/i.test(file.name)?'midi':null;}
function importProblem(file){const type=importType(file);return !type?'WAV, AIFF 또는 MIDI 파일을 선택하세요.':type==='aiff'&&!aiffImportSupported?'AIFF 가져오기는 서버 갱신 후 사용할 수 있습니다.':file.size>(type==='midi'?midiUploadLimit:wavUploadLimit)?`${file.name}: 파일 크기 한도를 초과했습니다.`:null;}
async function importFile(file,draft,inBatch=false){
 if(!file||busy&&!inBatch||!project)return null;
 const type=importType(file),invalid=importProblem(file);if(invalid){notice(invalid,true);return null;}
 if(!draft||draft.documentId!==documentState?.id||draft.revision!==project.revision){notice('파일 선택 중 프로젝트가 변경되었습니다. 가져오기를 다시 여세요.',true);return null;}
 busy=true;stopPreview(false);$('save-state').textContent=`${file.name} 가져오는 중…`;updateButtons();let committed=null;
 const previousIds=new Set(project.tracks.map(t=>t.id));
 try{
  const params=new URLSearchParams({name:file.name,expectedRevision:String(draft.revision)});
  if(type==='midi'&&midiImportSinglePartSupported)params.set('midiSinglePart',draft.midiSinglePart?'1':'0');
  if(type==='midi'&&midiImportLocatorSupported)params.set('midiPosition',draft.midiPosition??'start');
  if(type==='midi'&&midiImportDissolveSupported)params.set('midiAutoDissolve',draft.midiAutoDissolve?'1':'0');
  if(type==='midi'&&midiImportInspectorSupported){params.set('midiExtractPatch',draft.midiExtractPatch?'1':'0');params.set('midiExtractVolumePan',draft.midiExtractVolumePan?'1':'0');}
  if(type==='midi'&&midiImportTimingSupported){params.set('midiTempo',draft.midiTempo??'auto');params.set('midiSignature',draft.midiSignature??'preserve');params.set('midiMarkers',draft.midiMarkers===false?'0':'1');}
  if(type!=='midi'&&wavImportTargetSupported){params.set('atSample',String(draft.atSample));if(draft.trackId)params.set('trackId',draft.trackId);}
  const body=await jsonFetch(`/api/import/${type}?${params}`,{method:'POST',headers:{'Content-Type':type==='wav'?'audio/wav':type==='aiff'?'audio/aiff':'audio/midi'},body:file});
  committed={applied:true,revision:body.projectRevision,documentId:draft.documentId,midiImportReport:body.midiImportReport,warnings:body.warnings??[]};await refreshState();
  if(draft.documentId!==documentState?.id)return {...committed,stale:true};
  const added=project.tracks.find(t=>!previousIds.has(t.id)),created=new Set(body.changes?.created??[]),clip=project.clips.find(c=>created.has(c.id)&&c.type==='audio');
  if(added)selectTrack(added.id);else if(type!=='midi'&&draft.trackId)selectTrack(draft.trackId);
  const warnings=(body.warnings??[]).map(w=>w.message||String(w));
  notice(`${file.name} 가져오기 완료.${warnings.length?' '+warnings.slice(0,6).join(' · ')+(warnings.length>6?` · 외 ${warnings.length-6}건: 가져오기 결과 참조`:''):''}`);
  return {...committed,stale:project.revision!==body.projectRevision,clip:clip?structuredClone(clip):null,asset:clip?structuredClone(project.assets.find(a=>a.id===clip.assetId)):null};
 }catch(error){
  notice(error.status===409?'가져오는 동안 프로젝트가 바뀌었습니다. 최신 상태를 확인하세요.':error.message,true);
  try{await refreshState();}catch{setConnection(false);}
  return committed?{...committed,stale:true,error:error.message}:{applied:false,error:error.message,uncertain:![409,422,415,413].includes(error.status)};
 }finally{if(!inBatch)busy=false;updateButtons();$('save-state').textContent=connected?saveStateLabel():'서버 연결 대기';}
}
async function importFiles(files,draft){
 if(!files.length||busy||!project)return;
 if(files.length>32){notice('한 번에 최대 32개 파일을 선택하세요.',true);return;}
 const invalid=files.map(importProblem).find(Boolean);if(invalid){notice(invalid,true);return;}
 if(!draft||draft.documentId!==documentState?.id||draft.revision!==project.revision){notice('프로젝트가 변경되었습니다. 가져오기를 다시 여세요.',true);return;}
 busy=true;importBatchCancelled=false;$('import-batch-report').hidden=true;$('cancel-import-batch').hidden=false;$('cancel-import-batch').disabled=false;$('cancel-import-batch').textContent='다음 파일부터 중단';updateButtons();
 const report={documentId:draft.documentId,initialRevision:draft.revision,placement:draft.placement??'parallel',files:files.map(file=>({name:file.name,status:'not-started'}))};let next={...draft};
 try{
  for(let index=0;index<files.length;index++){
   if(importBatchCancelled)break;
   if(documentState?.id!==next.documentId||project?.revision!==next.revision){report.stoppedReason='project-changed';break;}
   const result=await importFile(files[index],next,true),row=report.files[index];
   Object.assign(row,{status:result?.applied?'imported':result?.uncertain?'uncertain':'failed',revision:result?.revision,error:result?.error,warnings:result?.warnings??[],...(result?.midiImportReport?{midiImportReport:result.midiImportReport}:{})});
   if(!result?.applied){report.stoppedReason=result?.uncertain?'current-file-status-uncertain':'file-failed';break;}
   if(result.stale){report.stoppedReason='project-changed-or-refresh-failed';break;}
   next.revision=result.revision;
   if(draft.placement==='serial'&&result.clip){next.trackId=result.clip.trackId;next.atSample=Math.ceil(result.clip.startSample+result.clip.lengthFrames/result.asset.sampleRate*project.sampleRate);if(!Number.isSafeInteger(next.atSample)){report.stoppedReason='position-overflow';break;}}
  }
  report.cancelled=importBatchCancelled;report.completed=report.files.filter(r=>r.status==='imported').length;
  if(importReportUrl)URL.revokeObjectURL(importReportUrl);importReportUrl=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));$('import-batch-report').href=importReportUrl;$('import-batch-report').hidden=false;
  notice(`${report.completed}/${files.length}개 가져오기 완료.${report.completed<files.length?' 나머지는 적용하지 않았거나 상태 확인이 필요합니다. 가져오기 결과를 확인하세요.':''}`,report.completed<files.length);
 }finally{busy=false;$('cancel-import-batch').hidden=true;updateButtons();$('save-state').textContent=connected?saveStateLabel():'서버 연결 대기';}
}
$('cancel-import-batch').addEventListener('click',()=>{importBatchCancelled=true;$('cancel-import-batch').disabled=true;$('cancel-import-batch').textContent='현재 파일 처리 후 중단';});

async function sessionRequest(route,body) {
  if(busy||!connected)throw new Error('다른 작업을 마친 뒤 다시 시도하세요.');
  busy=true;updateButtons();
  try {const result=await jsonFetch(route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});await refreshState();return result;}
  catch(error){if(error.status===409&&error.body?.errors?.some(e=>['REVISION_CONFLICT','MISSING_SET_CHANGED'].includes(e.code))){await refreshState();throw new Error('프로젝트 또는 미디어가 변경되었습니다. 최신 목록을 확인하고 다시 적용하세요.');}throw error;}
  finally{busy=false;updateButtons();$('save-state').textContent=connected?saveStateLabel():'서버 연결 대기';}
}

async function restoreAsset({assetId, file, expectedRevision}) {
  if (!project || busy || !connected) throw new Error('다른 작업을 마친 뒤 연결 상태를 확인하고 다시 복구하세요.');
  if (!file || file.size > wavUploadLimit) throw new Error(`복구할 WAV는 ${wavUploadLimit/1024/1024} MiB 이하여야 합니다.`);
  busy = true; stopPreview(false); updateButtons();
  $('save-state').textContent = '원본 미디어 대조 중…';
  try {
    const result = await jsonFetch(`/api/assets/${encodeURIComponent(assetId)}/restore?expectedRevision=${expectedRevision}`, {
      method:'POST', headers:{'Content-Type':'audio/wav'}, body:file
    });
    await refreshState();
    return result;
  } catch (error) {
    if (error.status === 409) { await refreshState(); throw new Error('프로젝트가 변경되었습니다. 목록을 다시 검사하고 복구할 파일을 다시 선택하세요.'); }
    throw error;
  } finally {
    busy = false; updateButtons();
    $('save-state').textContent = connected ? saveStateLabel() : '서버 연결 대기';
  }
}
function revealClip(id) {
  revealClips([id]);
}
function revealClips(ids) {
  const valid=ids.filter(id=>project.clips.some(clip=>clip.id===id));
  if(!valid.length)return;
  const id=valid[0];
  selectClip(id);
  selectedClipIds=new Set(valid);renderUI(true);
  document.querySelector(`.timeline-clip[data-clip-id="${CSS.escape(id)}"]`)?.scrollIntoView({block:'nearest', inline:'center'});
}

$('notice-dismiss').addEventListener('click', () => { $('notice').hidden = true; });
$('add-track').addEventListener('click', openAddTracks);
$('empty-add').addEventListener('click', addTrack);
$('add-clip').addEventListener('click', addClip);
$('add-note').addEventListener('click', () => addNoteAt(0,60,'ceil'));
$('delete-note').addEventListener('click', removeSelectedNote);
$('undo').addEventListener('click', () => runCommand('history.undo'));
$('redo').addEventListener('click', () => runCommand('history.redo'));
try{const stored=localStorage.getItem('newdaw.audition.levelDb');if(stored!==null&&Number.isFinite(Number(stored)))$('audition-level').value=String(clamp(Number(stored),-60,0));}catch{}
function updateAuditionLevel(){const db=Number($('audition-level').value);$('audition-level-value').textContent=`${db} dB`;if(auditionGainNode&&audioContext){auditionGainNode.gain.cancelScheduledValues(audioContext.currentTime);auditionGainNode.gain.setTargetAtTime(10**(db/20),audioContext.currentTime,.01);}try{localStorage.setItem('newdaw.audition.levelDb',String(db));}catch{}}
$('audition-level').addEventListener('input',updateAuditionLevel);updateAuditionLevel();
const timelinePointerTools=['timeline-range-mode','midi-glue-tool','audio-scrub-tool','track-audition-tool'];
function selectTimelineTool(mode=null){
 for(const id of timelinePointerTools)$(id).checked=id===mode;
 if(mode!=='audio-scrub-tool')stopScrub?.();
 updateToolbarModes();
}
for(const id of timelinePointerTools)$(id).addEventListener('change',()=>selectTimelineTool($(id).checked?id:null));
$('timeline-select-tool').addEventListener('click',()=>selectTimelineTool());
function updateToolbarModes(){
 $('timeline-select-tool').setAttribute('aria-pressed',String(!['timeline-range-mode','midi-glue-tool','audio-scrub-tool','track-audition-tool'].some(id=>$(id).checked)));
 const edit=[];if(audioTimeStretchSupported&&$('audio-resize-mode').value==='timeStretch')edit.push('타임스트레치');if(!$('audio-resize-mode-field').hidden&&$('audio-resize-mode').value==='moveContents')edit.push('내용 이동');if($('midi-glue-tool').checked)edit.push('붙이기');if($('zero-crossing-split').checked)edit.push('Zero');$('editing-tools-state').textContent=edit.length?' · '+edit.join('/') : '';
 const audition=[];if($('audio-scrub-tool').checked)audition.push('스크럽');if($('track-audition-tool').checked)audition.push('누르고 듣기');$('audition-tools-state').textContent=audition.length?' · '+audition.join('/') : '';
}
try{const mode=localStorage.getItem('newdaw.audio.resizeMode');if(['moveContents','timeStretch'].includes(mode))$('audio-resize-mode').value=mode;}catch{}
$('audio-resize-mode').addEventListener('change',()=>{try{localStorage.setItem('newdaw.audio.resizeMode',$('audio-resize-mode').value);}catch{}updateToolbarModes();});
for(const id of ['editing-tools-menu','audition-tools-menu'])$(id).addEventListener('change',updateToolbarModes);
document.addEventListener('pointerdown',event=>{for(const menu of document.querySelectorAll('.toolbar-popup[open], #arrangement-edit-menu[open]'))if(!menu.contains(event.target))menu.open=false;});
$('play').addEventListener('click', play);
function previewSelectedClips(onlyClips=false){
 if(!project||busy||!connected||!selectedClipIds.size)return;
 const clips=project.clips.filter(c=>selectedClipIds.has(c.id));if(!clips.length)return;
 let start=Infinity,end=0;for(const clip of clips){const bounds=clipTiming(clip);start=Math.min(start,bounds.start);end=Math.max(end,bounds.end);}
 const selectionRange={startTick:Math.max(0,Math.floor(start)),endTick:Math.ceil(end)};
 if(selectionRange.endTick<=selectionRange.startTick){notice('양의 길이를 가진 클립을 선택하세요.',true);return;}
 void play({selectionRange,...(onlyClips?{selectionClipIds:clips.map(c=>c.id),bypassTrackEffects:!$('audition-effect-bypass-field').hidden&&$('audition-effect-bypass').checked}:{})});
}
$('fill-loop-clips').addEventListener('click',async()=>{if(!project||busy||!connected||!selectedClipIds.size||!project.locators)return;const doc=documentState?.id,result=await runCommand('clips.fillLoop',{clipIds:[...selectedClipIds],timeBase:$('fill-loop-time-base').value},project.revision);if(result&&doc===documentState?.id){const ids=result.changes?.fillLoop?.clipIds??[];if(ids.length){selectedClipIds=new Set(ids);selectedClip=ids[0];selectedTrack=project.clips.find(c=>c.id===selectedClip)?.trackId??selectedTrack;selectedNote=null;selectedNoteIds.clear();renderUI(true);}}});
$('glue-selected-audio-clips').addEventListener('click',async()=>{if(!project||busy||!connected||selectedClipIds.size<2)return;const doc=documentState?.id,ids=[...selectedClipIds],result=await runCommand('audio.clips.glue',{clipIds:ids},project.revision);if(!result||doc!==documentState?.id)return;const kept=project.clips.find(c=>ids.includes(c.id));if(kept){selectedClip=kept.id;selectedClipIds=new Set([kept.id]);selectedTrack=kept.trackId;selectedNote=null;selectedNoteIds.clear();renderUI(true);}});
$('glue-selected-midi-clips').addEventListener('click',async()=>{if(!project||busy||!connected||selectedClipIds.size<2)return;const doc=documentState?.id,ids=[...selectedClipIds],result=await runCommand('midi.clips.glue',{clipIds:ids},project.revision);if(!result||doc!==documentState?.id)return;const kept=project.clips.find(c=>ids.includes(c.id));if(kept){selectedClip=kept.id;selectedClipIds=new Set([kept.id]);selectedTrack=kept.trackId;selectedNote=null;selectedNoteIds.clear();renderUI(true);}});
$('play-selected-range').addEventListener('click',()=>previewSelectedClips());
$('audition-selected-clips').addEventListener('click',()=>previewSelectedClips(true));
$('stop').addEventListener('click', () => void stopTransport(false));
$('rewind').addEventListener('click', () => void stopTransport(true));
function updateMixExportSummary(){
 if(!$('mix-export-dialog').open||!project)return;
 const stale=!mixExportDraft||mixExportDraft.documentId!==documentState?.id||mixExportDraft.revision!==project.revision;
 const cycles=$('mix-export-range').value==='cycles',isRange=$('mix-export-range').value==='locators',range=project.locators,tail=Number($('mix-export-tail').value),stems=['stems','cycleMix'].includes($('mix-export-target').value),cycleMix=$('mix-export-target').value==='cycleMix';
 const ids=[...$('mix-export-cycles').selectedOptions].map(o=>o.value),markers=(project.markers??[]).filter(m=>ids.includes(m.id)&&m.endTick!==undefined);
 const selectionScope=['stems','selection'].includes($('mix-export-target').value),selectionIds=new Set([...$('mix-export-tracks').selectedOptions].map(o=>o.value)),anySolo=project.tracks.some(t=>t.solo),effectTracks=project.tracks.filter(t=>!t.mute&&(selectionScope?selectionIds.has(t.id):!anySolo||t.solo||t.soloDefeat)),autoTail=automaticEffectTailSupported&&$('mix-export-auto-tail').checked&&!cycles&&!isRange&&delayTailEstimator?Math.min(10,effectTracks.reduce((max,t)=>Math.max(max,delayTailEstimator(t,project.sampleRate,project.tempoMap)),0)):0;
 const durations=cycles?markers.map(m=>tickToSeconds(m.endTick)-tickToSeconds(m.tick)+tail):[(isRange&&range?tickToSeconds(range.endTick)-tickToSeconds(range.startTick):realProjectSeconds())+Math.max(tail,autoTail)];
 const duration=durations.length?Math.max(...durations):0,totalDuration=durations.reduce((a,b)=>a+b,0);
 const outputRate=!$('mix-export-sample-rate').hidden&&$('mix-export-sample-rate').value!=='project'?Number($('mix-export-sample-rate').value):project.sampleRate;
 const channels=wavExportChannelModes.includes($('mix-export-channels').value)&&$('mix-export-channels').value!=='stereo'?1:2;
 const format=wavExportFormats.includes($('mix-export-format').value)?$('mix-export-format').value:'pcm16',bytesPerSample=format==='pcm16'?2:format==='pcm24'?3:4;
 const floatOutput=format==='float32';$('mix-export-dither').querySelector('[value=tpdf]').disabled=floatOutput;if(floatOutput)$('mix-export-dither').value='none';
 const noTracks=renderTrackSelectionSupported&&['stems','selection'].includes($('mix-export-target').value)&&!$('mix-export-tracks').selectedOptions.length;
 $('mix-export-split').disabled=!stems||$('mix-export-channels').value!=='stereo';
 const split=stems&&stemSplitSupported&&$('mix-export-split').checked&&$('mix-export-channels').value==='stereo';
 const stemCount=stems&&!cycleMix?$('mix-export-tracks').selectedOptions.length:1,fileCount=stemCount*durations.length*(split?2:1),stemBytes=Math.max(0,totalDuration)*outputRate*channels*bytesPerSample*stemCount+4096*fileCount;
 const stemTooLarge=stems&&(stemCount>128||fileCount>4096||stemBytes>128*1024*1024);
 const badContainer=$('mix-export-file-format').value==='aiff'&&format==='float32';
 const invalid=automaticEffectTailSupported&&!delayTailEstimator||badContainer||cycles&&(!markers.length||!stems)||stemTooLarge||noTracks||stale||isRange&&!range||!Number.isFinite(tail)||tail<0||tail>10||duration<=0||duration>renderMaxSeconds;
 $('mix-export-submit').disabled=invalid||busy||!!activeJob||!connected;$('mix-export-submit').textContent=stems?'ZIP 렌더':$('mix-export-file-format').value==='aiff'?'AIFF 렌더':'WAV 렌더';
 $('mix-export-project').textContent=`${project.name} · REV ${mixExportDraft?.revision??project.revision}`;
 $('mix-export-summary').textContent=stale?'프로젝트가 변경되었습니다. 닫고 다시 열어 범위를 확인하세요.':badContainer?'AIFF는 PCM 16/24-bit를 선택하세요.':noTracks?'출력할 트랙을 선택하세요.':cycles&&!markers.length?'사이클 마커를 선택하세요.':stemTooLarge?'스템 ZIP은 128트랙 / 4096파일 / 128 MiB 이하로 범위를 줄이세요.':isRange&&!range?'Locator 범위를 먼저 지정하세요.':`${cycles?markers.length+'개 구간 · 최대 ':''}${Number.isFinite(duration)?duration.toFixed(2):'—'}초 · ${outputRate} Hz · ${channels===1?'Mono':'Stereo'} · ${format} · 팬 ${panLawLabel(project.panLaw)}${$('mix-export-channels').value==='mono'?` · 모노 합산 ${monoLawLabel(project.panLaw)} · 동상 신호 레벨 증가 가능`:''}${stems?' · '+fileCount+'개 WAV · ZIP 약 '+(stemBytes/1024/1024).toFixed(1)+' MiB':''}${duration>renderMaxSeconds?' · 지원 길이 초과':''}`;
}
$('render-button').addEventListener('click',()=>{if(!project||busy||activeJob)return;mixExportDraft={documentId:documentState?.id,revision:project.revision};$('mix-export-target').value='mix';if($('mix-export-range').value==='cycles')$('mix-export-range').value='all';$('mix-export-cycle-field').hidden=true;$('mix-export-cycles').innerHTML=(project.markers??[]).filter(m=>m.endTick!==undefined).map(m=>`<option value="${esc(m.id)}">${m.number} · ${esc(m.name)} · ${m.tick}–${m.endTick}</option>`).join('');$('mix-export-track-field').hidden=true;$('mix-export-tracks').innerHTML=project.tracks.map(t=>`<option value="${esc(t.id)}" ${t.id===selectedTrack?'selected':''}>${esc(t.name)}${t.mute?' · 뮤트':''}</option>`).join('');refreshExportPresets();$('mix-export-dialog').showModal();updateMixExportSummary();});
$('mix-export-form').addEventListener('input',updateMixExportSummary);
$('mix-export-form').addEventListener('change',updateMixExportSummary);
$('mix-export-form').addEventListener('submit',event=>{event.preventDefault();updateMixExportSummary();if($('mix-export-submit').disabled)return;$('mix-export-dialog').close();void renderWav();});
$('cancel-render').addEventListener('click', () => { if (activeJob?.purpose === 'preview') stopPreview(false); else cancelActiveJob(); });
function readMidiImportChoices(){return {midiSinglePart:$('midi-import-single-part').checked,midiPosition:$('midi-import-position').value,midiAutoDissolve:$('midi-import-dissolve').checked,midiExtractPatch:$('midi-import-extract-patch').checked,midiExtractVolumePan:$('midi-import-extract-volumePan').checked,midiTempo:$('midi-import-tempo').value,midiSignature:$('midi-import-signature').value,midiMarkers:$('midi-import-markers').checked};}
$('midi-import-single-part').addEventListener('change',()=>{if($('midi-import-single-part').checked)$('midi-import-dissolve').checked=false;});
$('midi-import-dissolve').addEventListener('change',()=>{if($('midi-import-dissolve').checked)$('midi-import-single-part').checked=false;});
$('import-button').addEventListener('click', () => {
 if(!project||busy||!connected)return;
 importOptionsDraft={documentId:documentState?.id,revision:project.revision,cursorSample:Math.max(0,Math.round(transportSeconds*project.sampleRate))};
 $('import-audio-target').innerHTML='<option value="">새 오디오 트랙</option>'+project.tracks.filter(t=>t.type==='audio').map(t=>`<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('');
 $('import-audio-target').value=project.tracks.some(t=>t.id===selectedTrack&&t.type==='audio')?selectedTrack:'';
 $('import-audio-target').disabled=!wavImportTargetSupported;
 $('import-audio-position').disabled=!wavImportTargetSupported;$('import-placement').querySelector('[value=serial]').disabled=!wavImportTargetSupported;
 $('import-audio-position').value=wavImportTargetSupported?'cursor':'start';
 $('import-options-scope').textContent=wavImportTargetSupported?`커서 위치: ${(importOptionsDraft.cursorSample/project.sampleRate).toFixed(3)}초`:'현재 서버는 새 트랙 · 프로젝트 시작 위치만 지원합니다.';
 $('import-options-dialog').showModal();
});
$('import-choose-file').addEventListener('click',()=>{
 const draft=importOptionsDraft;
 if(!draft||busy||draft.documentId!==documentState?.id||draft.revision!==project?.revision){notice('프로젝트가 변경되었습니다. 가져오기를 다시 여세요.',true);return;}
 importFileDraft={...draft,...readMidiImportChoices(),placement:$('import-placement').value,trackId:wavImportTargetSupported?$('import-audio-target').value:'',atSample:wavImportTargetSupported&&$('import-audio-position').value==='cursor'?draft.cursorSample:0};
 $('import-options-dialog').close();$('import-file').click();
});
$('import-file').addEventListener('cancel',()=>{importFileDraft=null;});
$('import-file').addEventListener('change',event=>{const files=[...event.target.files],draft=importFileDraft;importFileDraft=null;event.target.value='';void importFiles(files,draft);});
$('midi-export-open').addEventListener('click',()=>{
 if(!project||busy||!connected)return;const trackIds=project.tracks.filter(t=>t.type==='midi'&&selectedTrackIds.has(t.id)).map(t=>t.id);
 midiExportDraft={documentId:documentState?.id,revision:project.revision,trackIds};$('midi-export-project').textContent=`${project.name} · REV ${project.revision} · 선택 MIDI 트랙 ${trackIds.length}개 · 원본 ${project.ppq} PPQ`;
 $('midi-export-scope').querySelector('[value=selected]').disabled=!trackIds.length;if(!trackIds.length)$('midi-export-scope').value='all';$('midi-export-dialog').showModal();updateButtons();
});
$('midi-export-dialog').addEventListener('close',()=>{midiExportDraft=null;updateButtons();});
$('midi-download').addEventListener('click', async () => {
 if(!project||midiExportDownloading||!midiExportDraft)return;
 if(midiExportDraft.documentId!==documentState?.id||midiExportDraft.revision!==project.revision){notice('프로젝트가 변경되었습니다. MIDI 내보내기 창을 다시 여세요.',true);return;}
const format=$('midi-export-format').value,selected=midiTrackExportSupported&&$('midi-export-scope').value==='selected',ids=midiExportDraft.trackIds,params=new URLSearchParams({format});
 if(selected&&!ids.length){notice('내보낼 MIDI 트랙을 선택하세요. 오디오 트랙은 SMF에 포함하지 않습니다.',true);return;}
 if(!$('midi-export-options').hidden)for(const key of ['patch','volumePan','modifiers','markers','delay'])params.set(key,$(`midi-include-${key}`).checked?'1':'0');
 if(!$('midi-export-range').hidden&&$('midi-export-range').value!=='all'){if(!project.locators){notice('MIDI 내보내기 전에 Locator 범위를 지정하세요.',true);return;}params.set('range','locators');if($('midi-export-range').value==='locatorsNoChase')params.set('chase','0');}
 if(!$('midi-export-ppq').hidden&&$('midi-export-ppq').value!=='project')params.set('ppq',$('midi-export-ppq').value);
 if(midiTrackExportSupported){params.set('expectedRevision',String(project.revision));if(selected)for(const id of ids)params.append('trackId',id);}
 notice(`MIDI: ${selected?ids.length+'개 선택 트랙':'전체 MIDI 트랙'} · ${params.get('ppq')??project.ppq} PPQ${params.has('ppq')&&Number(params.get('ppq'))<project.ppq?' · 낮은 PPQ는 짧은 노트·미세 타이밍을 반올림합니다.':''}${params.has('range')?' · Locator를 0부터 출력하며 끝에서 노트·페달을 종료합니다.':''} · 프로젝트 템포 포함${params.get('markers')!=='0'?' · 마커 포함':''}. 오디오·믹서·음원·뮤트/솔로는 표현하지 않습니다.${format==='0'?' SMF 0은 트랙을 합칩니다.':''}`);
 midiExportDownloading=true;updateButtons();try{if(await download(`/api/export/midi?${params}`,`${project.name}${selected?' Selected':''}.mid`,{documentId:midiExportDraft.documentId}))$('midi-export-dialog').close();}finally{midiExportDownloading=false;updateButtons();}
});
$('project-download').addEventListener('click', () => { notice('프로젝트 JSON은 WAV의 상대 경로만 참조합니다. 오디오 파일을 포함한 백업 패키지가 아닙니다.'); download('/api/project', `${project.name}.json`); });
$('project-name-form').addEventListener('submit', (event) => { event.preventDefault(); $('project-name').blur(); });
$('project-name').addEventListener('focus', () => { $('project-name').dataset.revision = project?.revision; });
$('project-name').addEventListener('change', () => { if ($('project-name').value !== project.name) runCommand('project.rename',{name:$('project-name').value},Number($('project-name').dataset.revision)); });
$('tempo-form').addEventListener('submit', (event) => { event.preventDefault(); $('tempo').blur(); });
$('tempo').addEventListener('focus',()=>{$('tempo').dataset.revision=project?.revision;$('tempo').dataset.documentId=documentState?.id??'';$('tempo').dataset.atTick=project?Math.max(0,Math.round(secondsToTick(transportSeconds))):0;});
$('tempo').addEventListener('change',()=>{if(!$('tempo').checkValidity()){$('tempo').reportValidity();return;}if($('tempo').dataset.documentId!==documentState?.id){notice('문서가 바뀌었습니다. 템포를 다시 입력하세요.',true);return;}const bpm=Number($('tempo').value),revision=Number($('tempo').dataset.revision);if(tempoCursorChangeSupported)void runCommand('tempo.change',{atTick:Number($('tempo').dataset.atTick),bpm},revision);else void runCommand('tempo.set',{tempoMap:project.tempoMap.map((point,index)=>index?point:{...point,bpm})},revision);});
$('master-gain').addEventListener('input', () => { $('master-value').textContent = dbLabel(Number($('master-gain').value)); });
$('master-gain').addEventListener('change', () => runCommand('project.settings',{masterGainDb:Number($('master-gain').value)}));
function applyEditorZoom(value,{anchorSeconds,anchorPixel}={}){
 if(!project)return;cancelNoteDrag();const scroll=$('timeline-scroll'),before=geometry().timeline;
 const pixel=anchorPixel??scroll.clientWidth/2,seconds=anchorSeconds??before.xToSeconds(scroll.scrollLeft+pixel);
 pxPerBeat=clamp(value,Number($('zoom').min),Number($('zoom').max));$('zoom').value=String(pxPerBeat);
 renderTimeline();renderPianoRoll();updatePosition();controllerLanesUI?.update();
 scroll.scrollLeft=Math.max(0,geometry().timeline.secondsToX(seconds)-pixel);
}
function fitTimeline(selection=false){
 if(!project)return;const clips=selection?project.clips.filter(c=>selectedClipIds.has(c.id)):project.clips;
 if(selection&&!clips.length){notice('맞출 클립을 먼저 선택하세요.',true);return;}
 const view=geometry().timeline,scroll=$('timeline-scroll');let start=0,end=projectEnd();
 if(selection){start=Infinity;end=0;for(const clip of clips){const timing=clipTiming(clip);start=Math.min(start,timing.start);end=Math.max(end,timing.end);}}
 const left=view.tickToX(start),span=Math.max(1,view.tickToX(end)-left),available=Math.max(1,scroll.clientWidth-48);
 applyEditorZoom(pxPerBeat*available/span,{anchorSeconds:view.xToSeconds(left),anchorPixel:24});
}
$('zoom').addEventListener('input',()=>applyEditorZoom(Number($('zoom').value)));
try{$('timeline-follow').checked=localStorage.getItem('newdaw.timeline.follow')!=='false';}catch{}
$('timeline-follow').addEventListener('change',()=>{resetFollowSuspension();try{localStorage.setItem('newdaw.timeline.follow',String($('timeline-follow').checked));}catch{}if(audioSource||nativeMidiUI?.active)followPlaybackPosition();});
try{const saved=JSON.parse(localStorage.getItem('newdaw.timeline.followOptions')??'null');if(['page','stationary'].includes(saved?.mode))$('timeline-follow-mode').value=saved.mode;if(typeof saved?.suspend==='boolean')$('timeline-follow-suspend').checked=saved.suspend;}catch{}
function saveFollowOptions(){try{localStorage.setItem('newdaw.timeline.followOptions',JSON.stringify({mode:$('timeline-follow-mode').value,suspend:$('timeline-follow-suspend').checked}));}catch{}if(!$('timeline-follow-suspend').checked)resetFollowSuspension();if(audioSource||nativeMidiUI?.active)followPlaybackPosition();}
$('timeline-follow-mode').addEventListener('change',saveFollowOptions);
$('timeline-follow-suspend').addEventListener('change',saveFollowOptions);
$('timeline-follow-resume').addEventListener('click',()=>{resetFollowSuspension();followPlaybackPosition();});
$('timeline-lanes').addEventListener('pointerdown',event=>{if(event.button!==0||!$('timeline-follow').checked||!$('timeline-follow-suspend').checked||!(audioSource||nativeMidiUI?.active))return;followSuspended=true;followDocument=documentState?.id;$('timeline-follow-resume').hidden=false;$('timeline-follow').closest('label').classList.add('follow-suspended');},{capture:true});
$('timeline-fit-project').addEventListener('click',()=>fitTimeline());
$('timeline-fit-selection').addEventListener('click',()=>fitTimeline(true));
$('snap').addEventListener('change', async () => {cancelNoteDrag();await runCommand('project.snapGrid',{options:{piano:{quarterNotes:Number($('snap').value)}}});renderPianoRoll();controllerLanesUI?.update();});
let locatorDraftContext=null;
function revealSplitResult(result,doc){
 if(!result||documentState?.id!==doc)return;const splits=result.changes?.splits??result.changes?.operations?.map(o=>o.changes?.split).filter(Boolean)??[];if(splits.length){const ids=new Set(splits.flatMap(s=>[s.leftClipId,s.rightClipId]));selectedClipIds=new Set(project.clips.filter(c=>ids.has(c.id)).map(c=>c.id));selectedClip=splits[0].leftClipId;selectedTrack=project.clips.find(c=>c.id===selectedClip)?.trackId??selectedTrack;}selectedNote=null;selectedNoteIds.clear();renderUI(true);$('timeline-scroll').focus();
}
async function splitClipsAtCursor(locators=false){
 if(!project||busy||!connected||!(locators?splitClipsRangeSupported:splitClipsAtCursorSupported))return;
 if((!locators||explicitSplitClipIdsSupported)&&audioZeroCrossingSupported&&$('zero-crossing-split').checked){
  if(locators&&!project.locators){notice('Locator 범위를 먼저 지정하세요.',true);return;}
  const doc=documentState?.id,revision=project.revision,snapshot=project,atTick=Math.max(0,Math.round(secondsToTick(transportSeconds))),clipIds=[...selectedClipIds];
  try{const resolver=async(clip,atSample)=>{if(doc!==documentState?.id||revision!==project?.revision)throw new Error('분할 준비 중 프로젝트가 변경되었습니다.');return jsonFetch('/api/audio/zero-crossing',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({clipId:clip.id,atSample,expectedRevision:revision})});};const plan=locators?await planZeroCrossingBoundarySplits(snapshot,{ticks:[snapshot.locators.startTick,snapshot.locators.endTick],clipIds},resolver):await planZeroCrossingSplits(snapshot,{atTick,clipIds},resolver);if(doc!==documentState?.id||revision!==project?.revision)return;const result=await runCommand('batch',{commands:plan.commands},revision);revealSplitResult(result,doc);}catch(error){if(doc===documentState?.id)notice(error.message,true);}return;
 }
 const doc=documentState?.id,ids=[...selectedClipIds],result=await runCommand(locators?'clips.splitAtLocators':'clips.splitAt',{...(!locators?{atTick:Math.max(0,Math.round(secondsToTick(transportSeconds)))}:{}),...(ids.length?{clipIds:ids}:{})},project.revision);revealSplitResult(result,doc);
}
try{$('zero-crossing-split').checked=localStorage.getItem('newdaw.audio.zeroCrossingSplit')==='true';}catch{}
$('zero-crossing-split').addEventListener('change',()=>{try{localStorage.setItem('newdaw.audio.zeroCrossingSplit',String($('zero-crossing-split').checked));}catch{}});
$('split-clips-cursor').addEventListener('click',()=>void splitClipsAtCursor());
$('split-clips-locators').addEventListener('click',()=>void splitClipsAtCursor(true));
$('split-clips-repeat').addEventListener('click',()=>{if(!project?.locators||!splitClipsRangeSupported||busy)return;splitRepeatDraft={documentId:documentState?.id,revision:project.revision,clipIds:[...selectedClipIds],range:structuredClone(project.locators),zeroCrossing:explicitSplitClipIdsSupported&&audioZeroCrossingSupported&&$('zero-crossing-split').checked};$('split-repeat-interval').value=String(project.ppq);$('split-repeat-context').textContent=`REV ${project.revision} · ${project.locators.startTick}–${project.locators.endTick} tick · ${selectedClipIds.size||'전체'} 클립${splitRepeatDraft.zeroCrossing?' · Zero Crossing 보정':''}`;$('split-repeat-dialog').showModal();});
$('split-repeat-form').addEventListener('submit',async event=>{
 event.preventDefault();const draft=splitRepeatDraft;if(!draft||draft.documentId!==documentState?.id||draft.revision!==project?.revision){notice('프로젝트가 바뀌었습니다. 반복 분할을 다시 여세요.',true);return;}
 let result;try{const intervalTicks=Number($('split-repeat-interval').value);if(draft.zeroCrossing){const snapshot=project,ticks=repeatedSplitTicks(draft.range,intervalTicks),plan=await planZeroCrossingBoundarySplits(snapshot,{ticks,clipIds:draft.clipIds},async(clip,atSample)=>{if(draft.documentId!==documentState?.id||draft.revision!==project?.revision)throw new Error('반복 분할 준비 중 프로젝트가 바뀌었습니다.');return jsonFetch('/api/audio/zero-crossing',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({clipId:clip.id,atSample,expectedRevision:draft.revision})});});if(draft.documentId!==documentState?.id||draft.revision!==project?.revision)return;result=await runCommand('batch',{commands:plan.commands},draft.revision);}else result=await runCommand('clips.splitRepeated',{range:draft.range,clipIds:draft.clipIds,intervalTicks},draft.revision);if(result&&draft.documentId===documentState?.id){$('split-repeat-dialog').close();revealSplitResult(result,draft.documentId);}}catch(error){if(draft.documentId===documentState?.id)notice(error.message,true);}
});
for(const [id,side] of [['cut-clips-head','head'],['cut-clips-tail','tail']])$(id).addEventListener('click',async()=>{
 if(!project||busy||!connected||!cutClipsAtCursorSupported)return;const doc=documentState?.id,result=await runCommand('clips.cutAt',{side,atTick:Math.max(0,Math.round(secondsToTick(transportSeconds))),clipIds:[...selectedClipIds]},project.revision);
 if(result&&documentState?.id===doc){selectedClipIds=new Set(result.changes.cut?.keptClipIds??[]);selectedClip=[...selectedClipIds][0]??null;selectedTrack=project.clips.find(c=>c.id===selectedClip)?.trackId??selectedTrack;selectedNote=null;selectedNoteIds.clear();renderUI(true);$('timeline-scroll').focus();}
});
$('arrangement-edit-menu').addEventListener('click',event=>{if(event.target.closest('button'))$('arrangement-edit-menu').open=false;});
function renderMarkerEditor(marker=null){
 markerDraft={documentId:documentState?.id,revision:project.revision};
 $('marker-edit-number').value=marker?.number??'';$('marker-edit-id').value=marker?.id??'';$('marker-edit-name').value=marker?.name??'새 마커';$('marker-edit-tick').value=String(marker?.tick??Math.max(0,Math.round(secondsToTick(transportSeconds))));$('marker-edit-end').value=marker?.endTick??'';$('marker-edit-end').disabled=!!marker&&marker.endTick===undefined;
}
function markerHeaderMarkup(key){
 const label=markerColumnLabels[key],sort=key===markerView.sortBy?markerView.direction:'none';
 return `<th scope="col" aria-sort="${sort}">${key==='actions'?label:`<button type="button" data-marker-sort="${key}" title="${label} 정렬">${label}</button>`}<span data-marker-resize="${key}" role="separator" tabindex="0" aria-orientation="vertical" aria-label="${label} 열 폭" aria-valuemin="60" aria-valuemax="600" aria-valuenow="${markerView.widths[key]}" title="드래그 또는 좌우 방향키"></span></th>`;
}
let markerFocusId=null;
const markerColumnLabels={number:'유형·번호',name:'이름',position:'시작 tick',end:'끝 tick',length:'길이 tick',id:'내부 ID',actions:'작업'};
let markerView=(()=>{try{return resolveMarkerListView(JSON.parse(localStorage.getItem('newdaw.markerListView')??'{}'));}catch{return resolveMarkerListView();}})();
function saveMarkerView(){try{localStorage.setItem('newdaw.markerListView',JSON.stringify(markerView));}catch{}}
function updateMarkerColumnControls(){const key=$('marker-column-key').value||'name';$('marker-column-key').innerHTML=markerView.columns.map(k=>`<option value="${k}">${markerColumnLabels[k]}</option>`).join('');$('marker-column-key').value=key;$('marker-column-width').value=markerView.widths[key];$('marker-column-left').disabled=markerView.columns.indexOf(key)===0;$('marker-column-right').disabled=markerView.columns.indexOf(key)===markerView.columns.length-1;}
function renderMarkerList(){
 const previousIds=[...$('project-markers-list').querySelectorAll('[data-marker-row]')].map(r=>r.dataset.markerRow),previousFocus=markerFocusId,hadFocus=$('project-markers-list').contains(document.activeElement);markerListContext={documentId:documentState?.id,revision:project.revision};
 if(!project.markers?.some(m=>m.id===markerFocusId))markerFocusId=null;
 const markers=sortProjectMarkers(project.markers??[],{sortBy:$('marker-sort-by').value,direction:$('marker-sort-direction').value}),width=markerView.columns.reduce((sum,k)=>sum+markerView.widths[k],0);
 $('project-markers-list').innerHTML=markers.length?`<table class="marker-list-table" style="width:${width}px"><colgroup>${markerView.columns.map(k=>`<col style="width:${markerView.widths[k]}px">`).join('')}</colgroup><thead><tr>${markerView.columns.map(markerHeaderMarkup).join('')}</tr></thead><tbody>${markers.map(m=>{const cells={number:`<button type="button" data-locate-marker="${esc(m.id)}" title="마커로 이동">▶ ${m.endTick===undefined?'위치':'사이클'} ${m.number}</button>`,name:`<button type="button" data-edit-marker="${esc(m.id)}">${esc(m.name)}</button>`,position:String(m.tick),end:m.endTick??'—',length:m.endTick===undefined?0:m.endTick-m.tick,id:esc(m.id),actions:`${m.endTick===undefined?'':`<button type="button" data-range-marker="${esc(m.id)}">Locator</button>`}<button type="button" data-remove-marker="${esc(m.id)}">삭제</button>`};return `<tr class="marker-list-row" tabindex="-1" data-marker-row="${esc(m.id)}" aria-label="${esc(m.name)} · ${m.number} · 시작 ${m.tick} tick">${markerView.columns.map(k=>`<td data-marker-column="${k}" title="${k==='id'?esc(m.id):''}">${cells[k]}</td>`).join('')}</tr>`;}).join('')}</tbody></table>`:'<p>마커가 없습니다.</p>';
 const rows=[...$('project-markers-list').querySelectorAll('[data-marker-row]')];markerFocusId=recoverMarkerRowFocus(previousIds,rows.map(r=>r.dataset.markerRow),previousFocus);const active=rows.find(r=>r.dataset.markerRow===markerFocusId);if(active){active.tabIndex=0;if(hadFocus)active.focus({preventScroll:true});}else if(hadFocus)$('marker-new').focus({preventScroll:true});updateMarkerColumnControls();
}
async function locateProjectMarker(id){
 const marker=project?.markers?.find(m=>m.id===id);if(!marker||busy)return;
 const doc=documentState?.id,target=tickToSeconds(marker.tick),token=++seekGeneration;transportSeeking=true;updateButtons();
 try{await stopTransport(false,'locate');if(token===seekGeneration&&doc===documentState?.id){transportSeconds=target;updatePosition();$('timeline-scroll').scrollLeft=Math.max(0,geometry().timeline.tickToX(marker.tick)-$('timeline-scroll').clientWidth/4);}}finally{if(token===seekGeneration)transportSeeking=false;updateButtons();}
}
$('project-markers-list').setAttribute('role','region');$('project-markers-list').setAttribute('aria-label','프로젝트 마커 목록');
$('marker-sort-by').value=markerView.sortBy;$('marker-sort-direction').value=markerView.direction;
$('marker-column-key').addEventListener('change',updateMarkerColumnControls);
$('marker-column-width').addEventListener('change',()=>{const width=Number($('marker-column-width').value);if(!Number.isInteger(width)||width<60||width>600){updateMarkerColumnControls();return;}markerView.widths[$('marker-column-key').value]=width;saveMarkerView();if(project)renderMarkerList();});
for(const [id,delta]of [['marker-column-left',-1],['marker-column-right',1]])$(id).addEventListener('click',()=>{const i=markerView.columns.indexOf($('marker-column-key').value),j=i+delta;if(j<0||j>=markerView.columns.length)return;[markerView.columns[i],markerView.columns[j]]=[markerView.columns[j],markerView.columns[i]];saveMarkerView();if(project)renderMarkerList();});
$('marker-columns-reset').addEventListener('click',()=>{markerView=resolveMarkerListView();$('marker-sort-by').value=markerView.sortBy;$('marker-sort-direction').value=markerView.direction;saveMarkerView();if(project)renderMarkerList();});
$('project-markers-list').addEventListener('focusin',event=>{const row=event.target.closest('[data-marker-row]');if(!row)return;markerFocusId=row.dataset.markerRow;for(const r of $('project-markers-list').querySelectorAll('[data-marker-row]'))r.tabIndex=r===row?0:-1;});
$('project-markers-list').addEventListener('keydown',event=>{const row=event.target.closest('[data-marker-row]');if(!row||!project||busy)return;if(['ArrowUp','ArrowDown','Home','End'].includes(event.key)){event.preventDefault();event.stopPropagation();const rows=[...$('project-markers-list').querySelectorAll('[data-marker-row]')],id=navigateMarkerRows(rows.map(r=>r.dataset.markerRow),row.dataset.markerRow,event.key),target=rows.find(r=>r.dataset.markerRow===id);target?.focus({preventScroll:true});target?.scrollIntoView({block:'nearest'});}else if(event.target===row&&event.key==='Enter'){event.preventDefault();event.stopPropagation();void locateProjectMarker(row.dataset.markerRow);}else if(event.key==='F2'){event.preventDefault();event.stopPropagation();if(markerListContext?.documentId!==documentState?.id)return;const marker=project.markers?.find(m=>m.id===row.dataset.markerRow);if(marker){renderMarkerEditor(marker);$('marker-edit-name').focus();}}});
for(const id of ['marker-sort-by','marker-sort-direction'])$(id).addEventListener('change',()=>{markerView.sortBy=$('marker-sort-by').value;markerView.direction=$('marker-sort-direction').value;saveMarkerView();if(project)renderMarkerList();});
$('project-markers-open').addEventListener('click',()=>{if(!project||!projectMarkersSupported)return;renderMarkerList();renderMarkerEditor();$('project-markers-dialog').showModal();});
for(const [id,direction] of [['marker-previous',-1],['marker-next',1]])$(id).addEventListener('click',()=>{
 if(!project)return;const tick=secondsToTick(transportSeconds),ordered=[...(project.markers??[])].sort((a,b)=>a.tick-b.tick),target=direction>0?ordered.find(m=>m.tick>tick+1e-6):ordered.filter(m=>m.tick<tick-1e-6).at(-1);
 if(target)void locateProjectMarker(target.id);else notice(direction>0?'다음 마커가 없습니다.':'이전 마커가 없습니다.');
});
$('marker-new').addEventListener('click',()=>renderMarkerEditor());
$('marker-renumber').addEventListener('click',async()=>{if(markerListContext?.documentId!==documentState?.id)return;const result=await runCommand('marker.renumber',{},markerListContext.revision);if(result){renderMarkerList();renderMarkerEditor();}});
$('marker-edit-form').addEventListener('submit',async event=>{
 event.preventDefault();if(!markerDraft||markerDraft.documentId!==documentState?.id){notice('문서가 바뀌었습니다. 마커 창을 다시 여세요.',true);return;}
 const id=$('marker-edit-id').value,args={name:$('marker-edit-name').value.trim(),tick:Number($('marker-edit-tick').value)},end=$('marker-edit-end').value;
 if(end!=='')args.endTick=Number(end);if($('marker-edit-number').value!=='')args.number=Number($('marker-edit-number').value);if(id)args.markerId=id;
 const result=await runCommand(id?'marker.update':'marker.add',args,markerDraft.revision);if(result){renderMarkerList();renderMarkerEditor(id?project.markers.find(m=>m.id===id):null);}
});
$('project-markers-dialog').addEventListener('click',async event=>{
 const button=event.target.closest('[data-locate-marker],[data-edit-marker],[data-remove-marker],[data-range-marker]');if(!button||!project)return;
 if(button.dataset.locateMarker){await locateProjectMarker(button.dataset.locateMarker);return;}
 if(markerListContext?.documentId!==documentState?.id){notice('문서가 바뀌었습니다. 마커 창을 다시 여세요.',true);return;}
 const marker=project.markers?.find(m=>m.id===(button.dataset.editMarker??button.dataset.removeMarker??button.dataset.rangeMarker));if(!marker)return;
 if(button.dataset.editMarker){renderMarkerEditor(marker);return;}
 const result=button.dataset.rangeMarker?await runCommand('project.locators',{range:{startTick:marker.tick,endTick:marker.endTick}},markerListContext.revision):await runCommand('marker.remove',{markerId:marker.id},markerListContext.revision);
 if(result){renderMarkerList();renderMarkerEditor();}
});
let suppressMarkerClick=false;
$('timeline-marker-strip').addEventListener('pointerdown',event=>{
 const handle=event.target.closest('[data-marker-drag]');if(!handle||!projectMarkersSupported||busy||!connected||event.button!==0)return;
 const marker=project.markers?.find(m=>m.id===handle.dataset.locateMarker);if(!marker)return;
 event.preventDefault();event.stopPropagation();
 const edge=handle.dataset.markerDrag,revision=project.revision,doc=documentState?.id,zoom=pxPerBeat,view=geometry().timeline,grid=compileEditorSnap(project,{scope:'primary'}),surface=$('timeline-surface'),base=edge==='end'?marker.endTick:marker.tick,pointerTick=view.xToTick(Math.max(0,event.clientX-surface.getBoundingClientRect().left)),controller=new AbortController(),options={signal:controller.signal};let moved=false,target=base,ghost=null;
 const valid=()=>project?.revision===revision&&documentState?.id===doc&&pxPerBeat===zoom&&handle.isConnected;
 const preview=e=>{if(!moved&&Math.abs(e.clientX-event.clientX)<3)return;moved=true;const raw=Math.max(0,base+view.xToTick(Math.max(0,e.clientX-surface.getBoundingClientRect().left))-pointerTick);target=e.altKey?Math.round(raw):grid.snap(raw).tick;if(edge==='end')target=Math.max(marker.tick+1,target);if(!ghost){ghost=document.createElement('div');document.body.append(ghost);}ghost.style.cssText=`position:fixed;left:${surface.getBoundingClientRect().left+view.tickToX(target)}px;top:${handle.getBoundingClientRect().top}px;border-left:2px solid #b1e8ff;pointer-events:none;z-index:10000;color:white;background:#203c51;padding:3px;font-size:11px`;ghost.textContent=`${marker.name} · ${target} tick`;};
 const finish=()=>{controller.abort();ghost?.remove();if(moved){suppressMarkerClick=true;setTimeout(()=>{suppressMarkerClick=false;},0);}};
 window.addEventListener('pointermove',e=>{if(e.pointerId!==event.pointerId)return;if(!valid())finish();else preview(e);},options);
 window.addEventListener('pointerup',async e=>{if(e.pointerId!==event.pointerId)return;const canCommit=valid();if(canCommit)preview(e);const changed=moved&&target!==base;finish();if(!canCommit||!changed)return;const args={markerId:marker.id};if(edge==='end')args.endTick=target;else{args.tick=target;if(marker.endTick!==undefined)args.endTick=target+(marker.endTick-marker.tick);}const result=await runCommand('marker.update',args,revision);if(result&&$('project-markers-dialog').open){renderMarkerList();renderMarkerEditor(project.markers.find(m=>m.id===marker.id));}},options);
 window.addEventListener('pointercancel',finish,options);window.addEventListener('blur',finish,options);window.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();finish();}},options);
});
$('timeline-marker-strip').addEventListener('click',event=>{if(suppressMarkerClick){suppressMarkerClick=false;return;}if(event.target.closest('[data-marker-drag="end"]'))return;const id=event.target.closest('[data-locate-marker]')?.dataset.locateMarker;if(id){event.preventDefault();event.stopPropagation();void locateProjectMarker(id);}});
async function copySelectedClips(cut=false){
 if(!project||busy||!connected||!clipSnapshotPasteSupported)return;const clips=project.clips.filter(c=>selectedClipIds.has(c.id));if(!clips.length)return;
 if(clips.length>4096||clips.reduce((sum,c)=>sum+(c.notes?.length??0),0)>200000){notice('클립 보관함은 최대4096개 클립/200000개 노트를 지원합니다.',true);return;}
 clipClipboard={documentId:documentState?.id,sourceProjectId:project.id,sourceRevision:project.revision,sourceTracks:structuredClone(project.tracks.filter(t=>clips.some(c=>c.trackId===t.id))),clips:structuredClone(clips)};$('clip-clipboard-status').textContent=`${clips.length}개 클립 보관 · 앱 내부/같은 문서`;
 if(cut){const result=await runCommand('batch',{commands:clips.map(c=>({command:'clip.remove',arguments:{clipId:c.id}}))},project.revision);if(result){selectedClipIds.clear();selectedClip=null;selectedNote=null;selectedNoteIds.clear();renderUI(true);}}updateButtons();
}
async function pasteClipboardClips(original=false){
 if(!project||busy||!connected||!clipSnapshotPasteSupported||!clipClipboard)return;
 if(clipClipboard.documentId!==documentState?.id||clipClipboard.sourceProjectId!==project.id){notice('복사한 문서에서 붙여넣으세요.',true);return;}
 const elapsed=geometry().timeline.mode==='time-linear',result=await runCommand('clips.paste',{sourceProjectId:clipClipboard.sourceProjectId,clips:clipClipboard.clips,...(!original&&audioSnapPointPasteSupported?{alignSnapPoint:true}:{}),...(!$('clip-paste-track-options').hidden?{sourceTracks:clipClipboard.sourceTracks,trackMode:$('clip-paste-track-mode').value,createMissingTracks:$('clip-paste-create-tracks').checked}:{}),...(original?{original:true}:elapsed?{atSample:Math.max(0,Math.round(transportSeconds*project.sampleRate))}:{atTick:Math.max(0,Math.round(secondsToTick(transportSeconds)))})},project.revision);
 if(result){selectedClipIds=new Set(result.changes.paste.clipIds);selectedClip=[...selectedClipIds][0]??null;selectedNote=null;selectedNoteIds.clear();renderUI(true);$('timeline-scroll').focus();}
}
$('clip-clipboard-export').addEventListener('click',()=>{if(!clipClipboard)return;const {documentId,...snapshot}=clipClipboard,bytes=JSON.stringify({format:'newdaw-clip-clipboard',version:1,...snapshot},null,2)+'\n',blob=new Blob([bytes],{type:'application/json'});if(blob.size>64*1024*1024){notice('보관함 파일은 최대64MiB입니다.',true);return;}const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='selection.newdaw-clips.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
$('clip-clipboard-import').addEventListener('click',()=>{$('clip-clipboard-file').value='';$('clip-clipboard-file').click();});
$('clip-clipboard-file').addEventListener('change',async event=>{const file=event.target.files?.[0];if(!file||!project||busy||!connected)return;const doc=documentState?.id,projectId=project.id;try{if(file.size>64*1024*1024)throw new Error('보관함 파일은 최대64MiB입니다.');const payload=parseClipClipboard(await file.text());if(doc!==documentState?.id||projectId!==project?.id)throw new Error('문서가 바뀌었습니다. 파일을 다시 여세요.');if(payload.sourceProjectId!==projectId)throw new Error('다른 프로젝트의 보관함입니다. 원래 프로젝트에서 여세요.');clipClipboard={documentId:doc,sourceProjectId:payload.sourceProjectId,sourceRevision:payload.sourceRevision,sourceTracks:payload.sourceTracks,clips:payload.clips};$('clip-clipboard-status').textContent=`${payload.clips.length}개 클립 파일 보관 · 붙여넣기 전`;updateButtons();}catch(error){notice(error.message,true);}});
$('copy-selected-clips').addEventListener('click',()=>void copySelectedClips());$('cut-selected-clips').addEventListener('click',()=>void copySelectedClips(true));$('paste-clips-cursor').addEventListener('click',()=>void pasteClipboardClips());$('paste-clips-original').addEventListener('click',()=>void pasteClipboardClips(true));
$('move-clips-track').addEventListener('click',()=>{if(!project||busy||!connected)return;const clips=project.clips.filter(c=>selectedClipIds.has(c.id));if(!clips.length)return;if(clips.some(c=>c.type!==clips[0].type)){notice('MIDI와 오디오 클립은 따로 선택해 옮기세요.',true);return;}moveClipsTrackDraft={documentId:documentState?.id,revision:project.revision,clipIds:clips.map(c=>c.id)};$('move-clips-track-source').textContent=`${clips.length}개 ${clips[0].type} 클립 · REV ${project.revision}`;$('move-clips-track-target').innerHTML=project.tracks.filter(t=>t.type===clips[0].type).map(t=>`<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('');$('move-clips-track-target').value=clips[0].trackId;$('move-clips-track-dialog').showModal();});
$('move-clips-track-form').addEventListener('submit',async event=>{event.preventDefault();const draft=moveClipsTrackDraft;if(!draft||draft.documentId!==documentState?.id){notice('문서가 바뀌었습니다. 이동 창을 다시 여세요.',true);return;}const trackId=$('move-clips-track-target').value,result=await runCommand('clips.moveToTrack',{clipIds:draft.clipIds,trackId},draft.revision);if(result){$('move-clips-track-dialog').close();selectedTrack=trackId;selectedTrackIds=new Set([trackId]);renderUI(true);}});
$('move-clips-cursor').addEventListener('click',()=>{if(!project||busy||!connected||!selectedClipIds.size)return;const elapsed=geometry().timeline.mode==='time-linear';void runCommand('clips.moveGroup',{clipIds:[...selectedClipIds],...(elapsed?{atSample:Math.max(0,Math.round(transportSeconds*project.sampleRate))}:{atTick:Math.max(0,Math.round(secondsToTick(transportSeconds)))})},project.revision);});
$('timeline-select-mode').addEventListener('change',event=>{const mode=event.target.value;event.target.value='';if(!mode||!project)return;try{const ids=selectProjectClips(project,{mode,selectedIds:[...selectedClipIds],trackIds:[...selectedTrackIds],cursorTick:secondsToTick(transportSeconds)});selectedClipIds=new Set(ids);if(!selectedClipIds.has(selectedClip))selectedClip=ids[0]??null;const focus=project.clips.find(c=>c.id===selectedClip);if(focus)selectedTrack=focus.trackId;selectedNote=null;selectedNoteIds.clear();renderUI(true);$('timeline-scroll').focus();}catch(error){notice(error.message,true);}});
async function toggleSelectedClipsMute(){if(!project||busy||!connected||!clipGroupMuteSupported)return;const clips=project.clips.filter(c=>selectedClipIds.has(c.id));if(!clips.length)return;await runCommand('clips.setMute',{clipIds:clips.map(c=>c.id),mute:!clips.every(c=>c.mute)},project.revision);}
$('mute-selected-clips').addEventListener('click',()=>void toggleSelectedClipsMute());
function updateRepeatSpacingLabel(){$('repeat-clips-spacing-label').textContent=$('repeat-clips-time-base').value==='elapsed'?'반복 간격 · 프로젝트 sample':'반복 간격 · tick';}
$('repeat-clips-time-base').addEventListener('change',()=>{$('repeat-clips-spacing').value='';updateRepeatSpacingLabel();});
$('repeat-selected-clips').addEventListener('click',()=>{if(!project||busy||!connected||!selectedClipIds.size)return;repeatClipsDraft={documentId:documentState?.id,revision:project.revision,clipIds:[...selectedClipIds]};$('repeat-clips-source').textContent=`${selectedClipIds.size}개 클립 · REV ${project.revision}`;$('repeat-clips-count').value='1';$('repeat-clips-time-base').value='musical';updateRepeatSpacingLabel();$('repeat-clips-spacing').value='';$('repeat-clips-dialog').showModal();});
$('repeat-clips-form').addEventListener('submit',async event=>{event.preventDefault();const draft=repeatClipsDraft;if(!draft||draft.documentId!==documentState?.id){notice('문서가 바뀌었습니다. 반복 창을 다시 여세요.',true);return;}const spacing=$('repeat-clips-spacing').value,timeBase=$('repeat-clips-time-base').value,result=await runCommand('clips.repeat',{clipIds:draft.clipIds,count:Number($('repeat-clips-count').value),timeBase,...(spacing!==''?{[timeBase==='elapsed'?'spacingSamples':'spacingTicks']:Number(spacing)}:{})},draft.revision);if(result){$('repeat-clips-dialog').close();selectedClipIds=new Set(result.changes.repetition.clipIds);selectedClip=[...selectedClipIds][0]??null;renderUI(true);}});
function updateLocatorOperation(){
 const mode=$('locator-operation').value,range=locatorDraftContext?.range;
 for(const id of ['locator-left','locator-right']){$(id).disabled=mode!=='bounds';$(id).closest('label').hidden=mode!=='bounds';}
 $('locator-delta-field').hidden=mode!=='move';$('locator-delta').disabled=mode!=='move';$('locator-delta').required=mode==='move';
 $('locator-duration-fields').hidden=mode!=='duration';$('locator-duration').disabled=mode!=='duration';$('locator-duration').required=mode==='duration';
 $('locator-draft-summary').textContent=range?`현재 ${range.startTick}–${range.endTick} · 길이 ${range.endTick-range.startTick} tick. 클립 위치는 바꾸지 않습니다.`:'기존 Locator가 없으면 좌우 경계를 먼저 설정하세요.';
}
$('locator-operation').addEventListener('change',updateLocatorOperation);
$('locators-edit').addEventListener('click',()=>{if(!project)return;locatorDraftContext={documentId:documentState?.id,revision:project.revision,range:project.locators?{...project.locators}:null};$('locator-operation').value='bounds';$('locator-delta').value='0';$('locator-duration').value=String(project.locators?project.locators.endTick-project.locators.startTick:project.ppq*4);updateLocatorOperation();$('locator-left').value=String(project.locators?.startTick??0);$('locator-right').value=String(project.locators?.endTick??project.ppq*4);$('locators-dialog').showModal();});
$('locators-dialog-close').addEventListener('click',()=>$('locators-dialog').close());
$('locators-form').addEventListener('submit',async event=>{event.preventDefault();if(!locatorDraftContext||locatorDraftContext.documentId!==documentState?.id){notice('문서가 바뀌었습니다. Locator 입력을 다시 여세요.',true);return;}const mode=$('locator-operation').value,range={startTick:Number($('locator-left').value),endTick:Number($('locator-right').value)},command=mode==='move'?'project.locatorsMove':mode==='duration'?'project.locatorsResize':'project.locators',args=mode==='move'?{deltaTicks:Number($('locator-delta').value)}:mode==='duration'?{durationTicks:Number($('locator-duration').value),anchor:$('locator-anchor').value}:{range};const result=await runCommand(command,args,locatorDraftContext.revision);if(result)$('locators-dialog').close();});
$('locators-from-notes').addEventListener('click',()=>{const p=currentClip(),notes=p?.notes?.filter(n=>selectedNoteIds.has(n.id))??[];if(!notes.length)return;let left=Infinity,right=0;for(const n of notes){left=Math.min(left,n.startTick);right=Math.max(right,n.startTick+n.durationTicks);}if(right<=left){notice('양의 길이가 있는 노트를 선택하세요.',true);return;}void runCommand('project.locators',{range:{startTick:p.startTick+left,endTick:p.startTick+right}});});
for(const [id,cycle] of [['locators-from-clips',false],['cycle-from-clips',true]])$(id).addEventListener('click',()=>{if(!project||busy||!connected||!selectedClipIds.size)return;void runCommand('project.locatorsFromClips',{clipIds:[...selectedClipIds],...(cycle?{enableCycle:true}:{})},project.revision);});
$('cycle-playback').addEventListener('click',()=>void runCommand('project.cycle',{enabled:!project.cycleEnabled}));
$('locators-clear').addEventListener('click',()=>void runCommand('project.locators',{range:null}));
$('note-select-menu').addEventListener('change',event=>{const mode=event.target.value;event.target.value='';const p=currentClip();if(!mode||p?.type!=='midi')return;try{const ids=selectNoteMenu(p.notes,{mode,selectedIds:[...selectedNoteIds],cursorTick:secondsToTick(transportSeconds)-p.startTick,loopRange:project.locators?{startTick:project.locators.startTick-p.startTick,endTick:project.locators.endTick-p.startTick}:null});selectedNoteIds=new Set(ids);if(!selectedNoteIds.has(selectedNote))selectedNote=ids[0]??null;refreshNoteSelection();controllerLanesUI?.noteSelected?.(selectedNote);}catch(error){notice(error.message,true);}});
$('clip-select').addEventListener('change', () => { if ($('clip-select').value) selectClip($('clip-select').value); });
$('track-heads').addEventListener('click', (event) => {
  const head = event.target.closest('[data-track-id]');
  if (!head || event.target.closest('input,[data-track-reorder],[data-track-resize]')) return;
  const track = project.tracks.find((item) => item.id === head.dataset.trackId);
  const action = event.target.closest('[data-action]')?.dataset.action;
  if(action==='solo'&&event.shiftKey){if(globalMuteSoloSupported)void runCommand('track.soloExclusive',{trackId:track.id},project.revision);else notice('단독 솔로를 사용하려면 서버 갱신이 필요합니다.',true);return;}
  if(action==='mute'||action==='solo'){
   const ids=selectedTrackIds.has(track.id)?[...selectedTrackIds]:[track.id],commands=ids.map(trackId=>({command:'track.update',arguments:{trackId,[action]:!track[action]}}));
   void runCommand(commands.length===1?'track.update':'batch',commands.length===1?commands[0].arguments:{commands},project.revision);
  }else selectTrack(track.id,{toggle:event.metaKey||event.ctrlKey,range:event.shiftKey});
});
const trackMixDrafts=new WeakMap();
$('track-heads').addEventListener('input', (event) => {
  if (!event.target.matches('input[type=range]')) return;
  if(!trackMixDrafts.has(event.target))trackMixDrafts.set(event.target,{documentId:documentState?.id,revision:project.revision,tracks:project.tracks.map(t=>({id:t.id,gainDb:t.gainDb,pan:t.pan})),selectedIds:[...selectedTrackIds],mode:$('track-mix-mode').value});
  event.target.nextElementSibling.textContent = event.target.dataset.action === 'gain' ? Number(event.target.value).toFixed(1) : panLabel(Number(event.target.value));
});
$('track-heads').addEventListener('change', (event) => {
  if (!event.target.matches('input[type=range]')) return;
  const trackId = event.target.closest('[data-track-id]').dataset.trackId;
  const draft=trackMixDrafts.get(event.target)??{documentId:documentState?.id,revision:project.revision,tracks:project.tracks,selectedIds:[...selectedTrackIds],mode:$('track-mix-mode').value};trackMixDrafts.delete(event.target);
  if(draft.documentId!==documentState?.id||draft.revision!==project.revision){notice('프로젝트가 변경되었습니다. 믹서 값을 다시 조절하세요.',true);renderUI(true);return;}
  try{const commands=planTrackMix(draft.tracks,{trackId,selectedIds:draft.selectedIds,field:event.target.dataset.action==='gain'?'gainDb':'pan',value:Number(event.target.value),mode:draft.mode});void runCommand(commands.length===1?'track.update':'batch',commands.length===1?commands[0].arguments:{commands},draft.revision);}catch(error){notice(error.message,true);renderUI(true);}
});
$('timeline-lanes').addEventListener('pointerdown',event=>{
 const handle=event.target.closest('[data-audio-gain]');
 if(!handle||!project||busy||!connected||event.button!==0||$('timeline-range-mode').checked)return;
 event.preventDefault();event.stopImmediatePropagation();handle.focus();
 const element=handle.closest('[data-clip-id]'),clip=project.clips.find(c=>c.id===element.dataset.clipId);
 if(clip?.type!=='audio')return;
 const startY=event.clientY,initial=clip.gainDb??0,revision=project.revision,documentId=documentState?.id,controller=new AbortController(),options={signal:controller.signal};let gain=initial,moved=false;
 const valid=()=>project?.revision===revision&&documentState?.id===documentId&&element.isConnected;
 const preview=e=>{moved||=Math.abs(e.clientY-startY)>2;gain=Math.round(clamp(initial+(startY-e.clientY)*(e.shiftKey ? 0.02 : 0.2),-60,12)*10)/10;handle.textContent=`${gain.toFixed(1)} dB`;handle.setAttribute('aria-valuenow',String(gain));};
 const cancel=()=>{controller.abort();renderTimeline();};
 window.addEventListener('pointermove',e=>{if(e.pointerId!==event.pointerId)return;if(!valid())cancel();else preview(e);},options);
 window.addEventListener('pointerup',e=>{if(e.pointerId!==event.pointerId)return;const canCommit=valid();controller.abort();if(canCommit&&moved&&gain!==initial)void runCommand('clip.update',{clipId:clip.id,gainDb:gain},revision).then(result=>{if(!result)renderTimeline();});else if(handle.isConnected){handle.textContent=`${initial.toFixed(1)} dB`;handle.setAttribute('aria-valuenow',String(initial));}},options);
 window.addEventListener('pointercancel',cancel,options);window.addEventListener('blur',cancel,options);window.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();cancel();}},options);
},true);
$('timeline-lanes').addEventListener('dblclick',event=>{
 const handle=event.target.closest('[data-audio-gain]');if(!handle)return;event.preventDefault();event.stopPropagation();if(busy||!connected||$('timeline-range-mode').checked)return;void runCommand('clip.update',{clipId:handle.closest('[data-clip-id]').dataset.clipId,gainDb:0},project.revision);
});
$('timeline-lanes').addEventListener('keydown',event=>{
 const handle=event.target.closest('[data-audio-gain]');if(!handle||!['ArrowUp','ArrowDown','Home'].includes(event.key))return;
 event.preventDefault();event.stopImmediatePropagation();if(busy||!connected||$('timeline-range-mode').checked)return;
 const clip=project.clips.find(c=>c.id===handle.closest('[data-clip-id]').dataset.clipId);if(clip?.type!=='audio')return;
 const gain=event.key==='Home'?0:Math.round(clamp((clip.gainDb??0)+(event.key==='ArrowUp'?1:-1)*(event.shiftKey ? 0.1 : 1),-60,12)*10)/10;
 if(gain!==clip.gainDb)void runCommand('clip.update',{clipId:clip.id,gainDb:gain},project.revision);
},true);
let suppressFadeClick=false;
$('timeline-lanes').addEventListener('pointerdown',event=>{
 const handle=event.target.closest('[data-audio-fade]');
 if(!handle||!audioFadeSupported||!project||busy||!connected||event.button!==0||$('timeline-range-mode').checked)return;
 event.preventDefault();event.stopImmediatePropagation();suppressFadeClick=true;
 const element=handle.closest('[data-clip-id]'),clip=project.clips.find(c=>c.id===element.dataset.clipId),asset=project.assets.find(a=>a.id===clip?.assetId);
 if(!clip||!asset)return;
 const side=handle.dataset.audioFade,key=side==='in'?'fadeInFrames':'fadeOutFrames',revision=project.revision,documentId=documentState?.id,zoom=pxPerBeat,view=geometry().timeline,controller=new AbortController(),options={signal:controller.signal};
 let frames=clip[key]??0;
 const valid=()=>project?.revision===revision&&documentState?.id===documentId&&zoom===pxPerBeat&&element.isConnected;
 const preview=e=>{const seconds=view.xToSeconds(Math.max(0,e.clientX-$('timeline-surface').getBoundingClientRect().left))-clip.startSample/project.sampleRate;frames=clamp(Math.round((side==='in'?seconds:clip.lengthFrames/asset.sampleRate-seconds)*asset.sampleRate),0,clip.lengthFrames);const x=view.secondsToX(clip.startSample/project.sampleRate+(side==='in'?frames:clip.lengthFrames-frames)/asset.sampleRate)-view.secondsToX(clip.startSample/project.sampleRate);handle.style.left=`${clamp(x-(side==='out'?10:0),0,Math.max(0,element.offsetWidth-10))}px`;handle.title=`${(frames/asset.sampleRate).toFixed(3)}초`;const line=element.querySelector(`.audio-fade-line.${side}`);if(line)line.style.width=`${side==='in'?x:Math.max(0,element.offsetWidth-x)}px`;};
 const cancel=()=>{controller.abort();suppressFadeClick=false;renderTimeline();};
 window.addEventListener('pointermove',e=>{if(e.pointerId!==event.pointerId)return;if(!valid())cancel();else preview(e);},options);
 window.addEventListener('pointerup',e=>{if(e.pointerId!==event.pointerId)return;const canCommit=valid();controller.abort();setTimeout(()=>{suppressFadeClick=false;},0);if(canCommit){preview(e);void runCommand('clip.update',{clipId:clip.id,[key]:frames},revision).then(result=>{if(!result)renderTimeline();});}else renderTimeline();},options);
 window.addEventListener('pointercancel',cancel,options);window.addEventListener('blur',cancel,options);window.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();cancel();}},options);
},true);
$('timeline-lanes').addEventListener('pointerdown',event=>{
 if(!$('midi-glue-tool').checked||$('midi-glue-tool-field').hidden||event.button!==0||busy||!connected||!project||$('timeline-range-mode').checked)return;
 const element=event.target.closest('[data-clip-id]'),clip=project.clips.find(c=>c.id===element?.dataset.clipId);if(!clip||!['midi','audio'].includes(clip.type)||clip.type==='audio'&&$('midi-glue-tool-field').dataset.audioSupported!=='true')return;
 event.preventDefault();event.stopImmediatePropagation();const doc=documentState?.id,clipId=clip.id;suppressFadeClick=true;
 void runCommand(clip.type==='midi'?'midi.clips.glueNext':'audio.clips.glueNext',{clipId,allFollowing:event.altKey},project.revision).then(result=>{if(result&&doc===documentState?.id){selectedClip=clipId;selectedClipIds=new Set([clipId]);selectedTrack=clip.trackId;selectedNote=null;selectedNoteIds.clear();renderUI(true);}});
 window.addEventListener('pointerup',()=>setTimeout(()=>{suppressFadeClick=false;},0),{once:true});
},true);
$('timeline-lanes').addEventListener('pointerdown',event=>{
 if(!$('audio-scrub-tool').checked||$('audio-scrub-tool-field').hidden||event.button!==0||busy||!connected||!project||recordingUI?.active||browserMidiRecordingUI?.active)return;
 const element=event.target.closest('[data-clip-id]');if(!element||event.target.closest('[data-audio-fade],[data-audio-gain],[data-audio-trim],[data-midi-part-end]'))return;
 const clip=project.clips.find(c=>c.id===element.dataset.clipId);if(clip?.type!=='audio')return;
 event.preventDefault();event.stopImmediatePropagation();if(audioSource||previewPreparing||activeJob||nativeMidiUI?.active){notice('현재 재생을 정지한 뒤 스크럽하세요.',true);return;}
 const doc=documentState?.id,revision=project.revision,zoom=pxPerBeat,view=geometry().timeline,bounds=clipTiming(clip),range={startTick:Math.max(0,Math.floor(bounds.start)),endTick:Math.ceil(bounds.end)},origin=tickToSeconds(range.startTick),controller=new AbortController(),options={signal:controller.signal},token=++previewToken;
 let finished=false,scrubber=null,animation=null,motion=null;
 const position=e=>Math.max(tickToSeconds(bounds.start),Math.min(tickToSeconds(bounds.end),tickToSeconds(view.xToTick(Math.max(0,e.clientX-$('timeline-surface').getBoundingClientRect().left)))));
 let previous={seconds:position(event),time:event.timeStamp};
 const finish=(stop=true)=>{if(finished)return;finished=true;controller.abort();if(animation!==null)cancelAnimationFrame(animation);scrubber?.dispose();element.style.removeProperty('outline');stopScrub=null;suppressFadeClick=true;setTimeout(()=>{suppressFadeClick=false;},0);if(stop)void stopTransport(false);};stopScrub=(stop=true)=>finish(stop);
 window.addEventListener('pointermove',e=>{if(e.pointerId!==event.pointerId)return;const current={seconds:position(e),time:e.timeStamp};transportSeconds=current.seconds;updatePosition();if(scrubber&&motion)scrubber.move(current.seconds-origin,motion(previous,current));previous=current;e.preventDefault();},options);
 window.addEventListener('pointerup',e=>{if(e.pointerId===event.pointerId)finish();},options);window.addEventListener('pointercancel',()=>finish(),options);window.addEventListener('blur',()=>finish(),options);window.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();finish();}},options);
 const valid=()=>!finished&&token===previewToken&&documentState?.id===doc&&project?.revision===revision&&pxPerBeat===zoom&&connected&&element.isConnected&&$('audio-scrub-tool').checked;
 const pump=()=>{if(!valid()){finish();return;}animation=requestAnimationFrame(pump);};animation=requestAnimationFrame(pump);element.style.outline='2px solid #ffc582';previewPreparing=true;$('playback-status').textContent='스크럽 준비 중…';updateButtons();
 void(async()=>{try{if(!await nativeMidiUI.previewAllowed())throw new Error('스크럽은 내장 오디오 프리뷰 모드에서 사용하세요.');if(!valid())return;audioContext ||= new AudioContext();await audioContext.resume();const module=await import('./audio-scrub.mjs');if(!valid())return;motion=module.scrubMotion;
 const [timing,chase]=await Promise.all([readTimingProfile(),readChaseProfile()]);if(!valid())return;
 const cacheKey=JSON.stringify([doc,revision,mediaRevision,clip.id,range,project.sampleRate,timing.fingerprint,chase.fingerprint]);let decoded;
 if(scrubBufferCache?.key===cacheKey)decoded=scrubBufferCache.buffer;
 else{scrubBufferCache=null;const rendered=await renderSnapshot('preview',{previewRange:range,clipIds:[clip.id],bypassTrackEffects:true,ignoreCycle:true,tailSeconds:0,autoEffectTail:false});if(!valid())return;if(rendered.mediaRevision!==mediaRevision){finish();return;}
 if(rendered.timingProfile?.fingerprint!==timing.fingerprint||rendered.chaseProfile?.fingerprint!==chase.fingerprint)throw new Error('스크럽 준비 중 시간/Chase 설정이 바뀌었습니다. 다시 시작하세요.');
 const response=await fetch(rendered.url);if(!response.ok)throw new Error('스크럽 오디오를 가져오지 못했습니다.');decoded=await audioContext.decodeAudioData(await response.arrayBuffer());if(!valid())return;
 const [latestTiming,latestChase]=await Promise.all([readTimingProfile(),readChaseProfile()]);if(!valid())return;if(latestTiming.fingerprint!==timing.fingerprint||latestChase.fingerprint!==chase.fingerprint)throw new Error('스크럽 준비 중 시간/Chase 설정이 바뀌었습니다. 다시 시작하세요.');
 if(decoded.length*decoded.numberOfChannels*4<=64*1024*1024)scrubBufferCache={key:cacheKey,buffer:decoded};}
 auditionGainNode=audioContext.createGain();auditionGainNode.gain.value=10**(Number($('audition-level').value)/20);auditionGainNode.connect(audioContext.destination);scrubber=module.createBufferScrubber(audioContext,decoded,auditionGainNode);$('playback-status').textContent='스크럽 · 좌우로 움직이세요';}catch(error){if(valid())notice(error.message,true);finish();}})();
},true);
$('timeline-lanes').addEventListener('pointerdown',event=>{
 if(!$('track-audition-tool').checked||!renderTrackSelectionSupported||event.button!==0||busy||!connected||!project||recordingUI?.active||browserMidiRecordingUI?.active)return;
 const element=event.target.closest('[data-clip-id]');if(!element||event.target.closest('[data-audio-fade],[data-audio-gain],[data-audio-trim],[data-midi-part-end]'))return;
 const clip=project.clips.find(c=>c.id===element.dataset.clipId);if(clip?.type!=='audio')return;
 event.preventDefault();event.stopImmediatePropagation();
 if(audioSource||previewPreparing||activeJob||nativeMidiUI?.active){notice('현재 재생을 정지한 뒤 트랙 미리듣기를 시작하세요.',true);return;}
 const view=geometry().timeline,startTick=Math.max(0,Math.floor(view.xToTick(Math.max(0,event.clientX-$('timeline-surface').getBoundingClientRect().left))));
 let endTick=startTick;for(const item of project.clips.filter(c=>c.trackId===clip.trackId))endTick=Math.max(endTick,Math.ceil(clipTiming(item).end));if(endTick<=startTick)return;
 const doc=documentState?.id,revision=project.revision,controller=new AbortController(),options={signal:controller.signal};let animation=null,finished=false;
 const finish=()=>{if(finished)return;finished=true;controller.abort();if(animation!==null)cancelAnimationFrame(animation);element.style.removeProperty('outline');suppressFadeClick=true;setTimeout(()=>{suppressFadeClick=false;},0);void stopTransport(false);};
 window.addEventListener('pointerup',e=>{if(e.pointerId===event.pointerId)finish();},options);window.addEventListener('pointercancel',finish,options);window.addEventListener('blur',finish,options);window.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();finish();}},options);
 const pump=()=>{if(finished)return;if(documentState?.id!==doc||project?.revision!==revision||!element.isConnected||!connected||!$('track-audition-tool').checked){finish();return;}animation=requestAnimationFrame(pump);};
 element.style.outline='2px solid #ffc582';animation=requestAnimationFrame(pump);
 void play({selectionRange:{startTick,endTick},selectionTrackIds:[clip.trackId]});
},true);
$('timeline-lanes').addEventListener('pointerdown',event=>{
 const handle=event.target.closest('[data-audio-trim]');if(!handle||!audioTrimSupported||busy||!connected||event.button!==0||$('timeline-range-mode').checked)return;
 event.preventDefault();event.stopImmediatePropagation();
 const element=handle.closest('[data-clip-id]'),clip=project.clips.find(c=>c.id===element.dataset.clipId),asset=project.assets.find(a=>a.id===clip?.assetId);if(!asset)return;
 const clips=selectedClipIds.has(clip.id)?project.clips.filter(c=>selectedClipIds.has(c.id)):[clip],ids=clips.map(c=>c.id);
 const requestedMode=audioResizeMovesContentsSupported?$('audio-resize-mode').value:'normal',resizeMode=requestedMode==='timeStretch'&&!audioTimeStretchSupported?'normal':requestedMode,edge=handle.dataset.audioTrim,view=geometry().timeline,grid=compileEditorSnap(project,{scope:'primary'}),revision=project.revision,doc=documentState?.id,zoom=pxPerBeat,controller=new AbortController(),options={signal:controller.signal};let deltaFrames=0,ghosts=new Map(),moved=false,commands=[],stretchPlan=null;
 if(resizeMode==='timeStretch'&&(clips.length>128||clips.length!==1&&!audioTimeStretchBatchSupported)){notice(audioTimeStretchBatchSupported?'한 번에 최대128개의 오디오 클립을 선택하세요.':'타임스트레치 드래그는 오디오 클립 하나를 선택하세요.',true);return;}
 const valid=()=>project?.revision===revision&&documentState?.id===doc&&pxPerBeat===zoom&&element.isConnected&&connected&&!busy;
 const preview=e=>{if(!moved&&Math.hypot(e.clientX-event.clientX,e.clientY-event.clientY)<3)return false;moved=true;const raw=Math.max(0,view.xToTick(Math.max(0,e.clientX-$('timeline-surface').getBoundingClientRect().left))),tick=e.altKey?Math.round(raw):grid.snap(raw).tick,target=tickToSeconds(tick),start=clip.startSample/project.sampleRate,end=start+clip.lengthFrames/asset.sampleRate;deltaFrames=Math.round((target-(edge==='left'?start:end))*asset.sampleRate);let a=project.sampleRate,b=asset.sampleRate;while(b)[a,b]=[b,a%b];if(edge==='left')deltaFrames=Math.round(deltaFrames/(asset.sampleRate/a))*(asset.sampleRate/a);const length=edge==='left'?clip.lengthFrames-deltaFrames:clip.lengthFrames+deltaFrames,offset=resizeMode==='moveContents'?(edge==='left'?clip.offsetFrames:clip.offsetFrames-deltaFrames):clip.offsetFrames+(edge==='left'?deltaFrames:0),newStart=start+(edge==='left'?deltaFrames/asset.sampleRate:0),w=clip.reverseWindow??clip,anchorAllowed=length>0&&offset>=0&&offset+length<=asset.frames&&newStart>=0&&(!clip.reverse||offset>=w.offsetFrames&&offset+length<=w.offsetFrames+w.lengthFrames);let allowed=resizeMode==='timeStretch'?length>0&&newStart>=0:anchorAllowed;try{if(resizeMode==='timeStretch'){stretchPlan=clips.map(c=>planAudioStretchResize(project,c.id,edge,deltaFrames/asset.sampleRate));commands=stretchPlan.map(p=>({command:'audio.clip.timeStretch',arguments:{clipId:p.clipId,deltaFrames:p.deltaFrames}}));}else commands=planAudioTrim(project,ids,edge,deltaFrames/asset.sampleRate,{mode:resizeMode}).commands;}catch{commands=[];stretchPlan=null;allowed=false;}for(const item of clips){const metadata=project.assets.find(a=>a.id===item.assetId),node=[...$('timeline-lanes').querySelectorAll('[data-clip-id]')].find(e=>e.dataset.clipId===item.id);if(!metadata||!node)continue;let ghost=ghosts.get(item.id);if(!ghost){ghost=document.createElement('div');ghost.className='trim-drag-preview';document.body.append(ghost);ghosts.set(item.id,ghost);}const planned=commands.find(c=>c.arguments.clipId===item.id)?.arguments.deltaFrames??Math.round(deltaFrames/asset.sampleRate*metadata.sampleRate),nextLength=item.lengthFrames+(edge==='left'?-planned:planned),nextStart=item.startSample/project.sampleRate+(edge==='left'?planned/metadata.sampleRate:0),rect=node.getBoundingClientRect();ghost.style.cssText=`position:fixed;pointer-events:none;left:${$('timeline-surface').getBoundingClientRect().left+view.secondsToX(Math.max(0,nextStart))}px;top:${rect.top}px;width:${Math.max(1,view.secondsToX(Math.max(0,nextStart+Math.max(1,nextLength)/metadata.sampleRate))-view.secondsToX(Math.max(0,nextStart)))}px;height:${rect.height}px;border:2px solid ${allowed?'#88ffd4':'#ff7777'};z-index:10000;background:#88ffd422`;ghost.textContent=`${item.name} · ${Math.max(0,nextLength)} frames`;}return allowed;};
 const finish=(cancelled=false)=>{controller.abort();for(const ghost of ghosts.values())ghost.remove();ghosts.clear();suppressFadeClick=true;if(cancelled)window.addEventListener('pointerdown',()=>{suppressFadeClick=false;},{once:true,capture:true});else setTimeout(()=>{suppressFadeClick=false;},0);};
 window.addEventListener('pointermove',e=>{if(e.pointerId!==event.pointerId)return;if(!valid())finish(true);else preview(e);},options);
 window.addEventListener('pointerup',async e=>{if(e.pointerId!==event.pointerId)return;const allowed=valid()&&preview(e),didMove=moved,planned=commands,snapshot=project;finish();if(!didMove)return;if(!allowed){notice('원본·역재생 구간과 프로젝트 시작 범위 안에서 트림하세요.',true);return;}if(resizeMode==='timeStretch'){if(stretchPlan&&deltaFrames)await stretchSelectedAudio(stretchPlan,{documentId:doc,revision});return;}try{let final=planned;if(resizeMode==='normal'&&audioZeroCrossingTrimSupported&&$('zero-crossing-split').checked)final=await refineZeroCrossingTrims(snapshot,planned,async(item,atSample,edge)=>{if(doc!==documentState?.id||revision!==project?.revision)throw new Error('트림 준비 중 프로젝트가 바뀌었습니다.');return jsonFetch('/api/audio/zero-crossing',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({clipId:item.id,atSample,edge,expectedRevision:revision})});});if(doc===documentState?.id&&revision===project?.revision&&final.length)await runCommand('batch',{commands:final},revision);}catch(error){if(doc===documentState?.id)notice(error.message,true);}},options);
 window.addEventListener('pointercancel',()=>finish(true),options);window.addEventListener('blur',()=>finish(true),options);window.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();finish(true);}},{...options,capture:true});
},true);
$('timeline-lanes').addEventListener('pointerdown',event=>{
 const handle=event.target.closest('[data-midi-part-end]');if(!handle||busy||!connected||event.button!==0||$('timeline-range-mode').checked)return;
 event.preventDefault();event.stopImmediatePropagation();
 const edge=handle.dataset.midiPartEnd,clip=project.clips.find(c=>c.id===handle.closest('[data-clip-id]').dataset.clipId),ids=selectedClipIds.has(clip.id)?[...selectedClipIds]:[clip.id],revision=project.revision,doc=documentState?.id,zoom=pxPerBeat,view=geometry().timeline,grid=compileEditorSnap(project,{scope:'primary'}),controller=new AbortController(),options={signal:controller.signal};let moved=false,commands=[],error='',ghosts=[];
 const valid=()=>doc===documentState?.id&&revision===project?.revision&&zoom===pxPerBeat&&handle.isConnected&&connected&&!busy;
 const preview=e=>{if(!moved&&Math.abs(e.clientX-event.clientX)<3)return;moved=true;for(const g of ghosts)g.remove();ghosts=[];const raw=Math.max(0,view.xToTick(e.clientX-$('timeline-surface').getBoundingClientRect().left)),end=e.altKey?Math.round(raw):grid.snap(raw).tick;
 try{commands=edge==='left'?planMidiPartStartResize(project,ids,end-clip.startTick):planMidiPartEndResize(project,ids,end-clip.startTick-clip.lengthTicks);error='';for(const command of commands){const part=project.clips.find(c=>c.id===command.arguments.clipId),node=$('timeline-lanes').querySelector(`[data-clip-id="${CSS.escape(part.id)}"]`);if(!node)continue;const g=document.createElement('div'),r=node.getBoundingClientRect();const nextStart=part.startTick+(edge==='left'?command.arguments.deltaTicks:0),nextLength=edge==='left'?part.lengthTicks-command.arguments.deltaTicks:command.arguments.lengthTicks;g.className='trim-drag-preview';g.style.cssText=`position:fixed;pointer-events:none;left:${$('timeline-surface').getBoundingClientRect().left+view.tickToX(nextStart)}px;top:${r.top}px;width:${Math.max(1,view.span(nextStart,nextStart+nextLength))}px;height:${r.height}px;border:2px solid #88ffd4;z-index:10000;background:#88ffd422`;g.textContent=`${part.name} · ${nextLength} tick`;document.body.append(g);ghosts.push(g);}}catch(e){commands=[];error=e.message;}};
 const finish=(cancelled=false)=>{controller.abort();for(const g of ghosts)g.remove();suppressFadeClick=true;if(cancelled)window.addEventListener('pointerdown',()=>{suppressFadeClick=false;},{once:true,capture:true});else setTimeout(()=>{suppressFadeClick=false;},0);};
 window.addEventListener('pointermove',e=>{if(e.pointerId===event.pointerId){if(!valid())finish(true);else preview(e);}},options);
 window.addEventListener('pointerup',async e=>{if(e.pointerId!==event.pointerId)return;const ok=valid();if(ok)preview(e);finish();if(!ok||!moved)return;if(error){notice(error,true);return;}if(commands.length)await runCommand('batch',{commands},revision);},options);
 window.addEventListener('pointercancel',()=>finish(true),options);window.addEventListener('blur',()=>finish(true),options);window.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();finish(true);}},{...options,capture:true});
},true);
let suppressClipDragClick=false;
$('timeline-lanes').addEventListener('pointerdown',event=>{
 if(!(event.ctrlKey||event.metaKey)||!event.altKey||event.button!==0||!audioSlipSupported||!project||busy||!connected||$('timeline-range-mode').checked)return;
 const element=event.target.closest('[data-clip-id]');if(!element||event.target.closest('[data-audio-fade],[data-audio-gain],[data-audio-trim],[data-midi-part-end]'))return;
 const clip=project.clips.find(c=>c.id===element.dataset.clipId);if(clip?.type!=='audio')return;
 event.preventDefault();event.stopImmediatePropagation();
 const clips=selectedClipIds.has(clip.id)?project.clips.filter(c=>selectedClipIds.has(c.id)):[clip],ids=clips.map(c=>c.id);let plan;try{plan=planAudioSlip(project,ids,0);}catch(error){notice(error.message,true);return;}
 const revision=project.revision,doc=documentState?.id,zoom=pxPerBeat,view=geometry().timeline,surface=$('timeline-surface'),startTick=view.xToTick(Math.max(0,event.clientX-surface.getBoundingClientRect().left)),startSeconds=tickToSeconds(startTick),controller=new AbortController(),options={signal:controller.signal};
 const scroll=$('timeline-scroll'),visuals=[...$('timeline-lanes').querySelectorAll('[data-clip-id]')].filter(e=>ids.includes(e.dataset.clipId)).map(e=>({element:e,name:e.querySelector('.clip-name'),text:e.querySelector('.clip-name')?.textContent,outline:e.style.outline}));
 let moved=false,lastEvent=event,animation=null,finished=false;
 const valid=()=>documentState?.id===doc&&project?.revision===revision&&pxPerBeat===zoom&&!busy&&connected&&element.isConnected&&!$('timeline-range-mode').checked;
 const preview=e=>{lastEvent=e;if(!moved&&Math.abs(e.clientX-event.clientX)<4)return;moved=true;const tick=view.xToTick(Math.max(0,e.clientX-surface.getBoundingClientRect().left));plan=planAudioSlip(project,ids,startSeconds-tickToSeconds(tick));for(const v of visuals){if(v.name)v.name.textContent=`${v.text} · 소스 ${plan.seconds.toFixed(4)}s${plan.limited?' · 파일 경계':''}`;v.element.style.outline='2px solid #82c9ff';}};
 const finish=()=>{if(finished)return;finished=true;controller.abort();if(animation!==null)cancelAnimationFrame(animation);for(const v of visuals){if(v.name)v.name.textContent=v.text;v.element.style.outline=v.outline;}if(moved){suppressClipDragClick=true;setTimeout(()=>{suppressClipDragClick=false;},0);}};
 const pump=()=>{if(finished)return;if(!valid()){finish();return;}if(moved){const r=scroll.getBoundingClientRect(),margin=32,delta=lastEvent.clientX<r.left+margin?-Math.min(24,(r.left+margin-lastEvent.clientX)/2):lastEvent.clientX>r.right-margin?Math.min(24,(lastEvent.clientX-r.right+margin)/2):0;if(delta){const before=scroll.scrollLeft;scroll.scrollLeft+=delta;if(scroll.scrollLeft!==before)preview(lastEvent);}}animation=requestAnimationFrame(pump);};
 window.addEventListener('pointermove',e=>{if(e.pointerId!==event.pointerId)return;if(!valid())finish();else{preview(e);e.preventDefault();}},options);
 window.addEventListener('pointerup',e=>{if(e.pointerId!==event.pointerId)return;const allowed=valid();if(allowed)preview(e);const commands=plan.commands,didMove=moved;finish();if(allowed&&didMove&&commands.length)void runCommand('batch',{commands},revision);},options);
 window.addEventListener('pointercancel',finish,options);window.addEventListener('blur',finish,options);window.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();finish();}},{...options,capture:true});
 animation=requestAnimationFrame(pump);
});
$('timeline-lanes').addEventListener('pointerdown',event=>{
 const element=event.target.closest('[data-clip-id]');
 if(!element||event.target.closest('[data-audio-fade],[data-audio-gain],[data-audio-trim],[data-midi-part-end]')||$('timeline-range-mode').checked||!project||busy||!connected||event.button!==0)return;
 const clip=project.clips.find(c=>c.id===element.dataset.clipId);if(!clip)return;
 const clips=selectedClipIds.has(clip.id)?project.clips.filter(c=>selectedClipIds.has(c.id)):[clip];
 if(clips.length>4096){notice('한 번의 드래그는 최대 4096개 클립을 지원합니다.',true);return;}
 const copyMode=event.ctrlKey||event.metaKey;if(copyMode&&!clipCopyToSupported){notice('드래그 복사를 지원하는 서버로 갱신하세요.',true);return;}if(copyMode&&clips.reduce((n,c)=>n+(c.notes?.length??0),0)>200000){notice('한 번에 복사할 수 있는 MIDI 노트는 200000개입니다.',true);return;}const copyIds=new Map(copyMode?clips.map(c=>[c.id,uid('clip')]):[]);
 const revision=project.revision,doc=documentState?.id,zoom=pxPerBeat,view=geometry().timeline,surface=$('timeline-surface'),scroll=$('timeline-scroll'),lanes=[...$('timeline-lanes').querySelectorAll('.timeline-lane')].filter(l=>l.style.display!=='none'),anchorIndex=lanes.findIndex(l=>l.dataset.trackId===clip.trackId),anchorTick=clipTiming(clip).start,grab=view.xToTick(Math.max(0,event.clientX-surface.getBoundingClientRect().left))-anchorTick,grid=compileEditorSnap(project,{scope:'primary'});
 const controller=new AbortController(),options={signal:controller.signal};let moved=false,ghost=null,commands=[],dropValid=false,lastEvent=event,animation=null;
 const valid=()=>documentState?.id===doc&&project?.revision===revision&&pxPerBeat===zoom&&!busy&&element.isConnected&&!$('timeline-range-mode').checked;
 const preview=e=>{
  lastEvent=e;if(!moved&&Math.hypot(e.clientX-event.clientX,e.clientY-event.clientY)<4)return;
  if(!moved){moved=true;ghost=element.cloneNode(true);ghost.classList.add('clip-drag-preview');ghost.setAttribute('aria-hidden','true');ghost.tabIndex=-1;document.body.append(ghost);}
  const raw=Math.max(0,view.xToTick(Math.max(0,e.clientX-surface.getBoundingClientRect().left))-grab),horizontal=Math.abs(e.clientX-event.clientX)>=Math.abs(e.clientY-event.clientY),tick=e.shiftKey&&!horizontal?anchorTick:e.altKey?Math.round(raw):audioEventSnapPointSupported?snapAudioEventStart(project,clip,raw,value=>grid.snap(value)):grid.snap(raw).tick,deltaTick=Math.round(tick-anchorTick),deltaSample=Math.round((tickToSeconds(tick)-tickToSeconds(anchorTick))*project.sampleRate);
  const laneIndex=e.shiftKey&&horizontal?anchorIndex:lanes.findIndex(l=>{const r=l.getBoundingClientRect();return e.clientY>=r.top&&e.clientY<r.bottom;}),laneDelta=laneIndex-anchorIndex;
  dropValid=laneIndex>=0;commands=[];
  for(const item of clips){const sourceLaneIndex=lanes.findIndex(l=>l.dataset.trackId===item.trackId);if(sourceLaneIndex<0){dropValid=false;break;}const targetLane=lanes[sourceLaneIndex+laneDelta],track=project.tracks.find(t=>t.id===targetLane?.dataset.trackId),position=item.type==='midi'?item.startTick+deltaTick:item.startSample+deltaSample;if(!track||track.type!==item.type||!Number.isSafeInteger(position)||position<0){dropValid=false;break;}commands.push({command:copyMode?'clip.copyTo':'clip.move',arguments:{clipId:item.id,...(copyMode?{id:copyIds.get(item.id)}:{}),trackId:track.id,[item.type==='midi'?'startTick':'startSample']:position}});}
  const lane=lanes[Math.max(0,laneIndex)],rect=element.getBoundingClientRect();ghost.style.cssText=`position:fixed;left:${surface.getBoundingClientRect().left+view.tickToX(tick)}px;top:${lane?.getBoundingClientRect().top??rect.top}px;width:${rect.width}px;height:${rect.height}px;z-index:10000;pointer-events:none;opacity:.75;outline:2px solid ${dropValid?'#88ffd4':'#ff7777'}`;
  ghost.style.setProperty('--track-color',color(project.tracks.find(t=>t.id===clip.trackId)));
  ghost.querySelector('.clip-name').textContent=`${clip.name}${clips.length>1?' + '+(clips.length-1):''} · ${dropValid?(copyMode?'복사':'이동'):'대상 트랙/범위 불가'}`;
 };
 const finish=()=>{controller.abort();if(animation!==null)cancelAnimationFrame(animation);ghost?.remove();if(moved){suppressClipDragClick=true;setTimeout(()=>{suppressClipDragClick=false;},0);}};
 const cancel=()=>finish();
 const pump=()=>{if(!valid()){cancel();return;}if(moved){const r=scroll.getBoundingClientRect(),margin=32,delta=lastEvent.clientX<r.left+margin?-Math.min(24,(r.left+margin-lastEvent.clientX)/2):lastEvent.clientX>r.right-margin?Math.min(24,(lastEvent.clientX-r.right+margin)/2):0;if(delta){scroll.scrollLeft+=delta;preview(lastEvent);}}animation=requestAnimationFrame(pump);};
 window.addEventListener('pointermove',e=>{if(e.pointerId!==event.pointerId)return;if(!valid())cancel();else{preview(e);if(moved)e.preventDefault();}},options);
 window.addEventListener('pointerup',async e=>{if(e.pointerId!==event.pointerId)return;const canCommit=valid();if(canCommit)preview(e);const didMove=moved,allowed=dropValid,planned=commands;finish();if(!didMove)return;if(!canCommit)return;if(!allowed){notice('선택 클립 전체가 같은 형식의 트랙과 유효한 시간에 놓여야 합니다.',true);return;}const changed=copyMode?planned:planned.filter((command,i)=>{const original=clips[i],args=command.arguments;return args.trackId!==original.trackId||(original.type==='midi'?args.startTick!==original.startTick:args.startSample!==original.startSample);});if(changed.length){const result=await runCommand('batch',{commands:changed},revision);if(result&&documentState?.id===doc){selectedClipIds=new Set(clips.map(c=>copyMode?copyIds.get(c.id):c.id));selectedClip=copyMode?copyIds.get(clip.id):clip.id;selectedNote=null;selectedNoteIds.clear();selectedTrack=project.clips.find(c=>c.id===selectedClip)?.trackId??selectedTrack;renderUI(true);}}},options);
 window.addEventListener('pointercancel',cancel,options);window.addEventListener('blur',cancel,options);window.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();cancel();}},options);
 animation=requestAnimationFrame(pump);
});
$('timeline-lanes').addEventListener('pointerdown',event=>{
 if(!$('timeline-range-mode').checked||!project||busy||!connected||event.button!==0)return;
 event.preventDefault();event.stopPropagation();
 const view=geometry().timeline,revision=project.revision,documentId=documentState?.id,zoom=pxPerBeat,surface=$('timeline-surface'),scroll=$('timeline-scroll'),overlay=$('timeline-range-overlay');
 const grid=compileEditorSnap(project,{scope:'primary'}),lanes=[...$('timeline-lanes').querySelectorAll('.timeline-lane')].filter(l=>l.style.display!=='none');
 if(!lanes.length)return;
 const tickAt=e=>{const raw=Math.max(0,view.xToTick(Math.max(0,e.clientX-surface.getBoundingClientRect().left)));return e.altKey?Math.round(raw):grid.snap(raw).tick;};
 const laneAt=e=>{const index=lanes.findIndex(l=>e.clientY<l.getBoundingClientRect().bottom);return index<0?lanes.length-1:index;};
 const anchor=tickAt(event),anchorLane=laneAt(event);let endpoint=anchor,endLane=anchorLane,lastEvent=event,animation=null;
 const controller=new AbortController(),options={signal:controller.signal};
 const valid=()=>project?.revision===revision&&documentState?.id===documentId&&pxPerBeat===zoom&&lanes.every(lane=>lane.isConnected)&&$('timeline-range-mode').checked;
 const draw=()=>{const first=Math.min(anchor,endpoint),last=Math.max(anchor,endpoint),top=lanes[Math.min(anchorLane,endLane)].getBoundingClientRect().top,bottom=lanes[Math.max(anchorLane,endLane)].getBoundingClientRect().bottom;overlay.hidden=false;overlay.style.left=`${view.tickToX(first)}px`;overlay.style.width=`${Math.max(1,view.span(first,last))}px`;overlay.style.top=`${top-surface.getBoundingClientRect().top}px`;overlay.style.bottom='auto';overlay.style.height=`${bottom-top}px`;};
 const finish=()=>{controller.abort();if(animation!==null)cancelAnimationFrame(animation);overlay.style.top='0';overlay.style.bottom='0';overlay.style.height='';};
 const cancel=()=>{finish();renderTimeline();};
 const update=e=>{lastEvent=e;endpoint=tickAt(e);endLane=laneAt(e);draw();};
 const pump=()=>{if(!valid()){cancel();return;}const rect=scroll.getBoundingClientRect(),margin=32;let delta=0;if(lastEvent.clientX<rect.left+margin)delta=-Math.min(24,(rect.left+margin-lastEvent.clientX)/2);else if(lastEvent.clientX>rect.right-margin)delta=Math.min(24,(lastEvent.clientX-rect.right+margin)/2);if(delta){scroll.scrollLeft+=delta;update(lastEvent);}animation=requestAnimationFrame(pump);};
 window.addEventListener('pointermove',e=>{if(e.pointerId!==event.pointerId)return;if(!valid()){cancel();return;}update(e);},options);
 window.addEventListener('pointerup',async e=>{
  if(e.pointerId!==event.pointerId)return;const canCommit=valid();finish();if(!canCommit){renderTimeline();return;}
  endpoint=tickAt(e);endLane=laneAt(e);const range={startTick:Math.min(anchor,endpoint),endTick:Math.max(anchor,endpoint)};
  if(range.endTick<=range.startTick){renderTimeline();return;}
  const trackIds=new Set(lanes.slice(Math.min(anchorLane,endLane),Math.max(anchorLane,endLane)+1).map(l=>l.dataset.trackId));
  const ids=project.clips.filter(c=>{const t=clipTiming(c);return trackIds.has(c.trackId)&&t.start<range.endTick&&t.end>range.startTick;}).map(c=>c.id);
  const result=await runCommand('project.locators',{range},revision);
  if(result&&documentState?.id===documentId){selectedClipIds=new Set(ids);selectedClip=project.clips.find(c=>ids.includes(c.id)&&c.type==='audio')?.id??ids[0]??null;selectedTrack=project.clips.find(c=>c.id===selectedClip)?.trackId??selectedTrack;selectedNote=null;selectedNoteIds.clear();renderUI(true);}else renderTimeline();
 },options);
 window.addEventListener('pointercancel',cancel,options);window.addEventListener('blur',cancel,options);window.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();cancel();}},options);
 draw();animation=requestAnimationFrame(pump);
});
$('timeline-lanes').addEventListener('click', (event) => {
  if(suppressClipDragClick){suppressClipDragClick=false;return;}
  if(suppressFadeClick){suppressFadeClick=false;return;}
  if(event.target.closest('[data-audio-gain]'))return;
  if($('timeline-range-mode').checked)return;
  const clip = event.target.closest('[data-clip-id]');
  if (clip) selectClip(clip.dataset.clipId,{additive:event.shiftKey||event.metaKey||event.ctrlKey});
  else if (event.target.closest('[data-track-id]')) selectTrack(event.target.closest('[data-track-id]').dataset.trackId);
});
async function seekRuler(event,scope){
  if(!project||event.button!==0)return;const view=geometry()[scope],element=$(scope==='timeline'?'timeline-ruler':'piano-ruler');
  const x=Math.max(0,event.clientX-element.getBoundingClientRect().left),doc=documentState?.id;
  const target=event.altKey?view.xToSeconds(x):tickToSeconds((scope==='piano'?noteSnap():compileEditorSnap(project,{scope:'primary'})).snap(view.xToTick(x)).tick);
  const token=++seekGeneration;transportSeeking=true;const stopped=stopTransport(false,'locate');transportSeconds=target;updatePosition();updateButtons();
  await stopped;if(token!==seekGeneration)return;transportSeeking=false;if(doc===documentState?.id){transportSeconds=target;updatePosition();}updateButtons();
}
$('timeline-ruler').addEventListener('pointerdown',event=>{
 const handle=event.target.closest('[data-locator-drag]');if(!handle||event.button!==0)return;
 event.preventDefault();event.stopImmediatePropagation();if(locatorDragging||!project?.locators||busy||!connected)return;
 const range={...project.locators},side=handle.dataset.locatorDrag,view=geometry().timeline,grid=compileEditorSnap(project,{scope:'primary'}),surface=$('timeline-surface'),revision=project.revision,doc=documentState?.id,zoom=pxPerBeat,controller=new AbortController(),options={signal:controller.signal};
 const scroll=$('timeline-scroll'),originalWidth=surface.style.width;locatorDragging=true;
 const pointerTick=view.xToTick(Math.max(0,event.clientX-surface.getBoundingClientRect().left));let moved=false,target={...range},ghost=null,lastEvent=event,animation=null,lastFrame=0;
 const valid=()=>project?.revision===revision&&documentState?.id===doc&&pxPerBeat===zoom&&handle.isConnected&&!busy;
 const preview=e=>{lastEvent=e;if(!moved&&Math.abs(e.clientX-event.clientX)<3)return;moved=true;const base=side==='end'?range.endTick:range.startTick,raw=Math.max(0,base+view.xToTick(Math.max(0,e.clientX-surface.getBoundingClientRect().left))-pointerTick),tick=e.altKey?Math.round(raw):grid.snap(raw).tick;
  target=side==='move'?{startTick:tick,endTick:tick+range.endTick-range.startTick}:side==='start'?{startTick:Math.min(tick,range.endTick-1),endTick:range.endTick}:{startTick:range.startTick,endTick:Math.max(tick,range.startTick+1)};
  if(!ghost){ghost=document.createElement('div');ghost.className='locator-drag-ghost';document.body.append(ghost);}ghost.style.left=`${surface.getBoundingClientRect().left+view.tickToX(target.startTick)}px`;ghost.style.width=`${Math.max(2,view.span(target.startTick,target.endTick))}px`;ghost.style.top=`${$('timeline-ruler').getBoundingClientRect().top}px`;ghost.textContent=`${target.startTick}–${target.endTick} · ${target.endTick-target.startTick} tick`;
 };
 const finish=()=>{controller.abort();if(animation!==null)cancelAnimationFrame(animation);animation=null;locatorDragging=false;ghost?.remove();surface.style.width=originalWidth;};
 const pump=now=>{if(!valid()){finish();return;}const dt=lastFrame?Math.min(32,now-lastFrame):16;lastFrame=now;
  if(moved){const rect=scroll.getBoundingClientRect(),margin=32;let speed=0;if(lastEvent.clientX<rect.left+margin)speed=-Math.min(24,(rect.left+margin-lastEvent.clientX)/2);else if(lastEvent.clientX>rect.right-margin)speed=Math.min(24,(lastEvent.clientX-rect.right+margin)/2);
   if(speed){if(speed>0&&scroll.scrollLeft+scroll.clientWidth>=scroll.scrollWidth-32)surface.style.width=`${scroll.scrollWidth+scroll.clientWidth/2}px`;scroll.scrollLeft+=speed*dt/16;preview(lastEvent);}
  }animation=requestAnimationFrame(pump);
 };
 animation=requestAnimationFrame(pump);
 window.addEventListener('pointermove',e=>{if(e.pointerId!==event.pointerId)return;if(!valid()){finish();return;}preview(e);},options);
 window.addEventListener('pointerup',e=>{if(e.pointerId!==event.pointerId)return;const commit=valid();if(commit)preview(e);finish();if(commit&&moved&&(target.startTick!==range.startTick||target.endTick!==range.endTick))void runCommand('project.locators',{range:target},revision);},options);
 window.addEventListener('pointercancel',finish,options);window.addEventListener('blur',finish,options);window.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();finish();}},options);
},{capture:true});
$('timeline-ruler').addEventListener('pointerdown',event=>void seekRuler(event,'timeline'));
function placeStepCursorFromPointer(event){
 if(event.button!==0||!editingUI?.stepCursorClickActive)return;
 event.preventDefault();event.stopImmediatePropagation();try{const grid=$('note-grid'),raw=Math.max(0,geometry().piano.xToTick(event.clientX-grid.getBoundingClientRect().left)),tick=event.altKey?Math.round(raw):noteSnap().snap(raw,'nearest').localTick;editingUI.placeStepCursor(tick);}catch(error){notice(error.message,true);}
}
for(const node of [$('piano-ruler'),$('note-grid')]){node.addEventListener('pointerdown',placeStepCursorFromPointer,true);node.addEventListener('dblclick',event=>{if(editingUI?.stepCursorClickActive){event.preventDefault();event.stopImmediatePropagation();}},true);}
$('piano-ruler').addEventListener('pointerdown',event=>void seekRuler(event,'piano'));
function effectPresetsMarkup(){if(!effectPresetsSupported)return '';const presets=project.effectPresets??[];if(!presets.some(p=>p.id===effectPresetSelection))effectPresetSelection='';const selected=presets.find(p=>p.id===effectPresetSelection);return `<details><summary>프로젝트 효과 프리셋</summary><select id="track-effect-preset-select"><option value="">새 프리셋</option>${presets.map(p=>`<option value="${esc(p.id)}" ${p.id===effectPresetSelection?'selected':''}>${esc(p.name)}</option>`).join('')}</select><label>이름<input id="track-effect-preset-name" maxlength="120" value="${esc(selected?.name??'')}"></label><label>저장/적용 범위<select id="track-effect-preset-scope"><option value="all">${preEffectTransferSupported?'Pre+EQ+딜레이':'EQ+딜레이'}</option>${preEffectTransferSupported?'<option value="pre">Pre만</option>':''}<option value="eq">EQ만</option><option value="delay">딜레이만</option></select></label><button type="button" data-effect-preset-action="save">저장된 트랙 값으로 저장/갱신</button><button type="button" data-effect-preset-action="apply">선택 트랙 적용</button><button type="button" data-effect-preset-action="rename">이름 변경</button><button type="button" data-effect-preset-action="remove">삭제</button><p class="form-help">프로젝트에 저장하는 내장 Pre/EQ/딜레이 설정입니다. 미적용 폼 값·악기·믹서·외부 포트는 포함하지 않습니다. 선택한 범위만 적용하며 없는 효과는 유지합니다.</p></details>`;}
function closeEqGraphOverlay(){const state=eqGraphOverlay;if(!state)return;eqGraphOverlay=null;if(state.placeholder.isConnected)state.placeholder.replaceWith(state.host);state.dialog.close();state.dialog.remove();}
$('inspector-content').addEventListener('click',event=>{if(!event.target.closest('[data-eq-graph-enlarge]')||eqGraphOverlay)return;const host=$('track-eq-graph-host'),form=host?.closest('form');if(!form)return;const placeholder=document.createComment('EQ graph location'),dialog=document.createElement('dialog'),heading=document.createElement('h2'),close=document.createElement('button'),help=document.createElement('p');heading.textContent='트랙 EQ · 확대';close.type='button';close.textContent='닫기 · 미적용 값 유지';close.onclick=closeEqGraphOverlay;help.textContent='드래그 주파수/게인 · Ctrl/Cmd 게인만 · Alt 주파수만 · Shift Q · 저장은 닫은 후 트랙 적용';dialog.style.cssText='width:min(960px,92vw);max-height:90vh;overflow:auto';host.before(placeholder);dialog.append(heading,close,help,host);form.append(dialog);eqGraphOverlay={host,placeholder,dialog};dialog.addEventListener('close',()=>{if(eqGraphOverlay?.dialog===dialog)closeEqGraphOverlay();});dialog.showModal();updateTrackEqGraph();});
function updateEqCrosshair(event){const svg=event.target.closest('#track-eq-response');if(!svg||!eqGraphModule?.eqGraphReadout||!project)return;const rect=svg.getBoundingClientRect(),x=clamp((event.clientX-rect.left)*300/rect.width,12,288),y=clamp((event.clientY-rect.top)*160/rect.height,12,140),readout=eqGraphModule.eqGraphReadout({x,y,sampleRate:project.sampleRate});let group=svg.querySelector('[data-eq-crosshair]');if(!group){group=document.createElementNS('http://www.w3.org/2000/svg','g');group.dataset.eqCrosshair='';group.style.pointerEvents='none';svg.append(group);}group.innerHTML=`<path d="M${x} 12V140M12 ${y}H288" stroke="#dfdd9a" stroke-width=".5" stroke-dasharray="2 2"/>`;$('track-eq-response-status').textContent=`${readout.frequencyHz.toFixed(2)}Hz · ${readout.note} ${readout.cents>=0?'+':''}${readout.cents}cent · ${readout.gainDb.toFixed(1)}dB · A3=440Hz · 미적용 폼`;
}
$('inspector-content').addEventListener('pointermove',updateEqCrosshair);
$('inspector-content').addEventListener('pointerout',event=>{const svg=event.target.closest('#track-eq-response');if(svg&&!(event.relatedTarget instanceof Node&&svg.contains(event.relatedTarget))){svg.querySelector('[data-eq-crosshair]')?.remove();const status=$('track-eq-response-status');if(status?.dataset.baseText)status.textContent=status.dataset.baseText;}});
function refreshEffectPresetControls(){const select=$('track-effect-preset-select');if(!select)return;const presets=project.effectPresets??[];select.innerHTML='<option value="">새 프리셋</option>'+presets.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');select.value=presets.some(p=>p.id===effectPresetSelection)?effectPresetSelection:'';$('track-effect-preset-name').value=presets.find(p=>p.id===select.value)?.name??'';}
$('inspector-content').addEventListener('change',event=>{if(event.target.id!=='track-effect-preset-select')return;effectPresetSelection=event.target.value;$('track-effect-preset-name').value=project.effectPresets?.find(p=>p.id===effectPresetSelection)?.name??'';});
$('inspector-content').addEventListener('click',async event=>{const button=event.target.closest('[data-effect-preset-action]');if(!button||!effectPresetsSupported||!project||busy||!connected)return;const action=button.dataset.effectPresetAction,id=$('track-effect-preset-select').value,name=$('track-effect-preset-name').value.trim(),scope=$('track-effect-preset-scope').value,track=project.tracks.find(t=>t.id===selectedTrack);let command,args;if(action==='save'){if(!name||!track){notice('프리셋 이름과 원본 트랙을 확인하세요.',true);return;}command='project.effectPreset.put';args={...(id?{presetId:id}:{}),name,...Object.fromEntries(['pre','eq','delay'].filter(key=>(scope==='all'||scope===key)&&(key!=='pre'||preEffectTransferSupported)).map(key=>[key,track[key]??null]))};}else{if(!id){notice('저장된 프리셋을 선택하세요.',true);return;}command=action==='apply'?'tracks.effectPreset.apply':action==='rename'?'project.effectPreset.rename':'project.effectPreset.remove';args={presetId:id,...(action==='apply'?{trackIds:selectedTrackIds.size?[...selectedTrackIds]:[track.id],scope}:action==='rename'?{name}:{})};}const result=await runCommand(command,args,project.revision);if(result){effectPresetSelection=action==='remove'?'':result.changes.effectPreset?.id??id;renderInspector();refreshEffectPresetControls();}});
function effectTransferMarkup(kind){return trackEffectTransferSupported?`<div class="effect-transfer"><button type="button" data-copy-track-effect="${kind}">저장된 설정 복사</button><button type="button" data-paste-track-effect="${kind}">선택 트랙에 적용</button><button type="button" data-reset-track-effect="${kind}">선택 트랙 초기화</button><p class="form-help" data-effect-clipboard-status="${kind}">미적용 폼 값은 복사하지 않습니다.</p></div>`:'';}
function updateEffectClipboardUI(){for(const kind of ['pre','eq','delay']){const status=document.querySelector(`[data-effect-clipboard-status="${kind}"]`),paste=document.querySelector(`[data-paste-track-effect="${kind}"]`);if(status)status.textContent=effectClipboard[kind]?`저장된 값: ${effectClipboard[kind].sourceName} · 선택 ${selectedTrackIds.size}개 · 미적용 폼 값 제외`:'미복사 · 저장된 설정만 복사합니다.';if(paste)paste.disabled=busy||!connected||!effectClipboard[kind];for(const selector of ['data-copy-track-effect','data-reset-track-effect']){const button=document.querySelector(`[${selector}="${kind}"]`);if(button)button.disabled=busy||!connected;}}}
$('inspector-content').addEventListener('click',async event=>{const button=event.target.closest('[data-copy-track-effect],[data-paste-track-effect],[data-reset-track-effect]');if(!button||!trackEffectTransferSupported||!project||busy||!connected)return;const kind=button.dataset.copyTrackEffect??button.dataset.pasteTrackEffect??button.dataset.resetTrackEffect,track=project.tracks.find(t=>t.id===selectedTrack);if(!track)return;if(button.dataset.copyTrackEffect){effectClipboard[kind]={settings:track[kind]?structuredClone(track[kind]):null,sourceName:track.name};updateEffectClipboardUI();return;}const resetting=button.dataset.resetTrackEffect!==undefined;if(!resetting&&!effectClipboard[kind])return;await runCommand('tracks.effectsApply',{trackIds:selectedTrackIds.size?[...selectedTrackIds]:[track.id],[kind]:resetting?null:effectClipboard[kind].settings},project.revision);});
function readTrackPreForm(form){if(!trackPreSupported)return undefined;return {gainDb:Number(form.elements.preGainDb.value),invertPolarity:form.elements.preInvertPolarity.checked,...(trackPreFiltersSupported?Object.fromEntries(['lowCut','highCut'].map(key=>[key,{enabled:form.elements[`pre${key}Enabled`].checked,frequencyHz:Number(form.elements[`pre${key}Hz`].value),slope:Number(form.elements[`pre${key}Slope`].value),...(trackPreFilterBypassSupported&&(form.elements[`pre${key}Bypass`].checked||currentTrack()?.pre?.[key]?.bypass!==undefined)?{bypass:form.elements[`pre${key}Bypass`].checked}:{})}])):{})};}
function readEqFrequency(input){return eqGraphModule?.parseEqFrequency?eqGraphModule.parseEqFrequency(input.value):Number(input.value);}
function readTrackEqForm(form){return {enabled:form.elements.eqEnabled.checked,bands:[0,1,2,3].map(index=>({enabled:form.elements[`eq${index}Enabled`].checked,...(trackEqTypesSupported?{type:form.elements[`eq${index}Type`]?.value??'peaking'}:{}),frequencyHz:readEqFrequency(form.elements[`eq${index}Frequency`]),gainDb:Number(form.elements[`eq${index}Gain`].value),q:Number(form.elements[`eq${index}Q`].value)}))};}
$('inspector-content').addEventListener('click',event=>{const button=event.target.closest('[data-invert-eq-draft]');if(!button||!eqGraphModule||busy)return;try{const form=button.closest('form'),settings=eqGraphModule.invertTrackEqGains(readTrackEqForm(form));for(let index=0;index<4;index++)form.elements[`eq${index}Gain`].value=String(settings.bands[index].gainDb);updateTrackEqGraph();}catch(error){notice(error.message,true);}});
function updateTrackEqGraph(){
 const form=$('track-form'),svg=$('track-eq-response'),status=$('track-eq-response-status');if(!form||!svg||!eqGraphModule||!project)return;
 try{const settings=readTrackEqForm(form),pre=readTrackPreForm(form),high=Math.min(20000,project.sampleRate*.49),frequencies=Array.from({length:256},(_,i)=>20*(high/20)**(i/255)),response=eqGraphModule.trackEqResponse(settings,project.sampleRate,frequencies,{pre}),path=response.map((p,i)=>`${i?'L':'M'}${(12+i/255*276).toFixed(2)},${(76-clamp(p.gainDb,-24,24)/24*64).toFixed(2)}`).join(' ');
  const asPath=points=>points.map((p,index)=>`${index?'L':'M'}${(12+index/255*276).toFixed(2)},${(76-clamp(p.gainDb,-24,24)/24*64).toFixed(2)}`).join(' ');let referencePaths='';
  for(const key of ['lowCut','highCut']){const filter=pre?.[key];if(!filter?.enabled)continue;const points=eqGraphModule.trackEqResponse(undefined,project.sampleRate,frequencies,{pre:{[key]:{...filter,bypass:false}}});referencePaths+=`<path data-pre-filter-curve="${key}" data-bypass="${!!filter.bypass}" d="${asPath(points)}" fill="none" stroke="${filter.bypass?'#88958d':'#82c9ff'}" stroke-width="1" ${filter.bypass?'stroke-dasharray="3 2"':''}/>`;}
  if(!settings.enabled)for(let index=0;index<4;index++){const band=settings.bands[index];if(!band.enabled||band.gainDb===0&&!['lowPass','highPass','notch'].includes(band.type))continue;const points=eqGraphModule.trackEqResponse({enabled:true,bands:settings.bands.map((b,j)=>({...b,enabled:j===index}))},project.sampleRate,frequencies);referencePaths+=`<path data-bypassed-eq-band="${index}" d="${asPath(points)}" fill="none" stroke="#88958d" stroke-dasharray="3 2" stroke-width="1"/>`;}
  svg.innerHTML=[-24,-12,0,12,24].map(db=>`<line x1="12" x2="288" y1="${76-db/24*64}" y2="${76-db/24*64}" stroke="${db?'#284034':'#5b7b69'}"/><text x="14" y="${73-db/24*64}" fill="#a3bcad" font-size="8">${db}dB</text>`).join('')+referencePaths+`<path data-eq-curve d="${path}" fill="none" stroke="#a3f0bf" stroke-width="2"/><text x="12" y="156" fill="#a3bcad" font-size="9">20Hz</text><text x="238" y="156" fill="#a3bcad" font-size="9">${Math.round(high)}Hz</text>`+settings.bands.map((band,index)=>{if(!band.enabled)return '';const pass=['lowPass','highPass','notch'].includes(band.type),x=12+Math.log(clamp(band.frequencyHz,20,high)/20)/Math.log(high/20)*276,y=76-(pass?0:band.gainDb)/24*64;return `<circle data-eq-band="${index}" role="img" aria-label="EQ 밴드 ${index+1}: 드래그 주파수${pass?'':'/게인'}, 방향키 미세 조절" cx="${x}" cy="${y}" r="6" fill="${settings.enabled?'#ffcf88':'#728478'}" stroke="#14201b" style="cursor:move;touch-action:none"><title>밴드 ${index+1} · 드래그 · Ctrl/Cmd 게인 · Alt 주파수 · Shift Q · Esc 취소 · 트랙 적용 전까지 미저장</title></circle>`;}).join('');svg.dataset.ready='true';status.textContent=`${settings.enabled?'EQ 켜짐':'EQ bypass'} · 미적용 폼 값 · 표시 ±24dB · ${project.sampleRate}Hz 렌더 기준`;status.dataset.baseText=status.textContent;
 }catch{svg.innerHTML='';svg.dataset.ready='false';status.textContent='유효한 EQ 수치를 입력하세요. 프로젝트는 변경하지 않았습니다.';}
}
$('inspector-content').addEventListener('pointerdown',event=>{
 const handle=event.target.closest('[data-eq-band]'),graph=event.target.closest('#track-eq-response');if(!graph||event.button!==0||eqGraphDragging||!eqGraphModule||busy)return;event.preventDefault();event.stopPropagation();
 if(!handle){const form=graph.closest('form'),index=[0,1,2,3].find(i=>!form.elements[`eq${i}Enabled`].checked)??[0,1,2,3].find(i=>Number(form.elements[`eq${i}Gain`].value)===0&&!['lowPass','highPass','notch'].includes(form.elements[`eq${i}Type`]?.value));if(index===undefined)return;const rect=graph.getBoundingClientRect(),x=(event.clientX-rect.left)*300/rect.width,y=(event.clientY-rect.top)*160/rect.height;if(x<12||x>288||y<12||y>140)return;const values=eqGraphModule.eqGraphDrag({frequencyHz:20,gainDb:0,dx:x-12,dy:y-76,sampleRate:project.sampleRate});form.elements[`eq${index}Enabled`].checked=true;form.elements.eqEnabled.checked=true;form.elements[`eq${index}Frequency`].value=String(values.frequencyHz);if(!['lowPass','highPass','notch'].includes(form.elements[`eq${index}Type`]?.value))form.elements[`eq${index}Gain`].value=String(values.gainDb);updateTrackEqGraph();return;}

 const form=handle.closest('form'),svg=$('track-eq-response'),index=Number(handle.dataset.eqBand),frequency=form.elements[`eq${index}Frequency`],gain=form.elements[`eq${index}Gain`],qInput=form.elements[`eq${index}Q`],original={frequencyHz:readEqFrequency(frequency),gainDb:Number(gain.value),q:Number(qInput.value)},text={frequency:frequency.value,gain:gain.value,q:qInput.value},rect=svg.getBoundingClientRect(),revision=project.revision,doc=documentState?.id,trackId=selectedTrack,rate=project.sampleRate,gainEditable=!['lowPass','highPass','notch'].includes(form.elements[`eq${index}Type`]?.value),controller=new AbortController(),options={signal:controller.signal};let moved=false;
 eqGraphDragging=true;const valid=()=>form.isConnected&&project?.revision===revision&&documentState?.id===doc&&selectedTrack===trackId;
 const preview=e=>{if(!moved&&Math.hypot(e.clientX-event.clientX,e.clientY-event.clientY)<2)return;moved=true;const values=eqGraphModule.eqGraphGesture({...original,dx:(e.clientX-event.clientX)*300/rect.width,dy:(e.clientY-event.clientY)*160/rect.height,sampleRate:rate,shiftKey:e.shiftKey,altKey:e.altKey,ctrlKey:e.ctrlKey,metaKey:e.metaKey,qEditable:!['lowShelf','highShelf'].includes(form.elements[`eq${index}Type`]?.value),gainEditable});frequency.value=String(values.frequencyHz);gain.value=String(values.gainDb);qInput.value=String(values.q);updateTrackEqGraph();updateEqCrosshair({target:svg,clientX:e.clientX,clientY:e.clientY});};
 const finish=cancel=>{controller.abort();eqGraphDragging=false;if(cancel&&form.isConnected){frequency.value=text.frequency;gain.value=text.gain;qInput.value=text.q;updateTrackEqGraph();}};
 window.addEventListener('pointermove',e=>{if(e.pointerId!==event.pointerId)return;if(!valid()){finish(true);return;}preview(e);},options);
 window.addEventListener('pointerup',e=>{if(e.pointerId!==event.pointerId)return;if(valid())preview(e);finish(!valid());},options);
 window.addEventListener('pointercancel',()=>finish(true),options);window.addEventListener('blur',()=>finish(true),options);window.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();finish(true);}},{...options,capture:true});
});
$('inspector-content').addEventListener('dblclick',event=>{const handle=event.target.closest('[data-eq-band]');if(!handle||busy)return;event.preventDefault();event.stopPropagation();const form=handle.closest('form');form.elements[`eq${handle.dataset.eqBand}Enabled`].checked=false;updateTrackEqGraph();});
$('inspector-content').addEventListener('change',event=>{const input=event.target.closest('#midi-track-time-base');if(!input||busy||!connected||!midiTrackTimeBaseSupported)return;if(input.dataset.document!==documentState?.id||Number(input.dataset.revision)!==project?.revision||input.dataset.track!==selectedTrack){notice('프로젝트가 변경되었습니다. 시간 기준을 다시 선택하세요.',true);return;}void runCommand('track.midiTimeBase',{trackId:input.dataset.track,mode:input.value},Number(input.dataset.revision));});
$('inspector-content').addEventListener('change',event=>{const input=event.target.closest('#audio-track-time-base');if(!input||busy||!connected||!audioTrackTimeBaseSupported)return;if(input.dataset.document!==documentState?.id||Number(input.dataset.revision)!==project?.revision||input.dataset.track!==selectedTrack){notice('프로젝트가 변경되었습니다. 시간 기준을 다시 선택하세요.',true);return;}void runCommand('track.audioTimeBase',{trackId:input.dataset.track,mode:input.value},Number(input.dataset.revision));});
$('inspector-content').addEventListener('keydown',event=>{const handle=event.target.closest('[data-eq-band],[data-eq-band-key]');if(!handle||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)||!eqGraphModule)return;event.preventDefault();event.stopPropagation();const form=handle.closest('form'),index=Number(handle.dataset.eqBand??handle.dataset.eqBandKey),frequency=form.elements[`eq${index}Frequency`],gain=form.elements[`eq${index}Gain`],pass=['lowPass','highPass','notch'].includes(form.elements[`eq${index}Type`]?.value),horizontal=event.key==='ArrowLeft'||event.key==='ArrowRight',sign=['ArrowRight','ArrowUp'].includes(event.key)?1:-1;const value=eqGraphModule.eqGraphDrag({frequencyHz:readEqFrequency(frequency),gainDb:Number(gain.value),dx:horizontal?sign*4:0,dy:horizontal?0:-sign*4/3,sampleRate:project.sampleRate,fine:event.shiftKey,gainEditable:!pass});frequency.value=String(value.frequencyHz);gain.value=String(value.gainDb);updateTrackEqGraph();form.querySelector(`[data-eq-band-key="${index}"]`)?.focus();});
for(const type of ['input','change'])$('inspector-content').addEventListener(type,event=>{if(event.target.name?.startsWith('eq')||event.target.name?.startsWith('pre')){if(type==='change'&&/^eq[0-3]Frequency$/.test(event.target.name)&&eqGraphModule?.parseEqFrequency){try{event.target.value=String(readEqFrequency(event.target));}catch{}}updateTrackEqGraph();}});
$('inspector-content').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  const data = Object.fromEntries(new FormData(form));
  const revision = Number(form.dataset.revision);
  let eqSettings;if(form.id==='track-form'&&trackEqSupported){try{eqSettings=readTrackEqForm(form);}catch(error){notice(error.message,true);return;}}
  if (form.id === 'track-form') await runCommand('track.update',{trackId:form.dataset.trackId,name:data.name,color:data.color,gainDb:Number(data.gainDb),pan:Number(data.pan),...(soloDefeatSupported?{soloDefeat:form.elements.soloDefeat.checked}:{}),...(trackRenameClipsSupported?{renameClips:data.renameClips??'none'}:{}),...(data.instrument ? {instrument:data.instrument} : {}),...(trackPreSupported?{pre:readTrackPreForm(form)}:{}),...(trackEqSupported?{eq:eqSettings}:{}),...(trackDelaySupported?{delay:{enabled:form.elements.delayEnabled.checked,timeMs:Number(data.delayTimeMs),feedback:Number(data.delayFeedback),wet:Number(data.delayWet),...(trackDelaySyncSupported?{sync:form.elements.delaySync.checked,division:data.delayDivision,rhythm:data.delayRhythm}:{}),...(trackDelayFiltersSupported?{lowCutEnabled:form.elements.delayLowCutEnabled.checked,lowCutHz:Number(data.delayLowCutHz),highCutEnabled:form.elements.delayHighCutEnabled.checked,highCutHz:Number(data.delayHighCutHz)}:{})}}:{})},revision);
  if (form.id === 'clip-form') {
    const clip = project.clips.find((item) => item.id === form.dataset.clipId);
    if (!clip) return;
    if(clip.type==='midi')await inspectorTime.submit(form,data);
    else await runCommand('clip.update',{clipId:clip.id,name:data.name,startSample:Math.round(Number(data.startSeconds)*project.sampleRate),offsetFrames:Number(data.offsetFrames),lengthFrames:Number(data.lengthFrames),gainDb:Number(data.gainDb),...(audioFadeShapesSupported?{fadeInShape:data.fadeInShape,fadeOutShape:data.fadeOutShape}:{}),...(audioFadeSupported?{mute:form.elements.audioMute.checked,invertPolarity:form.elements.invertPolarity.checked,reverse:form.elements.reverse.checked,fadeInFrames:Math.round(Number(data.fadeInSeconds)*(project.assets.find(a=>a.id===clip.assetId)?.sampleRate??project.sampleRate)),fadeOutFrames:Math.round(Number(data.fadeOutSeconds)*(project.assets.find(a=>a.id===clip.assetId)?.sampleRate??project.sampleRate))}:{})},revision);
  }
  if(form.id==='note-form')await inspectorTime.submit(form,data,controllerLanesUI?.getNoteMoveOptions()??{controllers:'none'});
});
$('inspector-content').addEventListener('pointerdown',event=>{
 const graph=event.target.closest('#audio-envelope-graph'),clip=currentClip();
 if(!graph||!audioVolumeEnvelopeSupported||busy||!connected||clip?.type!=='audio'||event.button!==0)return;
 event.preventDefault();event.stopPropagation();
 const clipId=clip.id,revision=project.revision,documentId=documentState?.id,original=JSON.stringify(clip.volumeEnvelope??[]),points=structuredClone(clip.volumeEnvelope??[]),rect=graph.getBoundingClientRect();
 const frameAt=e=>Math.round(clamp((e.clientX-rect.left)/rect.width*300-12,0,276)/276*Math.max(0,clip.lengthFrames-1)+clip.offsetFrames);
 const gainAt=e=>Math.round(clamp((108-(e.clientY-rect.top)/rect.height*122)/24,0,4)*1000)/1000;
 let index=Number(event.target.closest('[data-envelope-index]')?.dataset.envelopeIndex??-1);
 if(event.altKey){if(index<0)return;points.splice(index,1);void runCommand('audio.clip.envelope',{clipId,points},revision);return;}
 if(index<0){const frame=frameAt(event);index=points.findIndex(p=>p.frame>=frame);if(index<0)index=points.length;if(points[index]?.frame!==frame){if(points.length>=4096){notice('최대 4096점까지 추가할 수 있습니다.',true);return;}points.splice(index,0,{frame,gain:gainAt(event)});}}
 const controller=new AbortController(),options={signal:controller.signal};
 const valid=()=>graph.isConnected&&project?.revision===revision&&documentState?.id===documentId&&currentClip()?.id===clipId;
 const preview=e=>{if(!valid())return;const min=Math.max(clip.offsetFrames,(points[index-1]?.frame??-1)+1),max=Math.min(clip.offsetFrames+clip.lengthFrames-1,(points[index+1]?.frame??Number.MAX_SAFE_INTEGER)-1);points[index]={frame:clamp(frameAt(e),min,max),gain:gainAt(e)};graph.innerHTML=envelopeGraphMarkup(clip,points);};
 const cancel=()=>{controller.abort();if(graph.isConnected)graph.innerHTML=envelopeGraphMarkup(clip);};
 window.addEventListener('pointermove',e=>{if(e.pointerId===event.pointerId){if(!valid())cancel();else preview(e);}},options);
 window.addEventListener('pointerup',e=>{if(e.pointerId!==event.pointerId)return;const canCommit=valid();controller.abort();if(canCommit&&JSON.stringify(points)!==original)void runCommand('audio.clip.envelope',{clipId,points},revision).then(result=>{if(!result&&graph.isConnected)graph.innerHTML=envelopeGraphMarkup(clip);});else if(graph.isConnected)graph.innerHTML=envelopeGraphMarkup(clip);},options);
 window.addEventListener('pointercancel',cancel,options);window.addEventListener('blur',cancel,options);window.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();cancel();}},options);
 preview(event);
});
async function seekAudioZeroCrossing(){
 const clip=currentClip();if(!project||clip?.type!=='audio'||busy||!connected||!audioZeroCrossingSupported)return;const doc=documentState?.id,revision=project.revision,atSample=Math.round(transportSeconds*project.sampleRate);
 try{await stopTransport(false,'locate');if(doc!==documentState?.id||revision!==project?.revision)return;const result=await jsonFetch('/api/audio/zero-crossing',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({clipId:clip.id,atSample,expectedRevision:revision})});if(doc!==documentState?.id||revision!==project?.revision)return;if(!result.found){notice('±10ms 안에 모든 채널의 공통 Zero Crossing이 없습니다.');return;}transportSeconds=result.atSample/project.sampleRate;updatePosition();notice(`Zero Crossing · source frame ${result.sourceFrame}`);}catch(error){if(doc===documentState?.id)notice(error.message,true);}
}
async function stretchSelectedAudio(plan=null,context=null){
 if(context&&(context.documentId!==documentState?.id||context.revision!==project?.revision))return;const plans=Array.isArray(plan)?plan:null,firstPlan=plans?.[0]??plan;const clip=firstPlan?project?.clips.find(c=>c.id===firstPlan.clipId):currentClip(),asset=project?.assets.find(a=>a.id===clip?.assetId);if(!clip||clip.type!=='audio'||!asset||!audioTimeStretchSupported||busy||!connected)return;const seconds=firstPlan?firstPlan.targetFrames/asset.sampleRate:Number($('audio-stretch-seconds').value),targetFrames=firstPlan?.targetFrames??Math.round(seconds*asset.sampleRate);if(!Number.isFinite(seconds)||seconds<=0||seconds>600||!Number.isSafeInteger(targetFrames)||targetFrames<1){notice('목표 길이를 0초 초과·600초 이하로 입력하세요.',true);return;}
 const request={controller:new AbortController(),documentId:documentState?.id,clipId:clip.id,revision:project.revision};stretchRequest=request;busy=true;stopPreview(false);$('save-state').textContent='타임스트레치 처리 중…';updateButtons();
 try{const batch=plans&&plans.length>1,result=await jsonFetch(batch?'/api/audio/time-stretch-batch':'/api/audio/time-stretch',{method:'POST',signal:request.controller.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify(batch?{clips:plans.map(({clipId,targetFrames,startSample})=>({clipId,targetFrames,startSample})),expectedRevision:request.revision}:{clipId:clip.id,targetFrames,...(firstPlan?.startSample!==undefined?{startSample:firstPlan.startSample}:{}),expectedRevision:request.revision})});if(request.documentId!==documentState?.id)return;await refreshState({forceInspector:true});const reports=result.results?.map(r=>r.processing)??[result.processing];notice(`타임스트레치 ${reports.length}개 저장 완료 · 끝 보정 합계 ${reports.reduce((n,r)=>n+r.paddedFrames,0)} padding / ${reports.reduce((n,r)=>n+r.trimmedFrames,0)} trim · 이벤트 효과가 처리본에 합쳐졌습니다.`);}
 catch(error){if(request.documentId===documentState?.id){try{await refreshState({forceInspector:true});}catch{}notice(error.name==='AbortError'?'처리 취소를 요청했습니다. 최신 프로젝트 상태를 확인했습니다.':error.message,error.name!=='AbortError');}}
 finally{if(stretchRequest===request)stretchRequest=null;busy=false;$('save-state').textContent=connected?saveStateLabel():'서버 연결 대기';updateButtons();}
}
async function restoreSelectedAudioProcessing(){const clip=currentClip();if(!clip||clip.type!=='audio'||busy||!connected||!audioProcessingRestoreSupported)return;const doc=documentState?.id,revision=project.revision;busy=true;stopPreview(false);updateButtons();try{await jsonFetch('/api/audio/restore-processing',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({clipId:clip.id,expectedRevision:revision})});if(doc===documentState?.id){await refreshState({forceInspector:true});notice('원본 이벤트 설정을 복원했습니다. 현재 위치·이름·뮤트는 유지하며 Undo로 처리본에 돌아갈 수 있습니다.');}}catch(error){if(doc===documentState?.id)notice(error.message,true);}finally{busy=false;$('save-state').textContent=connected?saveStateLabel():'서버 연결 대기';updateButtons();}}
async function showAudioProcessing(){const clip=currentClip();if(!clip||clip.type!=='audio'||busy||!audioTimeStretchSupported)return;const doc=documentState?.id,revision=project.revision;try{const result=await jsonFetch('/api/audio/processing',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({clipId:clip.id,expectedRevision:revision})});if(doc!==documentState?.id||revision!==project?.revision||selectedClip!==clip.id)return;const record=result.processing,host=$('audio-processing-result');if(host)host.textContent=record?`원본: ${record.sourceAsset.name} · ${record.processing.engine} · ${record.processing.inputFrames} → ${record.processing.targetFrames} frames · 베이크: ${record.baked?.join(', ')??'—'}`:'이 WAV에는 newdaw 처리 이력이 없습니다.';}catch(error){if(doc===documentState?.id)notice(error.message,true);}}
$('inspector-content').addEventListener('click', (event) => {
  const action = event.target.closest('[data-action]')?.dataset.action;
  if(action==='range-audio-fades'&&!busy&&audioRangeFadesSupported){
    if(!project.locators){notice('먼저 Locator 범위를 설정하세요.',true);return;}
    const clipIds=project.clips.filter(c=>c.type==='audio'&&selectedClipIds.has(c.id)).map(c=>c.id);
    if(!clipIds.length){notice('오디오 클립을 선택하세요.',true);return;}
    void runCommand('audio.clips.fadesToRange',{clipIds,startSample:Math.round(tickToSeconds(project.locators.startTick)*project.sampleRate),endSample:Math.round(tickToSeconds(project.locators.endTick)*project.sampleRate),mode:$('audio-range-fade-mode').value},project.revision);
  }
  if(audioBulkFadesSupported&&!busy&&(action==='bulk-audio-fades'||action?.startsWith('remove-audio-fades-'))){
    const clipIds=project.clips.filter(c=>c.type==='audio'&&selectedClipIds.has(c.id)).map(c=>c.id);
    if(!clipIds.length){notice('오디오 클립을 선택하세요.',true);return;}
    if(action.startsWith('remove-'))void runCommand('audio.clips.removeFades',{clipIds,side:action.slice('remove-audio-fades-'.length)},project.revision);
    else{const args={clipIds,shape:$('bulk-fade-shape').value};for(const [id,key] of [['bulk-fade-in','fadeInMs'],['bulk-fade-out','fadeOutMs']])if($(id).value.trim()!=='')args[key]=Number($(id).value);if(!Object.hasOwn(args,'fadeInMs')&&!Object.hasOwn(args,'fadeOutMs')){notice('페이드 길이를 입력하세요.',true);return;}void runCommand('audio.clips.fades',args,project.revision);}
  }
  if(action==='apply-audio-envelope'&&!busy&&audioVolumeEnvelopeSupported&&currentClip()?.type==='audio'){
    const text=$('audio-envelope-points').value.trim(),points=text?text.split(/\r?\n/).map(line=>{const parts=line.trim().split(/[\s,]+/);return parts.length===2?{frame:Number(parts[0]),gain:Number(parts[1])}:null;}):[];
    if(points.some(p=>!p||!Number.isSafeInteger(p.frame)||p.frame<0||!Number.isFinite(p.gain)||p.gain<0||p.gain>4)){notice('각 줄에 원본 프레임 정수와 게인 0~4를 입력하세요.',true);return;}
    void runCommand('audio.clip.envelope',{clipId:selectedClip,points},project.revision);
  }
  if(action==='crossfade-audio'&&!busy&&audioCrossfadeSupported&&currentClip()?.type==='audio'){const rightClipId=$('audio-crossfade-right').value;if(!rightClipId){notice('같은 트랙에서 오른쪽으로 겹치는 클립이 필요합니다.',true);return;}void runCommand('audio.clips.crossfade',{leftClipId:selectedClip,rightClipId,...(audioFadeShapesSupported?{shape:$('audio-crossfade-shape').value}:{})},project.revision);}
  if(['tempo-from-audio-project','tempo-from-audio-event'].includes(action)&&!busy&&audioTempoFromEventSupported){const context=$('audio-tempo-from-event');if(!context||context.dataset.tempoDocument!==documentState?.id||Number(context.dataset.tempoRevision)!==project?.revision||context.dataset.tempoClip!==selectedClip){notice('프로젝트가 변경되었습니다. 계산을 다시 확인하세요.',true);return;}void runCommand('audio.clip.tempoFromEvent',{clipId:selectedClip,scope:action==='tempo-from-audio-event'?'event':'project'},project.revision);}
  if(action==='stretch-audio')void stretchSelectedAudio();
  if(action==='cancel-stretch-audio')stretchRequest?.controller.abort();
  if(action==='audio-processing')void showAudioProcessing();
  if(action==='restore-audio-processing')void restoreSelectedAudioProcessing();
  if(action==='seek-audio-zero')void seekAudioZeroCrossing();
  if(action==='snap-audio-cursor'&&!busy&&audioEventSnapPointSupported&&currentClip()?.type==='audio')void runCommand('audio.clip.snapToCursor',{clipId:selectedClip,atSample:Math.round(transportSeconds*project.sampleRate)},project.revision);
  if(action==='slip-audio'&&!busy&&audioSlipSupported&&currentClip()?.type==='audio'){const deltaFrames=Number($('audio-slip-frames').value);if(!Number.isSafeInteger(deltaFrames)){notice('정수 프레임을 입력하세요.',true);return;}void runCommand('audio.clip.slip',{clipId:selectedClip,deltaFrames},project.revision);}
  if(['silence-audio','clear-silence-audio'].includes(action)&&audioSilenceSupported&&!busy){
    const clipIds=project.clips.filter(c=>c.type==='audio'&&selectedClipIds.has(c.id)).map(c=>c.id),locators=$('audio-silence-scope').value==='locators';
    if(!clipIds.length){notice('오디오 클립을 선택하세요.',true);return;}if(locators&&!project.locators){notice('Locator 범위를 먼저 지정하세요.',true);return;}
    void runCommand('audio.clips.silence',{clipIds,clear:action==='clear-silence-audio',...(locators?{range:{startSample:Math.round(tickToSeconds(project.locators.startTick)*project.sampleRate),endSample:Math.round(tickToSeconds(project.locators.endTick)*project.sampleRate)}}:{})},project.revision);
  }
  if(action==='reset-dc'&&audioDcCorrectionSupported&&!busy&&currentClip()?.type==='audio')void runCommand('clip.update',{clipId:selectedClip,dcOffsets:[]},project.revision);
  if(action==='remove-dc'&&audioDcCorrectionSupported&&!busy&&currentClip()?.type==='audio'){
    const clipId=selectedClip,revision=project.revision;busy=true;stopPreview(false);updateButtons();void jsonFetch('/api/audio/remove-dc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({clipId,expectedRevision:revision})}).then(()=>refreshState()).catch(error=>notice(error.message,true)).finally(()=>{busy=false;updateButtons();});
  }
  if(action==='audio-statistics'&&audioStatisticsSupported&&!busy&&currentClip()?.type==='audio'){
    const clipId=selectedClip,revision=project.revision,doc=documentState?.id,mode=$('audio-statistics-mode').value;busy=true;stopPreview(false);updateButtons();$('audio-statistics-result').textContent='분석 중…';
    void jsonFetch('/api/audio/statistics',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({clipId,expectedRevision:revision,mode})}).then(result=>{
      if(doc!==documentState?.id||revision!==project?.revision||selectedClip!==clipId||!$('audio-statistics-result'))return;
      const data=result.statistics,number=(value,digits=2)=>value===null?'−∞':Number(value).toFixed(digits);
      $('audio-statistics-result').innerHTML=`<p class="form-help">${data.frames} frames · ${data.sampleRate} Hz · ${number(data.durationSeconds)}초<br>sample peak 기준. True peak/LUFS 분석은 미지원.</p><div class="audio-statistics-table"><table><thead><tr><th>Ch</th><th>Peak dBFS</th><th>RMS dBFS</th><th>AES17</th><th>DC %</th></tr></thead><tbody>${data.channels.map(c=>`<tr><td>${c.channel}</td><td>${number(c.samplePeakDbFS)}</td><td>${number(c.rmsDbFS)}</td><td>${number(c.rmsAES17DbFS)}</td><td>${number(c.dcOffsetPercent,4)}</td></tr>`).join('')}</tbody></table></div>`;
    }).catch(error=>{notice(error.message,true);if($('audio-statistics-result'))$('audio-statistics-result').textContent='분석 결과 없음';}).finally(()=>{busy=false;updateButtons();});
  }
  if(action==='normalize-audio'&&!busy&&currentClip()?.type==='audio'){const clipId=selectedClip,revision=project.revision,targetDb=Number($('audio-normalize-target').value);busy=true;stopPreview(false);updateButtons();void jsonFetch('/api/audio/normalize',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({clipId,expectedRevision:revision,targetDb})}).then(()=>refreshState()).catch(error=>notice(error.message,true)).finally(()=>{busy=false;updateButtons();});}
  if (action === 'remove-clip' && selectedClip) runCommand('clip.remove',{clipId:selectedClip});
  if (action === 'remove-track' && selectedTrack) requestTrackRemoval(false);
});

let drag = null;
const noteDragKey=()=>`${documentState?.id}:${project?.id}:${project?.revision}:${selectedClip}:${pxPerBeat}:${$('snap').value}:${$('piano-scroll').scrollLeft}:${$('piano-scroll').scrollTop}`;
function cancelNoteDrag(){if(!drag)return;try{$('note-grid').releasePointerCapture(drag.pointerId);}catch{}drag=null;}
$('piano-scroll').addEventListener('scroll',()=>{if(drag){cancelNoteDrag();renderPianoRoll();}},{passive:true});
function refreshNoteSelection() {
  controllerLanesUI?.cancelAudition();
  $('note-grid').querySelectorAll('.midi-note').forEach(element=>element.classList.toggle('selected',selectedNoteIds.has(element.dataset.noteId)));
  renderInspector();updateButtons();
}
function selectNoteForPointer(noteId,event) {
  if(event.shiftKey||event.metaKey||event.ctrlKey){
    if(selectedNoteIds.has(noteId))selectedNoteIds.delete(noteId);else selectedNoteIds.add(noteId);
    selectedNote=selectedNoteIds.has(noteId)?noteId:selectedNoteIds.values().next().value??null;
  }else{
    if(!selectedNoteIds.has(noteId))selectedNoteIds=new Set([noteId]);
    selectedNote=noteId;
  }
  refreshNoteSelection();
  if(selectedNoteIds.has(noteId))controllerLanesUI?.noteSelected?.(noteId);
}
$('piano-keys').addEventListener('click',event=>{const key=event.target.closest('[data-piano-pitch]'),p=currentClip();if(!key||p?.type!=='midi')return;const pitch=Number(key.dataset.pianoPitch);if(event.ctrlKey||event.metaKey){event.preventDefault();selectedNoteIds=new Set(selectNotePitch(p.notes,{pitch}));selectedNote=selectedNoteIds.values().next().value??null;refreshNoteSelection();}controllerLanesUI?.pianoKeySelected?.(pitch);});
$('note-grid').addEventListener('dblclick',event=>{if(!event.shiftKey)return;const element=event.target.closest('[data-note-id]'),p=currentClip(),note=p?.notes?.find(n=>n.id===element?.dataset.noteId);if(!note)return;event.preventDefault();selectedNoteIds=new Set(selectNotePitch(p.notes,{pitch:note.pitch,fromTick:note.startTick}));selectedNote=note.id;refreshNoteSelection();controllerLanesUI?.noteSelected?.(note.id);});
$('note-grid').addEventListener('pointerdown', event=>{
  const clip=currentClip();if(clip?.type!=='midi'||busy||event.button!==0)return;
  const target=event.target.closest('[data-note-id]'),grid=$('note-grid');
  grid.focus({preventScroll:true});
  if(target){
    event.preventDefault();const note=clip.notes.find(item=>item.id===target.dataset.noteId);
    selectNoteForPointer(note.id,event);
    if(event.shiftKey||event.metaKey||event.ctrlKey)return;
    const notes=clip.notes.filter(item=>selectedNoteIds.has(item.id)).map(item=>({...item}));
    const bounds=notes.reduce((b,n)=>({minStart:Math.min(b.minStart,n.startTick),maxEnd:Math.max(b.maxEnd,n.startTick+Math.max(1,n.durationTicks)),minPitch:Math.min(b.minPitch,n.pitch),maxPitch:Math.max(b.maxPitch,n.pitch)}),{minStart:Infinity,maxEnd:0,minPitch:127,maxPitch:0});
    drag={pointerId:event.pointerId,clipId:clip.id,revision:project.revision,startX:event.clientX,startY:event.clientY,view:geometry().piano,key:noteDragKey(),note,notes,bounds,moved:false,deltaTick:0,deltaPitch:0};grid.setPointerCapture(event.pointerId);
  }else{
    const rect=grid.getBoundingClientRect();
    const start=geometry().piano.xToTick(Math.max(0,event.clientX-rect.left));
    const pitch=clamp(pianoRange.high-Math.floor((event.clientY-rect.top)/19),0,127);
    addNoteAt(Math.max(0,start),pitch);
  }
});
$('note-grid').addEventListener('pointermove',event=>{
  if(!drag||event.pointerId!==drag.pointerId)return;
  if(drag.key!==noteDragKey()){cancelNoteDrag();renderPianoRoll();return;}
  const dx=event.clientX-drag.startX,dy=event.clientY-drag.startY;if(Math.abs(dx)+Math.abs(dy)<4&&!drag.moved)return;
  drag.moved=true;const clip=project.clips.find(item=>item.id===drag.clipId);if(!clip)return;
  try{const snap=noteSnap(),target=snap.snap(drag.view.xToTick(Math.max(0,drag.view.tickToX(drag.note.startTick)+dx)),'nearest').localTick,delta=target-drag.note.startTick;
    if(snap.mode==='time'&&(delta < -drag.bounds.minStart||delta>clip.lengthTicks-drag.bounds.maxEnd))throw Error('시간 격자로 이동하면 선택 노트가 클립 밖입니다.');
    drag.deltaTick=clamp(delta,-drag.bounds.minStart,clip.lengthTicks-drag.bounds.maxEnd);
  }catch(error){cancelNoteDrag();renderPianoRoll();notice(`${error.code??'SNAP_ERROR'}: ${error.message}`,true);return;}
  drag.deltaPitch=clamp(-Math.round(dy/19),-drag.bounds.minPitch,127-drag.bounds.maxPitch);
  const original=new Map(drag.notes.map(note=>[note.id,note]));
  $('note-grid').querySelectorAll('.midi-note').forEach(element=>{const n=original.get(element.dataset.noteId);if(!n)return;element.style.left=`${drag.view.tickToX(n.startTick+drag.deltaTick)}px`;element.style.width=`${Math.max(5,drag.view.span(n.startTick+drag.deltaTick,n.startTick+drag.deltaTick+n.durationTicks)-1)}px`;element.style.top=`${(pianoRange.high-n.pitch-drag.deltaPitch)*19+2}px`;element.textContent=pitchName(n.pitch+drag.deltaPitch);});
});
$('note-grid').addEventListener('pointerup',event=>{
  if(!drag||event.pointerId!==drag.pointerId)return;if(drag.key!==noteDragKey()){cancelNoteDrag();renderPianoRoll();return;}const change=drag;drag=null;
  if($('note-grid').hasPointerCapture(event.pointerId))$('note-grid').releasePointerCapture(event.pointerId);
  if(change.moved){const options=controllerLanesUI?.getNoteMoveOptions()??{controllers:'none'};
    const operation=options.controllers==='none'?runCommand('batch',{commands:change.notes.map(note=>({command:'midi.notes.update',arguments:{clipId:change.clipId,noteId:note.id,startTick:note.startTick+change.deltaTick,pitch:note.pitch+change.deltaPitch}}))},change.revision):runCommand('midi.notes.move',{clipId:change.clipId,noteIds:change.notes.map(n=>n.id),deltaTick:change.deltaTick,deltaPitch:change.deltaPitch,...options},change.revision);
    operation.then(()=>{renderPianoRoll();controllerLanesUI?.update();});} 
});
$('note-grid').addEventListener('pointercancel',()=>{drag=null;renderPianoRoll();});
$('note-grid').addEventListener('click',event=>{const target=event.target.closest('[data-note-id]');if(target&&event.detail===0)selectNoteForPointer(target.dataset.noteId,event);});

$('workspace-open-button').addEventListener('click',()=> $('projects-button').click());
$('help-button').addEventListener('click', () => $('help-dialog').showModal());
document.querySelectorAll('[data-close-dialog]').forEach((button) => button.addEventListener('click', () => button.closest('dialog').close()));
function addTempoRow(beat = 1, bpm = 120, first = false) {
  const row = document.createElement('div');
  row.className = 'tempo-row';
  row.innerHTML = `<div><label>시작 · 4분음표 단위 (1부터)</label><input name="beat" aria-label="템포 포인트 시작 박" type="number" min="1" step="any" value="${beat}" required ${first ? 'readonly' : ''}></div><div><label>BPM</label><input name="bpm" aria-label="템포 포인트 BPM" type="number" min="20" max="300" step="0.1" value="${bpm}" required></div><button type="button" aria-label="템포 포인트 삭제" ${first ? 'disabled' : ''}>×</button>`;
  row.querySelector('button').addEventListener('click', () => row.remove());
  $('tempo-rows').append(row);
}
$('tempo-mode-toggle').addEventListener('click',()=>{if(project&&!busy&&connected)void runCommand('tempo.mode',{enabled:project.tempoTrackEnabled===false},project.revision);});
$('tempo-map-button').addEventListener('click', () => {
  if(!project||busy||!connected)return;
  $('tempo-map-form').dataset.documentId=documentState?.id??'';
  $('default-track-time-base').value=project.defaultTrackTimeBase??'mediaDefault';
  $('project-signature-numerator').value=String(project.timeSignature.numerator);$('project-signature-denominator').value=String(project.timeSignature.denominator);
  $('add-tempo').disabled=project.tempoTrackEnabled===false;
  $('tempo-rows').replaceChildren();
  $('tempo-map-form').dataset.revision = project.revision;
  project.tempoMap.forEach((point,index) => addTempoRow(point.tick / project.ppq + 1,point.bpm,index === 0));
  $('tempo-dialog').showModal();
});
$('add-tempo').addEventListener('click', () => {
  const rows = [...$('tempo-rows').querySelectorAll('.tempo-row')];
  const last = rows.at(-1);
  addTempoRow(Number(last.querySelector('[name=beat]').value) + 4,Number(last.querySelector('[name=bpm]').value));
});
$('tempo-map-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const tempoMap = [...$('tempo-rows').querySelectorAll('.tempo-row')].map((row) => ({tick:Math.round((Number(row.querySelector('[name=beat]').value) - 1) * project.ppq),bpm:Number(row.querySelector('[name=bpm]').value)})).sort((a,b) => a.tick - b.tick);
  if(event.target.dataset.documentId!==documentState?.id||Number(event.target.dataset.revision)!==project?.revision){notice('프로젝트가 변경되었습니다. 템포·박자 창을 다시 여세요.',true);return;}
  const signature={numerator:Number($('project-signature-numerator').value),denominator:Number($('project-signature-denominator').value)},commands=[{command:'tempo.set',arguments:{tempoMap}}];
  if(defaultTrackTimeBaseSupported){const mode=$('default-track-time-base').value==='mediaDefault'?null:$('default-track-time-base').value;if(mode!==(project.defaultTrackTimeBase??null))commands.push({command:'project.trackTimeBase',arguments:{mode}});}
  if(!$('project-signature-fields').hidden&&(signature.numerator!==project.timeSignature.numerator||signature.denominator!==project.timeSignature.denominator))commands.push({command:'signature.set',arguments:signature});
  if (await runCommand(commands.length===1?'tempo.set':'batch',commands.length===1?{tempoMap}:{commands},Number(event.target.dataset.revision))) $('tempo-dialog').close();
});
document.addEventListener('keydown', (event) => {
  if(controllerLanesUI?.handleKeyDown(event))return;
  if (event.target.closest('input,textarea,select,[contenteditable=true]') || document.querySelector('dialog[open]')) return;
  if(event.target.closest('#timeline-scroll')&&!event.target.closest('[data-audio-gain]')){
    const clips=project?.clips.filter(c=>selectedClipIds.has(c.id))??[];
    if((event.metaKey||event.ctrlKey)&&!event.altKey){const key=event.key.toLowerCase();if(['c','x','v'].includes(key)&&clipSnapshotPasteSupported){event.preventDefault();if(key==='v')void pasteClipboardClips(event.shiftKey);else void copySelectedClips(key==='x');return;}}
    if(event.key.toLowerCase()==='m'&&!event.metaKey&&!event.ctrlKey&&!event.altKey){event.preventDefault();void toggleSelectedClipsMute();return;}
    if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='a'){event.preventDefault();selectedClipIds=new Set(project.clips.map(c=>c.id));if(!selectedClip)selectedClip=project.clips[0]?.id??null;renderUI(true);return;}
    if(event.key.toLowerCase()==='s'&&!event.metaKey&&!event.ctrlKey&&!event.altKey){event.preventDefault();void splitClipsAtCursor(event.shiftKey);return;}
    if(['ArrowLeft','ArrowRight'].includes(event.key)&&!event.metaKey&&!event.ctrlKey&&!event.altKey){event.preventDefault();if(!busy&&connected&&clips.length){if(!clipNudgeSupported){notice('키보드 클립 이동을 지원하는 서버로 갱신하세요.',true);return;}void runCommand('clips.nudge',{clipIds:clips.map(c=>c.id),direction:event.key==='ArrowRight'?1:-1,steps:event.shiftKey?10:1},project.revision).then(()=>{if(project)$('timeline-scroll').focus();});}return;}
    if(['Delete','Backspace'].includes(event.key)){event.preventDefault();if(!busy&&connected&&clips.length)void runCommand('batch',{commands:clips.map(c=>({command:'clip.remove',arguments:{clipId:c.id}}))},project.revision).then(result=>{if(result){selectedClipIds.clear();selectedClip=null;selectedNote=null;selectedNoteIds.clear();renderUI(true);$('timeline-scroll').focus();}});return;}
    if(event.key==='Escape'){event.preventDefault();selectedClipIds.clear();selectedClip=null;selectedNote=null;selectedNoteIds.clear();renderUI(true);return;}
  }
  if(event.target.closest('[data-piano-pitch]')&&(event.code==='Space'||event.key==='Enter'))return;
  if((event.metaKey||event.ctrlKey)&&event.target.closest('.editor')){
    const key=event.key.toLowerCase();
    if(key==='c'&&selectedNoteIds.size){event.preventDefault();controllerLanesUI?.copyNotes();controllerLanesUI?.copySelectedNotes?.();return;}
    if(key==='x'&&selectedNoteIds.size){event.preventDefault();controllerLanesUI?.cutNotes();return;}
    if(key==='v'){event.preventDefault();controllerLanesUI?.pasteNotes(event.shiftKey);return;}
  }
  if(['ArrowLeft','ArrowRight'].includes(event.key)&&event.target.closest('.editor')&&!event.metaKey&&!event.ctrlKey&&!event.altKey){
    const p=currentClip();if(p?.type==='midi'){event.preventDefault();const selection=navigateNoteSelection(p.notes,{activeId:selectedNote,selectedIds:[...selectedNoteIds],direction:event.key==='ArrowRight'?1:-1,extend:event.shiftKey});selectedNote=selection.activeId;selectedNoteIds=new Set(selection.selectedIds);refreshNoteSelection();controllerLanesUI?.noteSelected?.(selectedNote);document.querySelector(`.midi-note[data-note-id="${CSS.escape(selectedNote??'')}"]`)?.scrollIntoView({block:'nearest',inline:'nearest'});return;}
  }
  if (event.code === 'Space') { event.preventDefault(); if (nativeMidiUI?.active || audioSource || previewPreparing || activeJob?.purpose === 'preview') void stopTransport(false); else if (!$('play').disabled) play(); }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey ? history.canRedo : history.canUndo) runCommand(event.shiftKey ? 'history.redo' : 'history.undo'); }
  if ((event.key === 'Delete' || event.key === 'Backspace') && selectedNote && event.target.closest('.editor')) { event.preventDefault(); removeSelectedNote(); }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase()==='a' && event.target.closest('.editor')) { event.preventDefault(); selectedNoteIds=new Set(currentClip()?.notes?.map(note=>note.id)??[]); selectedNote=selectedNoteIds.values().next().value??null;refreshNoteSelection(); }
  if (event.key === 'Escape') {selectedNoteIds.clear();selectedNote=null;refreshNoteSelection();}
  if (event.key === '?') $('help-dialog').showModal();
});
window.addEventListener('beforeunload', () => { if (audioSource) { try { audioSource.stop(); } catch {} } });

async function initialize() {
  updateButtons();
  try { await refreshState(); } catch (error) { notice(`프로젝트 연결 실패: ${error.message}`, true); setConnection(false); }
  const events = new EventSource('/api/events');
  const receive = (event) => {
    try { applySnapshot(JSON.parse(event.data)); setConnection(true); }
    catch (error) { notice(`프로젝트 동기화 응답 오류: ${error.message}`, true); }
  };
  events.addEventListener('snapshot',receive);
  events.addEventListener('native-transport',event=>nativeMidiUI?.event(JSON.parse(event.data)));
  events.addEventListener('native-audio',event=>nativeAudioUI?.event(JSON.parse(event.data)));
  events.addEventListener('audio-units',event=>audioUnitsUI?.event(JSON.parse(event.data)));
  events.addEventListener('native-settings',()=>nativeMidiUI?.settingsChanged());
  events.addEventListener('timing-settings',()=>{nativeMidiUI?.settingsChanged();window.dispatchEvent(new Event('newdaw-timing-settings'));});
  events.addEventListener('reset-settings',()=>{nativeMidiUI?.settingsChanged();window.dispatchEvent(new Event('newdaw-reset-settings'));});
  events.addEventListener('chase-settings',()=>window.dispatchEvent(new Event('newdaw-chase-settings')));
  events.addEventListener('controller-settings',()=>window.dispatchEvent(new Event('newdaw-controller-settings')));
  events.onmessage = receive;
  events.onopen = () => { void controllerLanesUI?.refreshTime();void inspectorTime.refresh();void musicalDisplay.refresh();setConnection(true); refreshState().catch(() => setConnection(false)); };
  events.onerror = () => setConnection(false);
}
inspectorTime=setupInspectorTime({host:$('inspector-content'),getContext:()=>({project,track:currentTrack(),clip:currentClip(),note:currentNote(),documentId:documentState?.id,busy,connected}),readProfile:readTimingProfile,runCommand,render:renderInspector,notify:notice});
snapGridUI=setupSnapGridSettings({getContext:()=>({project,busy,connected,documentId:documentState?.id}),runCommand,notify:notice});
timeDisplayUI=setupTimeDisplaySettings({getContext:()=>({project,busy,connected,documentId:documentState?.id}),runCommand,notify:notice});
musicalDisplay=setupMusicalTimeDisplay({getContext:()=>({project,clip:currentClip(),note:currentNote(),cursorTick:project?secondsToTick(transportSeconds):0,pxPerBeat,geometry:project?geometry():null}),readProfile:readTimingProfile,notify:notice});
timingUI=setupTimingSettings({request:jsonFetch,getContext:()=>({project,selectedClip,selectedNote,documentId:documentState?.id}),onChange:()=>stopPreview(false),onApplied:result=>applySnapshot(result),notify:notice});
setupResetSettings({onChange:()=>{stopPreview(false);},notify:notice,manualReset:()=>nativeMidiUI.manualReset()});
nativeMidiUI=setupNativeMidi({request:jsonFetch,getContext:()=>({project,documentId:documentState?.id,busy,connected}),stopPreview:()=>stopPreview(false),notify:notice,onTransport:(state,{positionChanged})=>{
 if(['preparing','playing','stopping','resetting'].includes(state.status))controllerLanesUI?.cancelAudition();
 if(positionChanged&&!transportSeeking&&state.documentId===documentState?.id&&state.projectId===project?.id&&state.revision===project?.revision){
  if(Number.isFinite(state.positionNs))transportSeconds=tickToSeconds(state.startTick??0)+state.positionNs/1e9;
  $('playback-status').textContent=`Native MIDI · ${state.status}${state.error?' · '+state.error:''}`;updatePosition();if(state.status==='playing')followPlaybackPosition();
 }
 if(!audioSource&&!previewPreparing&&state.documentId===documentState?.id&&['idle','stopped','failed'].includes(state.status))resetFollowSuspension();
 if(state.documentId===documentState?.id&&state.projectId===project?.id&&state.preserveCursor)$('playback-status').textContent=`Native MIDI · ${state.status}${state.error?' · '+state.error:''}`;
 updateButtons();
}});
setupChaseSettings({onChange:()=>stopPreview(false),notify:notice});
midiMergeUI=setupMidiMerge({getContext:()=>({project,selectedTrack,selectedClip,busy,connected,documentId:documentState?.id}),runCommand,selectClip,notify:notice});
midiModifiersUI=setupMidiModifiers({getContext:()=>({project,selectedTrack,selectedTrackIds,selectedClip,busy,connected,documentId:documentState?.id}),runCommand,notify:notice});
controllerLanesUI = setupControllerLanes({getContext:()=>({project,selectedClip,selectedNote,selectedNoteIds,pxPerBeat,pianoGeometry:project?geometry().piano:null,projectCursorTick:project?secondsToTick(transportSeconds):0,snapTicks:project?Math.max(1,Math.round(Number($('snap').value)*project.ppq)):240,transportActive:Boolean(audioSource||previewPreparing||activeJob||nativeMidiUI?.active),busy,connected,documentId:documentState?.id}),runCommand,notify:notice,setSelectedNoteIds:ids=>{selectedNoteIds=new Set(ids);selectedNote=ids.at(-1)??null;refreshNoteSelection();},onLayout:height=>document.documentElement.style.setProperty('--controller-extra-height',`${height}px`)});
midiEventsUI = setupMidiEventsUI({getContext:()=>({project,selectedClip,busy,connected,documentId:documentState?.id}),runCommand,notify:notice});
editingUI = setupEditingUI({request:jsonFetch,getContext:()=>({project,documentId:documentState?.id,selectedTrack,selectedTrackIds,selectedClip,selectedClipIds,selectedNote,selectedNoteIds,busy,connected,recordingActive:!!recordingUI?.active||!!browserMidiRecordingUI?.active,legatoOptionsSupported,midiStepCursorNavigationSupported,midiStepCursorClickSupported,midiNoteInputEditSupported,transportSeconds,cursorTick:project?Math.max(0,Math.round(secondsToTick(transportSeconds))):0}),runCommand,notify:notice,selectTracks:ids=>{selectTrack(ids[0]);selectedTrackIds=new Set(ids);syncTrackClipSelection();renderUI(true);},selectTrack,selectClip,revealClip,revealClips,download,restoreAsset,selectNotes:ids=>{selectedNoteIds=new Set(ids);selectedNote=ids.at(-1)??null;refreshNoteSelection();},onStepMidiChange:updateButtons,onStepCursorChange:cursor=>{stepInputCursor=cursor;renderStepInputCursor();}});
async function loadSessionUI(){
 sessionUILoading=true;
 try {const {setupSessionUI}=await import('./session.mjs');sessionUI=setupSessionUI({getContext:()=>({project,busy,connected}),runCommand,request:sessionRequest,notify:notice});updateButtons();}
 catch(error){notice(`이력·백업 화면을 불러오지 못했습니다: ${error.message}`,true);}
 finally{sessionUILoading=false;}
}
setupI18n({onChange:()=>renderUI(true)});
initialize();

async function loadResolutionUI(){
 resolutionUILoading=true;
 try {const {setupResolutionUI}=await import('./resolution.mjs');resolutionUI=setupResolutionUI({getContext:()=>({project,busy,connected}),request:sessionRequest,notify:notice});updateButtons();}
 catch(error){notice(`미디어 해결 화면을 불러오지 못했습니다: ${error.message}`,true);}
 finally{resolutionUILoading=false;}
}

async function loadDocumentUI(){
 documentUILoading=true;
 try{const {setupDocumentUI}=await import('./document.mjs');documentUI=setupDocumentUI({getContext:()=>({project,busy,connected,document:documentState}),request:sessionRequest,notify:notice});updateButtons();}
 catch(error){notice(`저장 화면을 불러오지 못했습니다: ${error.message}`,true);}
 finally{documentUILoading=false;}
}

async function loadProjectsUI(){
 projectsUILoading=true;
 try{const {setupProjectsUI}=await import('./projects.mjs');projectsUI=setupProjectsUI({getContext:()=>({project,busy,connected,document:documentState,workspace:workspaceState}),request:sessionRequest,notify:notice,onOpened:()=>resolutionUI?.checkOpen()});updateButtons();}
 catch(error){notice('프로젝트 열기 화면을 불러오지 못했습니다: '+error.message,true);}
 finally{projectsUILoading=false;}
}

recordingUI=setupRecording({getContext:()=>({project,documentId:documentState?.id,busy:busy||!!browserMidiRecordingUI?.active||!!editingUI?.stepMidiArmed,connected,cursorSeconds:transportSeconds,cursorTick:project?secondsToTick(transportSeconds):0}),request:jsonFetch,onImported:refreshState,notify:notice,stopPlayback:()=>stopTransport(false),prepareBacking:async()=>{if(!await nativeMidiUI.previewAllowed())throw new Error('오버더빙은 내장 오디오 프리뷰 모드를 사용하세요.');const rendered=await renderSnapshot('preview',{ignoreCycle:true});const response=await fetch(rendered.url);if(!response.ok)throw new Error('반주 오디오를 읽을 수 없습니다.');return {bytes:await response.arrayBuffer(),startSeconds:rendered.stats?.startSeconds??0};}});

nativeAudioUI=setupNativeAudio({request:jsonFetch,getContext:()=>({project,busy,connected}),notify:notice});
audioUnitsUI=setupAudioUnits({request:jsonFetch,getContext:()=>({project,busy,connected,cursorSeconds:transportSeconds,selectedTrackIds:[...selectedTrackIds],selectedClipIds:[...selectedClipIds]}),renderCurrentMix:(options)=>renderSnapshot('export',options),onImported:refreshState,notify:notice});
metronomeUI=setupMetronome({getContext:()=>({project,playing:!!audioSource,positionSeconds:transportSeconds,secondsToTick,tickToSeconds})});

void jsonFetch('/api/health').then(async result=>{if(!result.capabilities?.browserMidiInput)return;const {setupBrowserMidiInput,setupBrowserMidiRecording}=await import('./web-midi-input.mjs');browserMidiInputUI=setupBrowserMidiInput({onFilterChange:result.capabilities.projectMidiInputFilter?((filter,revision,doc)=>doc===documentState?.id?runCommand('project.midiInputFilter',{filter},revision):Promise.resolve(null)):null,filterSupported:result.capabilities.midiInputFilter===true,notify:notice,getContext:()=>({project,documentId:documentState?.id,busy,connected,cursorSeconds:transportSeconds})});editingUI?.setMidiInput(browserMidiInputUI);if(result.capabilities.midiTakeCommit)browserMidiRecordingUI=setupBrowserMidiRecording(browserMidiInputUI,{autoQuantizeSupported:result.capabilities.midiTakeAutoQuantize===true,getContext:()=>({project,documentId:documentState?.id,busy:busy||!!recordingUI?.active||!!editingUI?.stepMidiArmed,connected,selectedClip,cursorTick:project?secondsToTick(transportSeconds):0}),commitTake:(args,revision)=>runCommand('midi.record.take',args,revision),stopPlayback:()=>stopTransport(false),prepareBacking:async()=>{if(!await nativeMidiUI.previewAllowed())throw new Error('MIDI 반주는 내장 프리뷰 모드에서 사용하세요.');const rendered=await renderSnapshot('preview',{ignoreCycle:true});const response=await fetch(rendered.url);if(!response.ok)throw new Error('MIDI 반주 오디오를 읽을 수 없습니다.');return {bytes:await response.arrayBuffer(),startSeconds:rendered.stats?.startSeconds??0};},notify:notice,onCommitted:result=>{const id=result.changes?.recording?.clipId;if(id)selectClip(id);}});}).catch(error=>notice(`MIDI 입력 UI: ${error.message}`,true));

function requestTrackRemoval(emptyOnly){
 if(!project||busy||!connected)return;
 const tracks=emptyOnly?project.tracks.filter(t=>!project.clips.some(c=>c.trackId===t.id)):project.tracks.filter(t=>selectedTrackIds.has(t.id));
 if(!tracks.length){notice('삭제할 빈 트랙이 없습니다. 빈 MIDI 파트도 클립으로 포함됩니다.');return;}
 const ids=new Set(tracks.map(t=>t.id)),clips=project.clips.filter(c=>ids.has(c.trackId));
 removeTracksDraft={documentId:documentState?.id,revision:project.revision,emptyOnly,trackId:tracks[0].id,trackIds:tracks.map(t=>t.id)};
 $('remove-tracks-summary').textContent=emptyOnly?`클립이 없는 트랙 ${tracks.length}개를 삭제합니다.`:`선택 트랙 ${tracks.length}개 (${tracks.map(t=>t.name).join(', ')})와 클립 ${clips.length}개를 삭제합니다.${clips.length?' 트랙의 편집 내용이 프로젝트에서 제거됩니다.':''}`;
 $('remove-tracks-dialog').showModal();
}
$('remove-empty-tracks').addEventListener('click',()=>requestTrackRemoval(true));
$('remove-tracks-form').addEventListener('submit',async event=>{
 event.preventDefault();const draft=removeTracksDraft;
 if(!draft||busy)return;
 if(draft.documentId!==documentState?.id||draft.revision!==project?.revision){notice('프로젝트가 변경되었습니다. 삭제 대상을 다시 확인하세요.',true);$('remove-tracks-dialog').close();return;}
 const result=await runCommand(draft.emptyOnly?'tracks.removeEmpty':'batch',draft.emptyOnly?{}:{commands:draft.trackIds.map(trackId=>({command:'track.remove',arguments:{trackId}}))},draft.revision);
 if(result&&draft.documentId===documentState?.id){$('remove-tracks-dialog').close();removeTracksDraft=null;}
});

$('new-track-color-mode').addEventListener('change',()=>{$('new-track-color-field').hidden=$('new-track-color-mode').value!=='custom';});
$('inspector-content').addEventListener('click',event=>{
 const swatch=event.target.closest('[data-track-color]');if(!swatch)return;
 const input=swatch.closest('form')?.elements.color;if(input){input.value=swatch.dataset.trackColor;input.focus();}
});

$('track-heads').addEventListener('keydown',event=>{
 const handle=event.target.closest('[data-track-reorder]');
 if(!handle||!['ArrowUp','ArrowDown'].includes(event.key))return;
 event.preventDefault();event.stopPropagation();if(!project||busy||!connected)return;
 const trackId=handle.closest('[data-track-id]').dataset.trackId,doc=documentState?.id;
 const commands=planTrackStep(project.tracks,selectedTrackIds.has(trackId)?selectedTrackIds:[trackId],event.key==='ArrowUp'?-1:1);
 if(!commands.length)return;
 void runCommand('batch',{commands},project.revision).then(result=>{
  if(result&&documentState?.id===doc){const head=[...$('track-heads').children].find(h=>h.dataset.trackId===trackId);head?.querySelector('[data-track-reorder]')?.focus();}
 });
});
$('track-heads').addEventListener('pointerdown',event=>{
 const handle=event.target.closest('[data-track-reorder]');
 if(!handle||event.button!==0||!project||busy||!connected)return;
 event.preventDefault();event.stopPropagation();
 const heads=[...$('track-heads').children].filter(h=>h.dataset.trackId&&h.style.display!=='none'),head=handle.closest('[data-track-id]'),trackId=head.dataset.trackId,revision=project.revision,doc=documentState?.id,pointerId=event.pointerId,startY=event.clientY;
 const movingIds=selectedTrackIds.has(trackId)?new Set(selectedTrackIds):new Set([trackId]),movingHeads=heads.filter(h=>movingIds.has(h.dataset.trackId));
 if(heads.length>4096){notice('드래그 순서 변경은 최대 4096개 트랙을 지원합니다.',true);return;}
 const scroll=head.closest('.arrangement-grid');
 let moved=false,commands=[],valid=false,lastEvent=event,animation=null,previousFrame=performance.now();
 const marker=document.createElement('div');marker.className='track-reorder-marker';marker.hidden=true;document.body.append(marker);
 const current=()=>project&&documentState?.id===doc&&project.revision===revision&&!busy&&connected&&heads.every(h=>h.isConnected);
 const clear=()=>{if(animation!==null)cancelAnimationFrame(animation);animation=null;marker.remove();for(const row of movingHeads)row.classList.remove('reordering');document.removeEventListener('pointermove',move,true);document.removeEventListener('pointerup',up,true);document.removeEventListener('pointercancel',cancel,true);document.removeEventListener('keydown',key,true);window.removeEventListener('blur',cancel);};
 const move=e=>{
  if(e.pointerId!==pointerId)return;lastEvent=e;
  if(!current()){clear();return;}
  moved=moved||Math.abs(e.clientY-startY)>4;if(!moved)return;
  e.preventDefault();for(const row of movingHeads)row.classList.add('reordering');
  const rects=heads.map(h=>h.getBoundingClientRect()),first=rects[0],last=rects.at(-1);
  const viewport=scroll.getBoundingClientRect();
  valid=e.clientX>=first.left&&e.clientX<=first.right&&e.clientY>=Math.max(first.top-16,viewport.top+18)&&e.clientY<=Math.min(last.bottom+16,viewport.bottom+16);
  if(!valid){marker.hidden=true;return;}
  let insertion=rects.findIndex(r=>e.clientY<r.top+r.height/2);if(insertion<0)insertion=heads.length;
  const target=heads[insertion]?.dataset.trackId;const sourceInsertion=target?project.tracks.findIndex(t=>t.id===target):project.tracks.length;commands=planTrackDrop(project.tracks,movingIds,sourceInsertion);
  const y=insertion===heads.length?last.bottom:rects[insertion].top;
  marker.hidden=!commands.length||y<viewport.top+34||y>viewport.bottom;marker.style.left=`${first.left}px`;marker.style.top=`${y-1}px`;marker.style.width=`${first.width}px`;
 };
 const up=e=>{if(e.pointerId!==pointerId)return;move(e);const apply=moved&&valid&&current()&&commands.length,planned=commands;clear();if(apply)void runCommand('batch',{commands:planned},revision);};
 const cancel=()=>clear();const key=e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();clear();}};
 const pump=now=>{
  if(!current()){clear();return;}
  const elapsed=Math.min(40,now-previousFrame);previousFrame=now;
  if(moved&&valid){const rect=scroll.getBoundingClientRect(),top=rect.top+34,margin=38,y=lastEvent.clientY;
   const direction=y<top+margin?-Math.min(1,(top+margin-y)/margin):y>rect.bottom-margin?Math.min(1,(y-rect.bottom+margin)/margin):0;
   if(direction){const before=scroll.scrollTop;scroll.scrollTop+=direction*.7*elapsed;if(scroll.scrollTop!==before)move(lastEvent);}
  }
  animation=requestAnimationFrame(pump);
 };
 animation=requestAnimationFrame(pump);
 document.addEventListener('pointermove',move,{capture:true,passive:false});document.addEventListener('pointerup',up,true);document.addEventListener('pointercancel',cancel,true);document.addEventListener('keydown',key,true);window.addEventListener('blur',cancel);
});

$('clear-all-mute').addEventListener('click',()=>{if(globalMuteSoloSupported)void runCommand('tracks.clearMuteSolo',{mode:'mute'},project.revision);});
$('clear-all-solo').addEventListener('click',()=>{if(globalMuteSoloSupported)void runCommand('tracks.clearMuteSolo',{mode:'solo'},project.revision);});

$('mix-export-target').addEventListener('change',()=>{
 const target=$('mix-export-target').value;
 if(target==='cycleMix'){$('mix-export-range').value='cycles';$('mix-export-cycle-field').hidden=false;}
 else if(target!=='stems'&&$('mix-export-range').value==='cycles'){$('mix-export-range').value='all';$('mix-export-cycle-field').hidden=true;}
 $('mix-export-track-field').hidden=!['stems','selection'].includes(target);updateMixExportSummary();
});
$('mix-export-range').addEventListener('change',()=>{
 const cycles=$('mix-export-range').value==='cycles';$('mix-export-cycle-field').hidden=!cycles;
 if(cycles&&$('mix-export-target').value!=='cycleMix'){$('mix-export-target').value='stems';$('mix-export-track-field').hidden=false;}
 if(!cycles&&$('mix-export-target').value==='cycleMix'){$('mix-export-target').value='mix';$('mix-export-track-field').hidden=true;}
 updateMixExportSummary();
});

function refreshExportPresets(selected=''){
 $('export-preset-select').innerHTML='<option value="">없음 · 수동 설정</option>'+(project?.exportPresets??[]).map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');$('export-preset-select').value=selected;
 $('export-preset-update').disabled=!selected;$('export-preset-remove').disabled=!selected;
}
$('export-preset-select').addEventListener('change',()=>{
 const preset=project?.exportPresets?.find(p=>p.id===$('export-preset-select').value);refreshExportPresets(preset?.id??'');if(!preset)return;
 const o=preset.options;$('export-preset-name').value=preset.name;
 if(o.outputSampleRate!==null&&![...$('mix-export-sample-rate').options].some(v=>v.value===String(o.outputSampleRate)))$('mix-export-sample-rate').add(new Option(`${o.outputSampleRate} Hz`,String(o.outputSampleRate)));
 $('mix-export-sample-rate').value=o.outputSampleRate===null?'project':String(o.outputSampleRate);$('mix-export-file-format').value=o.fileFormat??'wav';$('mix-export-format').value=o.sampleFormat;$('mix-export-channels').value=o.channelMode;$('mix-export-tail').value=String(o.tailSeconds);$('mix-export-auto-tail').checked=o.autoEffectTail!==false;$('mix-export-split').checked=o.stemSplitChannels;$('mix-export-dither').value=o.dither??'none';mixExportDitherSeed=o.ditherSeed??0x6d2b79f5;updateMixExportSummary();
});
async function writeExportPreset(action){
 const draft=mixExportDraft;if(!project||busy||!connected||!draft||draft.documentId!==documentState?.id||draft.revision!==project.revision){notice('프로젝트가 변경되었습니다. 내보내기 창을 다시 여세요.',true);return;}
 const selected=$('export-preset-select').value,name=$('export-preset-name').value.trim();
 if(action!=='remove'&&!name){notice('프리셋 이름을 입력하세요.',true);return;}
 if(action!=='create'&&!selected)return;
 const options={outputSampleRate:$('mix-export-sample-rate').value==='project'?null:Number($('mix-export-sample-rate').value),sampleFormat:$('mix-export-format').value,fileFormat:$('mix-export-file-format').value,...(!$('mix-export-dither-field').hidden?{dither:$('mix-export-dither').value,ditherSeed:mixExportDitherSeed}:{}),channelMode:$('mix-export-channels').value,tailSeconds:Number($('mix-export-tail').value),...(automaticEffectTailSupported?{autoEffectTail:$('mix-export-auto-tail').checked}:{}),stemSplitChannels:$('mix-export-split').checked};
 if(options.stemSplitChannels&&options.channelMode!=='stereo'&&action!=='remove'){notice('L/R 분리 프리셋은 Stereo 채널을 선택하세요.',true);return;}
 const result=await runCommand(action==='remove'?'project.exportPreset.remove':'project.exportPreset.put',action==='remove'?{presetId:selected}:{...(action==='update'?{presetId:selected}:{}),name,options},draft.revision);
 if(result&&documentState?.id===draft.documentId){mixExportDraft={...draft,revision:project.revision};refreshExportPresets(action==='remove'?'':result.changes.exportPreset.id);updateMixExportSummary();}
}
$('export-preset-save').addEventListener('click',()=>void writeExportPreset('create'));
$('export-preset-update').addEventListener('click',()=>void writeExportPreset('update'));
$('export-preset-remove').addEventListener('click',()=>void writeExportPreset('remove'));

let fileDropDraft=null,fileDropIndicator=null;
const hasDroppedFiles=event=>[...(event.dataTransfer?.types??[])].includes('Files');
function clearFileDrop(){fileDropIndicator?.remove();fileDropIndicator=null;}
function planFileDrop(event){
 if(!project||busy||!connected||!wavImportTargetSupported||recordingUI?.active||browserMidiRecordingUI?.active||editingUI?.stepMidiArmed)return null;
 if(!fileDropDraft)fileDropDraft={documentId:documentState?.id,revision:project.revision,...readMidiImportChoices()};
 if(fileDropDraft.documentId!==documentState?.id||fileDropDraft.revision!==project.revision)return null;
 const surface=$('timeline-surface'),view=geometry().timeline,x=Math.max(0,event.clientX-surface.getBoundingClientRect().left),rawTick=Math.max(0,view.xToTick(x));
 const tick=event.altKey?rawTick:compileEditorSnap(project,{scope:'primary'}).snap(rawTick).tick;
 const atSample=Math.max(0,Math.round(tickToSeconds(tick)*project.sampleRate)),lane=event.target.closest?.('.timeline-lane'),track=project.tracks.find(t=>t.id===lane?.dataset.trackId&&t.type==='audio');
 if(!Number.isSafeInteger(atSample))throw new Error('가져오기 위치가 지원 범위를 넘습니다.');
 return {...fileDropDraft,atSample,trackId:track?.id??'',trackName:track?.name??'새 오디오 트랙',placement:event.shiftKey?'serial':'parallel',previewX:surface.getBoundingClientRect().left+view.tickToX(tick)};
}
$('timeline-scroll').addEventListener('dragover',event=>{
 if(!hasDroppedFiles(event))return;event.preventDefault();let draft;try{draft=planFileDrop(event);}catch{draft=null;}
 if(!draft){event.dataTransfer.dropEffect='none';clearFileDrop();return;}
 event.dataTransfer.dropEffect='copy';if(!fileDropIndicator){fileDropIndicator=document.createElement('div');fileDropIndicator.className='file-drop-indicator';fileDropIndicator.append(document.createElement('span'));document.body.append(fileDropIndicator);}
 const rect=$('timeline-scroll').getBoundingClientRect();fileDropIndicator.style.left=`${Math.max(rect.left,Math.min(rect.right-2,draft.previewX))}px`;fileDropIndicator.style.top=`${rect.top}px`;fileDropIndicator.style.height=`${rect.height}px`;
 fileDropIndicator.firstChild.textContent=`${draft.trackName} · ${(draft.atSample/project.sampleRate).toFixed(3)}초 · ${draft.placement==='serial'?'순서대로':'같은 위치'} / Shift: 이어붙이기 · Alt: 스냅 해제 · MIDI: ${draft.midiSinglePart?'한 파트':draft.midiAutoDissolve?'채널 분해':'새 트랙'} · ${draft.midiPosition==='leftLocator'?'왼쪽 Locator':'프로젝트 시작'}`;
});
$('timeline-scroll').addEventListener('dragleave',event=>{if(!event.relatedTarget||!$('timeline-scroll').contains(event.relatedTarget)){clearFileDrop();fileDropDraft=null;}});
$('timeline-scroll').addEventListener('drop',event=>{
 if(!hasDroppedFiles(event))return;event.preventDefault();event.stopPropagation();const files=[...(event.dataTransfer?.files??[])];let draft;
 try{draft=planFileDrop(event);}catch(error){notice(error.message,true);}finally{clearFileDrop();fileDropDraft=null;}
 if(!draft){notice('현재는 파일을 가져올 수 없습니다. 진행 중인 작업과 프로젝트 상태를 확인하세요.',true);return;}
 void importFiles(files,draft);
});
window.addEventListener('dragend',()=>{clearFileDrop();fileDropDraft=null;});
window.addEventListener('blur',()=>{clearFileDrop();fileDropDraft=null;});
for(const type of ['dragover','drop'])document.addEventListener(type,event=>{if(hasDroppedFiles(event)&&!event.target.closest?.('#timeline-scroll'))event.preventDefault();});

try{trackSelectClips=localStorage.getItem('newdaw.trackSelection.selectClips')==='true';}catch{}
$('track-select-clips').checked=trackSelectClips;
$('track-select-clips').addEventListener('change',()=>{trackSelectClips=$('track-select-clips').checked;try{localStorage.setItem('newdaw.trackSelection.selectClips',String(trackSelectClips));}catch{}if(project){syncTrackClipSelection();renderUI(true);}});
$('track-heads').addEventListener('keydown',event=>{
 if(!event.target.closest('.track-name')||!project)return;
 const key=event.key,all=(event.metaKey||event.ctrlKey)&&key.toLowerCase()==='a';if(!all&&!['ArrowUp','ArrowDown','Home','End'].includes(key))return;
 event.preventDefault();event.stopPropagation();
 if(all){selectedTrackIds=new Set(project.tracks.map(t=>t.id));syncTrackClipSelection();renderUI(true);}
 else{const visible=arrangementFolderRows().filter(r=>r.track&&!r.hidden).map(r=>r.track);if(!visible.length)return;const index=visible.findIndex(t=>t.id===selectedTrack),next=key==='Home'?0:key==='End'?visible.length-1:Math.max(0,Math.min(visible.length-1,index+(key==='ArrowUp'?-1:1)));selectTrack(visible[next].id,{range:event.shiftKey});}
 [...$('track-heads').children].find(h=>h.dataset.trackId===selectedTrack)?.querySelector('.track-name')?.focus();
});

try{const saved=JSON.parse(localStorage.getItem('newdaw.trackRows')??'null');if([88,106,144,212].includes(saved?.height))trackRowHeight=saved.height;expandSelectedTracks=saved?.expandSelected===true;}catch{}
$('track-row-height').value=String(trackRowHeight);$('track-row-expand').checked=expandSelectedTracks;
for(const id of ['track-row-height','track-row-expand'])$(id).addEventListener('change',()=>{
 trackRowHeight=Number($('track-row-height').value);expandSelectedTracks=$('track-row-expand').checked;
 try{localStorage.setItem('newdaw.trackRows',JSON.stringify({height:trackRowHeight,expandSelected:expandSelectedTracks}));}catch{}
 if(project)renderUI(true);
});

function resizeTrackRows(id,base){
 for(const parent of [$('track-heads'),$('timeline-lanes')])for(const row of parent.children)if(row.dataset.trackId===id){
  row.style.setProperty('--lane',`${base*(expandSelectedTracks&&selectedTrackIds.has(id)?2:1)}px`);
  row.querySelector('[data-track-resize]')?.setAttribute('aria-valuenow',String(base));
 }
}
$('track-heads').addEventListener('dblclick',event=>{const handle=event.target.closest('[data-track-resize]');if(!handle)return;event.preventDefault();const id=handle.closest('[data-track-id]').dataset.trackId;trackRowOverrides.delete(id);resizeTrackRows(id,trackRowHeight);});
$('track-heads').addEventListener('keydown',event=>{
 const handle=event.target.closest('[data-track-resize]');if(!handle||!['ArrowUp','ArrowDown','Home'].includes(event.key))return;
 event.preventDefault();event.stopPropagation();const id=handle.closest('[data-track-id]').dataset.trackId;
 if(event.key==='Home')trackRowOverrides.delete(id);else trackRowOverrides.set(id,clamp(trackBaseHeight(id)+(event.key==='ArrowUp'?-1:1)*(event.altKey?1:8),88,212));resizeTrackRows(id,trackBaseHeight(id));
});
$('track-heads').addEventListener('pointerdown',event=>{
 const handle=event.target.closest('[data-track-resize]');if(!handle||!project||event.button!==0)return;
 event.preventDefault();event.stopPropagation();const id=handle.closest('[data-track-id]').dataset.trackId,base=trackBaseHeight(id),start=event.clientY,revision=project.revision,doc=documentState?.id,factor=expandSelectedTracks&&selectedTrackIds.has(id)?2:1,controller=new AbortController(),options={signal:controller.signal};let target=base;
 const valid=()=>handle.isConnected&&project?.revision===revision&&documentState?.id===doc;
 const finish=commit=>{controller.abort();if(commit&&valid())trackRowOverrides.set(id,target);resizeTrackRows(id,trackBaseHeight(id));};
 const move=e=>{if(e.pointerId!==event.pointerId)return;if(!valid()){finish(false);return;}const raw=base+(e.clientY-start)/factor;target=clamp(event.altKey||e.altKey?Math.round(raw):base+Math.round((raw-base)/8)*8,88,212);resizeTrackRows(id,target);};
 window.addEventListener('pointermove',move,options);window.addEventListener('pointerup',e=>{if(e.pointerId!==event.pointerId)return;move(e);finish(true);},options);window.addEventListener('pointercancel',()=>finish(false),options);window.addEventListener('blur',()=>finish(false),options);window.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();finish(false);}},options);
});

$('project-pan-law').addEventListener('change',()=>void runCommand('project.settings',{panLaw:$('project-pan-law').value},project.revision));

$('pan-law-status').addEventListener('click',()=>{if(!project||$('project-pan-law-field').hidden)return;$('project-pan-law-field').scrollIntoView({block:'center',behavior:'smooth'});$('project-pan-law').focus();});

$('project-markers-list').addEventListener('click',event=>{
 const button=event.target.closest('[data-marker-sort]');if(!button||!project)return;const key=button.dataset.markerSort;
 $('marker-sort-direction').value=$('marker-sort-by').value===key&&$('marker-sort-direction').value==='ascending'?'descending':'ascending';$('marker-sort-by').value=key;markerView.sortBy=key;markerView.direction=$('marker-sort-direction').value;saveMarkerView();renderMarkerList();$('project-markers-list').querySelector(`[data-marker-sort="${key}"]`)?.focus({preventScroll:true});
});
$('project-markers-list').addEventListener('keydown',event=>{
 const handle=event.target.closest('[data-marker-resize]');if(!handle||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();event.stopPropagation();const key=handle.dataset.markerResize,step=event.shiftKey?1:8;
 markerView.widths[key]=event.key==='Home'?60:event.key==='End'?600:clamp(markerView.widths[key]+(event.key==='ArrowRight'?step:-step),60,600);saveMarkerView();renderMarkerList();$('project-markers-list').querySelector(`[data-marker-resize="${key}"]`)?.focus({preventScroll:true});
});
$('project-markers-list').addEventListener('pointerdown',event=>{
 const handle=event.target.closest('[data-marker-resize]');if(!handle||event.button!==0)return;event.preventDefault();event.stopImmediatePropagation();
 const key=handle.dataset.markerResize,original=markerView.widths[key],table=handle.closest('table'),column=table.querySelectorAll('col')[markerView.columns.indexOf(key)],baseWidth=Number.parseFloat(table.style.width),controller=new AbortController(),options={signal:controller.signal},doc=documentState?.id;let width=original,finished=false;
 const valid=()=>handle.isConnected&&$('project-markers-dialog').open&&documentState?.id===doc;
 const preview=e=>{width=clamp(Math.round(original+e.clientX-event.clientX),60,600);column.style.width=`${width}px`;table.style.width=`${baseWidth+width-original}px`;handle.setAttribute('aria-valuenow',String(width));if($('marker-column-key').value===key)$('marker-column-width').value=width;};
 const finish=commit=>{if(finished)return;finished=true;controller.abort();if(commit){markerView.widths[key]=width;saveMarkerView();}if(project)renderMarkerList();};
 window.addEventListener('pointermove',e=>{if(e.pointerId!==event.pointerId)return;if(!valid())finish(false);else preview(e);},options);
 window.addEventListener('pointerup',e=>{if(e.pointerId!==event.pointerId)return;if(valid()){preview(e);finish(true);}else finish(false);},options);
 window.addEventListener('pointercancel',()=>finish(false),options);window.addEventListener('blur',()=>finish(false),options);window.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();finish(false);}},{...options,capture:true});
});

// Folder management uses the same revision-guarded commands as the CLI.
function mountTrackFolders({button,getState,runCommand,escapeHtml,notice}) {
 const dialog=document.createElement('dialog');dialog.id='track-folders-dialog';
 dialog.innerHTML='<div class="dialog-heading"><h2>트랙 폴더</h2><button type="button" data-folder-close aria-label="트랙 폴더 닫기">×</button></div><form data-folder-create><label>새 폴더 이름<input name="name" maxlength="120" required value="Folder"></label><label>상위 폴더<select name="parent"></select></label><label><input name="include" type="checkbox" checked>현재 선택 트랙을 새 폴더에 묶기</label><button type="submit">폴더 만들기</button></form><p>접기는 폴더 목록과 편곡 화면의 하위 행을 숨깁니다. 재생과 내보내기는 유지됩니다.</p><div class="fields-two"><label>폴더 데이터 표시<select data-folder-data-visibility><option value="always">항상</option><option value="never">숨김</option><option value="collapsed">펼쳤을 때 숨김</option></select></label><label>폴더 데이터 형태<select data-folder-data-style><option value="events">이벤트 상세</option><option value="blocks">범위 블록</option></select></label></div><div class="folder-fold-tools"><label>접기 대상<select data-folder-fold-scope><option value="all">모든 폴더</option><option value="selected">체크한 폴더</option></select></label><label><input type="checkbox" data-folder-fold-deep>Deep · 하위 폴더 전체 적용</label><button type="button" data-folder-fold="fold">접기</button><button type="button" data-folder-fold="unfold">펼치기</button><button type="button" data-folder-fold="flip">각 상태 반전</button></div><div data-folder-tree></div><label>선택 트랙 이동 대상<select data-folder-target></select></label><button type="button" data-folder-assign>선택 트랙 이동</button>';
 document.body.append(dialog);let context=null;const selectedFolders=new Set();
 dialog.querySelector('[data-folder-data-visibility]').value=folderDataView.visibility;dialog.querySelector('[data-folder-data-style]').value=folderDataView.style;dialog.addEventListener('change',event=>{if(!event.target.matches('[data-folder-data-visibility],[data-folder-data-style]'))return;folderDataView={visibility:dialog.querySelector('[data-folder-data-visibility]').value,style:dialog.querySelector('[data-folder-data-style]').value};try{localStorage.setItem('newdaw.folderDataView',JSON.stringify(folderDataView));}catch{}renderTimeline();});
 const esc=escapeHtml;
 function options(folders,excluded=new Set()){return '<option value="">최상위</option>'+folders.filter(f=>!excluded.has(f.id)).map(f=>`<option value="${esc(f.id)}">${esc(f.name)} · ${esc(f.id)}</option>`).join('');}
 function render(){const s=getState();if(!s.project)return;if(context&&context.documentId!==s.documentId)selectedFolders.clear();for(const id of selectedFolders)if(!s.project.trackFolders?.some(f=>f.id===id))selectedFolders.delete(id);context={documentId:s.documentId,revision:s.project.revision};const folders=s.project.trackFolders??[],tracks=s.project.tracks;
  const select=dialog.querySelector('[name=parent]'),target=dialog.querySelector('[data-folder-target]');for(const el of [select,target]){const value=el.value;el.innerHTML=options(folders);if([...el.options].some(o=>o.value===value))el.value=value;}
  const children=parent=>folders.filter(f=>(f.parentFolderId??null)===parent);
  function row(f,depth){const excluded=new Set([f.id]);let changed=true;while(changed){changed=false;for(const item of folders)if(excluded.has(item.parentFolderId)&&!excluded.has(item.id)){excluded.add(item.id);changed=true;}}
   const direct=tracks.filter(t=>t.parentFolderId===f.id);return `<section data-folder-id="${esc(f.id)}" style="margin-left:${depth*16}px;border-left:3px solid ${/^#[0-9a-f]{6}$/i.test(f.color)?f.color:'#97adba'};padding:8px"><label><input type="checkbox" data-folder-selected="${esc(f.id)}" ${selectedFolders.has(f.id)?'checked':''}>폴더 선택</label><button type="button" data-folder-toggle aria-expanded="${!f.collapsed}">${f.collapsed?'▸':'▾'} ${esc(f.name)} · ${direct.length} tracks</button><button type="button" data-folder-mute title="하위 폴더 포함 전체 트랙 뮤트">M</button><button type="button" data-folder-solo title="하위 폴더 포함 전체 트랙 솔로 · Shift: 이 폴더만 솔로">S</button><form data-folder-edit><label>이름<input name="name" value="${esc(f.name)}" maxlength="120" required></label><label>색<input name="color" type="color" value="${esc(f.color)}"></label><button type="submit">저장</button></form><label>상위 폴더<select data-folder-parent>${options(folders,excluded)}</select></label><button type="button" data-folder-move>폴더 이동</button><button type="button" data-folder-dissolve>폴더만 해제</button><button type="button" data-folder-up>위로</button><button type="button" data-folder-down>아래로</button><form data-folder-contents-move><label>내용 전체 이동 위치<input name="position" type="number" min="0" step="1" value="0" required></label><label>이동 시간 기준<select name="unit"><option value="atTick">박 · source tick</option><option value="atSample">시간 · 프로젝트 sample</option></select></label><button type="submit">하위 클립 전체 이동</button><p>중첩 폴더 포함 · 가장 이른 클립 시작을 입력 위치로 이동합니다.</p></form>${f.collapsed?'':`<ul>${direct.map(t=>`<li>${esc(t.name)} · ${esc(t.type)}</li>`).join('')}</ul>${children(f.id).map(c=>row(c,depth+1)).join('')}`}</section>`;}
  dialog.querySelector('[data-folder-tree]').innerHTML=children(null).map(f=>row(f,0)).join('')||'<p>폴더가 없습니다.</p>';
  for(const el of dialog.querySelectorAll('[data-folder-id]')){const f=folders.find(f=>f.id===el.dataset.folderId);el.querySelector('[data-folder-parent]').value=f.parentFolderId??'';const ids=new Set([f.id]);let grew=true;while(grew){grew=false;for(const child of folders)if(ids.has(child.parentFolderId)&&!ids.has(child.id)){ids.add(child.id);grew=true;}}const descendants=tracks.filter(t=>ids.has(t.parentFolderId));for(const key of ['mute','solo']){const b=el.querySelector(`[data-folder-${key}]`),count=descendants.filter(t=>t[key]).length;b.disabled=!descendants.length;b.setAttribute('aria-pressed',count===0?'false':count===descendants.length?'true':'mixed');b.textContent=`${key==='mute'?'M':'S'} ${count}/${descendants.length}`;}}
  dialog.querySelector('[data-folder-assign]').disabled=!s.selectedTrackIds.length;
 }
 async function command(name,args){const s=getState();if(!context||s.documentId!==context.documentId){dialog.close();notice('문서가 바뀌었습니다. 폴더 창을 다시 여세요.',true);return;}if(s.busy)return;const result=await runCommand(name,args,context.revision);if(dialog.open)render();return result;}
 button.addEventListener('click',()=>{render();dialog.showModal();});
 dialog.querySelector('[data-folder-close]').addEventListener('click',()=>dialog.close());
 dialog.addEventListener('submit',event=>{event.preventDefault();const form=event.target;if(form.matches('[data-folder-create]')){const data=new FormData(form);void command('folder.add',{name:data.get('name'),...(data.get('parent')?{parentFolderId:data.get('parent')}:{}),trackIds:data.has('include')?getState().selectedTrackIds:[]});}else if(form.matches('[data-folder-contents-move]')){const data=new FormData(form);void command('folder.contents.move',{folderId:form.closest('[data-folder-id]').dataset.folderId,[data.get('unit')]:Number(data.get('position'))});}else if(form.matches('[data-folder-edit]')){const data=new FormData(form);void command('folder.update',{folderId:form.closest('[data-folder-id]').dataset.folderId,name:data.get('name'),color:data.get('color')});}});
 dialog.addEventListener('click',event=>{const b=event.target.closest('button');if(!b)return;if(b.hasAttribute('data-folder-fold')){const ids=dialog.querySelector('[data-folder-fold-scope]').value==='selected'?[...selectedFolders].filter(id=>getState().project.trackFolders?.some(f=>f.id===id)):(getState().project.trackFolders??[]).map(f=>f.id);if(ids.length)void command('folder.fold',{folderIds:ids,mode:b.dataset.folderFold,deep:dialog.querySelector('[data-folder-fold-deep]').checked});else notice('접기 대상을 선택하세요.',true);return;}if(b.hasAttribute('data-folder-assign')){void command('tracks.moveToFolder',{trackIds:getState().selectedTrackIds,parentFolderId:dialog.querySelector('[data-folder-target]').value||null});return;}const row=b.closest('[data-folder-id]');if(!row)return;const folderId=row.dataset.folderId,f=getState().project.trackFolders.find(f=>f.id===folderId);if(b.hasAttribute('data-folder-up')||b.hasAttribute('data-folder-down')){const siblings=[...(getState().project.trackFolders??[]),...getState().project.tracks].filter(n=>(n.parentFolderId??null)===(f.parentFolderId??null)).sort((a,b)=>(a.arrangementOrder??Number.MAX_SAFE_INTEGER)-(b.arrangementOrder??Number.MAX_SAFE_INTEGER)),index=siblings.findIndex(n=>n.id===folderId),up=b.hasAttribute('data-folder-up');if(up&&index>0)void command('arrangement.reorder',{itemId:folderId,beforeId:siblings[index-1].id});else if(!up&&index<siblings.length-1)void command('arrangement.reorder',{itemId:folderId,beforeId:siblings[index+2]?.id??null});return;}if(b.hasAttribute('data-folder-mute')||b.hasAttribute('data-folder-solo')){const folders=getState().project.trackFolders??[],ids=new Set([folderId]);let grew=true;while(grew){grew=false;for(const child of folders)if(ids.has(child.parentFolderId)&&!ids.has(child.id)){ids.add(child.id);grew=true;}}const tracks=getState().project.tracks.filter(t=>ids.has(t.parentFolderId)),key=b.hasAttribute('data-folder-mute')?'mute':'solo';void command('folder.tracksState',{folderId,[key]:event.shiftKey&&key==='solo'?true:!tracks.every(t=>t[key]),...(event.shiftKey&&key==='solo'?{exclusiveSolo:true}:{})});return;}if(b.hasAttribute('data-folder-toggle'))void command('folder.fold',{folderIds:[folderId],mode:f.collapsed?'unfold':'fold',deep:dialog.querySelector('[data-folder-fold-deep]').checked||event.shiftKey});if(b.hasAttribute('data-folder-move'))void command('folder.move',{folderId,parentFolderId:row.querySelector('[data-folder-parent]').value||null});if(b.hasAttribute('data-folder-dissolve'))void command('folder.remove',{folderId});});
 dialog.addEventListener('change',event=>{if(event.target.matches('[data-folder-selected]')){const id=event.target.dataset.folderSelected;if(event.target.checked)selectedFolders.add(id);else selectedFolders.delete(id);}});
 return {update(){const s=getState();button.hidden=!s.supported;button.disabled=!s.project||s.busy||!s.connected;if(dialog.open){if(context?.documentId!==s.documentId||!s.supported)dialog.close();else if(context?.revision!==s.project?.revision)render();}}};
}

trackFoldersUI=mountTrackFolders({button:$('track-folders-open'),getState:()=>({project,documentId:documentState?.id,selectedTrackIds:[...selectedTrackIds],busy,connected,supported:trackFoldersSupported}),runCommand,escapeHtml:esc,notice});
trackFoldersUI.update();

$('track-heads').addEventListener('click',async event=>{const b=event.target.closest('[data-arrangement-folder-toggle]');if(!b||!project||busy)return;const id=b.dataset.arrangementFolderToggle,f=project.trackFolders?.find(f=>f.id===id);if(!f)return;const doc=documentState?.id;const result=await runCommand('folder.fold',{folderIds:[id],mode:f.collapsed?'unfold':'fold',deep:event.shiftKey},project.revision);if(result&&doc===documentState?.id)[...$('track-heads').querySelectorAll('[data-arrangement-folder-toggle]')].find(b=>b.dataset.arrangementFolderToggle===id)?.focus();});

// Only local drags from this document/revision may change folder membership.
let folderDrag=null;
function clearFolderDrag(){folderDrag=null;for(const n of document.querySelectorAll('.folder-drop-target,.folder-drop-before,.folder-drop-after'))n.classList.remove('folder-drop-target','folder-drop-before','folder-drop-after');}
function validFolderDrop(parent){if(!folderDrag||busy||!connected||documentState?.id!==folderDrag.documentId||project?.revision!==folderDrag.revision)return false;if(folderDrag.kind==='folder'){const folders=project.trackFolders??[];let cursor=parent;const seen=new Set();while(cursor){if(cursor===folderDrag.id||seen.has(cursor))return false;seen.add(cursor);cursor=folders.find(f=>f.id===cursor)?.parentFolderId;}}return true;}
let suppressFolderClick=false;
$('track-heads').addEventListener('click',event=>{if(suppressFolderClick){event.preventDefault();event.stopImmediatePropagation();}},true);
$('track-heads').addEventListener('pointerdown',event=>{
 const folder=event.target.closest('[data-arrangement-folder-toggle]'),track=event.target.closest('.track-name');if(event.button!==0||!trackFoldersSupported||!project||busy||(!folder&&!track))return;
 const id=folder?.dataset.arrangementFolderToggle??track.closest('[data-track-id]').dataset.trackId,startX=event.clientX,startY=event.clientY,pointerId=event.pointerId;
 folderDrag={kind:folder?'folder':'tracks',id,trackIds:folder?[]:selectedTrackIds.has(id)?arrangementFolderRows().filter(r=>r.track&&selectedTrackIds.has(r.track.id)).map(r=>r.track.id):[id],documentId:documentState?.id,revision:project.revision};
 const controller=new AbortController(),options={signal:controller.signal};let moved=false,target=null,ghost=null,animation=null,lastPointer=event;
 const finish=()=>{controller.abort();if(animation!==null)cancelAnimationFrame(animation);ghost?.remove();clearFolderDrag();if(moved){suppressFolderClick=true;setTimeout(()=>{suppressFolderClick=false;},0);}};
 const resolve=e=>{const hit=document.elementFromPoint(e.clientX,e.clientY);if(hit?.closest('#track-count'))return{node:$('track-count'),parent:null};const row=hit?.closest('#track-heads > [data-arrangement-folder],#track-heads > [data-track-id]');if(!row)return null;const itemId=row.dataset.arrangementFolder??row.dataset.trackId,item=[...(project.trackFolders??[]),...project.tracks].find(n=>n.id===itemId);if(!item)return null;const rect=row.getBoundingClientRect(),fraction=(e.clientY-rect.top)/rect.height;if(row.dataset.arrangementFolder&&fraction>.22&&fraction<.78)return{node:row,parent:itemId};const edge=fraction<.5?'before':'after',parent=item.parentFolderId??null,movingIds=new Set(folderDrag.kind==='folder'?[folderDrag.id]:folderDrag.trackIds);if(movingIds.has(itemId))return null;const siblings=[...(project.trackFolders??[]),...project.tracks].filter(n=>(n.parentFolderId??null)===parent&&!movingIds.has(n.id)).sort((a,b)=>(a.arrangementOrder??Number.MAX_SAFE_INTEGER)-(b.arrangementOrder??Number.MAX_SAFE_INTEGER)),index=siblings.findIndex(n=>n.id===itemId),beforeId=edge==='before'?itemId:siblings[index+1]?.id??null;return{node:row,parent,beforeId,edge};};
 const move=e=>{if(e.pointerId!==pointerId)return;lastPointer=e;if(!folderDrag||busy||project?.revision!==folderDrag.revision||documentState?.id!==folderDrag.documentId){finish();return;}moved=moved||Math.hypot(e.clientX-startX,e.clientY-startY)>5;if(!moved)return;e.preventDefault();if(!ghost){ghost=document.createElement('div');ghost.className='folder-drag-ghost';ghost.textContent=folder?'폴더 이동':'트랙 이동';document.body.append(ghost);}ghost.style.left=`${e.clientX+12}px`;ghost.style.top=`${e.clientY+12}px`;for(const n of document.querySelectorAll('.folder-drop-target,.folder-drop-before,.folder-drop-after'))n.classList.remove('folder-drop-target','folder-drop-before','folder-drop-after');target=resolve(e);if(target&&!validFolderDrop(target.parent))target=null;target?.node.classList.add(target.edge?`folder-drop-${target.edge}`:'folder-drop-target');};
 const scroll=$('track-heads').closest('.arrangement-grid');
 const pump=()=>{if(!folderDrag||controller.signal.aborted)return;if(moved&&scroll){const r=scroll.getBoundingClientRect(),margin=32,y=lastPointer.clientY,x=lastPointer.clientX;if(x>=r.left&&x<=r.right&&y>=r.top&&y<=r.bottom){const delta=y<r.top+margin?-Math.min(14,(r.top+margin-y)/2):y>r.bottom-margin?Math.min(14,(y-r.bottom+margin)/2):0;if(delta){scroll.scrollTop+=delta;move(lastPointer);}}}if(!controller.signal.aborted)animation=requestAnimationFrame(pump);};animation=requestAnimationFrame(pump);
 window.addEventListener('pointermove',move,options);
 window.addEventListener('pointerup',e=>{if(e.pointerId!==pointerId)return;move(e);const drag=folderDrag,drop=moved&&target&&validFolderDrop(target.parent)?target:null;finish();if(!drag||!drop)return;const commands=[{command:drag.kind==='folder'?'folder.move':'tracks.moveToFolder',arguments:drag.kind==='folder'?{folderId:drag.id,parentFolderId:drop.parent}:{trackIds:drag.trackIds,parentFolderId:drop.parent}}];if(Object.hasOwn(drop,'beforeId'))for(const itemId of drag.kind==='folder'?[drag.id]:drag.trackIds)commands.push({command:'arrangement.reorder',arguments:{itemId,beforeId:drop.beforeId}});void runCommand(commands.length===1?commands[0].command:'batch',commands.length===1?commands[0].arguments:{commands},drag.revision);},options);
 window.addEventListener('pointercancel',finish,options);window.addEventListener('blur',finish,options);window.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();finish();}},options);
});
$('track-count').title='트랙/폴더를 여기에 놓으면 최상위로 이동';
$('track-count').setAttribute('aria-label','트랙 수 · 폴더 밖 최상위 이동 드롭 영역');
window.addEventListener('dragend',clearFolderDrag);window.addEventListener('blur',clearFolderDrag);

$('track-heads').addEventListener('click',event=>{const select=event.target.closest('[data-folder-arrangement-select]'),state=event.target.closest('[data-folder-arrangement-state]');if(!project||busy||(!select&&!state))return;const id=select?.dataset.folderArrangementSelect??state.dataset.folderId,tracks=folderDescendantTracks(id);if(!tracks.length)return;if(select){selectedTrackIds=new Set(event.metaKey||event.ctrlKey?[...selectedTrackIds,...tracks.map(t=>t.id)]:tracks.map(t=>t.id));selectedTrack=tracks[0].id;trackSelectionAnchor=selectedTrack;syncTrackClipSelection();renderUI(true);}else{const key=state.dataset.folderArrangementState;void runCommand('folder.tracksState',{folderId:id,[key]:key==='solo'&&event.shiftKey?true:!tracks.every(t=>t[key]),...(key==='solo'&&event.shiftKey?{exclusiveSolo:true}:{})},project.revision);}});

$('inspector-content').addEventListener('change',event=>{const input=event.target.closest('[data-audio-overlap-mode]');if(!input||!audioOverlapFrontSupported||input.dataset.document!==documentState?.id||Number(input.dataset.revision)!==project?.revision)return;void runCommand('track.audioOverlap',{trackId:input.dataset.track,mode:input.value},Number(input.dataset.revision));});
$('inspector-content').addEventListener('click',event=>{const b=event.target.closest('[data-audio-to-front]');if(!b||!audioOverlapFrontSupported||b.dataset.document!==documentState?.id||Number(b.dataset.revision)!==project?.revision)return;void runCommand('audio.clip.toFront',{clipId:b.dataset.audioToFront},Number(b.dataset.revision));});

$('inspector-content').addEventListener('change',async event=>{const input=event.target.closest('[data-audio-stack-select]');if(!input||!input.value||!audioOverlapFrontSupported||input.dataset.document!==documentState?.id||Number(input.dataset.revision)!==project?.revision)return;const id=input.value,result=await runCommand('audio.clip.selectTake',{clipId:id},Number(input.dataset.revision));if(result&&input.dataset.document===documentState?.id)selectClip(id);});

$('inspector-content').addEventListener('change',event=>{const input=event.target.closest('[data-audio-lanes-view]');if(!input||!project)return;if(input.checked)audioLaneTrackIds().add(input.dataset.track);else audioLaneTrackIds().delete(input.dataset.track);renderTracks();renderTimeline();});
$('timeline-lanes').addEventListener('pointerdown',event=>{if(event.target.closest('[data-audio-lane-choose]'))event.stopImmediatePropagation();},true);
async function chooseAudioLaneEvent(event){const b=event.target.closest('[data-audio-lane-choose]');if(!b||!audioOverlapFrontSupported||busy)return;if(event.type==='keydown'&&!['Enter',' '].includes(event.key))return;event.preventDefault();event.stopImmediatePropagation();const id=b.dataset.audioLaneChoose,doc=documentState?.id,result=await runCommand('audio.clip.selectTake',{clipId:id},project.revision);if(result&&doc===documentState?.id)selectClip(id);}
$('timeline-lanes').addEventListener('click',chooseAudioLaneEvent,true);$('timeline-lanes').addEventListener('keydown',chooseAudioLaneEvent,true);
