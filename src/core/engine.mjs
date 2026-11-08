import {applyTrackFolders,validateTrackFolders} from './track-folders.mjs';
import {applyNewTrackTimeBase} from './track-time-base-default.mjs';
import {replaceEffectiveTempo,setAudioTimeBase} from './audio-time-base.mjs';
import {planTempoFromAudio} from '../media/tempo-from-audio.mjs';
import {applyMidiInputEdit} from './midi-input-edit.mjs';
import {parseEqFrequency,invertTrackEqGains} from '../media/track-eq.mjs';
import {compileMidiTake} from '../media/midi-recording.mjs';
import {editSilenceRanges} from '../media/audio-silence.mjs';
import {compileEditorSnap} from '../media/snap-grid.mjs';
import {compilePointerTimeGrid} from '../media/pointer-time-grid.mjs';
import {compileTempoMap} from '../media/time.mjs';
import {resolveSnapGrid,patchSnapGrid} from '../media/snap-grid.mjs';
import {resolveTimeDisplay} from '../media/time-display.mjs';
import {applyMerge} from './merge.mjs';
import {applyModifiers} from './modifiers.mjs';
import {validateModifierState} from '../media/midi-modifiers.mjs';
import { applyControllers, normalizeEditedCurves, normalizeInsertedCurves } from './controllers.mjs';
import { EngineError, fail, validateSchema, validateCommand, projectSchema, envelopeSchema, createOptionsSchema } from './schema.mjs';
import { applyEditing, nearestGrid, quantizeReferenceFits, invalidateOutsideQuantizeReferences } from './editing.mjs';
import { addMidiEvents, midiObjectIds, validateMidiClipEvents, validateMidiEventBudget } from './midi-events.mjs';
export { EngineError, getCommandCatalog } from './schema.mjs';

const clone = value => structuredClone(value);
const newId = kind => `${kind}-${globalThis.crypto.randomUUID()}`;

export function createProject(options = {}) {
  validateSchema(options, createOptionsSchema, '$.options');
  const project = {
    schemaVersion: 1, id: newId('project'), name: options.name ?? 'Untitled', revision: 0,
    ppq: 960, sampleRate: options.sampleRate ?? 48000, tempoMap: [{ tick: 0, bpm: 120 }],
    timeSignature: { numerator: 4, denominator: 4 }, masterGainDb: -6,
    tracks: [], clips: [], assets: [],
  };
  if(options.fixedTempo===true){project.tempoTrackEnabled=false;project.fixedTempoBpm=120;project.storedTempoMap=clone(project.tempoMap);}
  validateProject(project);
  return project;
}

/** Validate syntax plus referential, timing and global-ID invariants; never mutate input. */
export function validateProject(project) {
  validateSchema(project, projectSchema);
  if(project.cycleEnabled&&!project.locators)fail('INVALID_LOCATORS','Cycle requires locator range.');
  if(project.locators&&project.locators.startTick>=project.locators.endTick)fail('INVALID_LOCATORS','Left locator must precede right locator.');
  if(project.timeDisplay)try{resolveTimeDisplay(project.timeDisplay);}catch(e){fail(e.code,e.message);}
  if(project.snapGrid)try{resolveSnapGrid(project.snapGrid);}catch(e){fail(e.code,e.message);}
  const ids = new Set();
  const register = (item, path) => {
    if (ids.has(item.id)) fail('DUPLICATE_ID', `Duplicate object ID: ${item.id}.`, { id: item.id, path });
    ids.add(item.id);
  };
  register(project, '$');
  validateTrackFolders(project,register);
  const effectNames=new Set();for(const[index,preset]of(project.effectPresets??[]).entries()){register(preset,`$.effectPresets[${index}]`);if(!['pre','eq','delay'].some(key=>Object.hasOwn(preset,key)))fail('INVALID_PRESET','Effect preset must contain Pre, EQ or delay.');const name=preset.name.trim().toLocaleLowerCase();if(effectNames.has(name))fail('DUPLICATE_PRESET_NAME','Effect preset names must be unique.');effectNames.add(name);}
  const presetNames=new Set();for(const [index,preset]of(project.exportPresets??[]).entries()){register(preset,`$.exportPresets[${index}]`);const key=preset.name.trim().toLocaleLowerCase();if(presetNames.has(key))fail('DUPLICATE_PRESET_NAME','Export preset names must be unique.');presetNames.add(key);if(preset.options.fileFormat==='aiff'&&preset.options.sampleFormat==='float32')fail('INVALID_PRESET','AIFF presets require integer PCM.');if(preset.options.dither==='tpdf'&&preset.options.sampleFormat==='float32')fail('INVALID_PRESET','Float32 presets cannot apply PCM dither.');if(preset.options.stemSplitChannels&&preset.options.channelMode!=='stereo')fail('INVALID_PRESET','Split L/R presets require stereo channel mode.');}
  for(const [index,archive]of(project.sourceArchives??[]).entries()){register(archive,`$.sourceArchives[${index}]`);if(!new RegExp(`^sources/${archive.sha256}\\.(aiff|aifc)$`).test(archive.path))fail('INVALID_ARCHIVE_PATH','Original source path must match its SHA256.');}
  const markerNumbers=new Set();let markerPayloadBytes=0;
  for(const [index,marker] of (project.markers??[]).entries()){
    register(marker,`$.markers[${index}]`);
    markerPayloadBytes+=marker.midiData?.length??0;if(markerPayloadBytes>4*1024*1024)fail('MARKER_PAYLOAD_LIMIT','Marker source text exceeds 4 MiB total.');
    if(marker.endTick!==undefined&&marker.endTick<=marker.tick)fail('INVALID_MARKER','Cycle marker end must follow its start.');
    const key=`${marker.endTick===undefined?'position':'cycle'}/${marker.number}`;
    if(markerNumbers.has(key))fail('DUPLICATE_MARKER_NUMBER','Marker numbers must be unique within each marker type.');markerNumbers.add(key);
  }
  for(const map of [project.tempoMap,...(project.storedTempoMap?[project.storedTempoMap]:[])]){
    let previousTick=-1;for(const [index,tempo]of map.entries()){if((index===0&&tempo.tick!==0)||tempo.tick<=previousTick)fail('INVALID_TEMPO_MAP','Tempo map must start at tick 0 with strictly increasing ticks.',{index});previousTick=tempo.tick;}
  }
  if(project.tempoTrackEnabled===false&&(!project.storedTempoMap||project.tempoMap.length!==1||project.fixedTempoBpm!==project.tempoMap[0].bpm))fail('INVALID_FIXED_TEMPO','Fixed mode requires one effective tempo and a retained source map.');
  if(project.tempoTrackEnabled!==false&&project.storedTempoMap)fail('INVALID_FIXED_TEMPO','An inactive tempo map is only stored in fixed mode.');
  const tracks = new Map();
  for (const [index, track] of project.tracks.entries()) {
    register(track, `$.tracks[${index}]`);
    if (track.type === 'midi' && !Object.hasOwn(track, 'instrument')) fail('VALIDATION_ERROR', 'MIDI tracks require an instrument.', { trackId: track.id });
    if (track.type === 'audio' && Object.hasOwn(track, 'instrument')) fail('TYPE_MISMATCH', 'Audio tracks cannot have a synth instrument.', { trackId: track.id });
    if (track.pitchBendGrid && (track.type !== 'midi' || track.pitchBendGrid.linked && track.pitchBendGrid.up !== track.pitchBendGrid.down)) fail('INVALID_PITCHBEND_GRID', 'Pitchbend grid requires a MIDI track and equal linked ranges.', {trackId:track.id});
    if(track.type!=='midi'&&track.midiTimeBase!==undefined)fail('TYPE_MISMATCH','MIDI time base cannot be assigned to audio tracks.');
    if(track.type!=='audio'&&track.audioTimeBase!==undefined)fail('TYPE_MISMATCH','Audio time base cannot be assigned to MIDI tracks.');
    if(track.type!=='midi'&&(track.midiModifiers||track.midiParameters))fail('TYPE_MISMATCH','Audio tracks cannot have MIDI modifiers.');
    validateModifierState(track);
    tracks.set(track.id, track);
  }
  const assets = new Map();
  for (const [index, asset] of project.assets.entries()) {
    register(asset, `$.assets[${index}]`);
    if (asset.path !== `assets/${asset.sha256}.wav`) fail('INVALID_ASSET_PATH', 'Asset path must match its SHA-256 content address.', { assetId: asset.id });
    assets.set(asset.id, asset);
  }
  for (const [index, clip] of project.clips.entries()) {
    register(clip, `$.clips[${index}]`);
    const track = tracks.get(clip.trackId);
    if (!track) fail('NOT_FOUND', 'Clip references an unknown track.', { clipId: clip.id, trackId: clip.trackId });
    if (track.type !== clip.type) fail('TYPE_MISMATCH', 'Clip and track media types must match.', { clipId: clip.id, trackId: track.id });
    if (clip.type === 'midi') {
      validateModifierState(null,clip);
      if (!Number.isSafeInteger(clip.startTick + clip.lengthTicks)) fail('TIME_OVERFLOW', 'Clip end exceeds safe integer tick range.', { clipId: clip.id });
      for (const [noteIndex, note] of clip.notes.entries()) {
        register(note, `$.clips[${index}].notes[${noteIndex}]`);
        if (!Number.isSafeInteger(clip.startTick+note.startTick+note.durationTicks) || note.startTick >= clip.lengthTicks || (!clip.allowNoteTails && note.durationTicks > clip.lengthTicks - note.startTick)) fail('NOTE_OUT_OF_BOUNDS', 'Note must fit within the MIDI clip.', { clipId: clip.id, noteId: note.id });
        if (note.quantizeReference && !quantizeReferenceFits(note.quantizeReference, clip.lengthTicks)) fail('QUANTIZE_REFERENCE_OUT_OF_BOUNDS', 'Quantize reference must fit within the MIDI clip.', { clipId: clip.id, noteId: note.id });
      }
      validateMidiClipEvents(clip, (event, eventIndex) => register(event, `$.clips[${index}].events[${eventIndex}]`));
    } else {
      const asset = assets.get(clip.assetId);
      if (!asset) fail('NOT_FOUND', 'Audio clip references an unknown asset.', { clipId: clip.id, assetId: clip.assetId });
      {let end=-1;for(const range of clip.silencedRanges??[]){if(range.startFrame<end||range.startFrame>=range.endFrame||range.endFrame>asset.frames)fail('INVALID_SILENCE_RANGE','Silence regions must be ordered, disjoint and within source bounds.');end=range.endFrame;}}
      if(clip.dcOffsets?.length&&clip.dcOffsets.length!==asset.channels)fail('INVALID_DC_OFFSET','DC corrections must match source channel count.');
      if(clip.snapPointFrame!==undefined&&clip.snapPointFrame>asset.frames)fail('INVALID_SNAP_POINT','Event snap point must fit source bounds.');
      if(clip.reverseWindow){const w=clip.reverseWindow;if(w.offsetFrames>asset.frames||w.lengthFrames>asset.frames-w.offsetFrames||clip.reverse&&(clip.offsetFrames<w.offsetFrames||clip.offsetFrames+clip.lengthFrames>w.offsetFrames+w.lengthFrames))fail('INVALID_AUDIO_REVERSE','Reverse window must contain the audio trim and fit the source.');}
      if(clip.volumeEnvelope){let previous=-1;for(const point of clip.volumeEnvelope){if(point.frame<=previous||point.frame>=asset.frames)fail('INVALID_AUDIO_ENVELOPE','Envelope points must be strictly ordered within the source asset.');previous=point.frame;}}
      if (clip.offsetFrames > asset.frames || clip.lengthFrames > asset.frames - clip.offsetFrames) fail('AUDIO_OUT_OF_BOUNDS', 'Audio trim must fit within its source asset.', { clipId: clip.id, assetId: asset.id });
      const fade=clip.fadeWindow??clip;if(fade.offsetFrames>asset.frames||fade.lengthFrames>asset.frames-fade.offsetFrames||(clip.fadeInFrames??0)>fade.lengthFrames||(clip.fadeOutFrames??0)>fade.lengthFrames)fail('INVALID_AUDIO_FADE','Audio fades must fit their source window.');
      if (!Number.isSafeInteger(clip.startSample + Math.ceil(clip.lengthFrames / asset.sampleRate * project.sampleRate))) fail('TIME_OVERFLOW', 'Audio clip end exceeds safe integer sample range.', { clipId: clip.id });
    }
  }
  validateMidiEventBudget(project);
  return true;
}

function find(items, id, kind) {
  const item = items.find(candidate => candidate.id === id);
  if (!item) fail('NOT_FOUND', `${kind} not found: ${id}.`, { id, kind });
  return item;
}

