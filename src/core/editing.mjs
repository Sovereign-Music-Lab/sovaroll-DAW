import {orderedArrangementSiblings} from './track-folders.mjs';
import {compileMidiStreams} from '../media/midi-stream.mjs';
import {compileTempoMap} from '../media/time.mjs';
import {planTranspose} from '../media/transpose-plan.mjs';
import {optimizeDissolvedPart} from '../media/dissolve-display.mjs';
import {defaultTrackParameters} from '../media/midi-modifiers.mjs';
import { fail } from './schema.mjs';
import { midiObjectIds, checkMidiEventCopies, splitMidiEvents, hasMidiSourceOrdering } from './midi-events.mjs';

const clone = value => structuredClone(value);
const newId = kind => `${kind}-${globalThis.crypto.randomUUID()}`;
const maxInteger = BigInt(Number.MAX_SAFE_INTEGER);
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const idsOfClip = midiObjectIds;
const copiedName = name => `${name.slice(0, 251)} Copy`;
export const MAX_COPIED_NOTES = 200000;

function checkCopyLimit(requestedNotes, command, sourceId) {
  if (requestedNotes > MAX_COPIED_NOTES) fail('COPY_LIMIT', 'One copy command may create at most 200000 MIDI notes.', {
    command, sourceId, requestedNotes, limit: MAX_COPIED_NOTES,
  });
}

function safeInteger(value, context) {
  if (value < 0n || value > maxInteger) fail('TIME_OVERFLOW', 'Edited position exceeds the safe integer timeline.', context);
  return Number(value);
}

function find(items, id, kind) {
  const result = items.find(item => item.id === id);
  if (!result) fail('NOT_FOUND', `${kind} not found: ${id}.`, { id, kind });
  return result;
}

function midiClip(project, id) {
  const clip = find(project.clips, id, 'Clip');
  if (clip.type !== 'midi') fail('TYPE_MISMATCH', 'This command requires a MIDI clip.', { clipId: id });
  return clip;
}

function selectedNotes(clip, noteIds) {
  if (noteIds === undefined) return clip.notes;
  const selected = new Set(noteIds);
  const present = new Set(clip.notes.map(note => note.id));
  for (const id of noteIds) if (!present.has(id)) fail('NOT_FOUND', `Note not found: ${id}.`, { id, kind: 'Note', clipId: clip.id });
  return clip.notes.filter(note => selected.has(note.id));
}

export function quantizeReferenceFits(reference, lengthTicks) {
  return reference.startTick < lengthTicks && reference.durationTicks <= lengthTicks - reference.startTick;
}

export function invalidateOutsideQuantizeReferences(clip) {
  const invalidated = [];
  if (clip.type !== 'midi') return invalidated;
  for (const note of clip.notes) {
    if (note.quantizeReference && !quantizeReferenceFits(note.quantizeReference, clip.lengthTicks)) {
      delete note.quantizeReference; invalidated.push(note.id);
    }
  }
  return invalidated;
}

function timingOf(note) { return { startTick: note.startTick, durationTicks: note.durationTicks }; }

function captureQuantizeReference(note) {
  if (note.quantizeReference) return false;
  note.quantizeReference = timingOf(note);
  return true;
}

function copyClip(clip, trackId = clip.trackId, orderGroups) {
  const copy = clone(clip);
  copy.id = newId('clip'); copy.trackId = trackId;
  if (copy.type === 'midi') {
    for (const note of copy.notes) note.id = newId('note');
    for (const event of copy.events ?? []) event.id = newId('event');
    if (hasMidiSourceOrdering(clip)) {
      // A copy is an independent MIDI stream. A whole-track copy preserves
      // relationships between previously split pieces, using a fresh group.
      if (clip.midiOrderGroup && orderGroups) {
        if (!orderGroups.has(clip.midiOrderGroup)) orderGroups.set(clip.midiOrderGroup, newId('midi-order'));
        copy.midiOrderGroup = orderGroups.get(clip.midiOrderGroup);
      } else copy.midiOrderGroup = newId('midi-order');
    }
  }
  return copy;
}

function compatibleTrack(project, clip, trackId) {
  const track = find(project.tracks, trackId, 'Track');
  if (track.type !== clip.type) fail('TYPE_MISMATCH', 'Destination track and clip media types must match.', { trackId, clipId: clip.id });
  return track;
}

function checkMediaFields(clip, args, midiField, audioField) {
  const wrong = clip.type === 'midi' ? audioField : midiField;
  if (Object.hasOwn(args, wrong)) fail('TYPE_MISMATCH', `Field ${wrong} does not apply to a ${clip.type} clip.`, { clipId: clip.id, field: wrong });
}

function gcd(a, b) { while (b) [a, b] = [b, a % b]; return a; }

/** Exact integer arithmetic avoids off-by-one boundaries at unrelated sample rates. */
function audioSplitBoundary(project, clip, requestedSample) {
  const asset = find(project.assets, clip.assetId, 'Asset');
  const delta = BigInt(requestedSample) - BigInt(clip.startSample);
  const projectRate = BigInt(project.sampleRate), sourceRate = BigInt(asset.sampleRate);
  if (delta <= 0n || delta * sourceRate >= BigInt(clip.lengthFrames) * projectRate) fail('SPLIT_OUT_OF_BOUNDS', 'Split must be strictly inside the audio clip.', { clipId: clip.id, requestedSample });
  const divisor = gcd(projectRate, sourceRate);
  const projectGrid = projectRate / divisor, sourceGrid = sourceRate / divisor;
  const lastInteriorGrid = (BigInt(clip.lengthFrames) - 1n) / sourceGrid;
  if (lastInteriorGrid < 1n) fail('NO_EXACT_SPLIT', 'Clip has no interior boundary shared by the source and project integer sample grids.', {
    clipId: clip.id, projectSampleGrid: Number(projectGrid), sourceFrameGrid: Number(sourceGrid),
  });
  // Nearest interior common-grid position, with exact half-way cases rounded later.
  const nearest = (2n * delta + projectGrid) / (2n * projectGrid);
  const index = nearest < 1n ? 1n : nearest > lastInteriorGrid ? lastInteriorGrid : nearest;
  const leftFrames = safeInteger(index * sourceGrid, { clipId: clip.id });
  const actualSample = safeInteger(BigInt(clip.startSample) + index * projectGrid, { clipId: clip.id });
  return { leftFrames, actualSample, info: {
    type: 'audio', requestedSample, actualSample, roundingSamples: actualSample - requestedSample,
    projectSampleGrid: Number(projectGrid), sourceFrameGrid: Number(sourceGrid),
    sourceSplitFrame: clip.offsetFrames + leftFrames,
    policy: 'nearest-interior-common-integer-sample-grid; ties-later',
  } };
}

export function nearestGrid(value, grid, swing) {
  const around = Math.floor(value / grid);
  let nearest = 0, distance = Infinity;
  // Fixed iteration count also works near MAX_SAFE_INTEGER, where step++ can stop advancing.
  for (let offset = -2; offset <= 2; offset++) {
    const step = around + offset;
    if (step < 0) continue;
    const point = step * grid + (step % 2 ? grid * swing : 0);
    const difference = Math.abs(point - value);
    if (difference < distance || (difference === distance && point > nearest)) { nearest = point; distance = difference; }
  }
  return nearest;
}

