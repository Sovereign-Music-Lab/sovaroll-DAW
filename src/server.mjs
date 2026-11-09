import {prepareTimeStretchBatch} from './time-stretch-batch.mjs';
import {readAudioProcessingProvenance} from './media/audio-processing-provenance.mjs';
import {findAudioZeroCrossing} from './media/zero-crossing.mjs';
import {mergeImportedMidiTracks} from './media/midi-import-single-part.mjs';
import {splitImportedMidiChannels} from './media/midi-import-channels.mjs';
import {extractMidiInspector} from './media/midi-import-inspector.mjs';
import {decodeAiff} from './media/aiff.mjs';
import {resolveExportPresetOptions} from './media/export-presets.mjs';
import {selectRenderTracks,selectRenderClips,bypassRenderEffects} from './media/render-tracks.mjs';
import {MAX_WAV_FILE_BYTES,MAX_MIDI_FILE_BYTES} from './media/asset-limits.mjs';
import {MAX_RENDER_SECONDS} from './media/render-limits.mjs';
import {audioClipPeak} from './media/audio-clip-peak.mjs';
import {getSplitSettings,updateSplitSettings,withSplitDefaults} from './split-settings.mjs';
import {compileEditorSnap} from './media/snap-grid.mjs';
import {resolveFormattedTimeCommand} from './media/formatted-time-command.mjs';
import {compileRulerIntervals} from './media/ruler-intervals.mjs';
import {compileProjectTimeDisplay} from './media/time-display.mjs';
import {resolveDisplayTimeCommand} from './media/display-time-edit.mjs';
import {compileMusicalTime} from './media/musical-time.mjs';
import {getTimingSettings,updateTimingSettings} from './timing-settings.mjs';
import {convertMidiTicks,midiTickFraction} from './media/midi-display-time.mjs';
import {getResetSettings,updateResetSettings} from './reset-settings.mjs';
import {createNativeTransport} from './native-transport.mjs';
import {createNativeAudio} from './native-audio.mjs';
import {createAudioUnits} from './audio-units.mjs';
import {getNativeMidiSettings,updateNativeMidiSettings,defaultNativeMidiProject} from './native-midi-settings.mjs';
import {getChaseSettings,updateChaseSettings,withChaseDefaults} from './chase-settings.mjs';
import {resolveChaseOptions} from './media/midi-chase.mjs';
import {getControllerSettings,updateControllerSettings,withControllerDefaults} from './controller-settings.mjs';
import http from 'node:http';
import {AsyncLocalStorage} from 'node:async_hooks';
import {createMediaResolver} from './media-resolution.mjs';
import {createDocumentSession} from './document-session.mjs';
import {createWorkspace} from './workspace.mjs';
import {browseProjectFolders} from './folder-browser.mjs';
import {captureMediaOwnership} from './revert-media.mjs';
import {saveExplicitCheckpoint,contentProjectHash,previewProjectVersion,prepareProjectVersion} from './project-save.mjs';
import {inspectDraft,beginDraftPublication,finalizeDraftPublication,abortDraftPublication} from './project-drafts.mjs';
import {registerCreatedMedia} from './revert-media.mjs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { Engine, createProject, getCommandCatalog } from './core/engine.mjs';
import { decodeWav,encodeWav } from './media/wav.mjs';
import {createNoteAuditionJobs} from './note-audition-jobs.mjs';
import { parseMidi, writeMidiDetailed } from './media/midi.mjs';
import { atomicWrite, saveProject, acquireProjectLock } from './storage.mjs';
import { createDemoProject } from './demo.mjs';
import {loadSessionState,commitSessionState,updateSessionSettings,canonicalProjectHash} from './session-store.mjs';
import {listBackups,createAutoBackup,readBackup,backupBaseName} from './auto-backup.mjs';
import { assetInventory, readVerifiedAsset,readVerifiedSourceArchive,restoreSourceArchive, createProjectBundle, restoreAsset, MAX_BUNDLE_BYTES } from './project-files.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CAPABILITIES = Object.freeze({
  version:'0.128.0',audioOverlapFront:true,markerListView:true,trackFolders:true,midiPartStartResize:true,midiStepCursorNavigation:true,midiStepCursorClick:true,tapTempo:true,tempoTrackMode:true,tempoCursorChange:true,audioTempoFromEvent:true,audioTrackTimeBase:true,midiTrackTimeBase:true,midiLinearAffineCurves:true,defaultTrackTimeBase:true,midiNoteInputEdit:true,audioTimeStretchProcessing:true,audioTimeStretchBatch:true,audioProcessingRestore:true,audioZeroCrossingQuery:true,audioZeroCrossingTrim:true,explicitSplitClipIds:true,audioResizeMovesContents:true,audioSnapPointPaste:true,audioEventSnapPoint:true,clipFillLoop:true,audioClipGlue:true,audioClipGlueFollowing:true,midiClipGlue:true,midiClipGlueFollowing:true,clipSelectionPreview:true,previewEffectBypass:true,audioScrubPreview:true,noteAuditionTrackEffects:true,midiImportSinglePart:true,midiImportLeftLocator:true,midiImportAutoDissolve:true,midiImportInspectorOptions:true,fixedProjectSignature:true,midiImportTimingOptions:true,midiExportOptions:true,midiExportLocators:true,midiExportPpq:true,midiTrackExportSelection:true,projectPanLawModes:['legacy','equalPower','0dB','-3dB','-4.5dB','-6dB'],projectPanLaw:true,midiVelocityLimits:true,midiTransposeScale:true,midiTransposeRange:true,midiDissolveParts:true,midiRepeatLoop:true,midiThinControllers:true,midiRestrictPolyphony:true,midiDeleteControllers:true,sourceArchiveAccess:true,sourceArchivePreservation:true,aifcImport:true,aiffImport:true,audioExportFileFormats:['wav','aiff'],wavDitherModes:['none','tpdf'],projectExportPresets:true,stemSplitExport:true,wavOutputSampleRates:[22050,32000,44100,48000,88200,96000],stemCycleExport:true,stemExport:true,maxStemTracks:128,maxStemZipBytes:134217728,renderTrackSelection:true,midiNoteReverse:true,midiPedalsToLength:true,midiDeleteOverlaps:true,midiStepSettings:true,midiStepGrid:true,midiStepInput:true,midiLegatoOptions:true,midiNoteLength:true,midiNoteSplit:true,midiNoteGlue:true,soloDefeat:true,globalMuteSolo:true,removeEmptyTracks:true,trackRenameClips:true,browserMicrophoneRecording:true,browserMidiInput:true,browserMidiRecording:true,midiTakeCommit:true,midiTakeAutoQuantize:true,midiInputFilter:true,projectMidiInputFilter:true,midiTakeModes:['new','merge','replace'],maxBrowserRecordingSeconds:600,recordingTargetTracks:true,audioClipFades:true,locatorCycle:true,audioNormalize:true,audioStatistics:true,audioDcCorrection:true,audioSilence:true,audioSlip:true,audioCrossfade:true,audioFadeShapes:true,audioVolumeEnvelope:true,audioBulkFades:true,audioTrim:true,projectMarkers:true,clipCopyTo:true,clipNudge:true,splitClipsAtCursor:true,splitClipsRange:true,cutClipsAtCursor:true,midiProjectMarkers:true,audioRangeFades:true,savedSnapGrids:true,pianoElapsedSnap:true,controllerElapsedSnap:true,controllerPaintCommand:true,controllerPaintGui:true,controllerShapeCommand:true,controllerShapeGui:true,noteShapeCommand:true,noteShapeGui:true,notePaintCommand:true,notePaintGui:true,snapQueries:true,formattedTimeCommands:true,linearTimelineGeometry:true, adaptiveTimeRulers:true,projectTimeDisplay:true,timeDisplayReadout:true,controllerDisplayTimeEditing:true,timingGuardedCommands:true,inspectorDisplayTimeEditing:true,displayTimeBatches:true,displayTimeCommands:true,eventDisplayTimeEditing:true,musicalTimeReadout:true,musicalNoteTimeEditing:true,midiTimingPreferences:true,midiDisplayedNoteTime:true,midiReset:true,midiResetPreferences:true,sharedCommands:true,midiEditing:true,clipEditing:true,midiTransforms:true,maxCopiedNotesPerCommand:200000,wavImport:true,midiImport:true,midiExport:true,
  trackPreFilterBypass:true,trackPreEffectPresets:true,trackPreFilters:true,trackPreGainPolarity:true,projectEffectPresets:true,trackEqNoteFrequency:true,trackEffectTransfer:true,trackEqGraph:true,trackEqFilterTypes:true,trackEqAutomaticTail:true,trackFourBandEq:true,automaticEffectTail:true,trackDelayTempoSync:true,trackDelayFilters:true,trackFeedbackDelay:true,clipPasteTrackMapping:true,clipSnapshotPaste:true,clipGroupTrackMove:true,clipGroupMove:true,clipGroupMute:true,clipGroupRepeat:true,locatorRangeEditing:true,locatorsFromClips:true,offlineRender:true,preview:'rendered-snapshot',atomicBatch:true,undo:'persistent',historyBrowser:true,autoBackup:true,autosave:true,
  audioRecording:false,liveMidiInput:false,externalMidiOutput:process.platform==='darwin',nativeMidiTransport:process.platform==='darwin',nativeMidiRequiresBuild:true,nativeMidiAudioSync:false,nativeAudioPreview:process.platform==='darwin',audioUnitOfflineProbe:process.platform==='darwin',plugins:false,
  tempoRamps:false,automation:false,score:false,nativeRealtime:false,
  mediaInventory:true,verifiedAssetDownload:true,projectBundle:true,projectCollection:true,backupRecovery:true,
  assetRestore:true,exactHashAssetRestore:true,quantizeOrigins:true,mediaResolution:true,documentSave:true,saveNewVersion:true,revert:true,projectOpen:true,recentProjects:true,documentIdentityGuard:true,multipleProjects:true,inactiveProjects:true,untitledProjects:true,firstSave:true,draftRecovery:true,projectLocationPreferences:true,folderBrowser:true,midiEvents:true,midiControllerLanes:true,midiControllerPreferences:true,midiModifiers:true,midiModifierFreeze:true,midiModifiersMode:'offline-output',midiMergeLoop:true,midiMergeChaseTypes:true,midiChasePreferences:true,midiLocatePreview:true,midiInstantaneousNotes:true,midiSostenuto:true,midiPartMute:true,midiNoteTails:true,midiControllerExistingValues:true,midiControllerCursorReadout:true,midiControllerCursorScope:'selected-clip-events',midiPolyKeySelection:true,midiControllerSegmentBend:true,midiControllerCurves:['step','ramp','bezier'],midiControllerCurveTickResolution:1,midiNoteControllerMove:true,midiSplitControllers:true,pitchBendGrid:true,midiStatePlayback:true,midiPlaybackControllers:[7,10,11,64,66,120,121,123],midiPitchBend:true,midiPitchBendRange:'RPN-0',midiFormats:[0,1],maxCommandBytes:64*1024*1024,
  wavExportChannelModes:['stereo','mono','left','right'],wavExportFormats:['pcm16','pcm24','float32'],renderWindowFromCursor:true,maxRenderSeconds:MAX_RENDER_SECONDS,maxUploadBytes:MAX_WAV_FILE_BYTES,maxWavUploadBytes:MAX_WAV_FILE_BYTES,maxMidiUploadBytes:MAX_MIDI_FILE_BYTES,maxBundleBytes:MAX_BUNDLE_BYTES
});