function getMidiClip(project, id) {
  const clip = find(project.clips, id, 'Clip');
  if (clip.type !== 'midi') fail('TYPE_MISMATCH', 'This command requires a MIDI clip.', { clipId: id });
  return clip;
}

function patch(target, args, excluded) {
  const entries = Object.entries(args).filter(([key]) => !excluded.includes(key));
  if (!entries.length) fail('EMPTY_UPDATE', 'At least one editable field is required.');
  for (const [key, value] of entries) target[key] = clone(value);
}

function withNoteDefaults(note) {
  return { ...clone(note), id: note.id ?? newId('note'), channel: note.channel ?? 0 };
}

const clipIds = midiObjectIds;

// Source offsets/ends, unlike startSample, use the asset sample rate. Work in
// integer rationals so a rate change never silently stretches existing clips.
function convertSourceBoundary(frame, fromRate, toRate, framePolicy, details) {
  const numerator = BigInt(frame) * BigInt(toRate), denominator = BigInt(fromRate);
  if (framePolicy === 'exact' && numerator % denominator !== 0n) {
    fail('ASSET_RATE_INCOMPATIBLE', 'Source boundary cannot be represented exactly at the replacement sample rate. Explicit nearest policy is required to allow rounding.', { ...details, frame, fromSampleRate: fromRate, toSampleRate: toRate });
  }
  const converted = framePolicy === 'nearest' ? (2n * numerator + denominator) / (2n * denominator) : numerator / denominator;
  if (converted > BigInt(Number.MAX_SAFE_INTEGER)) fail('TIME_OVERFLOW', 'Converted source boundary exceeds the safe integer frame range.', details);
  const deltaNumerator = converted * denominator - numerator;
  return { frame: Number(converted), deltaNumerator, deltaFrames: Number(deltaNumerator) / fromRate };
}

function relinkAssets(project, args, changes) {
  const framePolicy = args.framePolicy ?? 'exact', assets = new Map(project.assets.map(asset => [asset.id, asset]));
  const mappingIds = new Set();
  for (const mapping of args.mappings) {
    if (mappingIds.has(mapping.assetId)) fail('DUPLICATE_ID', 'An asset may only be relinked once in one mapping list.', { assetId: mapping.assetId });
    mappingIds.add(mapping.assetId);
    if (!assets.has(mapping.assetId)) fail('NOT_FOUND', 'Asset to relink was not found.', { assetId: mapping.assetId });
    if (mapping.path !== `assets/${mapping.sha256}.wav`) fail('INVALID_ASSET_PATH', 'Asset path must match its SHA-256 content address.', { assetId: mapping.assetId });
  }
  const clipsByAsset = new Map([...mappingIds].map(id => [id, []]));
  for (const clip of project.clips) if (clip.type === 'audio' && clipsByAsset.has(clip.assetId)) clipsByAsset.get(clip.assetId).push(clip);
  const report = { assetIds: [...mappingIds], clipIds: [], framePolicy, conversions: [] };
  for (const mapping of args.mappings) {
    const asset = assets.get(mapping.assetId), clips = clipsByAsset.get(asset.id);
    const conversion = { assetId: asset.id, fromSampleRate: asset.sampleRate, toSampleRate: mapping.sampleRate, clipIds: clips.map(clip => clip.id), rounding: 'none', adjustments: [] };
    for (const clip of clips) {
      const previousOffsetFrames = clip.offsetFrames, previousLengthFrames = clip.lengthFrames;
      const offset = convertSourceBoundary(previousOffsetFrames, asset.sampleRate, mapping.sampleRate, framePolicy, { assetId: asset.id, clipId: clip.id, boundary: 'offset' });
      const end = convertSourceBoundary(previousOffsetFrames + previousLengthFrames, asset.sampleRate, mapping.sampleRate, framePolicy, { assetId: asset.id, clipId: clip.id, boundary: 'end' });
      const lengthFrames = end.frame - offset.frame;
      if (lengthFrames < 1) fail('ASSET_RATE_INCOMPATIBLE', 'Rounded source boundaries would collapse the clip to an empty range.', { assetId: asset.id, clipId: clip.id, reason: 'rounded-empty-range', offsetFrames: offset.frame, endFrames: end.frame });
      if (end.frame > mapping.frames) fail('AUDIO_OUT_OF_BOUNDS', 'Replacement audio is too short for an existing clip source range.', { assetId: asset.id, clipId: clip.id, offsetFrames: offset.frame, endFrames: end.frame, sourceFrames: mapping.frames });
      if (offset.deltaNumerator !== 0n || end.deltaNumerator !== 0n) conversion.rounding = 'nearest';
      if (asset.sampleRate !== mapping.sampleRate) conversion.adjustments.push({ clipId: clip.id, previousOffsetFrames, offsetFrames: offset.frame, previousLengthFrames, lengthFrames,
        offsetDeltaFrames: offset.deltaFrames, endDeltaFrames: end.deltaFrames,
        durationDeltaSeconds: Number(end.deltaNumerator - offset.deltaNumerator) / asset.sampleRate / mapping.sampleRate });
      clip.offsetFrames = offset.frame; clip.lengthFrames = lengthFrames;
      report.clipIds.push(clip.id);
    }
    const { assetId, ...metadata } = mapping;
    Object.assign(asset, metadata); // Keep the registered stable ID and display name.
    report.conversions.push(conversion);
  }
  changes.updated = [...report.assetIds, ...report.clipIds];
  changes.relinked = report;
  return [...changes.updated];
}

function splitClipsAtPositions(project,args,ticks,allowEmpty=false){
  const changes={created:[],updated:[],removed:[],splits:[]},resolvedTargets=[],map=compileTempoMap(project.tempoMap,project.ppq),selected=args.clipIds?.length?new Set(args.clipIds):null;
  if(selected)for(const id of selected)find(project.clips,id,'Clip');
  for(const atTick of ticks){
    const atSample=Math.round(map.tickToSeconds(atTick)*project.sampleRate);if(!Number.isSafeInteger(atSample))fail('TIME_OVERFLOW','Cursor sample exceeds safe integer range.');
    const clips=project.clips.filter(clip=>{if(selected&&!selected.has(clip.id))return false;if(clip.type==='midi')return atTick>clip.startTick&&atTick<clip.startTick+clip.lengthTicks;const asset=find(project.assets,clip.assetId,'Asset');return atSample>clip.startSample&&atSample<clip.startSample+clip.lengthFrames/asset.sampleRate*project.sampleRate;});
    if(changes.splits.length+clips.length>4096)fail('SPLIT_LIMIT','At most 4096 clip splits per operation.');
    for(const clip of clips){
      const splitArgs=clip.type==='midi'?{clipId:clip.id,atTick,splitNotes:args.splitNotes??true,chaseControllers:args.chaseControllers??false}:{clipId:clip.id,atSample};
      const result=applyEditing(project,'clip.split',splitArgs);if(changes.created.length+changes.updated.length+result.changes.created.length+result.changes.updated.length>1000000)fail('SPLIT_LIMIT','Split operation exceeds one million change references.');for(const key of ['created','updated','removed'])changes[key]=changes[key].concat(result.changes[key]);
      if(changes.created.length>200000)fail('SPLIT_LIMIT','Split operation exceeds 200000 created objects.');
      if(result.changes.warnings?.length)(changes.warnings??=[]).push(...result.changes.warnings);changes.splits.push(result.changes.split);for(const target of result.resolvedTargets)resolvedTargets.push(target);selected?.add(result.changes.split.rightClipId);
    }
  }
  if(!changes.splits.length&&!allowEmpty)fail('NOTHING_TO_SPLIT','No targeted clips cross the split positions.');
  return {changes,resolvedTargets:[...new Set(resolvedTargets)]};
}

function replaceMidiTrackRange(project,trackId,left,right){
 const beforeIds=new Set(project.clips.flatMap(clipIds)),updated=new Set();
 const targets=project.clips.filter(c=>c.type==='midi'&&c.trackId===trackId&&c.startTick<right&&(c.startTick+c.lengthTicks>left||c.allowNoteTails&&c.notes.some(n=>c.startTick+n.startTick+n.durationTicks>left)));
 if(targets.length>4096)fail('MIDI_TAKE_LIMIT','Replace targets at most 4096 existing MIDI parts.');
 for(const clip of targets)if(clip.allowNoteTails){const length=clip.notes.reduce((n,note)=>Math.max(n,note.startTick+note.durationTicks),clip.lengthTicks);if(length!==clip.lengthTicks){clip.lengthTicks=length;updated.add(clip.id);}}
 const result=targets.length?splitClipsAtPositions(project,{clipIds:targets.map(c=>c.id),splitNotes:true,chaseControllers:true},[left,right],true):{changes:{updated:[],splits:[]}};
 // With no overlapping parts, never fall back to the all-clips selection semantics.
 for(const id of result.changes.updated)updated.add(id);
 const keep=[],boundary=[];
 for(const clip of project.clips){
  if(clip.type!=='midi'||clip.trackId!==trackId||clip.startTick<left||clip.startTick>=right){keep.push(clip);continue;}
  if(clip.startTick+clip.lengthTicks===right){
   const events=(clip.events??[]).filter(e=>e.tick===clip.lengthTicks).map(e=>{const copy=clone(e);copy.tick=0;if(copy.curve?.window){copy.curve.window.startTick-=clip.lengthTicks;copy.curve.window.endTick-=clip.lengthTicks;}updated.add(copy.id);return copy;});
   if(events.length)boundary.push({...clone(clip),id:newId('clip'),startTick:right,lengthTicks:1,notes:[],events});
  }
 }
 project.clips=keep.concat(boundary);const afterIds=new Set(project.clips.flatMap(clipIds));
 return {created:[...afterIds].filter(id=>!beforeIds.has(id)),removed:[...beforeIds].filter(id=>!afterIds.has(id)),updated:[...updated].filter(id=>beforeIds.has(id)&&afterIds.has(id)),replacement:{startTick:left,endTick:right,scope:'track interval, right-exclusive; intersecting notes are split and outside fragments retained',splitCount:result.changes.splits.length}};
}

function quantizeRecordedTake(clip,notes,events,take,args,base,changes){
 const options=args.autoQuantize;if(!options||!notes.length)return;
 const origin=options.origin??'project',originTick=origin==='take'?args.startTick:0,strength=options.strength??1,swing=options.swing??0,oldStart=clip.startTick,plans=[];let newStart=oldStart,newEnd=oldStart+clip.lengthTicks,resetEnd=args.startTick+take.lengthTicks-1;
 for(const note of notes){
  note.quantizeReference={startTick:note.startTick,durationTicks:note.durationTicks};const absolute=oldStart+note.startTick,target=nearestGrid(absolute-originTick,options.gridTicks,swing)+originTick,start=Math.max(0,Math.round(absolute+(target-absolute)*strength));
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(start+note.durationTicks))fail('TIME_OVERFLOW','Auto-quantized take exceeds safe tick range.');
  plans.push({note,start});newStart=Math.min(newStart,start);newEnd=Math.max(newEnd,start+note.durationTicks);resetEnd=Math.max(resetEnd,start+note.durationTicks);
 }
 newEnd=Math.max(newEnd,resetEnd+1);if(!Number.isSafeInteger(newEnd))fail('TIME_OVERFLOW','Auto-quantized take end exceeds safe tick range.');
 const shift=oldStart-newStart;
 if(shift){for(const note of clip.notes){note.startTick+=shift;if(note.quantizeReference)note.quantizeReference.startTick+=shift;changes.updated.push(note.id);}for(const event of clip.events??[]){event.tick+=shift;if(event.curve?.window){event.curve.window.startTick+=shift;event.curve.window.endTick+=shift;}changes.updated.push(event.id);}}
 clip.startTick=newStart;clip.lengthTicks=newEnd-newStart;for(const plan of plans)plan.note.startTick=plan.start-newStart;
 for(const event of events)if(event.order>=take.recording.stopResetStartOrder+base)event.tick=resetEnd-newStart;
 changes.updated.push(clip.id);changes.autoQuantize={origin,gridTicks:options.gridTicks,strength,swing,noteIds:notes.map(n=>n.id),sourceReference:'captured unquantized clip-relative start/duration; raw input JSON unchanged',stopResetTick:resetEnd};
}