const editingCommands = new Set(['clips.paste','clips.repeat','midi.parts.dissolve','track.duplicate', 'track.reorder', 'clip.duplicate', 'clip.split', 'clip.move','clip.copyTo',
  'midi.notes.quantize', 'midi.notes.resetQuantize', 'midi.notes.freezeQuantize',
  'midi.notes.transpose', 'midi.notes.restrictPolyphony', 'midi.notes.reverse', 'midi.notes.deleteOverlaps', 'midi.notes.length', 'midi.notes.velocity', 'midi.notes.removeDoubles', 'midi.notes.split', 'midi.notes.glue', 'midi.notes.legato']);

/** Mutates only Engine's detached candidate. Engine validates and commits the entire command/batch. */
export function applyEditing(project, command, args) {
  if(command==='clips.fillLoop'){
    if(!project.locators)fail('INVALID_RANGE','Set left and right locators before Fill Loop.');
    const originals=args.clipIds.map(id=>find(project.clips,id,'Clip')),map=compileTempoMap(project.tempoMap,project.ppq),elapsed=args.timeBase==='elapsed',rate=project.sampleRate;
    const startOf=c=>elapsed?(c.type==='audio'?c.startSample:map.tickToSeconds(c.startTick)*rate):(c.type==='midi'?c.startTick:map.secondsToTick(c.startSample/rate));
    const endOf=c=>c.type==='midi'?(elapsed?map.tickToSeconds(c.startTick+c.lengthTicks)*rate:c.startTick+c.lengthTicks):elapsed?c.startSample+c.lengthFrames/find(project.assets,c.assetId,'Asset').sampleRate*rate:map.secondsToTick(c.startSample/rate+c.lengthFrames/find(project.assets,c.assetId,'Asset').sampleRate);
    const starts=originals.map(startOf),anchor=Math.min(...starts),span=Math.max(...originals.map(endOf))-anchor,left=elapsed?map.tickToSeconds(project.locators.startTick)*rate:project.locators.startTick,right=elapsed?map.tickToSeconds(project.locators.endTick)*rate:project.locators.endTick;
    if(!Number.isFinite(span)||span<=0||right<=left)fail('INVALID_RANGE','Fill Loop requires positive selection and locator spans.');const count=Math.ceil((right-left)/span);
    if(!Number.isSafeInteger(count)||count*originals.length>4096)fail('COPY_LIMIT','Fill Loop supports at most4096 copied clips.');checkCopyLimit(originals.reduce((n,c)=>n+(c.notes?.length??0),0)*count,command);checkMidiEventCopies(project,originals,count);
    const copies=[],rightSample=Math.floor(map.tickToSeconds(project.locators.endTick)*rate);
    for(let i=0;i<count;i++){const groups=new Map();for(let j=0;j<originals.length;j++){const original=originals[j],target=left+i*span+starts[j]-anchor;if(target>=right)continue;const copy=copyClip(original,original.trackId,groups);
      if(copy.type==='midi'){copy.startTick=Math.round(elapsed?map.secondsToTick(target/rate):target);if(!Number.isSafeInteger(copy.startTick)||copy.startTick<0)fail('TIME_OVERFLOW','Fill Loop exceeds MIDI timeline bounds.');if(copy.startTick>=project.locators.endTick)continue;if(copy.startTick+copy.lengthTicks>project.locators.endTick){const temporary={...project,clips:[copy]};applyEditing(temporary,'clip.split',{clipId:copy.id,atTick:project.locators.endTick,splitNotes:true,chaseControllers:false});}}
      else{copy.startSample=Math.round(elapsed?target:map.tickToSeconds(target)*rate);if(!Number.isSafeInteger(copy.startSample)||copy.startSample<0)fail('TIME_OVERFLOW','Fill Loop exceeds audio timeline bounds.');if(copy.startSample>=rightSample)continue;const asset=find(project.assets,copy.assetId,'Asset'),available=Number(BigInt(rightSample-copy.startSample)*BigInt(asset.sampleRate)/BigInt(rate));if(available<1)continue;if(available<copy.lengthFrames){if(copy.fadeInFrames||copy.fadeOutFrames||copy.fadeWindow)copy.fadeWindow=clone(copy.fadeWindow??{offsetFrames:copy.offsetFrames,lengthFrames:copy.lengthFrames});if(copy.reverse)copy.reverseWindow=clone(copy.reverseWindow??{offsetFrames:copy.offsetFrames,lengthFrames:copy.lengthFrames});copy.lengthFrames=available;}}
      copies.push(copy);
    }}
    if(!copies.length)fail('INVALID_RANGE','The locator range is too short to contain a representable copied clip.');
    project.clips.push(...copies);return {changes:{created:copies.flatMap(idsOfClip),updated:[],removed:[],fillLoop:{clipIds:copies.map(c=>c.id),timeBase:elapsed?'elapsed':'musical',count,sourceClipIds:args.clipIds}},resolvedTargets:copies.map(c=>c.id)};
  }

  if(command==='audio.clips.glueNext'){
    const source=find(project.clips,args.clipId,'Clip');if(source.type!=='audio')fail('TYPE_MISMATCH','Audio rejoin requires an audio event.');
    const following=project.clips.filter(c=>c.type==='audio'&&c.trackId===source.trackId).slice().sort((a,b)=>a.startSample-b.startSample),index=following.findIndex(c=>c.id===source.id),parts=args.allFollowing?following.slice(index):following.slice(index,index+2);
    if(parts.length<2)fail('NO_FOLLOWING_EVENT','No following audio event on this track.');
    return applyEditing(project,'audio.clips.glue',{clipIds:parts.map(c=>c.id)});
  }

  if(command==='audio.clips.glue'){
    const ids=new Set(args.clipIds),parts=project.clips.filter(c=>ids.has(c.id));if(parts.length!==ids.size||parts.some(c=>c.type!=='audio')||new Set(parts.map(c=>c.trackId)).size!==1||new Set(parts.map(c=>c.assetId)).size!==1)fail('INVALID_AUDIO_GLUE','Select audio fragments of one asset on one track.');
    const sorted=parts.slice().sort((a,b)=>a.startSample-b.startSample),first=sorted[0],asset=find(project.assets,first.assetId,'Asset');
    const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
    const signature=c=>JSON.stringify(canonical({snapPointFrame:c.snapPointFrame??null,gainDb:c.gainDb??0,mute:c.mute??false,invertPolarity:c.invertPolarity??false,reverse:c.reverse??false,reverseWindow:c.reverse?(c.reverseWindow??{offsetFrames:c.offsetFrames,lengthFrames:c.lengthFrames}):null,fadeInFrames:c.fadeInFrames??0,fadeOutFrames:c.fadeOutFrames??0,fadeInShape:c.fadeInShape??'linear',fadeOutShape:c.fadeOutShape??'linear',fadeWindow:c.fadeInFrames||c.fadeOutFrames?(c.fadeWindow??{offsetFrames:c.offsetFrames,lengthFrames:c.lengthFrames}):null,dcOffsets:c.dcOffsets??[],volumeEnvelope:c.volumeEnvelope??[],silencedRanges:c.silencedRanges??[]}));
    const settings=signature(first);let length=first.lengthFrames;
    for(let i=1;i<sorted.length;i++){const previous=sorted[i-1],next=sorted[i];if(signature(next)!==settings)fail('INCOMPATIBLE_AUDIO_GLUE','Audio processing differs between fragments; originals were preserved.');if(next.offsetFrames!==previous.offsetFrames+previous.lengthFrames||BigInt(next.startSample-previous.startSample)*BigInt(asset.sampleRate)!==BigInt(previous.lengthFrames)*BigInt(project.sampleRate))fail('NONCONTIGUOUS_AUDIO_GLUE','Fragments must be exactly contiguous in the source and project.');length+=next.lengthFrames;if(!Number.isSafeInteger(length))fail('TIME_OVERFLOW','Glued audio length exceeds safe source frames.');}
    const merged={...clone(first),name:args.name??first.name,lengthFrames:length};project.clips=project.clips.filter(c=>!ids.has(c.id)||c.id===first.id).map(c=>c.id===first.id?merged:c);
    return {changes:{created:[],updated:[first.id],removed:sorted.slice(1).map(c=>c.id)},resolvedTargets:[first.id]};
  }

  if(command==='midi.clips.glueNext'){
    const source=find(project.clips,args.clipId,'Clip');if(source.type!=='midi')fail('TYPE_MISMATCH','MIDI glue requires a MIDI part.');
    const following=project.clips.filter(c=>c.type==='midi'&&c.trackId===source.trackId).slice().sort((a,b)=>a.startTick-b.startTick),index=following.findIndex(c=>c.id===source.id),parts=args.allFollowing?following.slice(index):following.slice(index,index+2);
    if(parts.length<2)fail('NO_FOLLOWING_PART','No following MIDI part on this track.');
    return applyEditing(project,'midi.clips.glue',{clipIds:parts.map(c=>c.id)});
  }

  if(command==='midi.clips.glue'){
    const ids=new Set(args.clipIds),parts=project.clips.filter(c=>ids.has(c.id));
    if(parts.length!==ids.size||parts.some(c=>c.type!=='midi')||new Set(parts.map(c=>c.trackId)).size!==1)fail('INVALID_MIDI_GLUE','Select existing MIDI parts on one track.');
    const modifierKey=c=>JSON.stringify([c.midiModifiers?.transpose??0,c.midiModifiers?.velocityShift??0]);if(new Set(parts.map(modifierKey)).size!==1)fail('UNSUPPORTED_MIDI_GLUE','Parts with different playback transpose/velocity modifiers cannot yet be glued losslessly.');
    if(new Set(parts.map(c=>Boolean(c.mute))).size!==1)fail('INVALID_MIDI_GLUE','Parts with different mute states cannot be glued.');
    const groups=new Set(parts.map(c=>c.midiOrderGroup).filter(Boolean));if(project.clips.some(c=>!ids.has(c.id)&&groups.has(c.midiOrderGroup)))fail('INVALID_MIDI_GLUE','Select all fragments sharing the MIDI source order group.');
    if(parts.reduce((n,c)=>n+c.notes.length,0)>200000||parts.reduce((n,c)=>n+(c.events?.length??0),0)>200000)fail('COPY_LIMIT','Glue supports up to200000 notes and retained events.');
    const ordered=parts.slice().sort((a,b)=>a.startTick-b.startTick),first=ordered[0],start=first.startTick,end=Math.max(...parts.map(c=>c.startTick+c.lengthTicks));
    const merged={...clone(first),name:args.name??first.name,startTick:start,lengthTicks:end-start,notes:[],events:[]};delete merged.midiOrderGroup;
    for(const part of ordered){const delta=part.startTick-start;for(const source of part.notes){const note=clone(source);note.startTick+=delta;if(note.quantizeReference)note.quantizeReference.startTick+=delta;merged.notes.push(note);}for(const source of part.events??[]){const event=clone(source);event.tick+=delta;if(event.curve?.window){event.curve.window.startTick+=delta;event.curve.window.endTick+=delta;}merged.events.push(event);}}
    const raw=clone(project);raw.clips=parts.map(c=>clone(c));raw.tracks=raw.tracks.filter(t=>t.id===first.trackId).map(t=>{delete t.midiModifiers;delete t.midiParameters;return t;});
    const stream=compileMidiStreams(raw,{trackIds:[first.trackId],includeMutedClips:true,applyModifiers:false}).tracks[0],notes=new Map(merged.notes.map(n=>[n.id,n])),events=new Map(merged.events.map(e=>[e.id,e]));let order=0;
    for(const event of stream.events){if(event.kind==='noteOn')notes.get(event.noteId).onOrder=order++;else if(event.kind==='noteOff')notes.get(event.noteId).offOrder=order++;else if(events.has(event.eventId))events.get(event.eventId).order=order++;}
    if(merged.notes.some(n=>n.startTick+n.durationTicks>merged.lengthTicks))merged.allowNoteTails=true;
    const signature=stream=>JSON.stringify(stream.tracks[0].events.map(e=>[e.tick,e.kind,e.status,e.data]));
    const beforeStream=signature(compileMidiStreams(project,{trackIds:[first.trackId],includeMutedClips:true}));
    project.clips=project.clips.filter(c=>!ids.has(c.id)||c.id===first.id).map(c=>c.id===first.id?merged:c);
    if(signature(compileMidiStreams(project,{trackIds:[first.trackId],includeMutedClips:true}))!==beforeStream)fail('MIDI_GLUE_PLAYBACK_CHANGE','Glue would change MIDI ordering or modifier output on this track; the original parts were preserved.');
    return {changes:{created:[],updated:[first.id],removed:parts.filter(c=>c.id!==first.id).map(c=>c.id)},resolvedTargets:[first.id]};
  }

  if (!editingCommands.has(command)) return null;
  const changes = { created: [], updated: [], removed: [] };
  let resolvedTargets = [];
  if(command==='clips.paste'){
    if(args.sourceProjectId!==project.id)fail('FOREIGN_CLIPBOARD','Clipboard belongs to another project.');
    if(Number(args.atTick!==undefined)+Number(args.atSample!==undefined)+Number(args.original===true)!==1)fail('INVALID_OPTION','Choose atTick, atSample or original:true.');
    const originals=args.clips,map=compileTempoMap(project.tempoMap,project.ppq),elapsed=args.atSample!==undefined;
    checkCopyLimit(originals.reduce((sum,c)=>sum+(c.notes?.length??0),0),command);checkMidiEventCopies(project,originals);
    const sourceTracks=args.sourceTracks??[],trackMap=new Map(),createdTracks=[];
    if(new Set(sourceTracks.map(t=>t.id)).size!==sourceTracks.length)fail('INVALID_OPTION','Clipboard source track IDs must be unique.');
    for(const clip of originals){
      if(clip.type==='audio')find(project.assets,clip.assetId,'Asset');if(trackMap.has(clip.trackId)){if(trackMap.get(clip.trackId).type!==clip.type)fail('TYPE_MISMATCH','Clipboard track contains incompatible clip types.');continue;}
      const source=sourceTracks.find(t=>t.id===clip.trackId);let target;
      if(args.trackMode==='name'){if(!source||source.type!==clip.type)fail('INVALID_OPTION','Name matching requires compatible source track snapshots.');const matches=project.tracks.filter(t=>t.name===source.name&&t.type===source.type);if(matches.length>1)fail('AMBIGUOUS_TRACK','Multiple destination tracks have the same name and type.');target=matches[0];}
      else target=project.tracks.find(t=>t.id===clip.trackId);
      if(!target&&args.createMissingTracks){if(!source||source.type!==clip.type)fail('INVALID_OPTION','Creating tracks requires compatible source track snapshots.');if(createdTracks.length>=256)fail('COPY_LIMIT','Paste may create at most256 tracks.');target={...clone(source),id:newId('track')};if(target.parentFolderId&&!(project.trackFolders??[]).some(f=>f.id===target.parentFolderId)){delete target.parentFolderId;(changes.warnings??=[]).push('Clipboard parent folder is missing; recreated track was placed at root.');}project.tracks.push(target);createdTracks.push(target.id);}
      if(!target)fail('NOT_FOUND','Paste destination track is missing.',{trackId:clip.trackId});if(target.type!==clip.type)fail('TYPE_MISMATCH','Paste destination track type does not match clip.');trackMap.set(clip.trackId,target);
    }
    const starts=originals.map(c=>elapsed?(c.type==='audio'?c.startSample:map.tickToSeconds(c.startTick)*project.sampleRate):(c.type==='midi'?c.startTick:map.secondsToTick(c.startSample/project.sampleRate))),anchor=Math.min(...starts);let destination=elapsed?args.atSample:args.atTick;
    if(args.alignSnapPoint&&!args.original){const source=originals[starts.indexOf(anchor)];if(source.type==='audio'&&source.snapPointFrame!==undefined){const asset=find(project.assets,source.assetId,'Asset'),offset=(source.snapPointFrame-source.offsetFrames)/asset.sampleRate,seconds=(elapsed?destination/project.sampleRate:map.tickToSeconds(destination))-offset;if(seconds<0)fail('INVALID_SNAP_POINT','Pasting the event snap point here would place the clip before project start.');destination=elapsed?seconds*project.sampleRate:map.secondsToTick(seconds);}}
    const delta=args.original?0:destination-anchor;
    const orderGroups=new Map(),copies=originals.map((original,index)=>{const target=starts[index]+delta,position=args.original?original[original.type==='midi'?'startTick':'startSample']:elapsed?(original.type==='audio'?Math.round(target):Math.round(map.secondsToTick(target/project.sampleRate))):(original.type==='midi'?Math.round(target):Math.round(map.tickToSeconds(target)*project.sampleRate));if(!Number.isSafeInteger(position)||position<0)fail('TIME_OVERFLOW','Paste position exceeds safe project bounds.');const copy=copyClip(original,trackMap.get(original.trackId).id,orderGroups);copy[original.type==='midi'?'startTick':'startSample']=position;return copy;});
    project.clips.push(...copies);changes.created=[...createdTracks,...copies.flatMap(idsOfClip)];changes.paste={clipIds:copies.map(c=>c.id),createdTrackIds:createdTracks,trackMapping:[...trackMap].map(([sourceId,target])=>({sourceId,targetId:target.id})),timeBase:args.original?'original':elapsed?'elapsed':'musical',alignSnapPoint:Boolean(args.alignSnapPoint&&!args.original)};resolvedTargets=[...copies.map(c=>c.trackId),...changes.created];
  }else if(command==='clips.repeat'){
    const originals=args.clipIds.map(id=>find(project.clips,id,'Clip')),count=args.count??1,map=compileTempoMap(project.tempoMap,project.ppq);
    if(originals.length*count>4096)fail('COPY_LIMIT','One repeat may create at most4096 clips.');
    checkCopyLimit(originals.reduce((sum,c)=>sum+(c.notes?.length??0),0)*count,command);checkMidiEventCopies(project,originals,count);
    const elapsed=args.timeBase==='elapsed';if(elapsed&&args.spacingTicks!==undefined||!elapsed&&args.spacingSamples!==undefined)fail('INVALID_OPTION','Repeat spacing must match its time base.');
    let left=Infinity,right=0;const starts=new Map();
    for(const clip of originals){let start,end;if(clip.type==='midi'){start=clip.startTick;end=start+clip.lengthTicks;if(elapsed){start=map.tickToSeconds(start)*project.sampleRate;end=map.tickToSeconds(end)*project.sampleRate;}}else{const asset=find(project.assets,clip.assetId,'Asset');start=clip.startSample/project.sampleRate;end=start+clip.lengthFrames/asset.sampleRate;if(elapsed){start=clip.startSample;end*=project.sampleRate;}else{start=map.secondsToTick(start);end=map.secondsToTick(end);}}starts.set(clip.id,start);left=Math.min(left,Math.floor(start+1e-7));right=Math.max(right,Math.ceil(end-1e-7));}
    const spacing=(elapsed?args.spacingSamples:args.spacingTicks)??right-left;if(!Number.isSafeInteger(spacing)||spacing<1)fail('INVALID_RANGE','Selection must have a positive safe repeat span.');
    const copies=[],repeatOrderGroups=Array.from({length:count},()=>new Map());
    for(let i=1;i<=count;i++)for(const original of originals){const target=starts.get(original.id)+spacing*i;if(!Number.isFinite(target)||target>Number.MAX_SAFE_INTEGER)fail('TIME_OVERFLOW','Repeat exceeds timeline bounds.');const position=elapsed?(original.type==='audio'?target:Math.round(map.secondsToTick(target/project.sampleRate))):(original.type==='midi'?target:Math.round(map.tickToSeconds(target)*project.sampleRate));if(!Number.isSafeInteger(position)||position<0)fail('TIME_OVERFLOW','Repeat position exceeds safe timeline bounds.');const copy=copyClip(original,original.trackId,repeatOrderGroups[i-1]);copy[original.type==='midi'?'startTick':'startSample']=position;copies.push(copy);}
    project.clips.push(...copies);changes.created=copies.flatMap(idsOfClip);changes.repetition={clipIds:copies.map(c=>c.id),count,[elapsed?'spacingSamples':'spacingTicks']:spacing,timeBase:elapsed?'elapsed':'musical',midiInternalTiming:'unchanged',audioDuration:'unchanged'};resolvedTargets=[...args.clipIds,...changes.created];
  }else if(command==='midi.parts.dissolve'){
    const sources=args.clipIds.map(id=>find(project.clips,id,'Clip'));if(sources.some(c=>c.type!=='midi'))fail('TYPE_MISMATCH','Dissolve requires MIDI parts.');
    const plans=[];
    for(const original of project.tracks){
      const parts=sources.filter(c=>c.trackId===original.id);if(!parts.length)continue;
      const keys=new Map(),common=parts.some(c=>(c.events??[]).some(e=>e.kind!=='channel'));
      const register=(key,channel)=>{if(!keys.has(key))keys.set(key,new Set());keys.get(key).add(channel);};
      for(const part of parts){for(const note of part.notes)register(args.mode==='channels'?note.channel:note.pitch,note.channel);
        for(const event of part.events??[])if(event.kind==='channel'){const type=event.status>>4,channel=event.status&15;if(args.mode==='channels')register(channel,channel);else if(type===10)register(event.data[0],channel);}
      }
      const buckets=[...keys.keys()].sort((a,b)=>a-b);if(common)buckets.push('common');
      for(const key of buckets){const filtered=[];
        for(const part of parts){const notes=part.notes.filter(n=>key!=='common'&&(args.mode==='channels'?n.channel===key:n.pitch===key)),events=(part.events??[]).filter(e=>{
          if(e.kind!=='channel')return key==='common';if(key==='common')return false;
          const channel=e.status&15;return args.mode==='channels'?channel===key:(e.status>>4)===10?e.data[0]===key:keys.get(key).has(channel);
        });if(notes.length||events.length)filtered.push({...part,notes,events});}
        if(filtered.length)plans.push({original,key,filtered});
      }
    }
    if(plans.length>256)fail('COPY_LIMIT','Dissolve supports at most 256 new tracks per command.');
    const filtered=plans.flatMap(p=>p.filtered);checkCopyLimit(filtered.reduce((sum,c)=>sum+c.notes.length,0),command,sources[0]?.id);checkMidiEventCopies(project,filtered);
    const createdTrackIds=[];
    for(const original of [...project.tracks]){let insertion=project.tracks.indexOf(original)+1;
      for(const plan of plans.filter(p=>p.original.id===original.id)){
        const label=plan.key==='common'?'Common':args.mode==='channels'?`Ch ${plan.key+1}`:`Pitch ${plan.key}`,track={...clone(original),id:newId('track'),name:`${original.name.slice(0,100)} · ${label}`};
        if(args.mode==='channels'&&plan.key!=='common')track.midiParameters={...defaultTrackParameters(),...track.midiParameters,setupChannel:plan.key};
        project.tracks.splice(insertion++,0,track);createdTrackIds.push(track.id);changes.created.push(track.id);const groups=new Map();
        for(const source of plan.filtered){const copy=copyClip(source,track.id,groups),display=args.optimizeDisplay?optimizeDissolvedPart(copy):{parts:[copy],invalidatedQuantizeNoteIds:[]};
          if(project.clips.length+display.parts.length>16384)fail('COPY_LIMIT','Optimized dissolve exceeds 16384 project parts.');
          project.clips.push(...display.parts);for(const part of display.parts)changes.created.push(...idsOfClip(part));if(display.invalidatedQuantizeNoteIds.length)(changes.invalidatedQuantizeNoteIds??=[]).push(...display.invalidatedQuantizeNoteIds);
        }
      }
    }
    for(const source of sources)if(plans.some(p=>p.filtered.some(c=>c.id===source.id))){source.mute=true;changes.updated.push(source.id);}
    changes.dissolve={mode:args.mode,optimizeDisplay:args.optimizeDisplay??false,controllerDisplayPolicy:'preserve-full-control-part',createdTrackIds,sourceClipIds:sources.map(c=>c.id),nonChannelEvents:'separate-common-track',pitchChannelControllers:'copied-to-matching-channel-pitch-tracks'};
    changes.warnings=[{code:'DISSOLVE_ROUTING_REVIEW',message:'New tracks copy source settings; review external routing, track setup messages and random modifiers. SysEx/meta use a separate Common track; pitch mode duplicates channel controls to matching pitch tracks.'}];resolvedTargets=[...changes.updated,...changes.created];
  } else if (command === 'track.duplicate') {
    const original = find(project.tracks, args.trackId, 'Track');
    const sourceClips = (args.includeClips ?? true) ? project.clips.filter(clip => clip.trackId === original.id) : [];
    let requestedNotes = 0;
    for (const source of sourceClips) {
      if (source.type === 'midi') requestedNotes += source.notes.length;
      // Reject before creating IDs, cloning any copies or inserting the duplicate track.
      checkCopyLimit(requestedNotes, command, original.id);
    }
    checkMidiEventCopies(project, sourceClips);
    const copy = { ...clone(original), id: args.newTrackId ?? newId('track'), name: copiedName(original.name) };
    project.tracks.splice(project.tracks.indexOf(original) + 1, 0, copy);
    changes.created.push(copy.id);
    if (args.includeClips ?? true) {
      const orderGroups = new Map(), copies = sourceClips.map(clip => copyClip(clip, copy.id, orderGroups));
      project.clips = project.clips.concat(copies);
      changes.created = changes.created.concat(copies.flatMap(idsOfClip));
    }
    resolvedTargets = [original.id, ...changes.created];
  } else if (command === 'track.reorder') {
    const track = find(project.tracks, args.trackId, 'Track');
    if (args.index >= project.tracks.length) fail('INDEX_OUT_OF_BOUNDS', 'Track index must be within the existing track list.', { index: args.index, trackCount: project.tracks.length });
    const fromIndex = project.tracks.indexOf(track);
    project.tracks.splice(fromIndex, 1); project.tracks.splice(args.index, 0, track);
    const siblings=orderedArrangementSiblings(project,track.parentFolderId??null);if(siblings.some(n=>n.arrangementOrder!==undefined)){const trackIds=new Set(project.tracks.map(t=>t.id)),orderedTracks=project.tracks.filter(t=>(t.parentFolderId??null)===(track.parentFolderId??null));let next=0;for(const [i,node]of siblings.entries()){const target=trackIds.has(node.id)?orderedTracks[next++]:node;target.arrangementOrder=i;changes.updated.push(target.id);}}
    changes.updated.push(track.id); changes.trackOrder = { trackId: track.id, fromIndex, index: args.index };
    resolvedTargets = [track.id];
  } else if (command === 'clip.duplicate') {
    const original = find(project.clips, args.clipId, 'Clip');
    checkMediaFields(original, args, 'spacingTicks', 'spacingSamples');
    const trackId = args.targetTrackId ?? original.trackId;
    compatibleTrack(project, original, trackId);
    const midi = original.type === 'midi';
    checkCopyLimit(midi ? original.notes.length * (args.count ?? 1) : 0, command, original.id);
    checkMidiEventCopies(project, [original], args.count ?? 1);
    let spacing = midi ? args.spacingTicks ?? original.lengthTicks : args.spacingSamples;
    if (spacing === undefined) {
      const asset = find(project.assets, original.assetId, 'Asset');
      const numerator = BigInt(original.lengthFrames) * BigInt(project.sampleRate), denominator = BigInt(asset.sampleRate);
      spacing = safeInteger((numerator + denominator - 1n) / denominator, { clipId: original.id });
    }
    const copies = [];
    for (let index = 1; index <= (args.count ?? 1); index++) {
      const copy = copyClip(original, trackId);
      const key = midi ? 'startTick' : 'startSample';
      copy[key] = safeInteger(BigInt(original[key]) + BigInt(spacing) * BigInt(index), { clipId: original.id });
      copies.push(copy);
    }
    project.clips = project.clips.concat(copies);
    changes.created = copies.flatMap(idsOfClip);
    changes.duplication = { count: copies.length, spacing, unit: midi ? 'ticks' : 'projectSamples', targetTrackId: trackId };
    resolvedTargets = [original.id, trackId, ...changes.created];
  } else if(command==='clip.copyTo'){
    const original=find(project.clips,args.clipId,'Clip');checkMediaFields(original,args,'startTick','startSample');
    const trackId=args.trackId??original.trackId;compatibleTrack(project,original,trackId);
    checkCopyLimit(original.type==='midi'?original.notes.length:0,command,original.id);checkMidiEventCopies(project,[original]);
    const copy=copyClip(original,trackId);if(args.id!==undefined)copy.id=args.id;
    if(args.startTick!==undefined)copy.startTick=args.startTick;if(args.startSample!==undefined)copy.startSample=args.startSample;
    project.clips.push(copy);changes.created=idsOfClip(copy);resolvedTargets=[original.id,trackId,...changes.created];
  } else if (command === 'clip.move') {
    const clip = find(project.clips, args.clipId, 'Clip');
    checkMediaFields(clip, args, 'startTick', 'startSample');
    if (args.trackId === undefined && args.startTick === undefined && args.startSample === undefined) fail('EMPTY_UPDATE', 'A destination track or position is required.');
    const priorTrack = clip.trackId;
    if (args.trackId !== undefined) { compatibleTrack(project, clip, args.trackId); clip.trackId = args.trackId; }
    if (args.startTick !== undefined) clip.startTick = args.startTick;
    if (args.startSample !== undefined) clip.startSample = args.startSample;
    changes.updated.push(clip.id); resolvedTargets = [...new Set([clip.id, priorTrack, clip.trackId])];
  } else if (command === 'clip.split') {
    const clip = find(project.clips, args.clipId, 'Clip');
    checkMediaFields(clip, args, 'atTick', 'atSample');
    if(clip.type!=='midi'&&Object.hasOwn(args,'splitNotes'))fail('TYPE_MISMATCH','splitNotes applies only to MIDI clips.');
    const right = clone(clip); right.id = args.rightClipId??newId('clip');
    changes.created.push(right.id); changes.updated.push(clip.id);
    if (clip.type === 'midi') {
      if (args.atTick === undefined) fail('VALIDATION_ERROR', 'MIDI split requires absolute atTick.');
      const delta = args.atTick - clip.startTick;
      if (delta <= 0 || delta >= clip.lengthTicks) fail('SPLIT_OUT_OF_BOUNDS', 'Split must be strictly inside the MIDI clip.', { clipId: clip.id, atTick: args.atTick });
      if (hasMidiSourceOrdering(clip)) {
        // A fresh opaque group avoids accidental reunification when a deleted
        // clip's public ID is later reused. This is lineage, not an object ID.
        const group = clip.midiOrderGroup ?? newId('midi-order');
        clip.midiOrderGroup = group; right.midiOrderGroup = group;
      }
      right.startTick = args.atTick; right.lengthTicks = clip.lengthTicks - delta; right.notes = [];
      const leftNotes = [];
      const invalidatedQuantizeNoteIds = [], translatedQuantizeNoteIds = [];
      for (const note of clip.notes) {
        const end = note.startTick + note.durationTicks;
        if (note.startTick >= delta) {
          const moved = { ...note, startTick: note.startTick - delta };
          if (moved.quantizeReference) {
            if (moved.quantizeReference.startTick >= delta) {
              moved.quantizeReference = { ...moved.quantizeReference, startTick: moved.quantizeReference.startTick - delta };
              translatedQuantizeNoteIds.push(moved.id);
            } else { delete moved.quantizeReference; invalidatedQuantizeNoteIds.push(moved.id); }
          }
          right.notes.push(moved); changes.updated.push(note.id);
        } else if(end>delta&&args.splitNotes===false){
          clip.allowNoteTails=true;leftNotes.push(note);
          if(note.quantizeReference&&!quantizeReferenceFits(note.quantizeReference,delta)){delete note.quantizeReference;invalidatedQuantizeNoteIds.push(note.id);}
          changes.updated.push(note.id);
        } else if (end > delta) {
          const fragment = { ...note, id: newId('note'), startTick: 0, durationTicks: end - delta };
          // Only original endpoints retain their source order/release bytes.
          // The newly generated split boundary uses ordinary synthetic endpoints.
          delete fragment.onOrder;
          delete note.offOrder; delete note.releaseVelocity; delete note.noteOffEncoding;
          if (note.quantizeReference) {
            delete note.quantizeReference; delete fragment.quantizeReference;
            invalidatedQuantizeNoteIds.push(note.id, fragment.id);
          }
          right.notes.push(fragment); changes.created.push(fragment.id);
          note.durationTicks = delta - note.startTick; leftNotes.push(note); changes.updated.push(note.id);
        } else {
          if (note.quantizeReference && !quantizeReferenceFits(note.quantizeReference, delta)) {
            delete note.quantizeReference; invalidatedQuantizeNoteIds.push(note.id); changes.updated.push(note.id);
          }
          leftNotes.push(note);
        }
      }
      const movedEventIds = (clip.events ?? []).filter(event => event.tick >= delta).map(event => event.id);
      const curveSplit = splitMidiEvents(clip, right, delta, {chaseControllers:args.chaseControllers??false}); changes.updated = changes.updated.concat(movedEventIds,curveSplit.updatedEventIds); changes.created.push(...curveSplit.createdEventIds);
      if(curveSplit.warnings.length)changes.warnings=curveSplit.warnings;
      clip.notes = leftNotes; clip.lengthTicks = delta;
      changes.split = { type: 'midi', requestedTick: args.atTick, actualTick: args.atTick, roundingTicks: 0, leftClipId: clip.id, rightClipId: right.id,
        invalidatedQuantizeNoteIds, translatedQuantizeNoteIds };
      if (!args.chaseControllers && (clip.events?.length ?? 0) + (right.events?.length ?? 0)) (changes.warnings??=[]).push({ code: 'MIDI_SPLIT_STATE_NOT_CHASED', message: 'Raw events were partitioned without chasing controller state or joining SysEx packets. Playing or moving a fragment separately can change its result.' });
      if(Object.hasOwn(args,'chaseControllers'))changes.split.chaseControllers = args.chaseControllers;
      changes.split.splitNotes=args.splitNotes??true;
    } else {
      if (args.atSample === undefined) fail('VALIDATION_ERROR', 'Audio split requires absolute atSample.');
      const { leftFrames, actualSample, info } = audioSplitBoundary(project, clip, args.atSample);
      if(clip.reverse){const window=clone(clip.reverseWindow??{offsetFrames:clip.offsetFrames,lengthFrames:clip.lengthFrames});clip.reverseWindow=window;right.reverseWindow=clone(window);}
      if(clip.fadeInFrames||clip.fadeOutFrames||clip.fadeWindow){const window=clone(clip.fadeWindow??{offsetFrames:clip.offsetFrames,lengthFrames:clip.lengthFrames});clip.fadeWindow=window;right.fadeWindow=clone(window);}
      right.startSample = actualSample; right.offsetFrames += leftFrames; right.lengthFrames -= leftFrames;
      clip.lengthFrames = leftFrames;
      changes.split = { ...info, leftClipId: clip.id, rightClipId: right.id };
    }
    project.clips.splice(project.clips.indexOf(clip) + 1, 0, right);
    resolvedTargets = [...new Set([...changes.updated, ...changes.created])];
  } else {
    const clip = midiClip(project, args.clipId);
    const notes = selectedNotes(clip, args.noteIds);
    resolvedTargets = [clip.id, ...notes.map(note => note.id)];
    if(command==='midi.notes.split'){
      const ticks=[...args.atTicks].sort((a,b)=>a-b),selected=new Set(notes.map(n=>n.id)),cuts=new Map();let count=0;
      for(const note of notes){const inside=ticks.filter(t=>t>note.startTick&&t<note.startTick+note.durationTicks);if(inside.length){cuts.set(note.id,inside);count+=inside.length;}}
      if(count>MAX_COPIED_NOTES)fail('COPY_LIMIT','Note splitting creates at most 200000 fragments.',{requested:count,limit:MAX_COPIED_NOTES});
      const output=[],splits=[],invalidated=[];
      for(const note of clip.notes){
        const inside=selected.has(note.id)?cuts.get(note.id):null;if(!inside){output.push(note);continue;}
        const original=clone(note),bounds=[original.startTick,...inside,original.startTick+original.durationTicks],fragmentIds=[];
        for(let i=0;i<bounds.length-1;i++){
          const fragment={...clone(original),id:i===0?original.id:newId('note'),startTick:bounds[i],durationTicks:bounds[i+1]-bounds[i]};
          if(i>0){delete fragment.onOrder;changes.created.push(fragment.id);}
          if(i<bounds.length-2){delete fragment.offOrder;delete fragment.releaseVelocity;delete fragment.noteOffEncoding;}
          if(fragment.quantizeReference){delete fragment.quantizeReference;invalidated.push(fragment.id);}
          output.push(fragment);fragmentIds.push(fragment.id);
        }
        changes.updated.push(original.id);splits.push({sourceNoteId:original.id,fragmentIds});
      }
      clip.notes=output;if(splits.length)changes.updated.push(clip.id);
      changes.noteSplits={splits,atTicks:ticks,invalidatedQuantizeNoteIds:invalidated};resolvedTargets=[clip.id,...notes.map(n=>n.id)];
    } else if(command==='midi.notes.glue'){
      const sources=new Set(notes.map(n=>n.id)),removed=new Set(),invalidated=[],pairs=[];
      const lanes=new Map();for(const note of clip.notes){const key=`${note.channel}:${note.pitch}`;if(!lanes.has(key))lanes.set(key,[]);lanes.get(key).push(note);}
      for(const lane of lanes.values()){
        lane.sort((a,b)=>a.startTick-b.startTick);
        const successor=Array.from({length:lane.length+1},(_,i)=>i);
        const live=index=>{let root=index;while(successor[root]!==root)root=successor[root];while(successor[index]!==index){const next=successor[index];successor[index]=root;index=next;}return root;};
        for(let i=lane.length-1;i>=0;i--){
          const first=lane[i];if(!sources.has(first.id)||removed.has(first.id))continue;
          let low=i+1,high=lane.length;while(low<high){const middle=Math.floor((low+high)/2);if(lane[middle].startTick<=first.startTick)low=middle+1;else high=middle;}
          const nextIndex=live(low),next=lane[nextIndex];if(!next)continue;
          const end=Math.max(first.startTick+first.durationTicks,next.startTick+next.durationTicks),duration=end-first.startTick;
          if(duration!==first.durationTicks){if(first.quantizeReference){delete first.quantizeReference;invalidated.push(first.id);}first.durationTicks=duration;}
          successor[nextIndex]=live(nextIndex+1);removed.add(next.id);changes.updated.push(first.id);pairs.push({firstNoteId:first.id,removedNoteId:next.id});
        }
      }
      clip.notes=clip.notes.filter(n=>!removed.has(n.id));changes.removed=[...removed];changes.updated=changes.updated.filter(id=>!removed.has(id));
      if(removed.size)changes.updated.push(clip.id);
      changes.glue={pairs,invalidatedQuantizeNoteIds:invalidated,matching:['pitch','channel'],next:'strictly-later-onset'};
      resolvedTargets=[clip.id,...new Set([...notes.map(n=>n.id),...removed])];
    } else if (command === 'midi.notes.removeDoubles') {
      const seen = new Set();
      clip.notes = clip.notes.filter(note => {
        const key = `${note.channel}:${note.pitch}:${note.startTick}`;
        if (seen.has(key)) { changes.removed.push(note.id); return false; }
        seen.add(key); return true;
      });
      if (changes.removed.length) changes.updated.push(clip.id);
      changes.deduplication = { match: ['pitch', 'startTick', 'channel'], keep: 'first-in-stored-order' };
    } else {
      let affectedNotes = notes;
      if (command === 'midi.notes.transpose') {
        let plan;try{plan=planTranspose(notes,args);}catch(error){fail(error.code??'INVALID_TRANSPOSE',error.message);}
        const byId=new Map(notes.map(n=>[n.id,n]));for(const update of plan.updates)byId.get(update.noteId).pitch=update.pitch;
        const {updates,...summary}=plan;changes.transpose=summary;
      } else if(command==='midi.notes.reverse'){
        let left=Infinity,right=0;for(const note of notes){left=Math.min(left,note.startTick);right=Math.max(right,args.mode==='reverse'?note.startTick:note.startTick+note.durationTicks);}
        const plans=[],invalidated=[],invalidatedOrders=[];let requiredLength=clip.lengthTicks;
        for(const note of notes){
          const target=BigInt(left)+BigInt(right)-BigInt(note.startTick)-(args.mode==='mirror'?BigInt(note.durationTicks):0n);
          const start=safeInteger(target,{noteId:note.id}),end=safeInteger(target+BigInt(note.durationTicks),{noteId:note.id});
          safeInteger(BigInt(clip.startTick)+BigInt(end),{clipId:clip.id});
          if(start>=clip.lengthTicks||(!clip.allowNoteTails&&end>clip.lengthTicks)){
            if(!args.extendPart)fail('NOTE_OUT_OF_BOUNDS','Reverse would exceed part bounds. Enable extendPart.',{noteId:note.id});
            requiredLength=Math.max(requiredLength,end,start+1);
          }
          plans.push({note,start});
        }
        affectedNotes=[];
        for(const {note,start} of plans)if(start!==note.startTick){
          note.startTick=start;if(note.quantizeReference){delete note.quantizeReference;invalidated.push(note.id);}
          if(note.onOrder!==undefined||note.offOrder!==undefined){delete note.onOrder;delete note.offOrder;invalidatedOrders.push(note.id);}
          affectedNotes.push(note);
        }
        const previousLengthTicks=clip.lengthTicks;clip.lengthTicks=requiredLength;
        changes.reverse={mode:args.mode,leftTick:notes.length?left:null,rightTick:notes.length?right:null,previousLengthTicks,lengthTicks:requiredLength,invalidatedQuantizeNoteIds:invalidated,invalidatedSourceOrderNoteIds:invalidatedOrders,rawEventsMoved:false};
      } else if(command==='midi.notes.restrictPolyphony'){
        const lanes=new Map(),invalidated=[];affectedNotes=[];
        for(const note of notes){const key=args.perChannel?note.channel:'all';if(!lanes.has(key))lanes.set(key,[]);lanes.get(key).push(note);}
        for(const lane of lanes.values()){
          lane.sort((a,b)=>a.startTick-b.startTick);let active=[];
          for(const note of lane){
            active=active.filter(n=>n.startTick+n.durationTicks>note.startTick);if(!note.durationTicks)continue;
            if(active.length>=args.voices){const oldest=active.shift();oldest.durationTicks=note.startTick-oldest.startTick;delete oldest.offOrder;if(oldest.quantizeReference){delete oldest.quantizeReference;invalidated.push(oldest.id);}affectedNotes.push(oldest);}
            active.push(note);
          }
        }
        changes.polyphony={voices:args.voices,perChannel:args.perChannel??false,policy:'oldest-active-first-stored-ties',sustainInterpreted:false,invalidatedQuantizeNoteIds:invalidated};
      } else if(command==='midi.notes.deleteOverlaps'){
        const lanes=new Map(),invalidated=[];affectedNotes=[];
        for(const note of notes){const key=args.mode==='samePitch'?`${note.channel}:${note.pitch}`:String(note.channel);if(!lanes.has(key))lanes.set(key,[]);lanes.get(key).push(note);}
        for(const lane of lanes.values()){
          lane.sort((a,b)=>a.startTick-b.startTick);
          for(let i=0;i<lane.length-1;i++){
            const note=lane[i],next=lane[i+1];if(note.startTick+note.durationTicks<=next.startTick)continue;
            note.durationTicks=next.startTick-note.startTick;
            if(note.quantizeReference){delete note.quantizeReference;invalidated.push(note.id);}
            affectedNotes.push(note);
          }
        }
        changes.overlaps={mode:args.mode,matchingChannel:true,simultaneous:'stored-order-last-wins-zero-duration',invalidatedQuantizeNoteIds:invalidated};
      } else if(command==='midi.notes.length'){
        if(args.mode==='scale'&&args.value<0)fail('VALIDATION_ERROR','Length scale must be nonnegative.');
        const policy=args.overflow??'reject',plans=[],invalidated=[];let requiredLength=clip.lengthTicks;
        for(const note of notes){
          const value=args.mode==='set'?args.value:args.mode==='add'?note.durationTicks+args.value:note.durationTicks*args.value;
          let duration=Math.max(1,Math.round(value));
          if(!Number.isSafeInteger(duration)||!Number.isSafeInteger(note.startTick+duration)||!Number.isSafeInteger(clip.startTick+note.startTick+duration))fail('TIME_OVERFLOW','Length edit exceeds safe tick range.',{noteId:note.id});
          if(note.startTick+duration>clip.lengthTicks){
            if(policy==='reject')fail('NOTE_OUT_OF_BOUNDS','Length edit exceeds part end. Choose trim or extend.',{noteId:note.id});
            if(policy==='trim')duration=clip.lengthTicks-note.startTick;
            else requiredLength=Math.max(requiredLength,note.startTick+duration);
          }
          plans.push({note,duration});
        }
        affectedNotes=[];
        for(const {note,duration} of plans)if(duration!==note.durationTicks){if(note.quantizeReference){delete note.quantizeReference;invalidated.push(note.id);}note.durationTicks=duration;affectedNotes.push(note);}
        const previousLengthTicks=clip.lengthTicks;clip.lengthTicks=requiredLength;
        changes.length={mode:args.mode,value:args.value,overflow:policy,previousLengthTicks,lengthTicks:requiredLength,invalidatedQuantizeNoteIds:invalidated};
      } else if (command === 'midi.notes.velocity') {
        if(args.mode!=='limit'&&!Number.isFinite(args.value))fail('VALIDATION_ERROR','set/add/scale requires a finite value.');
        if (args.mode === 'scale' && args.value < 0) fail('VALIDATION_ERROR', 'Velocity scale must be nonnegative.', { value: args.value });
        const field=args.field??'velocity',minimum=args.minVelocity??(field==='velocity'?1:0),maximum=args.maxVelocity??127;
        if(minimum>maximum||field==='velocity'&&minimum<1)fail('INVALID_VELOCITY_RANGE','Use ordered limits; note-on velocity minimum is 1.');
        for (const note of notes) {
          const current=note[field]??0,value=args.mode==='limit'?current:args.mode==='set'?args.value:args.mode==='add'?current+args.value:current*args.value;
          note[field]=clamp(Math.round(value),minimum,maximum);if(field==='releaseVelocity'&&note[field]>0&&note.noteOffEncoding==='zeroVelocityNoteOn')note.noteOffEncoding='noteOff';
        }
        changes.velocity={field,mode:args.mode,minVelocity:minimum,maxVelocity:maximum};
      } else if (command === 'midi.notes.quantize') {
        const strength = args.strength ?? 1, swing = args.swing ?? 0, target = args.target ?? 'start', basis = args.basis ?? 'current';
        const capturedReferenceNoteIds = [];
        for (const note of notes) {
          if (captureQuantizeReference(note)) capturedReferenceNoteIds.push(note.id);
          const source = basis === 'original' ? note.quantizeReference : note;
          const initial = target === 'start' ? source.startTick : target === 'end' ? source.startTick + source.durationTicks : source.durationTicks;
          const quantized = nearestGrid(initial, args.gridTicks, swing);
          const result = Math.round(initial + (quantized - initial) * strength);
          if (target === 'start') note.startTick = clamp(result, 0, clip.lengthTicks - Math.max(1,note.durationTicks));
          else note.durationTicks = clamp(target === 'end' ? result - note.startTick : result, source.durationTicks===0?0:1, clip.lengthTicks - note.startTick);
        }
        changes.quantize = { gridTicks: args.gridTicks, strength, swing, target, origin: 'clip', basis, capturedReferenceNoteIds };
      } else if (command === 'midi.notes.resetQuantize') {
        affectedNotes = notes.filter(note => note.quantizeReference);
        const skippedNoteIds = notes.filter(note => !note.quantizeReference).map(note => note.id);
        for (const note of affectedNotes) Object.assign(note, timingOf(note.quantizeReference));
        changes.resetQuantize = { restoredNoteIds: affectedNotes.map(note => note.id), skippedNoteIds };
      } else if (command === 'midi.notes.freezeQuantize') {
        for (const note of notes) note.quantizeReference = timingOf(note);
        changes.freezeQuantize = { frozenNoteIds: notes.map(note => note.id) };
      } else if (command === 'midi.notes.legato') {
        if(Object.hasOwn(args,'gapTicks')&&Object.hasOwn(args,'overlapTicks'))fail('VALIDATION_ERROR','Use gapTicks or overlapTicks, not both.');
        const invalidatedQuantizeNoteIds = [];
        const betweenSelectedOnly=args.betweenSelectedOnly??true,candidates=betweenSelectedOnly?notes:clip.notes;
        const nextByChannel = new Map();
        // Sorting onsets, not mutating clip order, makes polyphonic chord handling deterministic.
        for (const channel of new Set(notes.map(note => note.channel))) {
          const starts = [...new Set(candidates.filter(note => note.channel === channel).map(note => note.startTick))].sort((a, b) => a - b);
          nextByChannel.set(channel, new Map(starts.map((start, index) => [start, starts[index + 1] ?? clip.lengthTicks])));
        }
        const gap = Object.hasOwn(args,'overlapTicks')?-BigInt(args.overlapTicks):BigInt(args.gapTicks??0);
        for (const note of notes) {
          const desiredEnd = BigInt(nextByChannel.get(note.channel).get(note.startTick)) - gap;
          const minimumEnd = BigInt(note.startTick) + 1n, maximumEnd = BigInt(clip.lengthTicks);
          const end = desiredEnd < minimumEnd ? minimumEnd : desiredEnd > maximumEnd ? maximumEnd : desiredEnd;
          const duration = Number(end - BigInt(note.startTick));
          if (duration !== note.durationTicks && note.quantizeReference) { delete note.quantizeReference; invalidatedQuantizeNoteIds.push(note.id); }
          note.durationTicks = duration;
        }
        changes.legato = { gapTicks: Number(gap),overlapTicks:Number(-gap),betweenSelectedOnly, next: betweenSelectedOnly?'strictly-later-selected-onset-in-same-channel':'strictly-later-onset-in-same-channel', final: 'clip-end', invalidatedQuantizeNoteIds };
      }
      changes.updated = affectedNotes.map(note => note.id);
      if (affectedNotes.length || changes.length?.previousLengthTicks!==changes.length?.lengthTicks || changes.reverse?.previousLengthTicks!==changes.reverse?.lengthTicks) changes.updated.push(clip.id);
    }
  }
  return { changes, resolvedTargets };
}