function problem(code, message, status=400) { return Object.assign(new Error(message),{code,status}); }
async function analyzeAudioSamples(source,clip,mode='event'){
 const worker=new Worker(new URL('./audio-statistics-worker.mjs',import.meta.url),{workerData:{source,clip,mode},transferList:source.channels.map(c=>c.buffer)});let timer;
 try{return await new Promise((resolve,reject)=>{let delivered=false;timer=setTimeout(()=>reject(problem('STATISTICS_TIMEOUT','Audio analysis exceeded 60 seconds',422)),60000);worker.once('message',value=>{delivered=true;value.error?reject(problem(value.error.code,value.error.message,422)):resolve(value.statistics);});worker.once('error',reject);worker.once('exit',code=>{if(!delivered)reject(problem('STATISTICS_FAILED',`Analysis worker exited (${code})`,422));});});}
 finally{clearTimeout(timer);void worker.terminate();}
}
function json(res, status, value) {
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
  res.end(JSON.stringify(value));
}
async function body(req, limit) {
  const chunks=[]; let size=0;
  for await(const chunk of req) { size+=chunk.length; if(size>limit) throw problem('BODY_TOO_LARGE',`Request exceeds ${limit} bytes`,413); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
async function jsonBody(req,limit=2*1024*1024) {
  if(!req.headers['content-type']?.startsWith('application/json')) throw problem('CONTENT_TYPE','Expected application/json',415);
  try { return JSON.parse((await body(req,limit)).toString('utf8')); }
  catch(error) { if(error.code) throw error; throw problem('INVALID_JSON','Request contains invalid JSON'); }
}
function ensureRevision(value) { if(!Number.isSafeInteger(value)||value<0) throw problem('EXPECTED_REVISION_REQUIRED','Provide integer expectedRevision from /api/state'); }
function containsAssetCommand(command) { return ['asset.add','asset.relink','asset.removeMissing'].includes(command?.command)||(command?.command==='batch'&&Array.isArray(command.arguments?.commands)&&command.arguments.commands.some(containsAssetCommand)); }

export async function startServer({projectPath=path.join(ROOT,'sessions','First-Light.newdaw.json'),port=4317,demo=true,quiet=false,persistProject=saveProject,backupClock=()=>Date.now(),backupPollMs=1000,recentPath,nativeBackendFactory,nativeAudioOffline=false,nativeAudioHelperPath,audioUnitsHelperPath}={}) {
  if(!Number.isInteger(backupPollMs)||backupPollMs<10)throw new Error('backupPollMs must be at least 10');
  projectPath=path.resolve(projectPath);
  let directory=path.dirname(projectPath);
  recentPath=path.resolve(recentPath??path.join(directory,'.newdaw-recent.json'));
  const splitSettingsPath=recentPath+'.split.json';
  const draftRegistryPath=recentPath+'.drafts.json',browseBasePath=directory,controllerSettingsPath=recentPath+'.controllers.json',chaseSettingsPath=recentPath+'.chase.json',nativeSettingsPath=recentPath+'.native-midi.json',resetSettingsPath=recentPath+'.reset.json',timingSettingsPath=recentPath+'.timing.json';
  if(/^\.newdaw-draft-[a-f0-9-]{36}\.newdaw\.json$/.test(path.basename(projectPath)))throw problem('DRAFT_RECOVERY_REQUIRED','Recover this Untitled document from the workspace draft registry.',409);
  const serverSessionId=randomUUID(),requestScope=new AsyncLocalStorage();let requireDocumentGuard=false;
  const clients=new Set(), jobs=new Map(), waveforms=new Map(), log=[];
  const auditionJobs=createNoteAuditionJobs();
  let sequence=0,mediaRevision=0,queue=Promise.resolve(),closed=false,releaseLock,bundleBusy=false;
  let engine,settings,persistence,backupBaselineHash,backupTimer,documentSession,workspace,activeDraft=null;
  let autoBackup={lastCreatedAt:null,lastId:null,lastError:null,nextDueAt:null,running:false};
  const backupStatus=()=>({...autoBackup,dirty:engine?canonicalProjectHash(engine.project)!==backupBaselineHash:false});
  const assertRequestDocument=()=>{const request=requestScope.getStore();if(request&&request.documentId!==documentSession?.identity())throw problem('DOCUMENT_CONFLICT','The active document changed. Refresh before applying this request.',409);};
  const runExclusive=(fn)=>{const result=queue.then(()=>{assertRequestDocument();return fn();});queue=result.catch(()=>{});return result;};
  const snapshot=()=>({nativeTransport:nativeTransport.snapshot(),nativeAudio:nativeAudio.snapshot(),audioUnits:audioUnits.snapshot(),project:engine?.project??null,history:engine?.history??{canUndo:false,canRedo:false},historyView:engine?.historyView??null,workspace:workspace?.snapshot()??null,session:{id:serverSessionId,settings,persistence,autoBackup:backupStatus(),document:documentSession?.snapshot(),requiresDocumentId:requireDocumentGuard},capabilities:CAPABILITIES,sequence,mediaRevision});
  const emit=()=>{sequence++; const data=`id: ${sequence}\nevent: snapshot\ndata: ${JSON.stringify(snapshot())}\n\n`; for(const response of clients) response.write(data);};
  const nativeTransport=createNativeTransport({...(nativeBackendFactory?{openBackend:nativeBackendFactory}:{}),
    readResetPreferences:async()=>(await getResetSettings(resetSettingsPath)).settings.options,
    onChange:(transport,detail)=>{if(closed)return;for(const response of clients)response.write(`event: native-transport\ndata: ${JSON.stringify({...transport,...detail})}\n\n`);},
    checkFresh:async state=>{
      const [profile,chase,reset,timing]=await Promise.all([getNativeMidiSettings(nativeSettingsPath),getChaseSettings(chaseSettingsPath),getResetSettings(resetSettingsPath),getTimingSettings(timingSettingsPath)]);
      return !closed&&state.documentId===documentSession?.identity()&&state.projectId===engine?.project.id&&state.revision===engine?.project.revision&&state.profileFingerprint===profile.fingerprint&&state.chaseFingerprint===chase.fingerprint&&state.resetFingerprint===reset.fingerprint&&state.timingFingerprint===timing.fingerprint;
    }
  });
  const nativeAudio=createNativeAudio({offline:nativeAudioOffline,...(nativeAudioHelperPath?{helperPath:nativeAudioHelperPath}:{}),onChange:state=>{if(closed)return;for(const response of clients)response.write(`event: native-audio\ndata: ${JSON.stringify(state)}\n\n`);}});
  const audioUnits=createAudioUnits({...(audioUnitsHelperPath?{helperPath:audioUnitsHelperPath}:{}),onChange:state=>{if(closed)return;for(const response of clients)response.write(`event: audio-units\ndata: ${JSON.stringify(state)}\n\n`);}});
  async function stopNativeResources(reason,{resetAudioUnits=true}={}){await Promise.all([nativeTransport.stopAll(reason),nativeAudio.stopAll(reason)]);if(resetAudioUnits)await audioUnits.reset();}
  const nativeSettings=async()=>{const profile=await getNativeMidiSettings(nativeSettingsPath);assertRequestDocument();if(!engine)throw problem('NO_ACTIVE_DOCUMENT','Activate a project first',409);return {...profile,projectId:engine.project.id,projectRevision:engine.project.revision,config:profile.settings.projects[engine.project.id]??defaultNativeMidiProject()};};
  const nativeRevision=value=>{ensureRevision(value);if(!engine||value!==engine.project.revision)throw problem('REVISION_CONFLICT','Project changed; refresh before native MIDI operation',409);};
  const commandInQueue=async(envelope,{internal=false,preserveAudioUnits=false}={})=>{
    if(closed)throw problem('SESSION_CLOSING','Session is closing',503);
    if(!envelope||typeof envelope!=='object'||Array.isArray(envelope)) throw problem('INVALID_ENVELOPE','Expected a command object');
    ensureRevision(envelope.expectedRevision);
    if(!internal&&containsAssetCommand(envelope)) throw problem('ASSET_IMPORT_REQUIRED','Use verified WAV import or media-resolution endpoints to modify assets',422);
    if(!engine)throw problem('NO_ACTIVE_DOCUMENT','Activate an open project before editing.',409);
    const candidate=new Engine(engine.project);
    candidate.restoreHistory(engine.exportHistory());
    const started=performance.now();
    const resolvedEnvelope=await withSplitDefaults(await withChaseDefaults(await withControllerDefaults(envelope,controllerSettingsPath),chaseSettingsPath),splitSettingsPath,engine.project);
    const response=candidate.execute({...resolvedEnvelope,requestId:envelope.requestId??randomUUID()});
    if(response.applied) {
      try {
        const stored=await commitSessionState(projectPath,{currentCheckpoint:engine.checkpoint(),nextCheckpoint:candidate.checkpoint(),settings,persistProject});
        candidate.restoreCheckpoint(stored.checkpoint);
        persistence={status:stored.status,warnings:stored.warnings};
      }
      catch(error) { throw problem('SAVE_FAILED',`Edit rolled back because project could not be saved: ${error.message}`,500); }
      // Queries and render workers can only observe durably committed state.
      await stopNativeResources('project-edited',{resetAudioUnits:!preserveAudioUnits});
      engine=candidate;
      emit();
    }
    const entry={at:new Date().toISOString(),command:envelope.command,requestId:response.requestId,status:response.status,revision:response.projectRevision,milliseconds:Math.round((performance.now()-started)*100)/100,errors:response.errors};
    log.push(entry); if(log.length>200)log.shift();
    return {...response,...snapshot()};
  };
  const command=(envelope,options)=>runExclusive(()=>commandInQueue(envelope,options));
  const changedMedia=()=>{mediaRevision++;waveforms.clear();};
  const recordCreated=async assets=>{
    const warnings=[];
    for(const asset of assets)try{await registerCreatedMedia(projectPath,asset);}catch(error){warnings.push({code:'MEDIA_OWNERSHIP_NOT_RECORDED',message:`The created file is retained but cannot be selected for Revert cleanup: ${error.message}`,assetId:asset.id});}
    return warnings;
  };
  const makeResolver=()=>createMediaResolver({directory,getEngine:()=>engine,getMediaRevision:()=>mediaRevision,runExclusive,commitCommand:commandInQueue,isClosed:()=>closed,onPublished:recordCreated,mediaChanged:()=>{changedMedia();emit();}});
  let resolver=makeResolver();
  const inspectAssets=async({project,sourceDirectory,directory:targetDirectory})=>{
      const inventory=await assetInventory(project,sourceDirectory),warnings=[];
      for(const asset of inventory.assets){if(asset.status==='missing')warnings.push({code:'ASSET_MISSING',message:`Saved with a missing media reference: ${asset.name}`,assetId:asset.id});else if(asset.status!=='ready')throw problem(asset.error.code,asset.error.message,422);}
      for(const archive of inventory.sourceArchives??[]){if(archive.status==='missing')warnings.push({code:'SOURCE_ARCHIVE_MISSING',message:`Original source archive missing: ${archive.name}`,archiveId:archive.id});else if(archive.status!=='ready')throw problem(archive.error.code,archive.error.message,422);}
      if(path.resolve(sourceDirectory)!==path.resolve(targetDirectory))for(const archive of project.sourceArchives??[])try{await readVerifiedSourceArchive(targetDirectory,archive);}catch(error){if(error.code!=='ASSET_MISSING')throw error;}
      if(path.resolve(sourceDirectory)!==path.resolve(targetDirectory))for(const asset of project.assets)try{await readVerifiedAsset(targetDirectory,asset);}catch(error){if(error.code!=='ASSET_MISSING')throw error;}
      return {warnings};
    };
  const prepareAssets=async({project,sourceDirectory,directory:targetDirectory})=>{
      const warnings=[],retainedCopies=[];
      try{
        const inventory=await assetInventory(project,sourceDirectory),invalid=inventory.assets.find(a=>!['ready','missing'].includes(a.status));
        if(invalid)throw problem(invalid.error.code,invalid.error.message,422);
        for(const asset of project.assets){
          let bytes;try{bytes=await readVerifiedAsset(sourceDirectory,asset);}catch(error){if(error.code==='ASSET_MISSING'){warnings.push({code:'ASSET_MISSING',message:`Saved with a missing media reference: ${asset.name}`,assetId:asset.id});continue;}throw error;}
          if(path.resolve(sourceDirectory)===path.resolve(targetDirectory))continue;
          try{await readVerifiedAsset(targetDirectory,asset);continue;}catch(error){if(error.code!=='ASSET_MISSING')throw error;}
          const copied=await restoreAsset(targetDirectory,asset,bytes);if(copied.applied)retainedCopies.push(path.join(targetDirectory,asset.path));
        }
        for(const archive of project.sourceArchives??[]){
          let bytes;try{bytes=await readVerifiedSourceArchive(sourceDirectory,archive);}catch(error){if(error.code==='ASSET_MISSING'){warnings.push({code:'SOURCE_ARCHIVE_MISSING',message:`Original source archive missing: ${archive.name}`,archiveId:archive.id});continue;}throw error;}
          if(path.resolve(sourceDirectory)===path.resolve(targetDirectory))continue;
          if(await restoreSourceArchive(targetDirectory,archive,bytes))retainedCopies.push(path.join(targetDirectory,archive.path));
        }
      }catch(error){error.details={...error.details,retainedCopies};throw error;}
      return {warnings,retainedCopies};
    };
  const reserveTarget=(target,options)=>acquireProjectLock(target,`http://127.0.0.1:${server.address()?.port??port}`,options);
  documentSession=createDocumentSession({getContext:()=>({engine,settings,projectPath,directory,recentPath,draft:activeDraft}),runExclusive,emit,isClosed:()=>closed,mediaChanged:changedMedia,
    reserveTarget,inspectAssets,prepareAssets,
    saveFirst:input=>{
      const context=workspace.contexts().find(value=>value.openId===workspace.snapshot().activeId);
      return publishFirstSave(context,input.outputPath,{dryRun:Boolean(input.dryRun)});
    },
    commitRevert:async candidate=>{
      try{const stored=await commitSessionState(projectPath,{currentCheckpoint:engine.checkpoint(),nextCheckpoint:candidate.checkpoint(),settings,persistProject});candidate.restoreCheckpoint(stored.checkpoint);persistence={status:stored.status,warnings:stored.warnings};await stopNativeResources('project-reverted');engine=candidate;}
      catch(error){throw problem('SAVE_FAILED',`Revert was not committed: ${error.message}`,500);}
    },
    activateVersion:(prepared,adoptMetadata)=>adoptProject(prepared,adoptMetadata),
    activateExisting:(prepared,adoptMetadata)=>adoptProject(prepared,adoptMetadata,{existing:true})
  });
  async function adoptProject(prepared,adoptMetadata,{existing=false}={}){
    const warnings=[],oldRelease=releaseLock,adopted=new Engine(prepared.project);adopted.restoreCheckpoint(prepared.checkpoint);
    await stopNativeResources('document-changed');
    await resolver.close();
    for(const job of jobs.values())if(job.status==='running'){job.status='cancelled';await job.worker.terminate().catch(()=>{});}jobs.clear();
    // Capture everything before switching. There is no await in the adoption
    // block, so HTTP/SSE sees either one complete old or new document context.
    projectPath=prepared.projectPath;directory=path.dirname(projectPath);releaseLock=prepared.releaseLock;activeDraft=null;
    engine=adopted;if(existing)settings=prepared.settings;
    persistence=existing?prepared.persistence:{status:'saved',warnings:prepared.warnings??[]};
    resolver=makeResolver();changedMedia();log.length=0;
    if(existing)requireDocumentGuard=true;
    backupBaselineHash=existing?(prepared.backups.lastFingerprint??canonicalProjectHash(engine.project)):canonicalProjectHash(engine.project);
    autoBackup.lastId=existing?(prepared.backups.files[0]?.id??null):null;autoBackup.lastCreatedAt=existing?(prepared.backups.files[0]?.createdAt??null):null;autoBackup.lastError=null;autoBackup.running=false;
    autoBackup.nextDueAt=backupClock()+settings.autoBackup.intervalMinutes*60000;adoptMetadata();workspace?.replaceActive(captureActive());sequence++;
    try{await oldRelease();}catch(error){warnings.push({code:'OLD_LOCK_RELEASE_FAILED',message:error.message});}
    return warnings;
  }
  function captureActive(){
    if(!engine)return null;
    const documentState=documentSession.exportState();
    return {engine,settings,persistence,projectPath,directory,releaseLock,draft:activeDraft,saved:documentState.saved,documentState,autoBackup,backupBaselineHash,resources:'initialized',log:[...log]};
  }
  function fromPrepared(prepared){
    const next=new Engine(prepared.project);next.restoreCheckpoint(prepared.checkpoint);
    return {engine:next,draft:prepared.draft??null,settings:prepared.settings,persistence:prepared.persistence,projectPath:prepared.projectPath,directory:prepared.directory,releaseLock:prepared.releaseLock,saved:prepared.saved,
      documentState:{saved:prepared.saved,recentWarnings:[]},resources:prepared.media?.deferred?'deferred':'initialized',log:[],
      backupBaselineHash:prepared.backups.lastFingerprint??canonicalProjectHash(prepared.project),
      autoBackup:{lastId:prepared.backups.files[0]?.id??null,lastCreatedAt:prepared.backups.files[0]?.createdAt??null,lastError:null,running:false,nextDueAt:backupClock()+prepared.settings.autoBackup.intervalMinutes*60000}};
  }
  async function stopActiveResources(){
    await stopNativeResources('document-changed');
    await resolver?.close();
    for(const job of jobs.values())if(job.status==='running'){job.status='cancelled';await job.worker.terminate().catch(()=>{});}
    jobs.clear();
  }
  async function activateWorkspaceContext(context,publish){
    await stopActiveResources();
    return publishWorkspaceContext(context,publish);
  }
  function publishWorkspaceContext(context,publish){
    // All observable active fields and the workspace registry publish together.
    // Inactive contexts retain their engine, saved baseline, timer and file lock.
    ({engine,settings,persistence,projectPath,directory,releaseLock,autoBackup,backupBaselineHash}=context);activeDraft=context.draft??null;
    documentSession.restoreState({...context.documentState,saved:context.saved});
    resolver=makeResolver();changedMedia();log.splice(0,log.length,...(context.log??[]));requireDocumentGuard=true;
    context.resources='initialized';publish();sequence++;
    return [];
  }
  async function deactivateWorkspaceContext(publish){
    await stopActiveResources();
    engine=null;activeDraft=null;settings=null;persistence=null;projectPath=null;directory=null;releaseLock=null;resolver=null;backupBaselineHash=null;
    autoBackup={lastCreatedAt:null,lastId:null,lastError:null,nextDueAt:null,running:false};
    documentSession.restoreState(null);changedMedia();log.length=0;requireDocumentGuard=true;publish();sequence++;
    return [];
  }
  async function saveContext(context,input={}){
    if(context.draft){const result=await publishFirstSave(context,input.saveOutputPath,{dryRun:Boolean(input.dryRun)});return input.dryRun?result:context.saved;}
    const ownership=await captureMediaOwnership(context.projectPath);
    const saved=await saveExplicitCheckpoint(context.projectPath,context.engine.project,{ownershipIds:ownership.ownershipIds});
    context.saved=saved;context.documentState={...context.documentState,saved};
    if(context.engine===engine&&context.projectPath===projectPath)documentSession.acceptSaved(saved);
    return saved;
  }
  async function publishFirstSave(context,outputPath,{dryRun=false}={}){
    if(!context?.draft)throw problem('FIRST_SAVE_REQUIRED','Select an Untitled document for its first Save.',422);
    if(typeof outputPath!=='string'||!outputPath.trim())throw problem('OUTPUT_REQUIRED','Choose a named project filename for the first Save.',422);
    if(/^\.newdaw-draft-[a-f0-9-]{36}\.newdaw\.json$/.test(path.basename(outputPath)))throw problem('INVALID_DRAFT_DESTINATION','First Save needs a named project filename.',422);
    const inspected=await inspectDraft(draftRegistryPath,context.draft.id,{deferredMedia:true});
    if(canonicalProjectHash(inspected.project)!==canonicalProjectHash(context.engine.project))throw problem('PROJECT_FILE_CHANGED','The Untitled working file changed outside this workspace. Its memory state was retained.',409);
    const checkpoint=context.engine.checkpoint(),preview=await previewProjectVersion(context.projectPath,{checkpoint,mode:'saveAs',outputPath});
    const assets=await inspectAssets({project:checkpoint.project,sourceDirectory:context.directory,directory:path.dirname(preview.projectPath)});
    if(dryRun)return {status:'validated',applied:false,outputPath:preview.projectPath,document:documentSession.snapshot(),warnings:[...preview.warnings,...assets.warnings]};
    const wasActive=context.engine===engine&&context.projectPath===projectPath,oldRelease=context.releaseLock;
    // Resource shutdown precedes the commit point. Publication below has no
    // asynchronous gap in which the named file could be exposed as Untitled.
    let prepared,intent;const warnings=[];
    try{
      if(wasActive)await stopActiveResources();
      intent=await beginDraftPublication(draftRegistryPath,context.draft.id,{targetPath:preview.projectPath,project:checkpoint.project});
      warnings.push(...(intent.warnings??[]));
      prepared=await prepareProjectVersion(context.projectPath,{checkpoint,settings:context.settings,mode:'saveAs',outputPath:intent.targetPath,ownershipIds:[],prepareAssets,reserveTarget});
    }catch(error){
      try{if(intent){const aborted=await abortDraftPublication(draftRegistryPath,context.draft.id,{intentId:intent.intentId});error.warnings=[...(error.warnings??[]),...aborted.warnings];}}
      catch(finalError){error.details={...error.details,draftId:context.draft.id,publicationWarning:finalError.message};}
      if(wasActive)resolver=makeResolver();
      throw error;
    }
    warnings.push(...prepared.warnings);
    try{const finalized=await finalizeDraftPublication(draftRegistryPath,context.draft.id,{intentId:intent.intentId});warnings.push(...finalized.warnings);}
    catch(error){warnings.push({code:'DRAFT_FINALIZATION_PENDING',message:`The named project is saved. Its publication intent prevents recovery as a second Untitled copy: ${error.message}`});}
    const next=fromPrepared({...prepared,draft:null,directory:path.dirname(prepared.projectPath),settings:context.settings,
      persistence:{status:'saved',warnings},saved:{available:true,checkpoint:prepared.savedCheckpoint,dirty:false,persistence:{status:'saved',warnings}},
      backups:{files:[],lastFingerprint:null}});
    next.openId=context.openId;
    const publish=()=>{Object.assign(context,next);workspace.contextChanged();};
    if(wasActive)publishWorkspaceContext(next,publish);else{publish();sequence++;}
    try{await oldRelease?.();}catch(error){warnings.push({code:'DRAFT_LOCK_RELEASE_FAILED',message:error.message});}
    warnings.push(...await workspace.remember(context));emit();
    return {status:'saved',applied:true,firstSave:true,projectChanged:false,activated:wasActive,outputPath:prepared.projectPath,document:wasActive?documentSession.snapshot():null,workspace:workspace.snapshot(),warnings};
  }
  async function createContextBackup(context){
    if(closed)return;
    const frozen=context.engine.project,automation=context.autoBackup;
    try{
      const unsaved=context.saved?.checkpoint?contentProjectHash(frozen)!==contentProjectHash(context.saved.checkpoint.project):true;
      if(!context.settings.autoBackup.enabled||(!automation.lastId&&!unsaved&&canonicalProjectHash(frozen)===context.backupBaselineHash))return;
      automation.running=true;
      const result=await createAutoBackup(context.projectPath,frozen,{baseName:context.draft?.name??backupBaseName(context.projectPath),maxCount:context.settings.autoBackup.maxCount,now:new Date(backupClock())});
      context.backupBaselineHash=canonicalProjectHash(frozen);automation.lastError=null;
      if(context.engine===engine&&context.projectPath===projectPath)backupBaselineHash=context.backupBaselineHash;
      if(result.status==='created'){automation.lastCreatedAt=new Date(backupClock()).toISOString();automation.lastId=result.id;}
    }catch(error){automation.lastError={code:error.code??'BACKUP_FAILED',message:error.message};throw error;}
    finally{automation.running=false;automation.nextDueAt=backupClock()+context.settings.autoBackup.intervalMinutes*60000;emit();}
  }
  const createBackup=async({expectedRevision,force=false,timer=false}={})=>runExclusive(async()=>{
    if(closed)throw problem('SESSION_CLOSING','Session is closing',503);
    if(!timer){ensureRevision(expectedRevision);if(expectedRevision!==engine.project.revision)throw problem('REVISION_CONFLICT','Project changed before backup',409);}
    const frozen=engine.project;
    if(timer&&(!settings.autoBackup.enabled||(!autoBackup.lastId&&canonicalProjectHash(frozen)===backupBaselineHash)))return {status:'skipped',reason:'unchanged-or-disabled'};
    autoBackup.running=true;
    try{
      const result=await createAutoBackup(projectPath,frozen,{baseName:activeDraft?.name??backupBaseName(projectPath),maxCount:settings.autoBackup.maxCount,force,now:new Date(backupClock())});
      backupBaselineHash=canonicalProjectHash(frozen);autoBackup.lastError=null;
      if(result.status==='created'){autoBackup.lastCreatedAt=new Date(backupClock()).toISOString();autoBackup.lastId=result.id;}
      return {...result,projectRevision:frozen.revision};
    }catch(error){autoBackup.lastError={code:error.code??'BACKUP_FAILED',message:error.message};throw error;}
    finally{autoBackup.running=false;autoBackup.nextDueAt=backupClock()+settings.autoBackup.intervalMinutes*60000;emit();}
  });
  const assetBytes=asset=>readVerifiedAsset(directory,asset);
  const publicJob=(job)=>({timingProfile:job.timingProfile,timingOptions:job.timingOptions,id:job.id,jobId:job.id,revision:job.revision,mediaRevision:job.mediaRevision,status:job.status,outputKind:job.outputKind??'wav',createdAt:job.createdAt,stats:job.stats,error:job.error,...(job.chaseProfile?{startTick:job.startTick,chaseProfile:job.chaseProfile,chaseOptions:job.chaseOptions}:{}),...(job.status==='completed'?{url:`/api/jobs/${job.id}/${job.outputKind==='stems'?'stems.zip':job.outputKind==='aiff'?'audio.aiff':'audio.wav'}`}:{}),stale:job.revision!==engine.project.revision||job.mediaRevision!==mediaRevision});

  const server=http.createServer((req,res)=>requestScope.run({documentId:req.headers['x-newdaw-document']??documentSession?.identity()},async()=>{
    try {
      if(closed)throw problem('SESSION_CLOSING','Session is closing',503);
      const address=server.address(), actualPort=address?.port;
      const hosts=new Set([`127.0.0.1:${actualPort}`,`localhost:${actualPort}`]);
      if(!hosts.has(req.headers.host)) throw problem('INVALID_HOST','This service only accepts local loopback requests',403);
      if(req.headers.origin&&!new Set([`http://127.0.0.1:${actualPort}`,`http://localhost:${actualPort}`]).has(req.headers.origin)) throw problem('INVALID_ORIGIN','Cross-origin requests are not allowed',403);
      if(req.headers['sec-fetch-site']==='cross-site') throw problem('INVALID_ORIGIN','Cross-site requests are not allowed',403);
      res.setHeader('X-Content-Type-Options','nosniff');
      res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; media-src 'self' blob:; img-src 'self' data:; frame-ancestors 'none'");
      const url=new URL(req.url,`http://127.0.0.1:${actualPort}`),route=url.pathname;
      if(req.method==='POST'){
        assertRequestDocument();
        if(engine&&requireDocumentGuard&&!route.startsWith('/api/document/')&&!route.startsWith('/api/workspace')&&!req.headers['x-newdaw-document'])throw problem('EXPECTED_DOCUMENT_REQUIRED','After switching files, send X-Newdaw-Document from the current session document.',428);
      }
      if(req.method==='POST'&&route==='/api/midi/audition') {
        const input=await jsonBody(req),abort=new AbortController();
        const disconnect=()=>abort.abort();res.once('close',disconnect);
        try{
          if(res.destroyed)abort.abort();
          const {pending}=await runExclusive(async()=>{
            assertRequestDocument();
            if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['expectedRevision','clipId','field','updates','durationSeconds'].includes(k)))throw problem('INVALID_AUDITION','Unknown audition option',422);
            nativeRevision(input.expectedRevision);
            const pending=auditionJobs.run(engine.project,input,{signal:abort.signal});pending.catch(()=>{});return {pending};
          });
          const rendered=await pending;
          if(res.destroyed)return;
          assertRequestDocument();nativeRevision(input.expectedRevision);
          if(rendered.silent)return json(res,200,{silent:true,revision:rendered.revision,warnings:rendered.warnings});
          res.writeHead(200,{'Content-Type':'audio/wav','Cache-Control':'no-store','X-NewDAW-Revision':String(rendered.revision),'X-NewDAW-Audition':'built-in-oscillator'});
          return res.end(rendered.bytes);
        }finally{res.off('close',disconnect);}
      }
      if(req.method==='GET'&&route==='/api/health') return json(res,200,{ok:true,capabilities:CAPABILITIES});
      if(req.method==='GET'&&route==='/api/state') return json(res,200,snapshot());
      if(route.startsWith('/api/workspace')){
        if(req.method==='GET'&&route==='/api/workspace/split-settings')return json(res,200,await getSplitSettings(splitSettingsPath));
        if(req.method==='POST'&&route==='/api/workspace/split-settings')return json(res,200,await updateSplitSettings(splitSettingsPath,await jsonBody(req)));
        if(req.method==='GET'&&route==='/api/workspace/timing-settings')return json(res,200,await getTimingSettings(timingSettingsPath));
        if(req.method==='POST'&&route==='/api/workspace/timing-settings'){
          const input=await jsonBody(req),result=await runExclusive(async()=>{const value=await updateTimingSettings(timingSettingsPath,input);if(value.applied)await stopNativeResources('timing-settings-changed');return value;});
          if(result.applied)for(const response of clients)response.write(`event: timing-settings\ndata: ${JSON.stringify({revision:result.settings.revision,fingerprint:result.fingerprint})}\n\n`);
          return json(res,200,result);
        }
        if(req.method==='GET'&&route==='/api/workspace/reset-settings')return json(res,200,await getResetSettings(resetSettingsPath));
        if(req.method==='POST'&&route==='/api/workspace/reset-settings'){
          const input=await jsonBody(req),result=await runExclusive(async()=>{const value=await updateResetSettings(resetSettingsPath,input);if(value.applied)await stopNativeResources('reset-settings-changed');return value;});
          if(result.applied)for(const response of clients)response.write(`event: reset-settings\ndata: ${JSON.stringify({revision:result.settings.revision,fingerprint:result.fingerprint})}\n\n`);
          return json(res,200,result);
        }
        if(req.method==='GET'&&route==='/api/workspace/chase-settings')return json(res,200,await getChaseSettings(chaseSettingsPath));
        if(req.method==='POST'&&route==='/api/workspace/chase-settings'){
          const input=await jsonBody(req),result=await runExclusive(async()=>{const value=await updateChaseSettings(chaseSettingsPath,input);if(value.applied)await stopNativeResources('chase-settings-changed');return value;});
          if(result.applied)for(const response of clients)response.write(`event: chase-settings\ndata: ${JSON.stringify({revision:result.settings.revision,fingerprint:result.fingerprint})}\n\n`);
          return json(res,200,result);
        }
        if(req.method==='GET'&&route==='/api/workspace/controller-settings')return json(res,200,await getControllerSettings(controllerSettingsPath));
        if(req.method==='POST'&&route==='/api/workspace/controller-settings'){
          const result=await updateControllerSettings(controllerSettingsPath,await jsonBody(req));
          if(result.applied)for(const response of clients)response.write(`event: controller-settings\ndata: ${JSON.stringify({revision:result.settings.revision})}\n\n`);
          return json(res,200,result);
        }
        if(req.method==='GET'&&route==='/api/workspace')return json(res,200,workspace.snapshot());
        if(req.method==='GET'&&route==='/api/workspace/drafts')return json(res,200,await workspace.drafts());
        if(req.method==='GET'&&route==='/api/workspace/locations')return json(res,200,await workspace.locations());
        if(req.method==='GET'&&route==='/api/workspace/folders'){
          if([...url.searchParams.keys()].some(key=>!['path','cursor'].includes(key))||['path','cursor'].some(key=>url.searchParams.getAll(key).length>1))throw problem('INVALID_FOLDER_QUERY','Use one folder path and optional page cursor.',422);
          const cursor=url.searchParams.get('cursor');if(cursor!==null&&!/^(0|[1-9]\d*)$/.test(cursor))throw problem('INVALID_FOLDER_QUERY','Invalid folder page cursor.',422);
          return json(res,200,await browseProjectFolders({...((url.searchParams.has('path'))?{path:url.searchParams.get('path')}:{}),...(cursor!==null?{cursor:Number(cursor)}:{})},{basePath:browseBasePath}));
        }
        const workspaceRoutes={'/api/workspace/locations':'changeLocations','/api/workspace/new/plan':'planNew','/api/workspace/new':'new','/api/workspace/recover/plan':'planRecover','/api/workspace/recover':'recover','/api/workspace/open/plan':'planOpen','/api/workspace/open':'open','/api/workspace/activate/plan':'planActivate','/api/workspace/activate':'activate','/api/workspace/close/plan':'planClose','/api/workspace/close':'close','/api/workspace/recent/remove':'changeRecent'};
        if(req.method==='POST'&&workspaceRoutes[route])return json(res,200,await workspace[workspaceRoutes[route]](await jsonBody(req)));
      }
      if(req.method==='GET'&&route==='/api/native/ports')return json(res,200,await nativeTransport.ports());
      if(req.method==='GET'&&route==='/api/native/transport')return json(res,200,await nativeTransport.status());
      if(req.method==='GET'&&route==='/api/native/audio')return json(res,200,nativeAudio.snapshot());
      if(req.method==='POST'&&route==='/api/native/audio/play'){
        const input=await jsonBody(req);
        if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['jobId','expectedRevision'].includes(k))||typeof input.jobId!=='string')throw problem('INVALID_NATIVE_AUDIO_PLAY','Provide render jobId and expectedRevision',422);
        assertRequestDocument();nativeRevision(input.expectedRevision);
        if(['preparing','playing','stopping','resetting'].includes(nativeTransport.snapshot().status))throw problem('NATIVE_PREVIEW_CONFLICT','Native MIDI mode owns playback; stop it before native audio',409);
        const job=jobs.get(input.jobId);
        if(!job||job.status!=='completed'||job.outputKind!=='wav'||!job.bytes)throw problem('RENDER_NOT_READY','Select a completed WAV render for native audio',409);
        return json(res,200,await nativeAudio.play({bytes:job.bytes,renderJobId:job.id,revision:job.revision,documentId:documentSession.identity()}));
      }
      if(req.method==='POST'&&route==='/api/native/audio/stop'){
        const input=await jsonBody(req);if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>k!=='jobId')||typeof input.jobId!=='string')throw problem('INVALID_NATIVE_AUDIO_STOP','Provide only the current native audio jobId',422);
        assertRequestDocument();return json(res,200,await nativeAudio.stop(input.jobId));
      }
      if(req.method==='GET'&&route==='/api/audio-units')return json(res,200,audioUnits.snapshot());
      if(req.method==='GET'&&route==='/api/audio-units/output'){
        const output=audioUnits.output();if(!output)throw problem('AUDIO_UNIT_OUTPUT_NOT_READY','No processed WAV is available',409);
        res.writeHead(200,{'Content-Type':'audio/wav','Content-Disposition':`attachment; filename="audio-unit-r${output.revision}.wav"`});return res.end(output.bytes);
      }
      if(req.method==='POST'&&route==='/api/audio-units/list'){
        const input=await jsonBody(req);if(!input||Object.keys(input).some(k=>!['expectedRevision','limit'].includes(k))||input.limit!==undefined&&(!Number.isSafeInteger(input.limit)||input.limit<1||input.limit>256))throw problem('INVALID_AUDIO_UNIT_REQUEST','Provide expectedRevision and optional limit 1..256',422);
        assertRequestDocument();nativeRevision(input.expectedRevision);return json(res,200,await audioUnits.list(input.limit));
      }
      if(req.method==='POST'&&route==='/api/audio-units/select'){
        const input=await jsonBody(req);if(!input||Object.keys(input).some(k=>!['expectedRevision','id'].includes(k))||typeof input.id!=='string')throw problem('INVALID_AUDIO_UNIT_REQUEST','Provide component id and expectedRevision',422);
        assertRequestDocument();nativeRevision(input.expectedRevision);return json(res,200,await audioUnits.select(input.id));
      }
      if(req.method==='POST'&&route==='/api/audio-units/instantiate'){
        const input=await jsonBody(req);if(!input||Object.keys(input).some(k=>!['expectedRevision','id'].includes(k))||typeof input.id!=='string')throw problem('INVALID_AUDIO_UNIT_REQUEST','Provide component id and expectedRevision',422);
        assertRequestDocument();nativeRevision(input.expectedRevision);return json(res,200,await audioUnits.instantiate(input.id));
      }
      if(req.method==='POST'&&route==='/api/audio-units/render'){
        const input=await jsonBody(req);if(!input||Object.keys(input).some(k=>!['expectedRevision','jobId'].includes(k))||typeof input.jobId!=='string')throw problem('INVALID_AUDIO_UNIT_RENDER','Provide render jobId and expectedRevision',422);
        assertRequestDocument();nativeRevision(input.expectedRevision);const job=jobs.get(input.jobId);
        if(!job||job.status!=='completed'||job.outputKind!=='wav'||!job.bytes)throw problem('RENDER_NOT_READY','Select a completed WAV render for the Audio Unit probe',409);
        const sourceStartSample=job.chaseProfile&&Number.isSafeInteger(job.startTick)&&job.startTick>=0?job.stats?.startFrame:null;
        return json(res,200,await audioUnits.render({bytes:job.bytes,renderJobId:job.id,revision:job.revision,documentId:documentSession.identity(),sourceStartSample}));
      }
      if(req.method==='POST'&&route==='/api/audio-units/release'){
        const input=await jsonBody(req);if(!input||Object.keys(input).some(k=>k!=='expectedRevision'))throw problem('INVALID_AUDIO_UNIT_REQUEST','Provide only expectedRevision',422);
        assertRequestDocument();nativeRevision(input.expectedRevision);return json(res,200,await audioUnits.release());
      }
      if(req.method==='POST'&&route==='/api/native/stop'){
        const input=await jsonBody(req);
        if(!input||Array.isArray(input)||Object.keys(input).some(k=>!['jobId','reason'].includes(k))||typeof input.jobId!=='string'||input.reason!==undefined&&!['stop','locate'].includes(input.reason))throw problem('INVALID_NATIVE_STOP','Provide only the current jobId',422);
        assertRequestDocument();return json(res,200,await nativeTransport.stop(input.jobId,{reason:input.reason}));
      }
      if(!engine&&route.startsWith('/api/')&&!['/api/events','/api/commands','/api/document','/api/document/recent'].includes(route))throw problem('NO_ACTIVE_DOCUMENT','No project is active. Open or activate a project from the workspace.',409);
      if(req.method==='GET'&&route==='/api/native/settings')return json(res,200,await nativeSettings());
      if(req.method==='POST'&&route==='/api/native/settings'){
        const input=await jsonBody(req);
        const result=await runExclusive(async()=>{
          if(!input||typeof input!=='object'||Array.isArray(input))throw problem('INVALID_NATIVE_MIDI_UPDATE','Expected native settings object',422);
          nativeRevision(input.expectedProjectRevision);
          if(input.projectId!==engine.project.id)throw problem('PROJECT_CONFLICT','Native settings belong to another project',409);
          if(!Array.isArray(input.routes)||input.routes.some(r=>!r||engine.project.tracks.find(t=>t.id===r.trackId)?.type!=='midi'))throw problem('NATIVE_ROUTE','Routes must identify existing MIDI tracks',422);
          const {expectedProjectRevision,...patch}=input,value=await updateNativeMidiSettings(nativeSettingsPath,patch);
          if(value.applied){await stopNativeResources('native-settings-changed');for(const response of clients)response.write(`event: native-settings\ndata: ${JSON.stringify({revision:value.settings.revision,fingerprint:value.fingerprint})}\n\n`);}
          return {...value,projectId:engine.project.id,projectRevision:engine.project.revision,config:value.settings.projects[engine.project.id]??defaultNativeMidiProject()};
        });return json(res,200,result);
      }
      if(req.method==='POST'&&['/api/native/play','/api/native/reset'].includes(route)){
        const input=await jsonBody(req);
        const execute=async()=>{
          if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['expectedRevision','expectedSettingsRevision','expectedSettingsFingerprint','expectedChaseRevision','expectedChaseFingerprint','expectedResetRevision','expectedResetFingerprint','expectedTimingRevision','expectedTimingFingerprint','startTick','endTick'].includes(k)))throw problem('INVALID_NATIVE_PLAY','Unknown native playback option',422);
          const [profile,chaseProfile,resetProfile,timingProfile]=await Promise.all([getNativeMidiSettings(nativeSettingsPath),getChaseSettings(chaseSettingsPath),getResetSettings(resetSettingsPath),getTimingSettings(timingSettingsPath)]);
          assertRequestDocument();nativeRevision(input.expectedRevision);
          if(input.expectedSettingsRevision!==profile.settings.revision||input.expectedSettingsFingerprint!==profile.fingerprint)throw problem('NATIVE_MIDI_SETTINGS_CONFLICT','Native settings changed; reload before playback',409);
          if(input.expectedChaseRevision!==chaseProfile.settings.revision||input.expectedChaseFingerprint!==chaseProfile.fingerprint)throw problem('CHASE_SETTINGS_CONFLICT','Chase settings changed; reload before playback',409);
          if((route==='/api/native/reset'||Object.hasOwn(input,'expectedResetRevision')||Object.hasOwn(input,'expectedResetFingerprint'))&&(input.expectedResetRevision!==resetProfile.settings.revision||input.expectedResetFingerprint!==resetProfile.fingerprint))throw problem('RESET_SETTINGS_CONFLICT','Reset settings changed; reload before output',409);
          if((Object.hasOwn(input,'expectedTimingRevision')||Object.hasOwn(input,'expectedTimingFingerprint'))&&(input.expectedTimingRevision!==timingProfile.settings.revision||input.expectedTimingFingerprint!==timingProfile.fingerprint))throw problem('TIMING_SETTINGS_CONFLICT','MIDI timing settings changed; reload before output',409);
          if(route==='/api/native/reset'){
            if(input.startTick!==undefined||input.endTick!==undefined)throw problem('INVALID_NATIVE_RESET','Reset does not move the cursor',422);
            return nativeTransport.reset({project:engine.project,documentId:documentSession.identity(),profile,chaseProfile,resetProfile,timingProfile});
          }
          return nativeTransport.start({project:engine.project,documentId:documentSession.identity(),profile,chaseProfile,resetProfile,timingProfile,startTick:input.startTick??0,...(input.endTick!==undefined?{endTick:input.endTick}:{})});
        };return json(res,200,await (route==='/api/native/reset'?execute():runExclusive(execute)));
      }
      if(req.method==='POST'&&route==='/api/time/command'){
        const input=await jsonBody(req);return json(res,200,await runExclusive(async()=>{
          if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['command','arguments','formattedTimes','timeOptions','expectedRevision','expectedTimingRevision','expectedTimingFingerprint','dryRun','requestId'].includes(k))||(input.dryRun!==undefined&&typeof input.dryRun!=='boolean')||(input.requestId!==undefined&&typeof input.requestId!=='string'))throw problem('INVALID_TIME_EDIT','Invalid formatted command request',422);
          const profile=await getTimingSettings(timingSettingsPath);assertRequestDocument();nativeRevision(input.expectedRevision);
          if(input.expectedTimingRevision!==profile.settings.revision||input.expectedTimingFingerprint!==profile.fingerprint)throw problem('TIMING_SETTINGS_CONFLICT','Time settings changed; reload your edit draft',409);
          let resolved;try{
            if(input.timeOptions!==undefined&&(!input.timeOptions||typeof input.timeOptions!=='object'||Array.isArray(input.timeOptions)||Object.keys(input.timeOptions).some(k=>!['scope','rounding','controllers'].includes(k))))throw problem('INVALID_TIME_EDIT','Unknown time edit option',422);
            resolved=resolveFormattedTimeCommand(engine.project,input.command,input.arguments,input.formattedTimes,{...input.timeOptions,displayPpq:profile.settings.options.displayPpq});
          }catch(error){throw problem(error.code??'INVALID_TIME_EDIT',error.message,422);}
          return {...await commandInQueue({command:resolved.command,arguments:resolved.arguments,expectedRevision:input.expectedRevision,dryRun:input.dryRun??false,...(input.requestId?{requestId:input.requestId}:{})}),timingProfile:{revision:profile.settings.revision,fingerprint:profile.fingerprint},convertedCommand:resolved.command,convertedArguments:resolved.arguments,timeConversions:resolved.conversions,timeScope:resolved.scope,sourceRounding:resolved.rounding};
        }));
      }
      if(req.method==='POST'&&route==='/api/midi/time/command'){
        const input=await jsonBody(req);return json(res,200,await runExclusive(async()=>{
          if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['command','arguments','displayTimes','expectedRevision','expectedTimingRevision','expectedTimingFingerprint','dryRun','requestId'].includes(k))||(input.dryRun!==undefined&&typeof input.dryRun!=='boolean')||(input.requestId!==undefined&&typeof input.requestId!=='string'))throw problem('INVALID_DISPLAY_TIME','Invalid displayed command request',422);
          const profile=await getTimingSettings(timingSettingsPath);assertRequestDocument();nativeRevision(input.expectedRevision);
          if(input.expectedTimingRevision!==profile.settings.revision||input.expectedTimingFingerprint!==profile.fingerprint)throw problem('TIMING_SETTINGS_CONFLICT','Display resolution changed; reload your edit draft',409);
          let args;try{args=resolveDisplayTimeCommand(input.command,input.arguments,input.displayTimes,{ppq:engine.project.ppq,displayPpq:profile.settings.options.displayPpq});}catch(error){throw problem(error.code??'INVALID_DISPLAY_TIME',error.message,422);}
          for(const c of input.command==='batch'?args.commands:[{command:input.command,arguments:args}])if(c.command==='clip.update'&&engine.project.clips.find(p=>p.id===c.arguments?.clipId)?.type!=='midi')throw problem('INVALID_DISPLAY_TIME','Displayed clip time editing requires a MIDI clip',422);
          return {...await commandInQueue({command:input.command,arguments:args,expectedRevision:input.expectedRevision,dryRun:input.dryRun??false,...(input.requestId?{requestId:input.requestId}:{})}),timingProfile:{revision:profile.settings.revision,fingerprint:profile.fingerprint},convertedArguments:args};
        }));
      }
      if(req.method==='POST'&&route==='/api/time/snap'){
        const input=await jsonBody(req);return json(res,200,await runExclusive(async()=>{
          if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['localTick','scope','clipId','rounding','cell','expectedRevision','expectedTimingRevision','expectedTimingFingerprint'].includes(k))||(input.cell!==undefined&&typeof input.cell!=='boolean'))throw problem('INVALID_SNAP_GRID','Invalid snap query',422);
          const profile=await getTimingSettings(timingSettingsPath);assertRequestDocument();nativeRevision(input.expectedRevision);
          if(input.expectedTimingRevision!==profile.settings.revision||input.expectedTimingFingerprint!==profile.fingerprint)throw problem('TIMING_SETTINGS_CONFLICT','Timing settings changed; reload',409);
          try{const grid=compileEditorSnap(engine.project,{scope:input.scope,clipId:input.clipId}),result=input.cell?grid.cell(input.localTick,input.rounding??'floor'):grid.snap(input.localTick,input.rounding??'nearest');return {result,scope:grid.scope,mode:grid.mode,format:grid.format,config:grid.config,projectRevision:engine.project.revision,documentId:documentSession.identity(),timingProfile:{revision:profile.settings.revision,fingerprint:profile.fingerprint}};}catch(error){throw problem(error.code??'INVALID_SNAP_GRID',error.message,422);}
        }));
      }
      if(req.method==='POST'&&route==='/api/time/ruler'){
        const input=await jsonBody(req);return json(res,200,await runExclusive(async()=>{
          if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['expectedRevision','expectedTimingRevision','expectedTimingFingerprint','fromPixel','toPixel','scope','originTick','zoom','minSpacing','maxLines'].includes(k)))throw problem('INVALID_RULER','Invalid ruler request',422);
          const profile=await getTimingSettings(timingSettingsPath);assertRequestDocument();nativeRevision(input.expectedRevision);
          if(input.expectedTimingRevision!==profile.settings.revision||input.expectedTimingFingerprint!==profile.fingerprint)throw problem('TIMING_SETTINGS_CONFLICT','Display resolution changed; reload',409);
          try{const ruler=compileRulerIntervals(engine.project,{scope:input.scope,originTick:input.originTick,zoom:input.zoom});return {...ruler.range(input.fromPixel,input.toPixel,{minSpacing:input.minSpacing,maxLines:input.maxLines}),originTick:ruler.originTick,precision:'integer-unit-labels-float64-coordinates',projectRevision:engine.project.revision,timingProfile:{revision:profile.settings.revision,fingerprint:profile.fingerprint}};}catch(error){throw problem(error.code??'INVALID_RULER',error.message,422);}
        }));
      }
      if(req.method==='POST'&&route==='/api/time/display'){
        const input=await jsonBody(req);return json(res,200,await runExclusive(async()=>{
          if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['expectedRevision','expectedTimingRevision','expectedTimingFingerprint','tick','endTick','sample','scope','originTick'].includes(k))||['tick','sample'].filter(k=>Object.hasOwn(input,k)).length!==1||Object.hasOwn(input,'sample')&&(Object.hasOwn(input,'endTick')||Object.hasOwn(input,'originTick'))||Object.hasOwn(input,'endTick')&&Object.hasOwn(input,'originTick'))throw problem('INVALID_TIME_DISPLAY','Use tick, tick+endTick, tick+originTick or sample; optional scope is primary/timeline/piano',422);
          const profile=await getTimingSettings(timingSettingsPath);assertRequestDocument();nativeRevision(input.expectedRevision);
          if(input.expectedTimingRevision!==profile.settings.revision||input.expectedTimingFingerprint!==profile.fingerprint)throw problem('TIMING_SETTINGS_CONFLICT','Display resolution changed; reload',409);
          try{const time=compileProjectTimeDisplay(engine.project,profile.settings.options.displayPpq);const value=Object.hasOwn(input,'sample')?time.samplePosition(input.sample,input.scope):Object.hasOwn(input,'endTick')?time.duration(input.tick,input.endTick,input.scope):time.position(input.tick,input.scope,input.originTick);
            return {...value,options:time.options,projectRevision:engine.project.revision,documentId:documentSession.identity(),timingProfile:{revision:profile.settings.revision,fingerprint:profile.fingerprint}};
          }catch(error){throw problem(error.code??'INVALID_TIME_DISPLAY',error.message,422);}
        }));
      }
      if(req.method==='POST'&&route==='/api/midi/time/convert'){
        const input=await jsonBody(req);return json(res,200,await runExclusive(async()=>{
          if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['expectedRevision','expectedTimingRevision','expectedTimingFingerprint','tick','position','duration'].includes(k))||['tick','position','duration'].filter(k=>Object.hasOwn(input,k)).length!==1)throw problem('INVALID_DISPLAY_TIME','Provide exactly one tick, position or duration',422);
          const profile=await getTimingSettings(timingSettingsPath);assertRequestDocument();nativeRevision(input.expectedRevision);
          if(input.expectedTimingRevision!==profile.settings.revision||input.expectedTimingFingerprint!==profile.fingerprint)throw problem('TIMING_SETTINGS_CONFLICT','Display resolution changed; reload',409);
          try{const time=compileMusicalTime({ppq:engine.project.ppq,displayPpq:profile.settings.options.displayPpq,timeSignature:engine.project.timeSignature});const tick=Object.hasOwn(input,'tick')?input.tick:Object.hasOwn(input,'position')?time.parsePosition(input.position):time.parseDuration(input.duration);
            return {projectRevision:engine.project.revision,documentId:documentSession.identity(),timingProfile:{revision:profile.settings.revision,fingerprint:profile.fingerprint},...time.options,tick,position:time.formatPosition(tick),duration:time.formatDuration(tick),positionParts:time.positionAt(tick),durationParts:time.durationAt(tick)};
          }catch(error){throw problem(error.code,error.message,422);}
        }));
      }
      if(req.method==='POST'&&route==='/api/midi/timing/note'){
        const input=await jsonBody(req);return json(res,200,await runExclusive(async()=>{
          if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['expectedRevision','expectedTimingRevision','expectedTimingFingerprint','clipId','noteId','startDisplayTick','durationDisplayTicks','startMusicalPosition','musicalDuration','dryRun'].includes(k))||typeof input.clipId!=='string'||typeof input.noteId!=='string'||(input.dryRun!==undefined&&typeof input.dryRun!=='boolean'))throw problem('INVALID_DISPLAY_TIME','Invalid displayed note-time request',422);
          const profile=await getTimingSettings(timingSettingsPath);assertRequestDocument();nativeRevision(input.expectedRevision);
          if(input.expectedTimingRevision!==profile.settings.revision||input.expectedTimingFingerprint!==profile.fingerprint)throw problem('TIMING_SETTINGS_CONFLICT','Display resolution changed; reload your note-time draft',409);
          if((Object.hasOwn(input,'startDisplayTick')&&Object.hasOwn(input,'startMusicalPosition'))||(Object.hasOwn(input,'durationDisplayTicks')&&Object.hasOwn(input,'musicalDuration')))throw problem('INVALID_DISPLAY_TIME','Use one unit per edited field',422);
          const args={clipId:input.clipId,noteId:input.noteId};
          try{const time=compileMusicalTime({ppq:engine.project.ppq,displayPpq:profile.settings.options.displayPpq,timeSignature:engine.project.timeSignature});if(Object.hasOwn(input,'startMusicalPosition'))args.startTick=time.parsePosition(input.startMusicalPosition);if(Object.hasOwn(input,'musicalDuration'))args.durationTicks=time.parseDuration(input.musicalDuration);}catch(error){throw problem(error.code,error.message,422);}
          try{for(const [key,target]of [['startDisplayTick','startTick'],['durationDisplayTicks','durationTicks']])if(Object.hasOwn(input,key))args[target]=convertMidiTicks(input[key],profile.settings.options.displayPpq,engine.project.ppq,'exact');}catch(error){throw problem(error.code,error.message,422);}
          if(Object.keys(args).length===2)throw problem('INVALID_DISPLAY_TIME','Provide at least one displayed time; blank fields mean unchanged',422);
          return {...await commandInQueue({command:'midi.notes.update',arguments:args,expectedRevision:input.expectedRevision,dryRun:input.dryRun??false}),timingProfile:{revision:profile.settings.revision,fingerprint:profile.fingerprint},convertedArguments:args};
        }));
      }
      if(req.method==='GET'&&route==='/api/document')return json(res,200,documentSession.snapshot());
      if(req.method==='GET'&&route==='/api/document/recent')return json(res,200,await documentSession.recent());
      if(req.method==='POST'&&route==='/api/document/recent/remove')return json(res,200,await documentSession.changeRecent(await jsonBody(req)));
      if(req.method==='POST'&&route==='/api/document/open/plan')return json(res,200,await documentSession.planOpen(await jsonBody(req)));
      if(req.method==='POST'&&route==='/api/document/open')return json(res,200,await documentSession.open(await jsonBody(req)));
      if(req.method==='POST'&&route==='/api/document/save')return json(res,200,await documentSession.save(await jsonBody(req)));
      if(req.method==='POST'&&route==='/api/document/save-as')return json(res,200,await documentSession.saveVersion(await jsonBody(req)));
      if(req.method==='POST'&&route==='/api/document/revert/plan')return json(res,200,await documentSession.planRevert(await jsonBody(req)));
      if(req.method==='POST'&&route==='/api/document/revert')return json(res,200,await documentSession.revert(await jsonBody(req)));
      if(req.method==='GET'&&route==='/api/document/trash')return json(res,200,await documentSession.listTrash());
      const trashRoute=route.match(/^\/api\/document\/trash\/([a-f0-9-]+)\/restore$/);
      if(req.method==='POST'&&trashRoute)return json(res,200,await documentSession.restoreTrash(trashRoute[1],await jsonBody(req)));
      if(req.method==='GET'&&route==='/api/history')return json(res,200,{projectId:engine.project.id,projectRevision:engine.project.revision,history:engine.historyView,persistence});
      if(req.method==='GET'&&route==='/api/backups')return json(res,200,{...(await listBackups(projectPath)),projectRevision:engine.project.revision,settings,automation:backupStatus()});
      if(req.method==='POST'&&route==='/api/backups/create'){
        const input=await jsonBody(req);
        if(!input||Object.keys(input).some(k=>!['expectedRevision','force'].includes(k))||(input.force!==undefined&&typeof input.force!=='boolean'))throw problem('INVALID_BACKUP_OPTIONS','Expected expectedRevision and optional boolean force',422);
        return json(res,200,await createBackup(input));
      }
      if(req.method==='POST'&&route==='/api/backups/settings'){
        const input=await jsonBody(req);
        const result=await runExclusive(async()=>{
          ensureRevision(input?.expectedRevision);
          if(input.expectedRevision!==engine.project.revision||input.expectedSettingsRevision!==settings.revision)throw problem('REVISION_CONFLICT','Project or backup settings changed; reload settings',409);
          if(Object.keys(input).some(k=>!['expectedRevision','expectedSettingsRevision','autoBackup','dryRun'].includes(k)))throw problem('INVALID_BACKUP_SETTINGS','Unknown settings field',422);
          const value=input.autoBackup;
          if(!value||Object.keys(value).sort().join(',')!=='enabled,intervalMinutes,maxCount'||typeof value.enabled!=='boolean'||!Number.isInteger(value.intervalMinutes)||value.intervalMinutes<1||value.intervalMinutes>1440||!Number.isInteger(value.maxCount)||value.maxCount<1||value.maxCount>1000||(input.dryRun!==undefined&&typeof input.dryRun!=='boolean'))throw problem('INVALID_BACKUP_SETTINGS','Use enabled boolean, intervalMinutes 1..1440 and maxCount 1..1000',422);
          const next={revision:settings.revision+1,autoBackup:{...value}};
          if(!Number.isSafeInteger(next.revision))throw problem('REVISION_OVERFLOW','Settings revision overflow',409);
          if(input.dryRun)return {status:'validated',settings:next,applied:false};
          const stored=await updateSessionSettings(projectPath,engine.checkpoint(),next);
          if(stored.checkpoint)engine.restoreCheckpoint(stored.checkpoint);
          settings=next;persistence={status:stored?.status??'saved',warnings:stored?.warnings??[]};autoBackup.nextDueAt=backupClock()+settings.autoBackup.intervalMinutes*60000;emit();
          return {status:'applied',applied:true,settings,projectRevision:engine.project.revision};
        });return json(res,200,result);
      }
      const backupRoute=route.match(/^\/api\/backups\/([^/]+)\/file$/);
      if(req.method==='GET'&&backupRoute){
        const result=await readBackup(projectPath,decodeURIComponent(backupRoute[1]));
        res.writeHead(200,{'Content-Type':'application/json','Content-Disposition':`attachment; filename="backup-${encodeURIComponent(backupRoute[1])}.newdaw.json"`,'Cache-Control':'no-store'});return res.end(result.bytes);
      }
      if(req.method==='GET'&&route==='/api/commands') return json(res,200,getCommandCatalog());
      if(req.method==='GET'&&route==='/api/log') return json(res,200,{entries:log});
      if(req.method==='GET'&&route==='/api/assets') {
        const frozen=engine.project,frozenMediaRevision=mediaRevision,result=await assetInventory(frozen,directory);
        return json(res,200,{...result,mediaRevision:frozenMediaRevision,currentRevision:engine.project.revision,currentMediaRevision:mediaRevision,
          stale:frozen.revision!==engine.project.revision||frozenMediaRevision!==mediaRevision});
      }
      const archiveRoute=route.match(/^\/api\/source-archives\/([^/]+)\/(file|restore)$/);
      if(archiveRoute){
        let id;try{id=decodeURIComponent(archiveRoute[1]);}catch{throw problem('INVALID_ARCHIVE_ID','Invalid source archive ID',422);}
        if(req.method==='GET'&&archiveRoute[2]==='file'){
          const frozen=engine.project,archive=frozen.sourceArchives?.find(a=>a.id===id);if(!archive)throw problem('ARCHIVE_NOT_FOUND','Source archive not found',404);
          const bytes=await readVerifiedSourceArchive(directory,archive);assertRequestDocument();
          res.writeHead(200,{'Content-Type':'audio/aiff','Cache-Control':'no-store','Content-Disposition':`attachment; filename="original.aiff"; filename*=UTF-8''${encodeURIComponent(archive.name)}`,'X-NewDAW-SHA256':archive.sha256});return res.end(bytes);
        }
        if(req.method==='POST'&&archiveRoute[2]==='restore'){
          const expectedRevision=url.searchParams.has('expectedRevision')?Number(url.searchParams.get('expectedRevision')):undefined;ensureRevision(expectedRevision);
          const bytes=await body(req,MAX_WAV_FILE_BYTES);
          const result=await runExclusive(async()=>{
            nativeRevision(expectedRevision);const archive=engine.project.sourceArchives?.find(a=>a.id===id);if(!archive)throw problem('ARCHIVE_NOT_FOUND','Source archive not found',404);
            if(mediaRevision===Number.MAX_SAFE_INTEGER)throw problem('MEDIA_REVISION_OVERFLOW','Media revision cannot increment',409);
            const applied=await restoreSourceArchive(directory,archive,bytes);if(applied){mediaRevision++;emit();}
            return{applied,status:applied?'restored':'unchanged',archiveId:id,projectRevision:engine.project.revision,mediaRevision};
          });return json(res,200,result);
        }
      }
      if(req.method==='POST'&&route==='/api/media/search')return json(res,202,await resolver.start(await jsonBody(req)));
      const searchRoute=route.match(/^\/api\/media\/search\/([a-f0-9-]+)(\/stop)?$/);
      if(searchRoute){
        if(req.method==='GET'&&!searchRoute[2])return json(res,200,resolver.get(searchRoute[1]));
        if(req.method==='POST'&&searchRoute[2]==='/stop'){await jsonBody(req);return json(res,200,resolver.stop(searchRoute[1]));}
      }
      if(req.method==='POST'&&route==='/api/media/plan')return json(res,200,await resolver.plan(await jsonBody(req)));
      if(req.method==='POST'&&route==='/api/media/accept')return json(res,200,await resolver.accept(await jsonBody(req)));
      if(req.method==='POST'&&route==='/api/media/remove-missing')return json(res,200,await resolver.removeMissing(await jsonBody(req)));
      const restoreRoute=route.match(/^\/api\/assets\/([^/]+)\/restore$/);
      if(req.method==='POST'&&restoreRoute) {
        const mime=req.headers['content-type']?.split(';')[0];
        if(!['application/octet-stream','audio/wav','audio/x-wav','audio/wave'].includes(mime))throw problem('CONTENT_TYPE','Send binary WAV bytes for asset restoration',415);
        let id;try{id=decodeURIComponent(restoreRoute[1]);}catch{throw problem('INVALID_ASSET_ID','Invalid asset identifier');}
        const expectedRevision=url.searchParams.has('expectedRevision')?Number(url.searchParams.get('expectedRevision')):undefined;
        ensureRevision(expectedRevision);
        const dryRunValue=url.searchParams.get('dryRun');
        if(dryRunValue!==null&&!['true','false'].includes(dryRunValue))throw problem('INVALID_DRY_RUN','dryRun must be true or false');
        const bytes=await body(req,CAPABILITIES.maxUploadBytes),dryRun=dryRunValue==='true';
        const result=await runExclusive(async()=>{
          if(closed)throw problem('SESSION_CLOSING','Session is closing',503);
          const project=engine.project;
          if(project.revision!==expectedRevision)throw problem('REVISION_CONFLICT','Project changed before media repair could begin',409);
          const asset=project.assets.find(item=>item.id===id);
          if(!asset)throw problem('ASSET_NOT_FOUND','Asset not found',404);
          if(mediaRevision===Number.MAX_SAFE_INTEGER)throw problem('MEDIA_REVISION_OVERFLOW','Media revision cannot be incremented safely',409);
          const started=performance.now(),repair=await restoreAsset(directory,asset,bytes,{dryRun});
          if(repair.applied){if(repair.plannedAction==='restore')repair.warnings.push(...await recordCreated([asset]));mediaRevision++;waveforms.delete(asset.sha256);emit();}
          log.push({at:new Date().toISOString(),command:'asset.restore',status:repair.status,assetId:id,revision:project.revision,mediaRevision,
            milliseconds:Math.round((performance.now()-started)*100)/100,errors:[]});if(log.length>200)log.shift();
          return {...repair,projectId:project.id,projectRevision:project.revision,mediaRevision,sequence};
        });
        return json(res,200,result);
      }
      const assetFile=route.match(/^\/api\/assets\/([^/]+)\/file$/);
      if(req.method==='GET'&&assetFile) {
        let id;try{id=decodeURIComponent(assetFile[1]);}catch{throw problem('INVALID_ASSET_ID','Invalid asset identifier');}
        const frozen=engine.project,asset=frozen.assets.find(item=>item.id===id);
        if(!asset)throw problem('ASSET_NOT_FOUND','Asset not found',404);
        const bytes=await assetBytes(asset);
        res.writeHead(200,{'Content-Type':'audio/wav','Cache-Control':'no-store',
          'Content-Disposition':`attachment; filename="asset.wav"; filename*=UTF-8''${encodeURIComponent(asset.name)}`,
          'X-NewDAW-Revision':String(frozen.revision),'X-NewDAW-SHA256':asset.sha256});
        return res.end(bytes);
      }
      if(req.method==='GET'&&route==='/api/project/bundle') {
        if(bundleBusy)throw problem('BUNDLE_BUSY','Another project bundle is being prepared; retry after it completes',409);
        const frozen=engine.project;
        if(url.searchParams.has('expectedRevision')) {
          const expected=Number(url.searchParams.get('expectedRevision'));ensureRevision(expected);
          if(expected!==frozen.revision)throw problem('REVISION_CONFLICT','Project changed before bundle snapshot',409);
        }
        bundleBusy=true;
        try {
          const bundle=await createProjectBundle(frozen,directory);
          res.writeHead(200,{'Content-Type':'application/zip','Cache-Control':'no-store',
            'Content-Disposition':`attachment; filename="newdaw-r${bundle.revision}.zip"`,'X-NewDAW-Revision':String(bundle.revision)});
          return res.end(bundle.bytes);
        } finally {bundleBusy=false;}
      }
      if(req.method==='GET'&&route==='/api/events') {
        res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'});
        res.write(`id: ${sequence}\nevent: snapshot\ndata: ${JSON.stringify(snapshot())}\n\n`); clients.add(res);
        req.on('close',()=>clients.delete(res)); return;
      }
      if(req.method==='POST'&&route==='/api/command') {
        const input=await jsonBody(req,64*1024*1024);
        const guarded=input&&typeof input==='object'&&(Object.hasOwn(input,'expectedTimingRevision')||Object.hasOwn(input,'expectedTimingFingerprint'));
        const response=guarded?await runExclusive(async()=>{
          if(!Number.isSafeInteger(input.expectedTimingRevision)||input.expectedTimingRevision<0||!Object.hasOwn(input,'expectedTimingFingerprint')||(input.expectedTimingFingerprint!==null&&(typeof input.expectedTimingFingerprint!=='string'||!/^[a-f0-9]{64}$/.test(input.expectedTimingFingerprint))))throw problem('INVALID_TIMING_GUARD','Provide both timing revision and fingerprint',422);
          const profile=await getTimingSettings(timingSettingsPath);assertRequestDocument();nativeRevision(input.expectedRevision);
          if(input.expectedTimingRevision!==profile.settings.revision||input.expectedTimingFingerprint!==profile.fingerprint)throw problem('TIMING_SETTINGS_CONFLICT','MIDI display settings changed; reload your gesture or draft',409);
          const {expectedTimingRevision,expectedTimingFingerprint,...envelope}=input;
          return {...await commandInQueue(envelope),timingProfile:{revision:profile.settings.revision,fingerprint:profile.fingerprint}};
        }):await command(input);
        const conflict=response.errors?.some(e=>/REVISION|CONFLICT/.test(e.code));
        return json(res,response.status==='error'?(conflict?409:422):200,response);
      }
      if(req.method==='POST'&&(route==='/api/import/wav'||route==='/api/import/aiff'||route==='/api/import/midi')) {
        const mime=req.headers['content-type']?.split(';')[0];
        if(!['application/octet-stream','audio/wav','audio/x-wav','audio/wave','audio/aiff','audio/x-aiff','audio/midi','audio/mid','audio/x-midi'].includes(mime)) throw problem('CONTENT_TYPE','Send binary WAV, AIFF or MIDI data',415);
        const expectedRevision=url.searchParams.has('expectedRevision')?Number(url.searchParams.get('expectedRevision')):undefined;
        ensureRevision(expectedRevision);
        const importStartSample=url.searchParams.has('atSample')?Number(url.searchParams.get('atSample')):0;
        if(!Number.isSafeInteger(importStartSample)||importStartSample<0||route.endsWith('/midi')&&url.searchParams.has('atSample'))throw problem('INVALID_IMPORT_POSITION','Use a nonnegative project sample position for WAV',422);
        const midiTempo=url.searchParams.get('midiTempo')??'auto',midiSignature=url.searchParams.get('midiSignature')??'preserve',midiMarkers=url.searchParams.get('midiMarkers')??'1',midiExtractPatch=url.searchParams.get('midiExtractPatch')??'0',midiExtractVolumePan=url.searchParams.get('midiExtractVolumePan')??'0',midiAutoDissolve=url.searchParams.get('midiAutoDissolve')??'0',midiPosition=url.searchParams.get('midiPosition')??'start',midiSinglePart=url.searchParams.get('midiSinglePart')??'0';
        if(['midiTempo','midiSignature','midiMarkers','midiExtractPatch','midiExtractVolumePan','midiAutoDissolve','midiPosition','midiSinglePart'].some(key=>url.searchParams.getAll(key).length>1)||!['start','leftLocator'].includes(midiPosition)||!['auto','preserve','replace'].includes(midiTempo)||!['preserve','initial'].includes(midiSignature)||![midiMarkers,midiExtractPatch,midiExtractVolumePan,midiAutoDissolve,midiSinglePart].every(v=>['0','1'].includes(v))||!route.endsWith('/midi')&&['midiTempo','midiSignature','midiMarkers','midiExtractPatch','midiExtractVolumePan','midiAutoDissolve','midiPosition','midiSinglePart'].some(key=>url.searchParams.has(key)))throw problem('INVALID_MIDI_IMPORT_OPTIONS','Use MIDI tempo auto/preserve/replace, signature preserve/initial and markers0/1 for MIDI import only',422);
        if(midiSinglePart==='1'&&midiAutoDissolve==='1')throw problem('CONFLICTING_MIDI_IMPORT_OPTIONS','Choose single part or channel auto dissolve, not both',422);
        const name=path.basename(url.searchParams.get('name')||'Imported').slice(0,120)||'Imported';
        const bytes=await body(req,route.endsWith('/midi')?MAX_MIDI_FILE_BYTES:MAX_WAV_FILE_BYTES);
        const imported=await runExclusive(async()=>{
        // A file import and its project commit share the document-switch queue.
        const project=engine.project;
        if(project.revision!==expectedRevision) throw problem('REVISION_CONFLICT',`Expected ${expectedRevision}, current ${project.revision}`,409);
        const commands=[],warnings=[];let midiImportReport=null;
        if(route.endsWith('/wav')||route.endsWith('/aiff')) {
          const requestedTrackId=url.searchParams.get('trackId');
          if(requestedTrackId&&!project.tracks.some(t=>t.id===requestedTrackId&&t.type==='audio'))throw problem('INVALID_RECORDING_TRACK','Choose an existing audio track',422);
          const isAiff=route.endsWith('/aiff');let decoded,assetBytes=bytes;
          try{decoded=isAiff?decodeAiff(bytes):decodeWav(bytes);}catch(e){throw problem(isAiff?'UNSUPPORTED_AIFF':'UNSUPPORTED_WAV',e.message,422);}
          if(isAiff){
            if(decoded.channels.length>2)throw problem('UNSUPPORTED_CHANNELS','AIFF import supports mono/stereo without downmix',422);
            if(decoded.frames*decoded.channels.length*4+56>MAX_WAV_FILE_BYTES)throw problem('CONVERTED_ASSET_TOO_LARGE','Decoded AIFF needs more than the managed 128 MiB WAV limit',422);
            assetBytes=encodeWav({...decoded,sampleFormat:'float32'});
            warnings.push('AIFF/AIFC sample values are stored in managed float32 WAV. The original container, including non-audio chunks, is retained separately in the project source archive and included by project collection/bundle.');
          }
          if(decoded.channels.length>2)throw problem('UNSUPPORTED_CHANNELS','This version imports mono or stereo WAV only; multichannel layouts are not downmixed',422);
          const sha256=createHash('sha256').update(assetBytes).digest('hex');
          let asset=project.assets.find(a=>a.sha256===sha256);
          if(!asset) {
            asset={id:`asset-${randomUUID()}`,name,path:`assets/${sha256}.wav`,sha256,sampleRate:decoded.sampleRate,channels:decoded.channels.length,frames:decoded.frames};
            const storedPath=path.join(directory,asset.path);let existed=false;
            try{await fs.lstat(storedPath);existed=true;}catch(error){if(error.code!=='ENOENT')throw error;}
            if(existed)await readVerifiedAsset(directory,asset);else{await atomicWrite(storedPath,assetBytes,{noClobber:true});warnings.push(...await recordCreated([asset]));}
            commands.push({command:'asset.add',arguments:{asset}});
          }
          if(isAiff){
            const sourceHash=createHash('sha256').update(bytes).digest('hex');
            if(!(project.sourceArchives??[]).some(a=>a.sha256===sourceHash)){
              const archive={id:`source-${randomUUID()}`,name,path:`sources/${sourceHash}.${decoded.container==='AIFC'?'aifc':'aiff'}`,sha256:sourceHash,bytes:bytes.length,convertedAssetSha256:asset.sha256};
              await restoreSourceArchive(directory,archive,bytes);commands.push({command:'sourceArchive.add',arguments:{archive}});
            }
          }
          const trackId=requestedTrackId||`track-${randomUUID()}`;
          if(!requestedTrackId)commands.push({command:'track.add',arguments:{id:trackId,name,type:'audio',color:'#f7b267'}});
          commands.push({command:'clip.add',arguments:{trackId,type:'audio',name,assetId:asset.id,startSample:importStartSample,offsetFrames:0,lengthFrames:asset.frames,gainDb:0}});
        } else {
          const midiStartTick=midiPosition==='leftLocator'?project.locators?.startTick:0;if(!Number.isSafeInteger(midiStartTick)||midiStartTick<0)throw problem('INVALID_LOCATORS','Set project locators before importing to the left locator',422);
          let imported; try { imported=parseMidi(bytes,{ppq:project.ppq,extractMarkers:true,extractSignatures:true}); } catch(e) { throw problem('UNSUPPORTED_MIDI',e.message,422); }
          warnings.push(...(imported.warnings??[]));
          const canApplyTempo=imported.sourceTempoEventCount>0&&(midiTempo==='replace'||midiTempo==='auto'&&project.tracks.length===0),canApplySignature=midiSignature==='initial'&&imported.timeSignatures?.some(s=>s.tick===0&&s.numerator>=1&&s.denominator!==null);
          if(!imported.tracks.length&&!imported.markers?.length&&!canApplyTempo&&!canApplySignature)throw problem('EMPTY_MIDI','MIDI contains no selected importable notes, markers, tempo or initial signature',422);
          warnings.push('MIDI channel, SysEx and stored metadata events are preserved for editing/export. The built-in oscillator plays sustain, volume/expression, pan, sostenuto and pitch bend with RPN 0 sensitivity; program changes, pressure, SysEx and unsupported controllers remain preservation-only. Each track has an independent instrument endpoint.');
          const applyImportedTempo=(midiTempo==='replace'||midiTempo==='auto'&&project.tracks.length===0)&&imported.tempoMap.length>0;
          const tempoTrackActivated=Boolean(applyImportedTempo&&canApplyTempo&&project.tempoTrackEnabled===false);
          if(applyImportedTempo){
            if(tempoTrackActivated){commands.push({command:'tempo.mode',arguments:{enabled:true}});warnings.push('Imported tempo events activate Tempo Track mode; Undo restores the previous fixed tempo and retained map.');}
            commands.push({command:'tempo.set',arguments:{tempoMap:midiStartTick?[...project.tempoMap.filter(p=>p.tick<midiStartTick),...imported.tempoMap.map(p=>({...p,tick:p.tick+midiStartTick}))]:imported.tempoMap}});
          }
          else if(imported.tempoMap.length)warnings.push('Existing project tempo was preserved; MIDI notes were placed in musical ticks.');
          const initialSignature=(imported.timeSignatures??[]).filter(s=>s.tick===0).at(-1);
          if(midiSignature==='initial'&&initialSignature){if(initialSignature.numerator>=1&&initialSignature.denominator!==null)commands.push({command:'signature.set',arguments:{numerator:initialSignature.numerator,denominator:initialSignature.denominator}});else warnings.push('Initial MIDI signature is unsupported by the fixed project meter; existing signature retained.');}
          else if(imported.timeSignatures?.length)warnings.push('Existing project time signature preserved.');
          if(imported.timeSignatures?.some(s=>s.tick>0))warnings.push('Later MIDI time-signature changes are not applied or stored in the project; retain the original MIDI file. Signature events are listed in this import report.');
          midiImportReport={insertionTick:midiStartTick,tempoTrackActivated,tempoMode:midiTempo,signatureMode:midiSignature,includeMarkers:midiMarkers==='1',sourceTimeSignatures:imported.timeSignatures??[],inspectorExtractions:[]};
          if(midiMarkers==='1')for(const marker of imported.markers??[])commands.push({command:'marker.add',arguments:{...marker,tick:marker.tick+midiStartTick}});
          if(midiMarkers==='1'&&imported.markers?.length)warnings.push('SMF markers are imported into the single project marker collection; original marker-track assignment and cycle ends cannot be recovered.');
          const partitions=midiAutoDissolve==='1'&&imported.sourceFormat===0?imported.tracks.map(splitImportedMidiChannels):null,merged=midiSinglePart==='1'?mergeImportedMidiTracks(imported.tracks,name):null,importTracks=midiSinglePart==='1'?(merged?[merged]:[]):partitions?partitions.flatMap(p=>p.tracks):imported.tracks;
          Object.assign(midiImportReport,{sourceFormat:imported.sourceFormat,singlePart:midiSinglePart==='1',mergedSourceTracks:merged?imported.tracks.map(t=>t.name):[],autoDissolveRequested:midiAutoDissolve==='1',autoDissolveApplied:Boolean(partitions),channelPartitions:partitions?.map(p=>p.report)??[]});
          if(merged&&imported.tracks.length>1)warnings.push('Single-part import combines instrument endpoints; same-channel controllers from different source tracks can interact. Source-track priority resolves same-tick ties.');
          if(partitions?.some(p=>p.report.commonEvents))warnings.push('Format-0 SysEx/meta events use a separate Common track; review external endpoint routing.');
          for(const originalTrack of importTracks) {
            const extraction=extractMidiInspector(originalTrack,{patch:midiExtractPatch==='1',volumePan:midiExtractVolumePan==='1'}),track=extraction.track;
            if(!track.notes.length&&!track.events?.length&&!extraction.settings)continue;
            const trackId=`track-${randomUUID()}`;
            commands.push({command:'track.add',arguments:{id:trackId,name:track.name||name,type:'midi',color:'#a3f0bf',instrument:'triangle'}});
            if(extraction.settings)commands.push({command:'midi.trackParameters.set',arguments:{trackId,settings:extraction.settings}});
            if(extraction.report.extracted.length||extraction.report.skipped.length){midiImportReport.inspectorExtractions.push({trackId,trackName:track.name,insertionTick:midiStartTick,setupAtProjectTick:0,...extraction.report});if(extraction.settings&&midiStartTick>0)warnings.push('Inspector setup uses project tick zero even when the imported part starts at the left locator; review shared-channel routing.');if(extraction.report.movesToTickZero)warnings.push('Extracted first Inspector settings moved to tick zero; source events are listed in the import report.');if(extraction.report.skipped.length)warnings.push('Some first Inspector settings used a different channel and remain in the imported part.');}
            const end=track.notes.reduce((maximum,n)=>Math.max(maximum,n.startTick+Math.max(1,n.durationTicks)),track.endTick??0);
            commands.push({command:'clip.add',arguments:{trackId,type:'midi',name:track.name||name,startTick:midiStartTick,lengthTicks:Math.max(project.ppq*4,Math.ceil(end/(project.ppq*4))*project.ppq*4),notes:track.notes,...(track.events?.length?{events:track.events}:{})}});
          }
          if(!commands.length)throw problem('EMPTY_MIDI','MIDI contains no importable notes or stored events',422);
        }
        const response=await commandInQueue({command:'batch',arguments:{commands},expectedRevision},{internal:true,preserveAudioUnits:route.endsWith('/wav')&&url.searchParams.get('audioUnitOutput')==='1'});
        return {...response,warnings,...(midiImportReport?{midiImportReport}:{})};
        });
        const conflict=imported.errors?.some(error=>/REVISION|CONFLICT/.test(error.code));
        return json(res,imported.status==='error'?(conflict?409:422):200,imported);
      }
      if(req.method==='POST'&&route==='/api/audio/restore-processing'){
        const input=await jsonBody(req);if(!input||Object.keys(input).some(k=>!['clipId','expectedRevision','dryRun'].includes(k))||typeof input.clipId!=='string'||input.dryRun!==undefined&&typeof input.dryRun!=='boolean')throw problem('INVALID_PROCESSING_RESTORE','Use clipId, expectedRevision and optional dryRun',422);
        return json(res,200,await runExclusive(async()=>{assertRequestDocument();nativeRevision(input.expectedRevision);const clip=engine.project.clips.find(c=>c.id===input.clipId);if(clip?.type!=='audio')throw problem('INVALID_PROCESSING_RESTORE','Select an audio event',422);const asset=engine.project.assets.find(a=>a.id===clip.assetId),record=readAudioProcessingProvenance(await assetBytes(asset));if(!record)throw problem('NO_PROCESSING_SOURCE','This WAV has no newdaw processing source',422);const source=engine.project.assets.find(a=>a.sha256===record.sourceAsset.sha256);if(!source)throw problem('PROCESSING_SOURCE_MISSING','Original asset is not registered in this project',422);await assetBytes(source);assertRequestDocument();nativeRevision(input.expectedRevision);return commandInQueue({command:'audio.clip.restoreProcessing',arguments:{clipId:clip.id,snapshot:{...record.sourceClip,assetId:source.id}},expectedRevision:input.expectedRevision,dryRun:input.dryRun??false});}));
      }
      if(req.method==='POST'&&route==='/api/audio/processing'){
        const input=await jsonBody(req);if(!input||Object.keys(input).some(k=>!['clipId','expectedRevision'].includes(k))||typeof input.clipId!=='string')throw problem('INVALID_PROCESSING_QUERY','Use clipId and expectedRevision',422);assertRequestDocument();nativeRevision(input.expectedRevision);const clip=engine.project.clips.find(c=>c.id===input.clipId);if(clip?.type!=='audio')throw problem('INVALID_PROCESSING_QUERY','Select an audio event',422);const asset=engine.project.assets.find(a=>a.id===clip.assetId),record=readAudioProcessingProvenance(await assetBytes(asset));assertRequestDocument();nativeRevision(input.expectedRevision);return json(res,200,{clipId:clip.id,revision:input.expectedRevision,assetId:asset.id,assetSha256:asset.sha256,processing:record});
      }
      if(req.method==='POST'&&['/api/audio/time-stretch','/api/audio/time-stretch-batch'].includes(route)){
        const input=await jsonBody(req),batch=route.endsWith('-batch');if(!input||Object.keys(input).some(k=>!(batch?['clips','expectedRevision','dryRun']:['clipId','targetFrames','startSample','expectedRevision','dryRun']).includes(k))||input.dryRun!==undefined&&typeof input.dryRun!=='boolean')throw problem('INVALID_TIME_STRETCH','Invalid time stretch request',422);
        assertRequestDocument();nativeRevision(input.expectedRevision);const snapshot=engine.project,sourceDirectory=directory,plans=batch?input.clips:[{clipId:input.clipId,targetFrames:input.targetFrames,...(input.startSample!==undefined?{startSample:input.startSample}:{})}],abort=new AbortController(),cancel=()=>{if(!res.writableEnded)abort.abort();};res.on('close',cancel);
        try{const prepared=await prepareTimeStretchBatch(snapshot,plans,asset=>readVerifiedAsset(sourceDirectory,asset),{signal:abort.signal});const result=await runExclusive(async()=>{assertRequestDocument();nativeRevision(input.expectedRevision);if(abort.signal.aborted)throw problem('STRETCH_CANCELLED','Time stretch cancelled',409);const envelope={command:'batch',arguments:{commands:prepared.commands},expectedRevision:input.expectedRevision},preview=await commandInQueue({...envelope,dryRun:true},{internal:true}),report=batch?{results:prepared.results}:{...prepared.results[0]};if(preview.status==='error'||input.dryRun)return {...preview,...report,mediaWritten:false};
          const written=[];try{for(const variant of prepared.variants){const storedPath=path.join(directory,variant.asset.path);try{await fs.lstat(storedPath);await readVerifiedAsset(directory,variant.asset);}catch(error){if(error.code!=='ENOENT')throw error;await atomicWrite(storedPath,variant.bytes,{noClobber:true});written.push(variant.asset);}}if(abort.signal.aborted)throw problem('STRETCH_CANCELLED','Time stretch cancelled',409);const committed=await commandInQueue(envelope,{internal:true});if(!committed.applied)throw problem('STRETCH_COMMIT_FAILED','Processed clips were not committed',422);return {...committed,...report,mediaWritten:written.length>0,warnings:await recordCreated(written)};}
          catch(error){for(const asset of written)try{const disk=JSON.parse(await fs.readFile(projectPath,'utf8'));if(!engine.project.assets.some(a=>a.sha256===asset.sha256)&&!disk.assets?.some(a=>a.sha256===asset.sha256))await fs.unlink(path.join(directory,asset.path));}catch{}throw error;}
        });return json(res,result.status==='error'?422:200,result);}finally{res.off('close',cancel);}
      }
      if(req.method==='POST'&&route==='/api/audio/zero-crossing'){
        const input=await jsonBody(req);if(!input||Object.keys(input).some(k=>!['clipId','atSample','edge','searchMs','expectedRevision'].includes(k))||input.edge!==undefined&&!['left','right'].includes(input.edge)||typeof input.clipId!=='string'||!Number.isSafeInteger(input.atSample)||input.atSample<0||input.searchMs!==undefined&&(!Number.isFinite(input.searchMs)||input.searchMs<0||input.searchMs>100))throw problem('INVALID_ZERO_CROSSING','Use clipId, atSample, expectedRevision and optional searchMs 0..100',422);
        assertRequestDocument();nativeRevision(input.expectedRevision);const clip=engine.project.clips.find(c=>c.id===input.clipId);if(clip?.type!=='audio')throw problem('INVALID_ZERO_CROSSING','Select an audio event',422);const asset=engine.project.assets.find(a=>a.id===clip.assetId),source=decodeWav(await assetBytes(asset));assertRequestDocument();nativeRevision(input.expectedRevision);
        const result=findAudioZeroCrossing(source,clip,{atSample:input.atSample,searchMs:input.searchMs,edge:input.edge,projectSampleRate:engine.project.sampleRate});return json(res,200,{...result,clipId:clip.id,revision:input.expectedRevision,assetSha256:asset.sha256});
      }
      if(req.method==='POST'&&route==='/api/audio/statistics'){
        const input=await jsonBody(req);if(!input||Object.keys(input).some(k=>!['clipId','expectedRevision','mode'].includes(k))||typeof input.clipId!=='string'||input.mode!==undefined&&!['raw','event'].includes(input.mode))throw problem('INVALID_STATISTICS','Use clipId, expectedRevision and optional mode raw/event',422);
        assertRequestDocument();nativeRevision(input.expectedRevision);
        const clip=engine.project.clips.find(c=>c.id===input.clipId);if(clip?.type!=='audio')throw problem('INVALID_STATISTICS','Select an audio clip',422);
        const asset=engine.project.assets.find(a=>a.id===clip.assetId),source=decodeWav(await assetBytes(asset));assertRequestDocument();nativeRevision(input.expectedRevision);
        const result=await analyzeAudioSamples(source,clip,input.mode??'event');
        assertRequestDocument();nativeRevision(input.expectedRevision);return json(res,200,{clipId:clip.id,revision:input.expectedRevision,assetSha256:asset.sha256,statistics:result});
      }
      if(req.method==='POST'&&route==='/api/audio/remove-dc'){
        const input=await jsonBody(req);if(!input||Object.keys(input).some(k=>!['clipId','expectedRevision','dryRun'].includes(k))||typeof input.clipId!=='string'||input.dryRun!==undefined&&typeof input.dryRun!=='boolean')throw problem('INVALID_DC_OFFSET','Use clipId, expectedRevision and optional dryRun',422);
        return json(res,200,await runExclusive(async()=>{
          assertRequestDocument();nativeRevision(input.expectedRevision);const clip=engine.project.clips.find(c=>c.id===input.clipId);if(clip?.type!=='audio')throw problem('INVALID_DC_OFFSET','Select an audio clip',422);
          const asset=engine.project.assets.find(a=>a.id===clip.assetId),source=decodeWav(await assetBytes(asset)),analysis=await analyzeAudioSamples(source,clip,'raw');
          assertRequestDocument();nativeRevision(input.expectedRevision);const dcOffsets=analysis.channels.map(c=>c.dcOffset);
          return {...await commandInQueue({command:'clip.update',arguments:{clipId:clip.id,dcOffsets},expectedRevision:input.expectedRevision,dryRun:input.dryRun??false}),analysis:{dcOffsets,scope:'selected source trim per channel before event gain/fades; source files unchanged'}};
        }));
      }
      if(req.method==='POST'&&route==='/api/audio/normalize'){
        const input=await jsonBody(req);
        if(!input||Object.keys(input).some(k=>!['clipId','expectedRevision','targetDb','dryRun'].includes(k))||typeof input.clipId!=='string'||input.dryRun!==undefined&&typeof input.dryRun!=='boolean')throw problem('INVALID_NORMALIZE','Invalid normalize request',422);
        const target=input.targetDb??-1;if(!Number.isFinite(target)||target< -60||target>0)throw problem('INVALID_NORMALIZE','Target must be -60..0 dBFS',422);
        return json(res,200,await runExclusive(async()=>{
          assertRequestDocument();nativeRevision(input.expectedRevision);
          const clip=engine.project.clips.find(c=>c.id===input.clipId);if(clip?.type!=='audio')throw problem('INVALID_NORMALIZE','Select an audio clip',422);
          const asset=engine.project.assets.find(a=>a.id===clip.assetId),decoded=decodeWav(await assetBytes(asset)),peak=audioClipPeak(decoded,clip);
          assertRequestDocument();nativeRevision(input.expectedRevision);
          if(!peak)return {applied:false,status:'unchanged',reason:'Audio is silent',peak:0};
          const gainDb=target-20*Math.log10(peak);if(gainDb< -60||gainDb>12)throw problem('NORMALIZE_GAIN_LIMIT','Required clip gain is outside -60..+12 dB; choose a different target',422);
          return {...await commandInQueue({command:'clip.update',arguments:{clipId:clip.id,gainDb},expectedRevision:input.expectedRevision,dryRun:input.dryRun??false}),analysis:{sourcePeak:peak,targetDb:target,gainDb,measurement:'source-sample peak after fades; not true peak'}};
        }));
      }
      const waveform=route.match(/^\/api\/assets\/([^/]+)\/waveform$/);
      if(req.method==='GET'&&waveform) {
        const asset=engine.project.assets.find(a=>a.id===decodeURIComponent(waveform[1]));
        if(!asset)throw problem('ASSET_NOT_FOUND','Asset not found',404);
        if(!waveforms.has(asset.sha256)) {
          const decoded=decodeWav(await assetBytes(asset)), bins=Math.min(256,decoded.frames),peaks=[];
          for(let b=0;b<bins;b++){let peak=0;const start=Math.floor(b*decoded.frames/bins),end=Math.floor((b+1)*decoded.frames/bins);for(const channel of decoded.channels)for(let f=start;f<end;f++)peak=Math.max(peak,Math.abs(channel[f]));peaks.push(peak);}
          waveforms.set(asset.sha256,{peaks,frames:decoded.frames,sampleRate:decoded.sampleRate});
        }
        return json(res,200,waveforms.get(asset.sha256));
      }
      if(req.method==='GET'&&route==='/api/export/midi') {
        if([...url.searchParams.keys()].some(key=>!['format','trackId','expectedRevision','ppq','range','chase','patch','volumePan','modifiers','markers','delay'].includes(key))||url.searchParams.getAll('format').length>1||url.searchParams.has('format')&&!['0','1'].includes(url.searchParams.get('format')))throw problem('INVALID_MIDI_FORMAT','format must be 0 or 1; optional repeated trackId and expectedRevision',422);
        assertRequestDocument();
        if(url.searchParams.has('expectedRevision')){const revisions=url.searchParams.getAll('expectedRevision'),raw=revisions[0];if(revisions.length!==1||!/^\d+$/.test(raw)||!Number.isSafeInteger(Number(raw)))throw problem('INVALID_REVISION','expectedRevision must be one safe nonnegative integer',422);if(Number(raw)!==engine.project.revision)throw problem('REVISION_CONFLICT','Project changed before MIDI export',409);}
        const trackIds=url.searchParams.has('trackId')?url.searchParams.getAll('trackId'):undefined;if(trackIds&&trackIds.length>4096)throw problem('COPY_LIMIT','Select at most 4096 MIDI tracks',422);
        let outputPpq;if(url.searchParams.has('ppq')){const values=url.searchParams.getAll('ppq');if(values.length!==1||!/^\d+$/.test(values[0])||Number(values[0])<24||Number(values[0])>960)throw problem('INVALID_MIDI_PPQ','ppq must be one integer from 24 to 960',422);outputPpq=Number(values[0]);}
        let range;if(url.searchParams.has('range')){if(url.searchParams.getAll('range').length!==1||url.searchParams.get('range')!=='locators')throw problem('INVALID_LOCATORS','range must be locators',422);range=engine.project.locators;if(!range)throw problem('INVALID_LOCATORS','Set project locators before MIDI export',422);}
        if(url.searchParams.has('chase')&&(!range||url.searchParams.getAll('chase').length!==1||!['0','1'].includes(url.searchParams.get('chase'))))throw problem('INVALID_CHASE','chase requires locator range and 0 or 1',422);
        const exportOptions={};for(const [key,field]of Object.entries({patch:'includeInspectorPatch',volumePan:'includeInspectorVolumePan',modifiers:'includeModifiers',markers:'includeMarkers',delay:'includeDelay'}))if(url.searchParams.has(key)){const values=url.searchParams.getAll(key);if(values.length!==1||!['0','1'].includes(values[0]))throw problem('INVALID_MIDI_EXPORT_OPTIONS',`${key} must be 0 or 1`,422);exportOptions[field]=values[0]==='1';}
        const format=Number(url.searchParams.get('format')??1),revision=engine.project.revision,exported=writeMidiDetailed(engine.project,{...exportOptions,format,trackIds,outputPpq,range,includeChase:url.searchParams.get('chase')!=='0'}),bytes=exported.bytes;
        res.writeHead(200,{'Content-Type':'audio/midi','Content-Disposition':'attachment; filename="session.mid"','X-NewDAW-Revision':String(revision),'X-NewDAW-MIDI-Track-Count':String(trackIds?.length??engine.project.tracks.filter(t=>t.type==='midi').length),'X-NewDAW-MIDI-Format':String(format),'X-NewDAW-MIDI-PPQ':String(exported.timingResolution.outputPpq),'X-NewDAW-MIDI-Options':JSON.stringify(exported.exportOptions),'X-NewDAW-Loss-Report':`Notes, release velocity and stored channel/SysEx/meta events are exported with project tempo, markers and fixed signature. ${trackIds?'Only explicitly selected MIDI tracks included. ':''}Audio, instruments, mixer and mute/solo are not represented.${format===0?' Format 0 merges tracks; individual track names and grouping are not retained.':''}${exported.warnings.length?' '+exported.warnings.join(' '):''}`});return res.end(bytes);
      }
      if(req.method==='GET'&&route==='/api/project') {
        res.writeHead(200,{'Content-Type':'application/json','Content-Disposition':'attachment; filename="session.newdaw.json"'}); return res.end(JSON.stringify(engine.project,null,2));
      }
      if(req.method==='POST'&&route==='/api/render') {
        let options=await jsonBody(req);assertRequestDocument();
        if(!options||typeof options!=='object'||Array.isArray(options))throw problem('INVALID_OPTIONS','Render options must be an object',422);
        ensureRevision(options.expectedRevision);
        if(closed)throw problem('SESSION_CLOSING','Session is closing',503);
        if(options.expectedRevision!==engine.project.revision)throw problem('REVISION_CONFLICT','Project changed before render started',409);
        for(const key of Object.keys(options))if(!['autoEffectTail','fileFormat','exportPresetId','dither','ditherSeed','stemSplitChannels','outputSampleRate','stemMixdown','cycleMarkerIds','stemBatch','bypassTrackEffects','clipIds','trackIds','channelMode','sampleFormat','expectedRevision','durationSeconds','tailSeconds','startTick','chaseOptions','expectedChaseRevision','expectedChaseFingerprint','expectedTimingRevision','expectedTimingFingerprint','preview'].includes(key))throw problem('INVALID_OPTION',`Unknown render option: ${key}`,422);
        try{options=resolveExportPresetOptions(engine.project,options);}catch(error){throw problem(error.code,error.message,422);}
        try{selectRenderTracks(engine.project,options.trackIds);}catch(error){throw problem(error.code,error.message,422);}
        if(options.clipIds!==undefined&&options.preview!==true)throw problem('INVALID_RENDER_CLIPS','Clip selection currently requires preview:true',422);
        try{selectRenderClips(engine.project,options.clipIds);}catch(error){throw problem(error.code,error.message,422);}
        if(options.bypassTrackEffects!==undefined&&options.preview!==true)throw problem('INVALID_EFFECT_BYPASS','Effect bypass currently requires preview:true',422);
        try{bypassRenderEffects(engine.project,options.bypassTrackEffects);}catch(error){throw problem(error.code,error.message,422);}
        if(options.outputSampleRate!==undefined&&(!Number.isSafeInteger(options.outputSampleRate)||options.outputSampleRate<8000||options.outputSampleRate>96000))throw problem('INVALID_OUTPUT_SAMPLE_RATE','Output sample rate must be 8000..96000 Hz',422);
        if(options.dither!==undefined&&!['none','tpdf'].includes(options.dither)||options.dither==='tpdf'&&options.sampleFormat==='float32')throw problem('INVALID_DITHER','TPDF is available only for integer PCM',422);
        if(options.ditherSeed!==undefined&&(!Number.isSafeInteger(options.ditherSeed)||options.ditherSeed<1||options.ditherSeed>0xffffffff))throw problem('INVALID_DITHER_SEED','Use a seed from 1..4294967295',422);
        if(options.channelMode!==undefined&&!CAPABILITIES.wavExportChannelModes.includes(options.channelMode))throw problem('INVALID_CHANNEL_MODE','channelMode must be stereo, mono, left or right',422);
        if(options.fileFormat!==undefined&&!['wav','aiff'].includes(options.fileFormat)||options.fileFormat==='aiff'&&options.sampleFormat==='float32')throw problem('INVALID_FILE_FORMAT','AIFF supports PCM16/24; WAV also supports float32',422);
        if(options.sampleFormat!==undefined&&!CAPABILITIES.wavExportFormats.includes(options.sampleFormat))throw problem('INVALID_WAV_FORMAT','sampleFormat must be pcm16, pcm24 or float32',422);
        if(options.durationSeconds!==undefined&&(!Number.isFinite(options.durationSeconds)||options.durationSeconds<=0||options.durationSeconds>MAX_RENDER_SECONDS))throw problem('INVALID_DURATION',`durationSeconds must be >0 and <=${MAX_RENDER_SECONDS}`,422);
        if(options.autoEffectTail!==undefined&&typeof options.autoEffectTail!=='boolean')throw problem('INVALID_EFFECT_TAIL','autoEffectTail must be boolean',422);
        if(options.tailSeconds!==undefined&&(!Number.isFinite(options.tailSeconds)||options.tailSeconds<0||options.tailSeconds>10))throw problem('INVALID_TAIL','tailSeconds must be 0..10',422);
        if(options.stemSplitChannels!==undefined&&(typeof options.stemSplitChannels!=='boolean'||options.stemSplitChannels&&!options.stemBatch))throw problem('INVALID_SPLIT_CHANNELS','stemSplitChannels requires stemBatch',422);
        if(options.stemMixdown!==undefined&&(typeof options.stemMixdown!=='boolean'||!options.stemBatch))throw problem('INVALID_MIX_BATCH','stemMixdown requires stemBatch',422);
        if(options.cycleMarkerIds!==undefined&&!options.stemBatch)throw problem('INVALID_CYCLE_EXPORT','Cycle marker ranges require stemBatch',422);
        if(options.stemBatch!==undefined&&typeof options.stemBatch!=='boolean')throw problem('INVALID_STEM_BATCH','stemBatch must be boolean',422);
        if(options.stemBatch&&options.preview)throw problem('INVALID_STEM_BATCH','Stem export cannot be preview playback',422);
        if(options.preview!==undefined&&typeof options.preview!=='boolean')throw problem('INVALID_PREVIEW','preview must be boolean',422);
        if(options.preview){const profile=await nativeSettings();if(profile.config.mode!=='preview'||['preparing','playing','stopping','resetting'].includes(nativeTransport.snapshot().status))throw problem('NATIVE_PREVIEW_CONFLICT','Native MIDI mode owns playback; select preview mode first',409);}
        const timingProfile=await getTimingSettings(timingSettingsPath);
        if((options.expectedTimingRevision!==undefined||options.expectedTimingFingerprint!==undefined)&&(options.expectedTimingRevision!==timingProfile.settings.revision||options.expectedTimingFingerprint!==timingProfile.fingerprint))throw problem('TIMING_SETTINGS_CONFLICT','MIDI timing settings changed before render',409);
        options.timingOptions=timingProfile.settings.options;
        let chaseProfile=null;
        if(options.startTick!==undefined||options.cycleMarkerIds!==undefined){
          if(options.startTick!==undefined&&(!Number.isSafeInteger(options.startTick)||options.startTick<0))throw problem('INVALID_START_TICK','startTick must be a nonnegative integer',422);
          chaseProfile=await getChaseSettings(chaseSettingsPath);
          if(options.expectedChaseRevision!==undefined||options.expectedChaseFingerprint!==undefined){
            if(options.expectedChaseRevision!==chaseProfile.settings.revision||options.expectedChaseFingerprint!==chaseProfile.fingerprint)throw problem('CHASE_SETTINGS_CONFLICT','Chase settings changed before playback render started',409);
          }
          try{if(options.chaseOptions!==undefined)resolveChaseOptions(options.chaseOptions);options.chaseOptions=resolveChaseOptions({...chaseProfile.settings.options,...options.chaseOptions});}catch(error){throw problem(error.code,error.message,422);}
          assertRequestDocument();ensureRevision(options.expectedRevision);
          if(options.expectedRevision!==engine.project.revision)throw problem('REVISION_CONFLICT','Project changed while reading Chase settings',409);
        }else if(['chaseOptions','expectedChaseRevision','expectedChaseFingerprint'].some(k=>Object.hasOwn(options,k)))throw problem('CHASE_REQUIRES_START','Chase render options require startTick',422);
        assertRequestDocument();nativeRevision(options.expectedRevision);
        if([...jobs.values()].some(j=>j.status==='running'))throw problem('RENDER_BUSY','A render is already running; wait or cancel it',409);
        // Retain only a small number of buffers. Results are downloadable, not project source assets.
        while(jobs.size>=4){const oldest=jobs.keys().next().value;jobs.delete(oldest);}
        const frozen=engine.project,id=randomUUID();
        const job={id,outputKind:options.stemBatch?'stems':options.fileFormat==='aiff'?'aiff':'wav',revision:frozen.revision,mediaRevision,timingProfile:{revision:timingProfile.settings.revision,fingerprint:timingProfile.fingerprint},timingOptions:timingProfile.settings.options,...(chaseProfile?{startTick:options.startTick,chaseProfile:{revision:chaseProfile.settings.revision,fingerprint:chaseProfile.fingerprint},chaseOptions:options.chaseOptions}:{}),status:'running',createdAt:new Date().toISOString()};jobs.set(id,job);
        const {expectedRevision,expectedChaseRevision,expectedChaseFingerprint,expectedTimingRevision,expectedTimingFingerprint,preview,...renderOptions}=options;
        const worker=new Worker(new URL(options.stemBatch?'./stem-worker.mjs':'./render-worker.mjs',import.meta.url),{workerData:{...(options.stemBatch?{kind:'stemBatch'}:{}),project:frozen,projectDirectory:directory,options:renderOptions}});job.worker=worker;
        worker.once('message',result=>{if(job.status!=='running')return;if(result.error){job.status='failed';job.error=result.error;}else{job.status='completed';job.bytes=Buffer.from(result.bytes);job.stats=result.stats;}});
        worker.once('error',error=>{if(job.status==='running'){job.status='failed';job.error={code:'WORKER_FAILED',message:error.message};}});
        worker.once('exit',code=>{if(job.status==='running'){job.status='failed';job.error={code:'WORKER_EXIT',message:`Worker exited before result (${code})`};}});
        return json(res,202,publicJob(job));
      }
      const jobRoute=route.match(/^\/api\/jobs\/([a-f0-9-]+)(\/audio\.wav|\/audio\.aiff|\/stems\.zip|\/cancel)?$/);
      if(jobRoute) {
        const job=jobs.get(jobRoute[1]);if(!job)throw problem('JOB_NOT_FOUND','Render job expired or does not exist',404);
        if(req.method==='GET'&&!jobRoute[2])return json(res,200,publicJob(job));
        if(req.method==='POST'&&jobRoute[2]==='/cancel') {await jsonBody(req);if(job.status==='running'){job.status='cancelled';await job.worker.terminate();}return json(res,200,publicJob(job));}
        if(req.method==='GET'&&jobRoute[2]==='/stems.zip'){if(job.status!=='completed'||job.outputKind!=='stems')throw problem('RENDER_NOT_READY','Stem bundle is not ready',409);res.writeHead(200,{'Content-Type':'application/zip','Content-Disposition':`attachment; filename="stems-r${job.revision}.zip"`});return res.end(job.bytes);}
        if(req.method==='GET'&&jobRoute[2]==='/audio.aiff'){if(job.status!=='completed'||job.outputKind!=='aiff')throw problem('RENDER_NOT_READY','AIFF render is not ready',409);res.writeHead(200,{'Content-Type':'audio/aiff','Content-Disposition':`attachment; filename="mix-r${job.revision}.aiff"`});return res.end(job.bytes);}
        if(req.method==='GET'&&jobRoute[2]==='/audio.wav') {if(job.status!=='completed'||job.outputKind==='stems'||job.outputKind==='aiff')throw problem('RENDER_NOT_READY','Render is not complete',409);res.writeHead(200,{'Content-Type':'audio/wav','Content-Disposition':`attachment; filename="mix-r${job.revision}.wav"`});return res.end(job.bytes);}
      }
      if(req.method==='GET') {
        if(['/media/tempo-from-audio.mjs','/media/tap-tempo.mjs','/media/step-timing.mjs','/media/step-settings.mjs','/media/track-effects.mjs','/media/track-eq.mjs','/media/track-delay.mjs','/media/midi-input-filter.mjs','/media/note-paint.mjs','/media/note-shapes.mjs','/media/controller-shape-gesture.mjs','/media/controller-shapes.mjs','/media/controller-paint.mjs','/media/controller-time-gesture.mjs','/media/snap-grid.mjs','/media/pointer-time-grid.mjs','/media/exact-tempo.mjs','/media/time-edit-resolver.mjs','/media/ruler-intervals.mjs','/media/editor-geometry.mjs','/media/timeline-projection.mjs','/media/time-display.mjs','/media/timecode.mjs','/media/elapsed-time.mjs','/media/display-time-edit.mjs','/media/musical-time.mjs','/media/midi-display-time.mjs','/media/midi-chase.mjs','/media/controller-bend.mjs','/media/midi-modifiers.mjs','/media/common.mjs','/media/time.mjs','/media/midi-curves.mjs','/media/midi-controllers-query.mjs','/media/controller-readout.mjs'].includes(route)){const content=await fs.readFile(path.join(ROOT,'src',route));res.writeHead(200,{'Content-Type':'text/javascript'});return res.end(content);}
        const files={'/tap-tempo-ui.mjs':'tap-tempo-ui.mjs','/audio-scrub.mjs':'audio-scrub.mjs','/web-midi-input.mjs':'web-midi-input.mjs','/metronome.mjs':'metronome.mjs','/microphone-recorder.mjs':'microphone-recorder.mjs','/recording-ui.mjs':'recording-ui.mjs','/note-keyboard-selection.mjs':'note-keyboard-selection.mjs','/note-clipboard.mjs':'note-clipboard.mjs','/note-velocity-readout.mjs':'note-velocity-readout.mjs','/note-audition-targets.mjs':'note-audition-targets.mjs','/note-audition.mjs':'note-audition.mjs','/note-audition-browser.mjs':'note-audition-browser.mjs','/snap-grid-settings.mjs':'snap-grid-settings.mjs','/time-display-settings.mjs':'time-display-settings.mjs','/inspector-time.mjs':'inspector-time.mjs','/':'index.html','/index.html':'index.html','/app.mjs':'app.mjs','/editing.mjs':'editing.mjs','/midi-events.mjs':'midi-events.mjs','/controller-lanes.mjs':'controller-lanes.mjs','/musical-time-display.mjs':'musical-time-display.mjs','/timing-settings.mjs':'timing-settings.mjs','/reset-settings.mjs':'reset-settings.mjs','/chase-settings.mjs':'chase-settings.mjs','/native-midi.mjs':'native-midi.mjs','/native-audio.mjs':'native-audio.mjs','/audio-units.mjs':'audio-units.mjs','/controller-settings.mjs':'controller-settings.mjs','/midi-modifiers.mjs':'midi-modifiers.mjs','/midi-merge.mjs':'midi-merge.mjs','/session.mjs':'session.mjs','/resolution.mjs':'resolution.mjs','/document.mjs':'document.mjs','/projects.mjs':'projects.mjs','/i18n.mjs':'i18n.mjs','/styles.css':'styles.css'};
        if(files[route]) {const content=await fs.readFile(path.join(ROOT,'public',files[route]));res.writeHead(200,{'Content-Type':route.endsWith('.mjs')?'text/javascript':route.endsWith('.css')?'text/css':'text/html; charset=utf-8'});return res.end(content);}
      }
      throw problem('NOT_FOUND','Unknown route',404);
    } catch(error) {
      if(res.destroyed)return;
      if(!res.headersSent)json(res,error.status??(req.url?.startsWith('/api/native/')?(/^(NATIVE_(PLATFORM|BUILD|TIMEOUT|PIPE|EXIT|SPAWN)|COREMIDI)/.test(error.code??'')?503:422):(req.url?.startsWith('/api/document')||req.url?.startsWith('/api/workspace'))&&['ENOENT','ENOTDIR','EACCES','EPERM','UNSAFE_PATH'].includes(error.code)?422:500),{status:'error',applied:false,errors:[{code:error.code??'INTERNAL_ERROR',message:error.message,...(error.details?{details:error.details}:{})}]});else res.end();
    }
  }));
  // Acquire lock before reading, creating, or modifying project assets.
  releaseLock=await acquireProjectLock(projectPath,`http://127.0.0.1:${port}`);
  try {
    let project;
    try { project=JSON.parse(await fs.readFile(projectPath,'utf8')); }
    catch(error) {if(error.code!=='ENOENT')throw new Error(`Cannot open project. Original kept intact; inspect ${projectPath}.bak. ${error.message}`);project=demo?await createDemoProject(directory):createProject({fixedTempo:true});await saveProject(projectPath,project);}
    engine=new Engine(project);
    const saved=await loadSessionState(projectPath,project);settings=saved.settings;persistence=saved.persistence;
    if(saved.history)engine.restoreHistory(saved.history);
    await documentSession.initialize();
    const backups=await listBackups(projectPath);backupBaselineHash=backups.lastFingerprint??canonicalProjectHash(project);
    autoBackup.lastId=backups.files[0]?.id??null;autoBackup.lastCreatedAt=backups.files[0]?.createdAt??null;
    autoBackup.nextDueAt=backupClock()+settings.autoBackup.intervalMinutes*60000;
    workspace=createWorkspace({initial:captureActive(),captureActive,fromPrepared,adopt:activateWorkspaceContext,deactivate:deactivateWorkspaceContext,saveContext,
      acceptSaved:(context,saved)=>{if(context.engine===engine&&context.projectPath===projectPath)documentSession.acceptSaved(saved);},
      reserveTarget,runExclusive,emit,isClosed:()=>closed,recentPath,draftRegistryPath});
    await workspace.locations();
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  } catch(error) {await nativeTransport.close();await nativeAudio.close();await audioUnits.close();await releaseLock();throw error;}
  const heartbeat=setInterval(()=>{for(const response of clients)response.write(': keepalive\n\n');},20000);heartbeat.unref();
  let checkingBackup=false;
  backupTimer=setInterval(()=>{
    if(closed||checkingBackup)return;
    const due=workspace.contexts().filter(c=>c.settings.autoBackup.enabled&&backupClock()>=c.autoBackup.nextDueAt);
    if(!due.length)return;
    checkingBackup=true;
    runExclusive(async()=>{for(const context of due){if(!workspace.contexts().includes(context))continue;await createContextBackup(context).catch(()=>{});}}).finally(()=>{checkingBackup=false;}).catch(()=>{});
  },backupPollMs);backupTimer.unref();
  const url=`http://127.0.0.1:${server.address().port}`;
  if(!quiet)console.log(`newdaw v${CAPABILITIES.version}  ${url}\nProject: ${projectPath}\nEvery edit is saved atomically. Ctrl+C to close.`);
  async function close(){
    if(closed)return;closed=true;clearInterval(heartbeat);clearInterval(backupTimer);
    // Stop accepting connections before draining committed work. A client may
    // keep an incomplete upload or SSE request open indefinitely; after the
    // mutation queue drains, those connections must not retain the project lock.
    const disconnected=new Promise(resolve=>server.close(resolve));
    for(const response of clients)response.end();
    await auditionJobs.close();await nativeTransport.close();await nativeAudio.close();await audioUnits.close();await resolver?.close();await queue;
    await Promise.all([...jobs.values()].filter(j=>j.status==='running').map(j=>j.worker.terminate()));
    server.closeAllConnections();await disconnected;
    if(workspace)await Promise.all(workspace.contexts().map(c=>c.releaseLock()));else await releaseLock();
  }
  return {url,get projectPath(){return projectPath;},close,server};
}