function applyCommand(project, command, args) {
  if(command==='audio.clip.selectTake'){const clip=find(project.clips,args.clipId,'Clip');if(clip.type!=='audio')fail('TYPE_MISMATCH','Take selection requires an audio clip.');if(clip.mute)fail('CLIP_MUTED','Unmute the audio event before selecting it for playback.');const mode=applyCommand(project,'track.audioOverlap',{trackId:clip.trackId,mode:'front'}),front=applyCommand(project,'audio.clip.toFront',{clipId:clip.id});return{changes:{created:[],updated:[...mode.changes.updated,...front.changes.updated],removed:[],selectedTake:{trackId:clip.trackId,clipId:clip.id}},resolvedTargets:[clip.trackId,clip.id]};}
  if(command==='track.audioOverlap'){const track=find(project.tracks,args.trackId,'Track');if(track.type!=='audio')fail('TYPE_MISMATCH','Audio overlap mode requires an audio track.');track.audioOverlapMode=args.mode;validateProject(project);return{changes:{created:[],updated:[track.id],removed:[]},resolvedTargets:[track.id]};}
  if(command==='audio.clip.toFront'){const clip=find(project.clips,args.clipId,'Clip');if(clip.type!=='audio')fail('TYPE_MISMATCH','To Front requires an audio clip.');const max=project.clips.filter(c=>c.trackId===clip.trackId).reduce((max,c)=>Math.max(max,c.frontOrder??0),0);if(max>=Number.MAX_SAFE_INTEGER)fail('ORDER_OVERFLOW','Audio front order cannot increase further.');clip.frontOrder=max+1;validateProject(project);return{changes:{created:[],updated:[clip.id],removed:[]},resolvedTargets:[clip.id]};}

  if(command==='folder.contents.move'){
   find(project.trackFolders??[],args.folderId,'Folder');
   const ids=new Set([args.folderId]);let grew=true;while(grew){grew=false;for(const f of project.trackFolders??[])if(ids.has(f.parentFolderId)&&!ids.has(f.id)){ids.add(f.id);grew=true;}}
   const tracks=new Set(project.tracks.filter(t=>ids.has(t.parentFolderId)).map(t=>t.id)),clips=project.clips.filter(c=>tracks.has(c.trackId));
   if(!clips.length)fail('EMPTY_FOLDER','Folder contains no clips to move.');if(clips.length>4096)fail('CLIP_LIMIT','Folder contents move supports at most 4096 clips.');
   const result=applyCommand(project,'clips.moveGroup',{clipIds:clips.map(c=>c.id),...(args.atTick===undefined?{}:{atTick:args.atTick}),...(args.atSample===undefined?{}:{atSample:args.atSample})});
   result.changes.folderContents={folderId:args.folderId,clipIds:clips.map(c=>c.id)};result.resolvedTargets=[args.folderId,...result.resolvedTargets];return result;
  }

  const folderResult=applyTrackFolders(project,command,args);if(folderResult){validateProject(project);return folderResult;}
  const merged=applyMerge(project,command,args);if(merged){validateProject(project);return merged;}
  const modifiers=applyModifiers(project,command,args);
  if(modifiers){validateProject(project);return modifiers;}
  const controllers = applyControllers(project, command, args);
  if (controllers) { validateProject(project); return controllers; }
  const editing = applyEditing(project, command, args);
  if (editing) { validateProject(project); return editing; }
  const changes = { created: [], updated: [], removed: [] };
  let resolvedTargets = [];
  switch (command) {
    case 'project.rename':
      project.name = args.name;
      changes.updated.push(project.id); resolvedTargets = [project.id]; break;
    case 'project.settings':
      patch(project, args, []);
      changes.updated.push(project.id); resolvedTargets = [project.id]; break;
    case 'marker.add': {
      const markers=project.markers??=[],cycle=args.endTick!==undefined;
      const number=args.number??markers.filter(m=>(m.endTick!==undefined)===cycle).reduce((n,m)=>Math.max(n,m.number),0)+1;
      const marker={...clone(args),id:args.id??newId('marker'),number};project.markers=[...markers,marker];
      changes.created.push(marker.id);resolvedTargets=[marker.id];break;
    }
    case 'marker.update': {
      const marker=find(project.markers??[],args.markerId,'Marker');
      if(args.endTick!==undefined&&marker.endTick===undefined)fail('TYPE_MISMATCH','A position marker cannot become a cycle marker through update.');
      if(args.name!==undefined&&args.name!==marker.name)delete marker.midiData;
      patch(marker,args,['markerId']);changes.updated.push(marker.id);resolvedTargets=[marker.id];break;
    }
    case 'marker.remove': {
      const marker=find(project.markers??[],args.markerId,'Marker');project.markers=project.markers.filter(m=>m.id!==marker.id);changes.removed.push(marker.id);resolvedTargets=[marker.id];break;
    }
    case 'marker.renumber': {
      for(const cycle of [false,true]){const markers=(project.markers??[]).filter(m=>(m.endTick!==undefined)===cycle).sort((a,b)=>a.tick-b.tick);for(const [index,marker] of markers.entries()){marker.number=index+1;changes.updated.push(marker.id);}}
      resolvedTargets=[...changes.updated];break;
    }
    case 'project.cycle':
      if(args.enabled&&!project.locators)fail('INVALID_LOCATORS','Set locator range before enabling cycle.');project.cycleEnabled=args.enabled;changes.updated.push(project.id);resolvedTargets=[project.id];break;
    case 'project.locatorsMove':
    case 'project.locatorsResize': {
      if(!project.locators)fail('INVALID_LOCATORS','Set locators before moving or resizing their range.');
      let {startTick,endTick}=project.locators;
      if(command==='project.locatorsMove'){startTick+=args.deltaTicks;endTick+=args.deltaTicks;}
      else if(args.anchor==='end')startTick=endTick-args.durationTicks;
      else endTick=startTick+args.durationTicks;
      if(!Number.isSafeInteger(startTick)||!Number.isSafeInteger(endTick)||startTick<0||endTick<=startTick)fail('INVALID_LOCATORS','Locator operation exceeds positive safe project bounds.');
      project.locators={startTick,endTick};changes.updated.push(project.id);changes.locators={...project.locators};resolvedTargets=[project.id];break;
    }
    case 'project.locatorsFromClips': {
      const map=compileTempoMap(project.tempoMap,project.ppq);let startTick=Infinity,endTick=0;
      for(const id of args.clipIds){const clip=find(project.clips,id,'Clip');let start,end;
        if(clip.type==='midi'){start=clip.startTick;end=start+clip.lengthTicks;}
        else{const asset=find(project.assets,clip.assetId,'Asset');start=map.secondsToTick(clip.startSample/project.sampleRate);end=map.secondsToTick(clip.startSample/project.sampleRate+clip.lengthFrames/asset.sampleRate);}
        startTick=Math.min(startTick,Math.floor(start+1e-7));endTick=Math.max(endTick,Math.ceil(end-1e-7));
      }
      if(!Number.isSafeInteger(startTick)||!Number.isSafeInteger(endTick)||startTick<0||endTick<=startTick)fail('INVALID_LOCATORS','Selected clips do not define a positive safe locator range.');
      project.locators={startTick,endTick};if(args.enableCycle!==undefined)project.cycleEnabled=args.enableCycle;changes.updated.push(project.id);changes.locators={...project.locators};resolvedTargets=[project.id,...args.clipIds];break;
    }
    case 'project.locators':
      if(args.range===null){delete project.locators;if(project.cycleEnabled)project.cycleEnabled=false;}else{if(args.range.startTick>=args.range.endTick)fail('INVALID_LOCATORS','Left locator must precede right locator.');project.locators=clone(args.range);}
      changes.updated.push(project.id);resolvedTargets=[project.id];break;
    case 'project.exportPreset.put': {
      const presets=project.exportPresets??[],id=args.presetId??newId('export-preset'),name=args.name.trim();
      if(presets.some(p=>p.id!==id&&p.name.toLocaleLowerCase()===name.toLocaleLowerCase()))fail('DUPLICATE_PRESET_NAME','An export preset with this name already exists.');
      const index=presets.findIndex(p=>p.id===id),preset={id,name,options:clone(args.options)};
      project.exportPresets=[...presets];if(index<0){project.exportPresets.push(preset);changes.created.push(id);}else{project.exportPresets[index]=preset;changes.updated.push(id);}
      changes.updated.push(project.id);changes.exportPreset={id};resolvedTargets=[project.id,id];break;
    }
    case 'project.exportPreset.remove': {
      find(project.exportPresets??[],args.presetId,'Export preset');project.exportPresets=project.exportPresets.filter(p=>p.id!==args.presetId);changes.removed.push(args.presetId);changes.updated.push(project.id);resolvedTargets=[project.id,args.presetId];break;
    }
    case 'project.midiStepSettings':
      if(args.settings===null)delete project.midiStepSettings;else project.midiStepSettings=clone(args.settings);changes.updated.push(project.id);resolvedTargets=[project.id];break;
    case 'project.midiInputFilter':
      if(args.filter===null)delete project.midiInputFilter;else project.midiInputFilter=clone(args.filter);changes.updated.push(project.id);resolvedTargets=[project.id];break;
    case 'project.snapGrid':
      try{project.snapGrid=patchSnapGrid(project.snapGrid,args.options);}catch(e){fail(e.code,e.message);}
      changes.updated.push(project.id);resolvedTargets=[project.id];break;
    case 'project.timeDisplay':
      if(!Object.keys(args.options).length)fail('INVALID_TIME_DISPLAY','Provide at least one display setting.');
      try{project.timeDisplay=resolveTimeDisplay({...resolveTimeDisplay(project.timeDisplay),...args.options});}catch(e){fail(e.code,e.message);}
      changes.updated.push(project.id); resolvedTargets=[project.id]; break;
    case 'signature.set':
      project.timeSignature={numerator:args.numerator,denominator:args.denominator};changes.updated.push(project.id);resolvedTargets=[project.id];break;
    case 'audio.clip.tempoFromEvent': {
      let plan;try{plan=planTempoFromAudio(project,args);}catch(error){fail(error.code??'INVALID_AUDIO_TEMPO',error.message);}for(const operation of plan.commands){const result=applyCommand(project,operation.command,operation.arguments);changes.updated.push(...result.changes.updated);}
      changes.tempoFromAudio={clipId:plan.clipId,scope:plan.scope,bpm:plan.bpm,beats:plan.beats,durationSeconds:plan.durationSeconds,startTick:plan.startTick,endTick:plan.endTick};changes.updated.push(project.id);resolvedTargets=[project.id,args.clipId];break;
    }
    case 'tempo.change': {
      const atTick=project.tempoTrackEnabled===false||project.tempoMap.length===1?0:args.atTick;
      const nextMap=project.tempoMap.filter(p=>p.tick!==atTick);nextMap.push({tick:atTick,bpm:args.bpm});nextMap.sort((a,b)=>a.tick-b.tick);replaceEffectiveTempo(project,nextMap,changes);
      if(project.tempoTrackEnabled===false)project.fixedTempoBpm=args.bpm;
      changes.tempo={atTick,bpm:args.bpm,mode:project.tempoTrackEnabled===false?'fixed':'track'};changes.updated.push(project.id);resolvedTargets=[project.id];break;
    }
    case 'tempo.mode': {
      if(args.enabled){if(args.bpm!==undefined)fail('INVALID_TEMPO_MODE','bpm only applies to fixed mode.');if(project.tempoTrackEnabled===false){replaceEffectiveTempo(project,project.storedTempoMap,changes);delete project.storedTempoMap;}project.tempoTrackEnabled=true;}
      else{if(project.tempoTrackEnabled!==false)project.storedTempoMap=clone(project.tempoMap);project.fixedTempoBpm=args.bpm??project.fixedTempoBpm??project.tempoMap[0].bpm;replaceEffectiveTempo(project,[{tick:0,bpm:project.fixedTempoBpm}],changes);project.tempoTrackEnabled=false;}
      changes.updated.push(project.id);resolvedTargets=[project.id];break;
    }
    case 'tempo.set':
      if(project.tempoTrackEnabled===false){if(args.tempoMap.length!==1||args.tempoMap[0].tick!==0)fail('FIXED_TEMPO_MAP','Enable tempo track to edit multiple tempo points.');project.fixedTempoBpm=args.tempoMap[0].bpm;}
      replaceEffectiveTempo(project,args.tempoMap,changes);
      changes.updated.push(project.id); resolvedTargets = [project.id]; break;
    case 'project.trackTimeBase': {if(args.mode===null)delete project.defaultTrackTimeBase;else project.defaultTrackTimeBase=args.mode;changes.updated.push(project.id);resolvedTargets=[project.id];break;}
    case 'track.midiTimeBase': {const track=find(project.tracks,args.trackId,'Track');if(track.type!=='midi')fail('TYPE_MISMATCH','MIDI time base only applies to MIDI tracks.');track.midiTimeBase=args.mode;changes.updated.push(track.id);resolvedTargets=[track.id];break;}
    case 'track.audioTimeBase': {const track=find(project.tracks,args.trackId,'Track');setAudioTimeBase(project,track,args.mode,changes);resolvedTargets=[track.id];break;}
    case 'track.add': {
      if (args.type === 'audio' && Object.hasOwn(args, 'instrument')) fail('TYPE_MISMATCH', 'Audio tracks cannot have a synth instrument.');
      const track = { id: args.id ?? newId('track'), name: args.name ?? (args.type === 'midi' ? 'MIDI Track' : 'Audio Track'), type: args.type,
        color: args.color ?? (args.type === 'midi' ? '#a3f0bf' : '#f4a66a'), gainDb: 0, pan: 0, mute: false, solo: false };
      if (args.type === 'midi') track.instrument = args.instrument ?? 'sine';
      applyNewTrackTimeBase(project,track,args.timeBase);
      project.tracks.push(track); changes.created.push(track.id); resolvedTargets = [track.id]; break;
    }
    case 'track.update': {
      const track = find(project.tracks, args.trackId, 'Track');
      if (track.type === 'audio' && Object.hasOwn(args, 'instrument')) fail('TYPE_MISMATCH', 'Audio tracks cannot have a synth instrument.', { trackId: track.id });
      if(args.renameClips&&args.renameClips!=='none'&&!Object.hasOwn(args,'name'))fail('MISSING_TRACK_NAME','Clip renaming requires an explicit track name.');
      const oldName=track.name;
      patch(track, args, ['trackId','renameClips']); changes.updated.push(track.id);
      if(args.renameClips&&args.renameClips!=='none')for(const clip of project.clips){
        if(clip.trackId===track.id&&(args.renameClips==='all'||clip.name===oldName)){clip.name=track.name;changes.updated.push(clip.id);}
      }
      resolvedTargets = [...changes.updated]; break;
    }
    case 'track.eqFrequency': {const track=find(project.tracks,args.trackId,'Track');if(!track.eq)fail('INVALID_EQ','Configure track EQ before setting a band frequency.');track.eq.bands[args.bandIndex].frequencyHz=parseEqFrequency(args.value);changes.updated.push(track.id);resolvedTargets=[track.id];break;}
    case 'tracks.eqInvert': {const tracks=args.trackIds.map(id=>find(project.tracks,id,'Track'));for(const track of tracks)if(track.eq){track.eq=invertTrackEqGains(track.eq);changes.updated.push(track.id);}resolvedTargets=tracks.map(t=>t.id);break;}
    case 'project.effectPreset.put': {
      if(!['pre','eq','delay'].some(key=>Object.hasOwn(args,key)))fail('INVALID_PRESET','Specify Pre, EQ or delay.');const presets=project.effectPresets??[],id=args.presetId??newId('effect-preset'),name=args.name.trim(),index=presets.findIndex(p=>p.id===id);if(index<0&&presets.length>=64)fail('PRESET_LIMIT','At most64 effect presets.');if(presets.some(p=>p.id!==id&&p.name.toLocaleLowerCase()===name.toLocaleLowerCase()))fail('DUPLICATE_PRESET_NAME','Effect preset name already exists.');const preset={id,name};for(const key of ['pre','eq','delay'])if(Object.hasOwn(args,key))preset[key]=clone(args[key]);project.effectPresets=[...presets];if(index<0){project.effectPresets.push(preset);changes.created.push(id);}else{project.effectPresets[index]=preset;changes.updated.push(id);}changes.updated.push(project.id);changes.effectPreset={id};resolvedTargets=[project.id,id];break;
    }
    case 'project.effectPreset.rename': {
      const preset=find(project.effectPresets??[],args.presetId,'Effect preset'),name=args.name.trim();if(project.effectPresets.some(p=>p.id!==preset.id&&p.name.toLocaleLowerCase()===name.toLocaleLowerCase()))fail('DUPLICATE_PRESET_NAME','Effect preset name already exists.');preset.name=name;changes.updated.push(preset.id);changes.effectPreset={id:preset.id};resolvedTargets=[preset.id];break;
    }
    case 'project.effectPreset.remove': {find(project.effectPresets??[],args.presetId,'Effect preset');project.effectPresets=project.effectPresets.filter(p=>p.id!==args.presetId);changes.removed.push(args.presetId);resolvedTargets=[args.presetId];break;}
    case 'tracks.effectPreset.apply': {const preset=find(project.effectPresets??[],args.presetId,'Effect preset'),settings={trackIds:args.trackIds};for(const key of ['pre','eq','delay'])if((!args.scope||args.scope==='all'||args.scope===key)&&Object.hasOwn(preset,key))settings[key]=preset[key];if(!['pre','eq','delay'].some(key=>Object.hasOwn(settings,key)))fail('INVALID_PRESET_SCOPE','Preset does not contain that effect.');return applyCommand(project,'tracks.effectsApply',settings);}
    case 'tracks.effectsApply': {
      if(!['pre','eq','delay'].some(key=>Object.hasOwn(args,key)))fail('EMPTY_UPDATE','Specify Pre, EQ or delay settings.');const tracks=args.trackIds.map(id=>find(project.tracks,id,'Track'));for(const track of tracks){for(const key of ['pre','eq','delay'])if(Object.hasOwn(args,key)){if(args[key]===null)delete track[key];else track[key]=clone(args[key]);}changes.updated.push(track.id);}resolvedTargets=tracks.map(t=>t.id);break;
    }
    case 'tracks.clearMuteSolo': {
      const keys=args.mode==='mute'?['mute']:args.mode==='solo'?['solo']:['mute','solo'];
      for(const track of project.tracks){let changed=false;for(const key of keys)if(track[key]){track[key]=false;changed=true;}if(changed)changes.updated.push(track.id);}
      resolvedTargets=project.tracks.map(track=>track.id);break;
    }
    case 'track.soloExclusive': {
      find(project.tracks,args.trackId,'Track');
      for(const track of project.tracks){const solo=track.id===args.trackId;if(track.solo!==solo){track.solo=solo;changes.updated.push(track.id);}}
      resolvedTargets=project.tracks.map(track=>track.id);break;
    }
    case 'tracks.removeEmpty': {
      const occupied=new Set(project.clips.map(clip=>clip.trackId));
      const empty=project.tracks.filter(track=>!occupied.has(track.id));
      changes.removed=empty.map(track=>track.id);
      project.tracks=project.tracks.filter(track=>occupied.has(track.id));
      resolvedTargets=[...changes.removed];break;
    }
    case 'track.remove': {
      const track = find(project.tracks, args.trackId, 'Track');
      changes.removed = [track.id, ...project.clips.filter(clip => clip.trackId === track.id).flatMap(clipIds)];
      project.tracks = project.tracks.filter(item => item.id !== track.id);
      project.clips = project.clips.filter(clip => clip.trackId !== track.id);
      resolvedTargets = [...changes.removed]; break;
    }
    case 'clip.add': {
      find(project.tracks, args.trackId, 'Track');
      const clip = args.type === 'midi'
        ? { id: args.id ?? newId('clip'), trackId: args.trackId, type: 'midi', name: args.name ?? 'MIDI Clip', startTick: args.startTick ?? 0, lengthTicks: args.lengthTicks ?? 3840, notes: (args.notes ?? []).map(withNoteDefaults) }
        : { ...clone(args), id: args.id ?? newId('clip'), name: args.name ?? 'Audio Clip', gainDb: args.gainDb ?? 0 };
      if (args.type === 'midi' && Object.hasOwn(args, 'events')) addMidiEvents(clip, args.events);
      if (args.type === 'midi' && Object.hasOwn(args, 'midiOrderGroup')) clip.midiOrderGroup = args.midiOrderGroup;
      if(args.type==='midi'&&args.midiModifiers)clip.midiModifiers=clone(args.midiModifiers);
      if(args.type==='midi')for(const key of ['mute','allowNoteTails'])if(Object.hasOwn(args,key))clip[key]=args[key];
      project.clips.push(clip); changes.created = clipIds(clip); resolvedTargets = [clip.trackId, ...changes.created]; break;
    }
    case 'clips.cutAt': {
      const result=splitClipsAtPositions(project,args,[args.atTick]),removeClipIds=new Set(result.changes.splits.map(s=>args.side==='head'?s.leftClipId:s.rightClipId)),created=new Set(result.changes.created),removed=[];
      for(const clip of project.clips)if(removeClipIds.has(clip.id))for(const id of clipIds(clip))removed.push(id);
      const removedSet=new Set(removed);project.clips=project.clips.filter(c=>!removeClipIds.has(c.id));
      result.changes.created=result.changes.created.filter(id=>!removedSet.has(id));result.changes.updated=result.changes.updated.filter(id=>!removedSet.has(id));result.changes.removed=removed.filter(id=>!created.has(id));
      result.changes.cut={side:args.side,atTick:args.atTick,removedClipIds:[...removeClipIds],keptClipIds:result.changes.splits.map(s=>args.side==='head'?s.rightClipId:s.leftClipId),scope:'crossing-clips-only'};return result;
    }
    case 'clips.splitAt': return splitClipsAtPositions(project,args,[args.atTick]);
    case 'clips.splitAtLocators':
      if(!project.locators)fail('INVALID_LOCATORS','Set locators before splitting.');return splitClipsAtPositions(project,args,[project.locators.startTick,project.locators.endTick]);
    case 'clips.splitRepeated': {
      const range=args.range??project.locators;if(!range||range.endTick<=range.startTick)fail('INVALID_LOCATORS','Provide a positive range or set locators.');
      const count=(BigInt(range.endTick)-BigInt(range.startTick)-1n)/BigInt(args.intervalTicks);if(count>1024n)fail('SPLIT_LIMIT','Repeated split supports at most 1024 boundaries.');
      const ticks=[];for(let i=1n;i<=count;i++)ticks.push(Number(BigInt(range.startTick)+i*BigInt(args.intervalTicks)));
      return splitClipsAtPositions(project,args,ticks);
    }
    case 'clips.moveToTrack': {
      const target=find(project.tracks,args.trackId,'Track'),clips=args.clipIds.map(id=>find(project.clips,id,'Clip'));if(clips.some(c=>c.type!==target.type))fail('TYPE_MISMATCH','All selected clips must match the destination track type.');for(const clip of clips){clip.trackId=target.id;changes.updated.push(clip.id);}resolvedTargets=[target.id,...clips.map(c=>c.id)];break;
    }
    case 'clips.moveGroup': {
      if((args.atTick===undefined)===(args.atSample===undefined))fail('INVALID_OPTION','Specify exactly one destination: atTick or atSample.');
      const clips=args.clipIds.map(id=>find(project.clips,id,'Clip')),map=compileTempoMap(project.tempoMap,project.ppq),elapsed=args.atSample!==undefined;
      const source=clips.map(clip=>elapsed?(clip.type==='audio'?clip.startSample:map.tickToSeconds(clip.startTick)*project.sampleRate):(clip.type==='midi'?clip.startTick:map.secondsToTick(clip.startSample/project.sampleRate)));
      const anchor=Math.min(...source),delta=(elapsed?args.atSample:args.atTick)-anchor,positions=clips.map((clip,index)=>{const target=source[index]+delta;const value=elapsed?(clip.type==='audio'?Math.round(target):Math.round(map.secondsToTick(target/project.sampleRate))):(clip.type==='midi'?Math.round(target):Math.round(map.tickToSeconds(target)*project.sampleRate));if(!Number.isSafeInteger(value)||value<0)fail('TIME_OVERFLOW','Group move exceeds safe project positions.');return value;});
      clips.forEach((clip,index)=>{clip[clip.type==='midi'?'startTick':'startSample']=positions[index];changes.updated.push(clip.id);});changes.groupMove={timeBase:elapsed?'elapsed':'musical',anchor,delta};resolvedTargets=clips.map(c=>c.id);break;
    }
    case 'clips.setMute': {
      const clips=args.clipIds.map(id=>find(project.clips,id,'Clip'));for(const clip of clips){clip.mute=args.mute;changes.updated.push(clip.id);}resolvedTargets=clips.map(c=>c.id);break;
    }
    case 'clips.nudge': {
      const clips=args.clipIds.map(id=>find(project.clips,id,'Clip')),grid=compileEditorSnap(project,{scope:'primary'}),map=compileTempoMap(project.tempoMap,project.ppq),steps=args.direction*(args.steps??1);
      const round=value=>{const policy=grid.config.sourceRounding;if(policy==='exact'&&Math.abs(value-Math.round(value))>1e-6)fail('INEXACT_NUDGE','Elapsed nudge is not exactly representable in destination ticks/samples; choose an explicit rounding policy.');const result=policy==='floor'?Math.floor(value+1e-9):policy==='ceil'?Math.ceil(value-1e-9):Math.round(value);if(!Number.isSafeInteger(result)||result<0)fail('NUDGE_OUT_OF_BOUNDS','Nudged position exceeds project bounds.');return result;};
      let deltaTicks=0,deltaSeconds=0;
      if(grid.mode==='musical'){
        deltaTicks=grid.stepTicks*steps;const anchor=clips[0],tick=anchor.type==='midi'?anchor.startTick:map.secondsToTick(anchor.startSample/project.sampleRate);
        if(tick+deltaTicks<0)fail('NUDGE_OUT_OF_BOUNDS','Nudge would precede project start.');deltaSeconds=map.tickToSeconds(tick+deltaTicks)-map.tickToSeconds(tick);
      }else{const elapsed=compilePointerTimeGrid(project,{scope:'primary',gridType:grid.gridType,sourceRounding:grid.config.sourceRounding});deltaSeconds=Number(elapsed.step)*Number(elapsed.unitRate.denominator)/Number(elapsed.unitRate.numerator)*steps;}
      for(const clip of clips){
        if(clip.type==='midi'){const tick=grid.mode==='musical'?clip.startTick+deltaTicks:map.secondsToTick(map.tickToSeconds(clip.startTick)+deltaSeconds);clip.startTick=round(tick);}
        else{const position=clip.startSample+deltaSeconds*project.sampleRate;clip.startSample=grid.mode==='musical'?Math.round(position):round(position);if(!Number.isSafeInteger(clip.startSample)||clip.startSample<0)fail('NUDGE_OUT_OF_BOUNDS','Nudge would precede project start.');}
        changes.updated.push(clip.id);
      }
      changes.nudge={mode:grid.mode,direction:args.direction,steps:args.steps??1,deltaTicks,deltaSeconds};resolvedTargets=clips.map(c=>c.id);break;
    }
    case 'audio.clips.silence': {
      if(args.range&&args.range.endSample<=args.range.startSample)fail('INVALID_SILENCE_RANGE','Range end must follow its start.');
      const clips=args.clipIds.map(id=>find(project.clips,id,'Clip'));if(clips.some(c=>c.type!=='audio'))fail('TYPE_MISMATCH','Silence requires audio clips only.');
      for(const clip of clips){
        const asset=find(project.assets,clip.assetId,'Asset'),range=args.range;
        const start=range?Math.max(clip.offsetFrames,clip.offsetFrames+Math.floor((range.startSample-clip.startSample)/project.sampleRate*asset.sampleRate)):clip.offsetFrames;
        const end=range?Math.min(clip.offsetFrames+clip.lengthFrames,clip.offsetFrames+Math.ceil((range.endSample-clip.startSample)/project.sampleRate*asset.sampleRate)):clip.offsetFrames+clip.lengthFrames;
        if(end<=start)continue;
        const next=editSilenceRanges(clip.silencedRanges??[],start,end,args.clear??false);if(next.length)clip.silencedRanges=next;else delete clip.silencedRanges;
        changes.updated.push(clip.id);
      }
      if(!changes.updated.length)fail('NOTHING_TO_SILENCE','No selected audio clips overlap the range.');resolvedTargets=[...changes.updated];break;
    }
    case 'audio.clip.restoreProcessing': {
      const current=find(project.clips,args.clipId,'Clip');if(current.type!=='audio'||args.snapshot.type!=='audio')fail('TYPE_MISMATCH','Processing restore requires audio.');find(project.assets,args.snapshot.assetId,'Source asset');const restored={...clone(args.snapshot),id:current.id,trackId:current.trackId,name:current.name,startSample:current.startSample};if(Object.hasOwn(current,'mute'))restored.mute=current.mute;else delete restored.mute;project.clips[project.clips.indexOf(current)]=restored;changes.updated.push(current.id);resolvedTargets=[current.id];break;
    }
    case 'audio.clip.applyTimeStretch': {
      const clip=find(project.clips,args.clipId,'Clip');if(clip.type!=='audio')fail('TYPE_MISMATCH','Time stretch requires audio.');const source=find(project.assets,clip.assetId,'Source asset'),asset=find(project.assets,args.assetId,'Processed asset');if(source.sampleRate!==asset.sampleRate||source.channels!==asset.channels)fail('STRETCH_FORMAT_MISMATCH','Processed audio must retain source sample rate and channel count.');
      const before=clone(clip);if(clip.snapPointFrame!==undefined){const relative=clip.snapPointFrame-clip.offsetFrames;if(relative<0||relative>clip.lengthFrames)fail('UNMAPPED_SNAP_POINT','Move snap point into the event before stretching.');clip.snapPointFrame=Math.round(relative/clip.lengthFrames*asset.frames);}
      clip.assetId=asset.id;clip.offsetFrames=0;clip.lengthFrames=asset.frames;clip.gainDb=0;if(args.startSample!==undefined)clip.startSample=args.startSample;
      for(const key of ['invertPolarity','reverse','reverseWindow','dcOffsets','fadeInFrames','fadeOutFrames','fadeInShape','fadeOutShape','fadeWindow','volumeEnvelope','silencedRanges'])delete clip[key];
      changes.updated.push(clip.id);changes.timeStretch={sourceClip:before,processedAssetId:asset.id,policy:'Event processing baked; track/master processing remains editable. Original asset retained.'};resolvedTargets=[clip.id];break;
    }
    case 'audio.clip.resizeContents':
    case 'audio.clip.trim': {
      const clip=find(project.clips,args.clipId,'Clip');if(clip.type!=='audio')fail('TYPE_MISMATCH','Audio trim requires an audio clip.');
      const asset=find(project.assets,clip.assetId,'Asset');let divisor=project.sampleRate,b=asset.sampleRate;while(b)[divisor,b]=[b,divisor%b];
      const step=asset.sampleRate/divisor,delta=args.edge==='left'?Math.round(args.deltaFrames/step)*step:args.deltaFrames;
      if(!Number.isSafeInteger(delta))fail('TIME_OVERFLOW','Trim delta exceeds safe source-frame range.');
      if(!clip.fadeWindow&&(clip.fadeInFrames||clip.fadeOutFrames))clip.fadeWindow={offsetFrames:clip.offsetFrames,lengthFrames:clip.lengthFrames};
      if(clip.reverse&&!clip.reverseWindow)clip.reverseWindow={offsetFrames:clip.offsetFrames,lengthFrames:clip.lengthFrames};
      const movesContents=command==='audio.clip.resizeContents',offset=movesContents?(args.edge==='left'?clip.offsetFrames:clip.offsetFrames-delta):(args.edge==='left'?clip.offsetFrames+delta:clip.offsetFrames),length=args.edge==='left'?clip.lengthFrames-delta:clip.lengthFrames+delta,start=args.edge==='left'?clip.startSample+delta/step*(project.sampleRate/divisor):clip.startSample;
      if(![offset,length,start].every(Number.isSafeInteger)||offset<0||length<1||start<0||offset>asset.frames-length)fail('INVALID_AUDIO_TRIM','Trim must keep positive clip length and fit source/project bounds.');
      clip.offsetFrames=offset;clip.lengthFrames=length;clip.startSample=start;
      changes.updated.push(clip.id);changes.trim={mode:movesContents?'moveContents':'normal',edge:args.edge,requestedDeltaFrames:args.deltaFrames,appliedDeltaFrames:delta,sourceGridFrames:args.edge==='left'?step:1};resolvedTargets=[clip.id];break;
    }
    case 'audio.clips.fadesToRange': {
      if(args.endSample<=args.startSample)fail('INVALID_AUDIO_FADE','Range end must follow range start.');
      const clips=args.clipIds.map(id=>find(project.clips,id,'Clip'));
      for(const clip of clips){
        if(clip.type!=='audio')fail('TYPE_MISMATCH','Range fades require audio clips only.');
        const asset=find(project.assets,clip.assetId,'Asset'),start=clip.startSample,end=start+clip.lengthFrames/asset.sampleRate*project.sampleRate;
        if(args.endSample<=start||args.startSample>=end)fail('INVALID_AUDIO_FADE','Every selected clip must overlap the range.',{clipId:clip.id});
        if(args.mode==='adjust'&&(args.startSample<=start||args.endSample>=end))fail('INVALID_AUDIO_FADE','Adjust both fades requires a range strictly inside every selected clip.',{clipId:clip.id});
        const toFrames=samples=>Math.max(0,Math.min(clip.lengthFrames,Math.round(samples/project.sampleRate*asset.sampleRate)));
        if(args.mode==='in'||args.mode==='adjust'){
          const target=args.startSample<=start?args.endSample:args.startSample;
          clip.fadeInFrames=toFrames(target-start);if(args.shape)clip.fadeInShape=args.shape;
        }
        if(args.mode==='out'||args.mode==='adjust'){
          const target=args.endSample>=end?args.startSample:args.endSample;
          clip.fadeOutFrames=toFrames(end-target);if(args.shape)clip.fadeOutShape=args.shape;
        }
        clip.fadeWindow={offsetFrames:clip.offsetFrames,lengthFrames:clip.lengthFrames};
        clip.fadeInFrames=Math.min(clip.fadeInFrames??0,clip.lengthFrames);clip.fadeOutFrames=Math.min(clip.fadeOutFrames??0,clip.lengthFrames);
        changes.updated.push(clip.id);
      }
      resolvedTargets=clips.map(c=>c.id);break;
    }
    case 'audio.clips.fades':
    case 'audio.clips.removeFades': {
      const clips=args.clipIds.map(id=>find(project.clips,id,'Clip'));
      if(clips.some(c=>c.type!=='audio'))fail('TYPE_MISMATCH','Fade operations require audio clips only.');
      const removing=command==='audio.clips.removeFades';
      if(!removing&&!Object.hasOwn(args,'fadeInMs')&&!Object.hasOwn(args,'fadeOutMs'))fail('INVALID_AUDIO_FADE','Specify fadeInMs or fadeOutMs.');
      for(const clip of clips){
        if(removing){
          for(const side of ['in','out'])if(args.side==='both'||args.side===side){delete clip[side==='in'?'fadeInFrames':'fadeOutFrames'];delete clip[side==='in'?'fadeInShape':'fadeOutShape'];}
          if(!clip.fadeInFrames&&!clip.fadeOutFrames)delete clip.fadeWindow;
        }else{
          const asset=find(project.assets,clip.assetId,'Asset');
          for(const [key,ms] of [['fadeInFrames','fadeInMs'],['fadeOutFrames','fadeOutMs']])if(Object.hasOwn(args,ms)){
            const frames=Math.round(args[ms]/1000*asset.sampleRate);
            if(frames>clip.lengthFrames)fail('INVALID_AUDIO_FADE','Requested fade is longer than a selected clip.',{clipId:clip.id});
            clip[key]=frames;if(args.shape)clip[key==='fadeInFrames'?'fadeInShape':'fadeOutShape']=args.shape;
          }
          clip.fadeWindow={offsetFrames:clip.offsetFrames,lengthFrames:clip.lengthFrames};
          clip.fadeInFrames=Math.min(clip.fadeInFrames??0,clip.lengthFrames);clip.fadeOutFrames=Math.min(clip.fadeOutFrames??0,clip.lengthFrames);
        }
        changes.updated.push(clip.id);
      }
      resolvedTargets=clips.map(c=>c.id);break;
    }
    case 'audio.clip.envelope': {
      const clip=find(project.clips,args.clipId,'Clip');
      if(clip.type!=='audio')fail('TYPE_MISMATCH','Volume envelope requires an audio clip.');
      if(args.points.length)clip.volumeEnvelope=clone(args.points);else delete clip.volumeEnvelope;
      changes.updated.push(clip.id);resolvedTargets=[clip.id];break;
    }
    case 'audio.clips.crossfade': {
      const left=find(project.clips,args.leftClipId,'Clip'),right=find(project.clips,args.rightClipId,'Clip');
      if(left.id===right.id||left.type!=='audio'||right.type!=='audio'||left.trackId!==right.trackId)fail('INVALID_CROSSFADE','Crossfade requires two distinct audio clips on the same track.');
      const leftAsset=find(project.assets,left.assetId,'Asset'),rightAsset=find(project.assets,right.assetId,'Asset');
      const leftEnd=left.startSample+left.lengthFrames/leftAsset.sampleRate*project.sampleRate;
      const rightEnd=right.startSample+right.lengthFrames/rightAsset.sampleRate*project.sampleRate;
      if(right.startSample<=left.startSample||right.startSample>=leftEnd||rightEnd<leftEnd)fail('INVALID_CROSSFADE','The right clip must start inside the left clip and extend to its end or beyond.');
      const overlap=leftEnd-right.startSample;
      const fadeOut=Math.round(overlap/project.sampleRate*leftAsset.sampleRate),fadeIn=Math.round(overlap/project.sampleRate*rightAsset.sampleRate);
      if(fadeOut<1||fadeIn<1)fail('INVALID_CROSSFADE','Overlap is shorter than a source frame.');
      left.fadeOutFrames=Math.min(left.lengthFrames,fadeOut);right.fadeInFrames=Math.min(right.lengthFrames,fadeIn);
      left.fadeOutShape=right.fadeInShape=args.shape??'linear';
      for(const clip of [left,right]){clip.fadeWindow={offsetFrames:clip.offsetFrames,lengthFrames:clip.lengthFrames};clip.fadeInFrames=Math.min(clip.fadeInFrames??0,clip.lengthFrames);clip.fadeOutFrames=Math.min(clip.fadeOutFrames??0,clip.lengthFrames);}
      changes.updated.push(left.id,right.id);resolvedTargets=[left.id,right.id];break;
    }
    case 'audio.clip.snapToCursor': {
      const clip=find(project.clips,args.clipId,'Clip');if(clip.type!=='audio')fail('TYPE_MISMATCH','Event snap points require audio.');const asset=find(project.assets,clip.assetId,'Asset'),delta=args.atSample-clip.startSample;
      if(delta<0||BigInt(delta)*BigInt(asset.sampleRate)>BigInt(clip.lengthFrames)*BigInt(project.sampleRate))fail('INVALID_SNAP_POINT','Place the project cursor inside the selected audio event.');
      clip.snapPointFrame=clip.offsetFrames+Math.round(delta/project.sampleRate*asset.sampleRate);changes.updated.push(clip.id);resolvedTargets=[clip.id];break;
    }
    case 'audio.clip.slip': {
      const clip=find(project.clips,args.clipId,'Clip');
      if(clip.type!=='audio')fail('TYPE_MISMATCH','Source slip requires an audio clip.');
      const asset=find(project.assets,clip.assetId,'Asset'),delta=args.deltaFrames;
      const windows=[clip,...['fadeWindow','reverseWindow'].filter(k=>clip[k]).map(k=>clip[k])];
      for(const window of windows){const offset=window.offsetFrames+delta;if(!Number.isSafeInteger(offset)||offset<0||offset>asset.frames-window.lengthFrames)fail('INVALID_AUDIO_SLIP','Shifted source window must fit the original asset.');}
      if(clip.volumeEnvelope)for(const point of clip.volumeEnvelope){const frame=point.frame+delta;if(!Number.isSafeInteger(frame)||frame<0||frame>=asset.frames)fail('INVALID_AUDIO_SLIP','Shifted envelope points must fit the original asset.');point.frame=frame;}
      if(clip.silencedRanges)for(const range of clip.silencedRanges){const start=range.startFrame+delta,end=range.endFrame+delta;if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end>asset.frames)fail('INVALID_AUDIO_SLIP','Shifted silence regions must fit source bounds.');range.startFrame=start;range.endFrame=end;}
      for(const window of windows)window.offsetFrames+=delta;
      changes.updated.push(clip.id);resolvedTargets=[clip.id];break;
    }
    case 'midi.clip.resizeStart': {
      const clip=getMidiClip(project,args.clipId),delta=args.deltaTicks,start=clip.startTick+delta,length=clip.lengthTicks-delta;
      if(!Number.isSafeInteger(start)||start<0||!Number.isSafeInteger(length)||length<1)fail('INVALID_MIDI_RESIZE','Part boundaries must remain positive and inside project time.');
      if(clip.notes.some(n=>n.startTick<delta)||(clip.events??[]).some(e=>e.tick<delta))fail('MIDI_RESIZE_TRUNCATION','Sizing cannot discard notes or controllers; split the part first.');
      clip.startTick=start;clip.lengthTicks=length;
      for(const note of clip.notes){note.startTick-=delta;if(note.quantizeReference)note.quantizeReference.startTick-=delta;changes.updated.push(note.id);}
      for(const event of clip.events??[]){event.tick-=delta;if(event.curve?.window){event.curve.window.startTick-=delta;event.curve.window.endTick-=delta;}changes.updated.push(event.id);}
      changes.invalidatedQuantizeNoteIds=invalidateOutsideQuantizeReferences(clip);
      changes.updated.push(clip.id);resolvedTargets=[clip.id];break;
    }
    case 'clip.update': {
      const clip = find(project.clips, args.clipId, 'Clip');
      const incompatible = clip.type === 'midi' ? ['startSample', 'offsetFrames', 'lengthFrames', 'gainDb','dcOffsets','fadeInFrames','fadeOutFrames','fadeInShape','fadeOutShape','invertPolarity','reverse'] : ['startTick', 'lengthTicks','allowNoteTails'];
      for (const key of incompatible) if (Object.hasOwn(args, key)) fail('TYPE_MISMATCH', `Field ${key} does not apply to a ${clip.type} clip.`, { clipId: clip.id, field: key });
      const enableReverse=clip.type==='audio'&&args.reverse===true&&!clip.reverse;
      const resetFade=clip.type==='audio'&&['fadeInFrames','fadeOutFrames','offsetFrames','lengthFrames'].some(k=>Object.hasOwn(args,k)&&args[k]!==clip[k]);
      patch(clip, args, ['clipId']);
      if(enableReverse)clip.reverseWindow={offsetFrames:clip.offsetFrames,lengthFrames:clip.lengthFrames};
      if(resetFade&&(clip.fadeInFrames||clip.fadeOutFrames||clip.fadeWindow))clip.fadeWindow={offsetFrames:clip.offsetFrames,lengthFrames:clip.lengthFrames};
      if (clip.type === 'midi' && Object.hasOwn(args, 'lengthTicks')) changes.invalidatedQuantizeNoteIds = invalidateOutsideQuantizeReferences(clip);
      changes.updated.push(clip.id); resolvedTargets = [clip.id]; break;
    }
    case 'clip.remove': {
      const clip = find(project.clips, args.clipId, 'Clip');
      changes.removed = clipIds(clip); project.clips = project.clips.filter(item => item.id !== clip.id);
      resolvedTargets = [...changes.removed]; break;
    }
    case 'midi.record.take': {
      const take=compileMidiTake(project,args),mode=args.mode??'new';let track,clip,recordedNotes=[],recordedEvents=[],recordedOrderBase=0;
      if(mode==='merge'){
        if(!args.targetClipId||args.clipId)fail('INVALID_MIDI_TAKE_TARGET','Merge requires targetClipId and cannot assign a new clipId.');
        clip=getMidiClip(project,args.targetClipId);track=find(project.tracks,clip.trackId,'Track');if(args.trackId&&args.trackId!==track.id)fail('INVALID_MIDI_TAKE_TARGET','Track and target clip must agree.');
        const start=Math.min(clip.startTick,args.startTick),end=Math.max(clip.startTick+clip.lengthTicks,args.startTick+take.lengthTicks),shift=clip.startTick-start,offset=args.startTick-start;
        let maximum=-1;for(const part of project.clips)if(part.id===clip.id||clip.midiOrderGroup&&part.midiOrderGroup===clip.midiOrderGroup){for(const note of part.notes??[])for(const key of ['onOrder','offOrder'])if(note[key]!==undefined)maximum=Math.max(maximum,note[key]);for(const event of part.events??[])maximum=Math.max(maximum,event.order);}
        const base=maximum+1;if(!Number.isSafeInteger(base))fail('MIDI_ORDER_OVERFLOW','No source order remains for a merged take.');
        if(shift){for(const note of clip.notes){note.startTick+=shift;if(note.quantizeReference)note.quantizeReference.startTick+=shift;changes.updated.push(note.id);}for(const event of clip.events??[]){event.tick+=shift;if(event.curve?.window){event.curve.window.startTick+=shift;event.curve.window.endTick+=shift;}changes.updated.push(event.id);}}
        clip.startTick=start;clip.lengthTicks=end-start;
        const notes=take.notes.map(note=>withNoteDefaults({...note,startTick:note.startTick+offset,onOrder:note.onOrder+base,offOrder:note.offOrder+base})),events=take.events.map(event=>({...event,tick:event.tick+offset,order:event.order+base}));
        if(notes.some(n=>!Number.isSafeInteger(n.onOrder)||!Number.isSafeInteger(n.offOrder))||events.some(e=>!Number.isSafeInteger(e.order)))fail('MIDI_ORDER_OVERFLOW','Merged take source order exceeds safe range.');
        clip.notes=clip.notes.concat(notes);normalizeInsertedCurves(clip,events,changes);const added=addMidiEvents(clip,events);changes.created=notes.map(n=>n.id).concat(added.map(e=>e.id));changes.updated.push(clip.id);recordedNotes=notes;recordedEvents=added;recordedOrderBase=base;
      }else{
        if(args.targetClipId)fail('INVALID_MIDI_TAKE_TARGET','targetClipId requires merge mode.');
        if(args.trackId){track=find(project.tracks,args.trackId,'Track');if(track.type!=='midi')fail('TYPE_MISMATCH','MIDI take requires a MIDI track.');}
        else{if(mode==='replace')fail('INVALID_MIDI_TAKE_TARGET','Replace requires an existing MIDI track.');track={id:newId('track'),name:args.name??'MIDI Recording',type:'midi',color:'#a3f0bf',gainDb:0,pan:0,mute:false,solo:false,instrument:'sine'};applyNewTrackTimeBase(project,track);project.tracks.push(track);changes.created.push(track.id);}
        if(mode==='replace'){const right=args.startTick+Math.max(1,take.lengthTicks-1);if(!Number.isSafeInteger(right))fail('TIME_OVERFLOW','Take end exceeds safe tick range.');const replaced=replaceMidiTrackRange(project,track.id,args.startTick,right);for(const key of ['created','updated','removed'])changes[key]=changes[key].concat(replaced[key]);changes.replacement=replaced.replacement;}
        clip={id:args.clipId??newId('clip'),trackId:track.id,type:'midi',name:args.name??'MIDI Take',startTick:args.startTick,lengthTicks:take.lengthTicks,notes:take.notes.map(withNoteDefaults)};addMidiEvents(clip,take.events);project.clips.push(clip);changes.created=changes.created.concat(clipIds(clip));recordedNotes=clip.notes;recordedEvents=clip.events??[];
      }
      quantizeRecordedTake(clip,recordedNotes,recordedEvents,take,args,recordedOrderBase,changes);
      changes.warnings=[...(changes.warnings??[]),...take.warnings];changes.recording={...take.recording,mode,clipId:clip.id,trackId:track.id};resolvedTargets=[track.id,clip.id,...changes.created];break;
    }
    case 'midi.notes.inputValues': {
      const clip=getMidiClip(project,args.clipId),result=applyMidiInputEdit(clip,args);changes.created.push(...result.created);changes.updated.push(clip.id,...result.updated);changes.removed.push(...result.removed);changes.inputEdit=result.inputEdit;resolvedTargets=[clip.id,...result.inputEdit.noteIds];break;
    }
    case 'midi.notes.add': {
      const clip = getMidiClip(project, args.clipId);
      const notes = args.notes.map(withNoteDefaults); clip.notes = clip.notes.concat(notes);
      changes.created = notes.map(note => note.id); changes.updated.push(clip.id);
      resolvedTargets = [clip.id, ...changes.created]; break;
    }
    case 'midi.notes.update': {
      const clip = getMidiClip(project, args.clipId); const note = find(clip.notes, args.noteId, 'Note');
      const previousStart = note.startTick, previousDuration = note.durationTicks;
      patch(note, args, ['clipId', 'noteId']);
      if (note.quantizeReference && (previousStart !== note.startTick || previousDuration !== note.durationTicks)) {
        delete note.quantizeReference; changes.invalidatedQuantizeNoteIds = [note.id];
      }
      changes.updated.push(note.id); resolvedTargets = [clip.id, note.id]; break;
    }
    case 'midi.notes.remove': {
      const clip = getMidiClip(project, args.clipId);
      for (const id of args.noteIds) find(clip.notes, id, 'Note');
      const removed = new Set(args.noteIds); clip.notes = clip.notes.filter(note => !removed.has(note.id));
      changes.removed = [...args.noteIds]; changes.updated.push(clip.id); resolvedTargets = [clip.id, ...args.noteIds]; break;
    }
    case 'midi.events.add': {
      const clip = getMidiClip(project, args.clipId); normalizeInsertedCurves(clip,args.events,changes); const added = addMidiEvents(clip, args.events);
      changes.created = changes.created.concat(added.map(event => event.id)); changes.updated.push(clip.id); resolvedTargets = [clip.id, ...changes.created]; break;
    }
    case 'midi.events.update': {
      const clip = getMidiClip(project, args.clipId), event = find(clip.events ?? [], args.eventId, 'MIDI event');
      if (Object.hasOwn(args, 'channel') && event.kind !== 'channel') fail('TYPE_MISMATCH', 'Channel applies only to channel MIDI messages.', { eventId: event.id });
      if (!Object.keys(args).some(key => !['clipId', 'eventId'].includes(key))) fail('EMPTY_UPDATE', 'At least one editable event field is required.');
      if (Object.hasOwn(args,'tick') && args.tick!==event.tick || Object.hasOwn(args,'data') && JSON.stringify(args.data)!==JSON.stringify(event.data) || Object.hasOwn(args,'channel') && args.channel!==(event.status&15) || Object.hasOwn(args,'order') && args.order!==event.order) normalizeEditedCurves(clip,[event.id],changes);
      if (Object.hasOwn(args,'tick') || Object.hasOwn(args,'data') || Object.hasOwn(args,'channel')) normalizeInsertedCurves(clip,[{...event,tick:args.tick??event.tick,data:args.data??event.data,status:Object.hasOwn(args,'channel')?(event.status&0xf0)|args.channel:event.status}],changes);
      for (const key of ['tick', 'data', 'order']) if (Object.hasOwn(args, key)) event[key] = clone(args[key]);
      if (Object.hasOwn(args, 'channel')) event.status = (event.status & 0xf0) | args.channel;
      changes.updated.push(event.id); resolvedTargets = [clip.id, event.id]; break;
    }
    case 'midi.events.remove': {
      const clip = getMidiClip(project, args.clipId);
      for (const id of args.eventIds) find(clip.events ?? [], id, 'MIDI event');
      normalizeEditedCurves(clip,args.eventIds,changes);
      const removed = new Set(args.eventIds); clip.events = clip.events.filter(event => !removed.has(event.id));
      changes.removed = [...args.eventIds]; changes.updated.push(clip.id); resolvedTargets = [clip.id, ...args.eventIds]; break;
    }
    case 'sourceArchive.add':
      project.sourceArchives=[...(project.sourceArchives??[]),clone(args.archive)];changes.created.push(args.archive.id);resolvedTargets=[args.archive.id];break;
    case 'asset.add':
      project.assets.push(clone(args.asset)); changes.created.push(args.asset.id); resolvedTargets = [args.asset.id]; break;
    case 'asset.relink':
      resolvedTargets = relinkAssets(project, args, changes); break;
    case 'asset.removeMissing': {
      const assetIds = new Set(args.assetIds), registered = new Set(project.assets.map(asset => asset.id));
      for (const assetId of assetIds) if (!registered.has(assetId)) fail('NOT_FOUND', 'Missing asset registration was not found.', { assetId });
      const removedClipIds = project.clips.filter(clip => clip.type === 'audio' && assetIds.has(clip.assetId)).map(clip => clip.id);
      project.assets = project.assets.filter(asset => !assetIds.has(asset.id));
      project.clips = project.clips.filter(clip => clip.type !== 'audio' || !assetIds.has(clip.assetId));
      changes.removed = [...args.assetIds, ...removedClipIds];
      changes.removedMissing = { assetIds: [...args.assetIds], clipIds: removedClipIds, assetCount: args.assetIds.length, clipCount: removedClipIds.length };
      resolvedTargets = [...changes.removed]; break;
    }
    default:
      fail('UNKNOWN_COMMAND', `Unsupported mutation command: ${command}.`, { command });
  }
  validateProject(project);
  return { changes, resolvedTargets };
}

function batchCommands(envelope) {
  const commands = envelope.command === 'batch' ? envelope.arguments.commands : [{ command: envelope.command, arguments: envelope.arguments }];
  for (const [batchIndex, item] of commands.entries()) {
    try {
      if (item.command === 'batch' || item.command.startsWith('history.')) fail('INVALID_BATCH_COMMAND', 'Nested batches and history commands are not allowed in a batch.', { command: item.command });
      validateCommand(item.command, item.arguments);
    } catch (error) {
      if (envelope.command === 'batch' && error instanceof EngineError) error.details = { ...error.details, batchIndex };
      throw error;
    }
  }
  return commands;
}

const DEFAULT_MAX_STEPS = 100;
const historyIdSchema = { type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' };
const safeIntegerSchema = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const historySummarySchema = {
  type: 'object', properties: {
    created: safeIntegerSchema, updated: safeIntegerSchema, removed: safeIntegerSchema, targets: safeIntegerSchema,
    commands: { type: 'array', maxItems: 1000, items: { type: 'string', minLength: 1, maxLength: 256 } },
  }, required: ['created', 'updated', 'removed', 'targets', 'commands'], additionalProperties: false,
};
const historyEntrySchema = {
  type: 'object', properties: {
    id: historyIdSchema, boundaryId: historyIdSchema,
    action: { type: 'string', minLength: 1, maxLength: 256 }, label: { type: 'string', minLength: 1, maxLength: 256 },
    time: { oneOf: [{ const: null }, { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$' }] },
    revision: { oneOf: [{ const: null }, { ...safeIntegerSchema, minimum: 1 }] },
    description: { type: 'string', maxLength: 2048 }, summary: historySummarySchema,
  }, required: ['id', 'boundaryId', 'action', 'label', 'time', 'revision', 'description', 'summary'], additionalProperties: false,
};

function initialHistory(project) {
  return { maxSteps: DEFAULT_MAX_STEPS, baseBoundaryId: newId('boundary'), cursor: 0, entries: [], snapshots: [project] };
}

// Internal snapshots and metadata are never mutated after publication. Candidate edits shallow-copy
// the sequence, replace only changed values, and clone project state before editing it.
function copyHistory(history) {
  return { ...history, entries: history.entries.slice(), snapshots: history.snapshots.slice() };
}

function boundaryAt(history, index) { return index === 0 ? history.baseBoundaryId : history.entries[index - 1].boundaryId; }

function dropOneHistoryEntry(history, droppedEntryIds, droppedBoundaryIds) {
  if (!history.entries.length) return false;
  if (history.cursor > 0) {
    const removed = history.entries.shift();
    droppedEntryIds.push(removed.id); droppedBoundaryIds.push(history.baseBoundaryId);
    history.baseBoundaryId = removed.boundaryId;
    history.snapshots.shift(); history.cursor--;
  } else {
    const removed = history.entries.pop();
    droppedEntryIds.push(removed.id); droppedBoundaryIds.push(removed.boundaryId);
    history.snapshots.pop();
  }
  return true;
}

function trimHistorySteps(history) {
  const droppedEntryIds = [], droppedBoundaryIds = [];
  while (history.entries.length > history.maxSteps) dropOneHistoryEntry(history, droppedEntryIds, droppedBoundaryIds);
  return { droppedEntryIds, droppedBoundaryIds };
}

function historyDocument(history, project) {
  return {
    schemaVersion: 2, projectId: project.id, projectRevision: project.revision,
    maxSteps: history.maxSteps, baseBoundaryId: history.baseBoundaryId, cursor: history.cursor,
    entries: history.entries,
    // The current project already exists in the checkpoint/session file. Exactly this boundary is
    // represented by null; all other boundaries carry full project states, including note metadata.
    snapshots: history.snapshots.map((snapshot, index) => index === history.cursor ? null : snapshot),
  };
}

function validateHistorySnapshot(snapshot, project, details) {
  validateProject(snapshot);
  if (snapshot.id !== project.id || snapshot.ppq !== project.ppq || snapshot.sampleRate !== project.sampleRate || snapshot.revision > project.revision) {
    fail('INVALID_HISTORY', 'History belongs to an incompatible project or revision.', details);
  }
}

function readHistory(history, project) {
  if (history?.schemaVersion === 1) {
    validateSchema(history, { type: 'object', properties: {
      schemaVersion: { const: 1 }, projectId: { const: project.id }, projectRevision: { const: project.revision },
      undo: { type: 'array', items: {} }, redo: { type: 'array', items: {} },
    }, required: ['schemaVersion', 'projectId', 'projectRevision', 'undo', 'redo'], additionalProperties: false }, '$.history');
    for (const [stack, snapshots] of [['undo', history.undo], ['redo', history.redo]]) {
      for (const [index, snapshot] of snapshots.entries()) validateHistorySnapshot(snapshot, project, { stack, index });
    }
    const snapshots = clone([...history.undo, project, ...history.redo.toReversed()]);
    const entries = Array.from({ length: snapshots.length - 1 }, () => ({
      id: newId('history'), boundaryId: newId('boundary'), action: 'legacy', label: 'Restored edit',
      time: null, revision: null, description: '', summary: { created: 0, updated: 0, removed: 0, targets: 0, commands: [] },
    }));
    const state = { maxSteps: DEFAULT_MAX_STEPS, baseBoundaryId: newId('boundary'), cursor: history.undo.length, entries, snapshots };
    const trimmed = trimHistorySteps(state);
    return { state, report: { migrated: true, ...trimmed } };
  }
  validateSchema(history, { type: 'object', properties: {
    schemaVersion: { const: 2 }, projectId: { const: project.id }, projectRevision: { const: project.revision },
    maxSteps: { type: 'integer', minimum: 1, maximum: 1000 }, baseBoundaryId: historyIdSchema,
    cursor: safeIntegerSchema, entries: { type: 'array', maxItems: 1000, items: historyEntrySchema },
    snapshots: { type: 'array', maxItems: 1001, items: {} },
  }, required: ['schemaVersion', 'projectId', 'projectRevision', 'maxSteps', 'baseBoundaryId', 'cursor', 'entries', 'snapshots'], additionalProperties: false }, '$.history');
  if (history.entries.length > history.maxSteps || history.cursor > history.entries.length || history.snapshots.length !== history.entries.length + 1) {
    fail('INVALID_HISTORY', 'History entry, cursor, snapshot or retention counts are inconsistent.');
  }
  const ids = new Set([history.baseBoundaryId]);
  for (const [index, entry] of history.entries.entries()) {
    for (const id of [entry.id, entry.boundaryId]) {
      if (ids.has(id)) fail('INVALID_HISTORY', 'History IDs must be unique.', { id, index });
      ids.add(id);
    }
    if (entry.time !== null && (!Number.isFinite(Date.parse(entry.time)) || new Date(entry.time).toISOString() !== entry.time)) fail('INVALID_HISTORY', 'History entry time is invalid.', { index });
    if (entry.revision !== null && entry.revision > project.revision) fail('INVALID_HISTORY', 'History entry revision is newer than the project.', { index });
  }
  for (const [index, snapshot] of history.snapshots.entries()) {
    if (index === history.cursor) {
      if (snapshot !== null) fail('INVALID_HISTORY', 'The current history boundary must use the null project placeholder.', { index });
    } else {
      if (snapshot === null) fail('INVALID_HISTORY', 'Only the current history boundary may omit its snapshot.', { index });
      validateHistorySnapshot(snapshot, project, { index });
    }
  }
  const state = clone({ maxSteps: history.maxSteps, baseBoundaryId: history.baseBoundaryId, cursor: history.cursor, entries: history.entries, snapshots: history.snapshots });
  state.snapshots[state.cursor] = clone(project);
  return { state, report: { migrated: false, droppedEntryIds: [], droppedBoundaryIds: [] } };
}

const actionLabels = {
  'midi.notes.pedalsToLength':'Pedals to note lengths',
  'midi.step':'Step input',
  'midi.notes.reverse':'Reverse/Mirror notes',
  'midi.notes.deleteOverlaps':'Delete note overlaps',
  'midi.notes.length':'Edit note lengths',
  'midi.notes.split':'Split notes', 'midi.notes.glue':'Glue notes',
  'midi.notes.paint':'Draw note velocities',
  'midi.notes.shape':'Shape note velocities',
  'midi.notes.restrictPolyphony':'Restrict note polyphony',
  'midi.parts.dissolve':'Dissolve MIDI parts',
  'midi.part.repeatLoop':'Repeat MIDI loop to part end',
  'midi.controllers.thin':'Thin CC data',
  'midi.controllers.delete':'Delete CC data',
  'midi.controllers.shape':'Generate controller shape',
  'midi.controllers.paint':'Paint controller range',
  'midi.controllers.bend':'Bend controller curve',
  'midi.mergeLoop':'Merge MIDI in Loop',
  'midi.modifiers.set':'MIDI modifiers', 'midi.trackParameters.set':'MIDI track parameters', 'midi.partModifiers.set':'MIDI part modifiers', 'midi.modifiers.freeze':'Freeze MIDI modifiers',
  'project.rename': 'Rename project', 'project.settings': 'Project settings', 'project.snapGrid': 'Snap grid settings', 'project.timeDisplay': 'Time display settings', 'tempo.set': 'Set tempo map', 'signature.set':'Set time signature',
  'clips.paste':'Paste clip snapshots',
  'clips.moveToTrack':'Move clips to track',
  'clips.moveGroup':'Move clip group',
  'clips.setMute':'Mute/unmute clips',
  'clips.repeat':'Repeat selected clips',
  'audio.clip.restoreProcessing':'Restore audio processing source',
  'audio.clip.applyTimeStretch':'Time stretch audio event',
  'audio.clip.resizeContents':'Resize and move audio contents',
  'midi.clip.resizeStart':'Resize MIDI part start',
  'audio.clip.snapToCursor':'Snap point to cursor',
  'clips.fillLoop':'Fill locator loop',
  'midi.clips.glue':'Glue MIDI parts', 'midi.clips.glueNext':'Glue following MIDI parts',
  'audio.clips.glue':'Rejoin audio fragments', 'audio.clips.glueNext':'Rejoin following audio fragments',
  'project.locatorsMove':'Move locator range',
  'project.locatorsResize':'Resize locator range',
  'project.locatorsFromClips':'Locators from selection',
  'track.eqFrequency':'Set EQ frequency', 'tracks.eqInvert':'Invert EQ gains',
  'project.effectPreset.put':'Save effect preset', 'project.effectPreset.rename':'Rename effect preset', 'project.effectPreset.remove':'Remove effect preset', 'tracks.effectPreset.apply':'Apply effect preset',
  'tracks.effectsApply':'Apply track effects',
  'tracks.clearMuteSolo':'Clear mute/solo', 'track.soloExclusive':'Exclusive solo',
  'tracks.removeEmpty':'Remove empty tracks',
  'track.add': 'Add track', 'track.update': 'Edit track', 'track.remove': 'Remove track', 'track.duplicate': 'Duplicate track', 'track.reorder': 'Reorder track',
  'clip.add': 'Add clip', 'clip.update': 'Edit clip', 'clip.remove': 'Remove clip', 'clip.duplicate': 'Duplicate clip', 'clip.split': 'Split clip', 'clip.move': 'Move clip',
  'midi.notes.add': 'Add notes', 'midi.notes.update': 'Edit note', 'midi.notes.remove': 'Remove notes',
  'midi.events.add': 'Add MIDI events', 'midi.events.update': 'Edit MIDI event', 'midi.events.remove': 'Remove MIDI events',
  'midi.notes.quantize': 'Quantize notes', 'midi.notes.resetQuantize': 'Reset quantize', 'midi.notes.freezeQuantize': 'Freeze quantize',
  'midi.notes.transpose': 'Transpose notes', 'midi.notes.velocity': 'Edit velocities', 'midi.notes.removeDoubles': 'Remove double notes', 'midi.notes.legato': 'Legato notes',
  'sourceArchive.add':'Archive original source',
  'asset.add': 'Register audio asset', 'asset.relink': 'Relink audio assets', 'asset.removeMissing': 'Remove missing audio assets',
};

function summarizeChanges(changes, targets, commands) {
  return { created: changes.created?.length ?? 0, updated: changes.updated?.length ?? 0, removed: changes.removed?.length ?? 0,
    targets: targets.length, commands: [...new Set(commands.map(item => item.command))] };
}

function historyDetails(entry) {
  if (entry.description) return entry.description;
  if (entry.action === 'legacy') return 'Restored history; original action details and time are unavailable.';
  const summary = entry.summary;
  return `${summary.created} created, ${summary.updated} updated, ${summary.removed} removed; ${summary.targets} targets`;
}

// Exact JSON UTF-8 size without constructing one potentially huge journal string. Snapshot byte
// sizes are cached across pruning passes, so trimming does not repeatedly stringify large projects.
function historyDocumentBytes(history, project, cache = new WeakMap()) {
  const bytes = value => {
    if (value === null) return 4;
    let result = cache.get(value);
    if (result === undefined) { result = Buffer.byteLength(JSON.stringify(value), 'utf8'); cache.set(value, result); }
    return result;
  };
  const header = { schemaVersion: 2, projectId: project.id, projectRevision: project.revision, maxSteps: history.maxSteps,
    baseBoundaryId: history.baseBoundaryId, cursor: history.cursor, entries: [], snapshots: [] };
  return Buffer.byteLength(JSON.stringify(header), 'utf8') + history.entries.reduce((sum, entry) => sum + bytes(entry), 0)
    + Math.max(0, history.entries.length - 1)
    + history.snapshots.reduce((sum, snapshot, index) => sum + bytes(index === history.cursor ? null : snapshot), 0)
    + Math.max(0, history.snapshots.length - 1);
}

export class Engine {
  #project;
  #timeline;

  constructor(project = createProject()) {
    validateProject(project);
    this.#project = clone(project);
    this.#timeline = initialHistory(this.#project);
  }

  get project() { return clone(this.#project); }
  get canUndo() { return this.#timeline.cursor > 0; }
  get canRedo() { return this.#timeline.cursor < this.#timeline.entries.length; }
  get history() { return { canUndo: this.canUndo, canRedo: this.canRedo }; }
  get historyView() {
    const timeline = this.#timeline;
    return clone({ entries: timeline.entries.map((entry, index) => ({ ...entry, index, state: index < timeline.cursor ? 'applied' : 'undone', details: historyDetails(entry) })),
      cursor: timeline.cursor, maxSteps: timeline.maxSteps, baseBoundaryId: timeline.baseBoundaryId, currentBoundaryId: boundaryAt(timeline, timeline.cursor) });
  }

  exportHistory() { return clone(historyDocument(this.#timeline, this.#project)); }

  restoreHistory(history) {
    const { state, report } = readHistory(history, this.#project);
    this.#timeline = state;
    return report;
  }

  checkpoint() { return { schemaVersion: 1, project: this.project, history: this.exportHistory() }; }

  restoreCheckpoint(checkpoint) {
    validateSchema(checkpoint, { type: 'object', properties: { schemaVersion: { const: 1 }, project: projectSchema, history: { type: 'object' } }, required: ['schemaVersion', 'project', 'history'], additionalProperties: false }, '$.checkpoint');
    validateProject(checkpoint.project);
    const { state, report } = readHistory(checkpoint.history, checkpoint.project);
    const project = clone(checkpoint.project);
    this.#project = project; this.#timeline = state;
    return report;
  }

  /** Storage-only retention operation. Does not alter musical state or project revision. */
  trimHistoryToBytes(maxBytes) {
    validateSchema(maxBytes, { type: 'integer', minimum: 1024, maximum: Number.MAX_SAFE_INTEGER }, '$.maxBytes');
    const candidate = copyHistory(this.#timeline), cache = new WeakMap();
    const beforeBytes = historyDocumentBytes(candidate, this.#project, cache);
    let bytes = beforeBytes;
    const droppedEntryIds = [], droppedBoundaryIds = [];
    while (bytes > maxBytes && dropOneHistoryEntry(candidate, droppedEntryIds, droppedBoundaryIds)) bytes = historyDocumentBytes(candidate, this.#project, cache);
    if (bytes > maxBytes) fail('HISTORY_BYTE_LIMIT', 'The minimum history envelope exceeds the requested byte limit.', { bytes, maxBytes });
    this.#timeline = candidate;
    return { beforeBytes, bytes, droppedEntryIds, droppedBoundaryIds };
  }

  execute(envelope) {
    const requestId = typeof envelope?.requestId === 'string' ? envelope.requestId : null;
    const response = { status: 'error', applied: false, requestId, projectRevision: this.#project.revision, resolvedTargets: [], changes: {}, errors: [] };
    try {
      validateSchema(envelope, envelopeSchema);
      if (envelope.expectedRevision !== undefined && envelope.expectedRevision !== this.#project.revision) fail('REVISION_CONFLICT', 'Project revision changed; reload before retrying.', { expectedRevision: envelope.expectedRevision, actualRevision: this.#project.revision });
      validateCommand(envelope.command, envelope.arguments);
      if (this.#project.revision === Number.MAX_SAFE_INTEGER) fail('REVISION_OVERFLOW', 'Project revision cannot be incremented safely.');
      const timeline = copyHistory(this.#timeline);
      let next, commands;
      const historyCommand = envelope.command.startsWith('history.');
      if (historyCommand) {
        const args = envelope.arguments;
        response.resolvedTargets = [this.#project.id];
        if (envelope.command === 'history.describe') {
          const index = timeline.entries.findIndex(entry => entry.id === args.entryId);
          if (index < 0) fail('NOT_FOUND', 'History entry was not found or has been discarded.', { entryId: args.entryId });
          timeline.entries[index] = { ...timeline.entries[index], description: args.description };
          next = clone(this.#project);
          response.resolvedTargets.push(args.entryId);
          response.changes = { history: 'describe', entryId: args.entryId, description: args.description };
        } else if (envelope.command === 'history.settings') {
          const previousMaxSteps = timeline.maxSteps;
          timeline.maxSteps = args.maxSteps;
          const trimmed = trimHistorySteps(timeline);
          next = clone(this.#project);
          response.changes = { history: 'settings', previousMaxSteps, maxSteps: timeline.maxSteps, ...trimmed };
        } else {
          const fromIndex = timeline.cursor;
          let targetIndex;
          if (envelope.command === 'history.undo') {
            if (!this.canUndo) fail('NOTHING_TO_UNDO', 'Nothing to undo.');
            targetIndex = fromIndex - 1;
          } else if (envelope.command === 'history.redo') {
            if (!this.canRedo) fail('NOTHING_TO_REDO', 'Nothing to redo.');
            targetIndex = fromIndex + 1;
          } else if (envelope.command === 'history.goTo') {
            if (args.index !== undefined) targetIndex = args.index;
            else if (args.boundaryId === timeline.baseBoundaryId) targetIndex = 0;
            else {
              const index = timeline.entries.findIndex(entry => entry.boundaryId === args.boundaryId);
              if (index < 0) fail('NOT_FOUND', 'History boundary was not found or has been discarded.', { boundaryId: args.boundaryId });
              targetIndex = index + 1;
            }
            if (targetIndex > timeline.entries.length) fail('INDEX_OUT_OF_BOUNDS', 'History index is outside the retained boundary sequence.', { index: targetIndex, maximum: timeline.entries.length });
          } else fail('UNKNOWN_COMMAND', 'Unsupported history command.', { command: envelope.command });
          timeline.snapshots[fromIndex] = this.#project;
          timeline.cursor = targetIndex;
          next = clone(timeline.snapshots[targetIndex]);
          response.changes = { history: envelope.command.slice('history.'.length), fromIndex, index: targetIndex,
            boundaryId: boundaryAt(timeline, targetIndex), steps: Math.abs(targetIndex - fromIndex) };
        }
      } else {
        commands = batchCommands(envelope);
        next = clone(this.#project);
        const operations = [];
        for (const [batchIndex, command] of commands.entries()) {
          try { operations.push({ command: command.command, ...applyCommand(next, command.command, command.arguments) }); }
          catch (error) {
            if (envelope.command === 'batch' && error instanceof EngineError) error.details = { ...error.details, batchIndex };
            throw error;
          }
        }
        response.resolvedTargets = [...new Set(operations.flatMap(operation => operation.resolvedTargets))];
        response.changes = envelope.command === 'batch' ? {
          created: operations.flatMap(operation => operation.changes.created), updated: [...new Set(operations.flatMap(operation => operation.changes.updated))],
          removed: operations.flatMap(operation => operation.changes.removed), operations,
        } : operations[0].changes;
      }
      if (envelope.dryRun) return { ...response, status: 'validated' };
      if(envelope.command==='midi.modifiers.freeze'&&response.changes.noop||envelope.command==='batch'&&response.changes.operations.every(operation=>operation.command==='midi.modifiers.freeze'&&operation.changes.noop===true))return {...response,status:'unchanged'};
      next.revision = this.#project.revision + 1;
      validateProject(next);
      if (!historyCommand) {
        const entry = {
          id: newId('history'), boundaryId: newId('boundary'), action: envelope.command,
          label: envelope.command === 'batch' ? `Batch (${commands.length} commands)` : actionLabels[envelope.command] ?? envelope.command,
          time: new Date().toISOString(), revision: next.revision, description: '',
          summary: summarizeChanges(response.changes, response.resolvedTargets, commands),
        };
        timeline.entries = timeline.entries.slice(0, timeline.cursor);
        timeline.snapshots = timeline.snapshots.slice(0, timeline.cursor + 1);
        timeline.snapshots[timeline.cursor] = this.#project;
        timeline.entries.push(entry); timeline.snapshots.push(next); timeline.cursor++;
        trimHistorySteps(timeline);
      }
      timeline.snapshots[timeline.cursor] = next;
      this.#project = next; this.#timeline = timeline;
      return { ...response, status: 'applied', applied: true, projectRevision: next.revision };
    } catch (error) {
      // Media-layer validation errors (for example tempo maps compiled while retiming clips) are user-facing diagnostics, not internal faults.
      const detail = error instanceof EngineError ? { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) } : error?.name === 'MediaError' && typeof error.code === 'string' ? { code: error.code, message: error.message } : { code: 'INTERNAL_ERROR', message: 'Command could not be processed.' };
      return { ...response, status: 'error', applied: false, resolvedTargets: [], changes: {}, errors: [detail] };
    }
  }
}

