import {compileAudioFrontSpans} from './audio-overlap.mjs';
import {trackPreGain} from './track-pre.mjs';
import {estimateTrackEffectsTail} from './track-effects.mjs';
import {activeEqBands,processTrackEq,preFilterSections,processPreFilters} from './track-eq.mjs';
import {resolveTrackDelay,processTrackDelay} from './track-delay.mjs';
import {panGains,resolvePanLaw} from './pan-law.mjs';
import {selectRenderTracks,selectRenderClips,bypassRenderEffects} from './render-tracks.mjs';
import {audibleTrackIds} from './track-audibility.mjs';
import {audioFadeGain} from './audio-fade.mjs';
import {adjustMidiStreamLengths,resolveMidiTimingOptions} from './midi-length-adjustment.mjs';
import {modifierTrackIds} from './midi-modifiers.mjs';
import {chaseMidiStreams,resolveChaseOptions} from './midi-chase.mjs';
import { finite, integer, requireValue } from './common.mjs';
import { compileTempoMap } from './time.mjs';
import { compileMidiStreams } from './midi-stream.mjs';
import { needsMidiPlayback, midiPlaybackWarnings, compileMidiPlayback, renderMidiPlayback, midiPlaybackSampleCount } from './midi-playback.mjs';

import {MAX_RENDER_SECONDS as MAX_SECONDS,MAX_RENDER_SAMPLE_RATE as MAX_SAMPLE_RATE,MAX_RENDER_SOURCE_SAMPLES as MAX_MIX_SAMPLES} from './render-limits.mjs';
const RELEASE_SECONDS = 0.05;

function context(project) {
  requireValue(project && Array.isArray(project.tracks) && Array.isArray(project.clips) && Array.isArray(project.assets),
    'INVALID_RENDER_PROJECT', 'Expected a project containing tracks, clips and assets.');
  const sampleRate = integer(project.sampleRate, 1, MAX_SAMPLE_RATE, 'Render sample rate');
  const timeline = compileTempoMap(project.tempoMap, project.ppq ?? 960);
  const tracks = new Map(project.tracks.map(track => [track.id, track]));
  const assets = new Map(project.assets.map(asset => [asset.id, asset]));
  return { sampleRate, timeline, tracks, assets };
}

function clipEnd(clip, state) {
  const track = state.tracks.get(clip.trackId);
  requireValue(track && track.type === clip.type, 'INVALID_RENDER_PROJECT', 'A clip does not match an existing track.');
  if (clip.type === 'midi') {
    integer(clip.startTick, 0, Number.MAX_SAFE_INTEGER, 'MIDI clip start');
    integer(clip.lengthTicks, 1, Number.MAX_SAFE_INTEGER, 'MIDI clip length');
    let tick = clip.startTick + clip.lengthTicks;
    if(clip.allowNoteTails)for(const note of clip.notes)tick=Math.max(tick,clip.startTick+note.startTick+note.durationTicks);
    integer(tick, 1, Number.MAX_SAFE_INTEGER, 'MIDI clip end');
    return state.timeline.tickToSeconds(tick);
  }
  requireValue(clip.type === 'audio', 'INVALID_RENDER_PROJECT', 'Unsupported clip type.');
  const asset = state.assets.get(clip.assetId);
  requireValue(asset, 'ASSET_MISSING', `Audio asset metadata is missing: ${clip.assetId}.`);
  integer(asset.sampleRate, 1, 384000, 'Source sample rate');
  integer(asset.frames, 1, Number.MAX_SAFE_INTEGER, 'Source frames');
  integer(clip.startSample, 0, Number.MAX_SAFE_INTEGER, 'Audio clip start');
  integer(clip.offsetFrames, 0, Number.MAX_SAFE_INTEGER, 'Audio source offset');
  integer(clip.lengthFrames, 1, Number.MAX_SAFE_INTEGER, 'Audio source length');
  requireValue(Number.isSafeInteger(clip.offsetFrames + clip.lengthFrames) && clip.offsetFrames + clip.lengthFrames <= asset.frames,
    'INVALID_AUDIO_TRIM', 'Audio clip offset and length extend beyond the source asset.');
  return clip.startSample / state.sampleRate + clip.lengthFrames / asset.sampleRate;
}

/** Content length includes muted clips and intentionally empty MIDI clip tails. */
export function projectDurationSeconds(project) {
  const state = context(project);
  let duration = 0;
  for (const clip of project.clips) duration = Math.max(duration, clipEnd(clip, state));
  const modified=modifierTrackIds(project);
  if(modified.length)duration=Math.max(duration,state.timeline.tickToSeconds(compileMidiStreams(project,{trackIds:modified}).endTick));
  return duration;
}

function linearGain(value, name) { return 10 ** (finite(value ?? 0, -60, 12, name) / 20); }

/**
 * Deterministic offline stereo render. Explicit durationSeconds is final output length;
 * otherwise clip content length + tailSeconds (default .2). Samples retain headroom:
 * peak/clippedSamples describe the values before PCM16 export clamps them.
 */
export function renderProject(project, assets = new Map(), options = {}) {
  requireValue(options && typeof options === 'object', 'INVALID_RENDER_OPTIONS', 'Render options must be an object.');
  project=bypassRenderEffects(selectRenderClips(selectRenderTracks(project,options.trackIds),options.clipIds),options.bypassTrackEffects);
  const state = context(project);
  requireValue(assets instanceof Map, 'INVALID_RENDER_ASSETS', 'Render assets must be a Map keyed by asset ID.');
  const startTick=integer(options.startTick??0,0,Number.MAX_SAFE_INTEGER,'Render start tick');
  const chaseOptions=resolveChaseOptions(options.chaseOptions),timingOptions=resolveMidiTimingOptions(options.timingOptions);
  const startFrame=Math.ceil(state.timeline.tickToSeconds(startTick)*state.sampleRate),startSeconds=startFrame/state.sampleRate;
  requireValue(Number.isSafeInteger(startFrame),'RENDER_START_OUT_OF_RANGE','Render start exceeds safe integer sample range.');
  const tail = finite(options.tailSeconds ?? 0.2, 0, MAX_SECONDS, 'Render tail seconds');
  const modifiedIds=new Set(modifierTrackIds(project)),enabledIds=audibleTrackIds(project);
  const statefulTracks=[...new Set([...project.clips.filter(c=>enabledIds.has(c.trackId)&&needsMidiPlayback(c)).map(c=>c.trackId),...[...modifiedIds].filter(id=>enabledIds.has(id)),...(startTick>0||timingOptions.lengthAdjustmentTicks>0?project.tracks.filter(t=>t.type==='midi'&&enabledIds.has(t.id)).map(t=>t.id):[])])];
  const curveTracks=project.clips.filter(c=>enabledIds.has(c.trackId)&&c.type==='midi'&&c.events?.some(e=>e.curve!==undefined)).map(c=>c.trackId);
  const compileIds=[...new Set([...statefulTracks,...curveTracks,...modifiedIds])];
  let allStreams=compileIds.length?compileMidiStreams(project,{trackIds:compileIds,includeMutedClips:false}):null;
  if(allStreams&&timingOptions.lengthAdjustmentTicks>0)allStreams=adjustMidiStreamLengths(allStreams,{projectPpq:project.ppq??960,...timingOptions});
  const clipEnds = new Map();
  let contentDuration = 0;
  for (const clip of project.clips) {
    const end = clipEnd(clip, state);
    clipEnds.set(clip, end);
    contentDuration = Math.max(contentDuration, end);
  }
  for(const stream of allStreams?.tracks??[])if(modifiedIds.has(stream.trackId))contentDuration=Math.max(contentDuration,state.timeline.tickToSeconds(stream.endTick));
  requireValue(options.autoEffectTail===undefined||typeof options.autoEffectTail==='boolean','INVALID_RENDER_OPTIONS','autoEffectTail must be boolean.');
  const effectTailEstimate=project.tracks.filter(t=>enabledIds.has(t.id)).reduce((max,t)=>Math.max(max,estimateTrackEffectsTail(t,state.sampleRate,project.tempoMap)),0),automaticEffectTail=options.autoEffectTail!==false&&options.durationSeconds===undefined?Math.min(10,effectTailEstimate):0;
  const effectiveTail=Math.max(tail,automaticEffectTail),effectTail={enabled:options.autoEffectTail!==false,estimatedSeconds:effectTailEstimate,appliedTailSeconds:options.durationSeconds===undefined?effectiveTail:0,capped:automaticEffectTail>0&&effectTailEstimate>10,explicitDuration:options.durationSeconds!==undefined};
  const requestedDuration = options.durationSeconds === undefined ? contentDuration + effectiveTail
    : startSeconds+finite(options.durationSeconds, 0, MAX_SECONDS, 'Render duration seconds');
  finite(requestedDuration, 0, Number.MAX_SAFE_INTEGER/state.sampleRate, 'Render end seconds');
  requireValue(requestedDuration > 0, 'EMPTY_RENDER', 'Render duration must be positive; choose a duration or add a clip.');
  const frames = Math.ceil(requestedDuration * state.sampleRate);
  requireValue(frames>startFrame,'EMPTY_RENDER','Render start must precede the output end.');
  const outputFrames=frames-startFrame;
  requireValue(Number.isSafeInteger(frames)&&outputFrames <= MAX_SECONDS * state.sampleRate, 'RENDER_TOO_LONG', 'Render window exceeds 600 seconds including its tail.');
  const warnings = new Set();
  if(effectTail.capped)warnings.add('Automatic effect tail reached its10-second cap; effect decay may be truncated. Use an explicit longer render duration if needed.');
  midiPlaybackWarnings(project.clips, warnings);
  for(const warning of allStreams?.lengthAdjustment?.diagnostics??[])warnings.add(warning.message);
  if (options.durationSeconds !== undefined && requestedDuration < contentDuration) {
    warnings.add('The explicit render duration truncates project content and may cut off notes or audio.');
  }
  const panLaw=resolvePanLaw(project.panLaw);
  const masterGain = linearGain(project.masterGainDb ?? 0, 'Master gain');
  const mixerActiveIds=audibleTrackIds(project);
  const active = new Map();
  for (const track of project.tracks) {
    requireValue(track.type === 'midi' || track.type === 'audio', 'INVALID_RENDER_PROJECT', 'Unsupported track type.');
    const gain = linearGain(track.gainDb ?? 0, 'Track gain') * masterGain * trackPreGain(track.pre);
    const pan = finite(track.pan ?? 0, -1, 1, 'Track pan');
    const enabled = mixerActiveIds.has(track.id);
    const gains=panGains(pan,panLaw);
    active.set(track.id,{track,enabled,gain,panLaw,...Object.fromEntries(Object.entries(gains).map(([key,value])=>[key,value*gain]))});
  }
  for (const warning of allStreams?.curveWarnings ?? []) warnings.add(warning.message);
  for(const warning of allStreams?.modifierWarnings??[])warnings.add(warning);
  const statefulIds = new Set(statefulTracks);
  let playbackStreams = allStreams?.tracks.filter(track => statefulIds.has(track.trackId));
  let chased=null;
  if(startTick>0&&allStreams){
    chased=chaseMidiStreams({...allStreams,tracks:playbackStreams},project,{tick:startTick,options:chaseOptions});
    playbackStreams=playbackStreams.map((track,i)=>({...track,events:[...chased.tracks[i].events,...track.events.filter(e=>e.tick>=startTick)]}));
    for(const warning of chased.warnings)warnings.add(warning.message);
  }
  const streams = allStreams && statefulTracks.length ? { ...allStreams, tracks: playbackStreams, noteCount: playbackStreams.reduce((n,track)=>n+track.events.filter(event=>event.kind==='noteOn').length,0) } : null;
  const playback = streams ? compileMidiPlayback(streams, { timeline: state.timeline, contentDuration, warnings }) : null;
  const tasks = [];
  const frontSpans=compileAudioFrontSpans(project);
  const audioBoundaryKey = (clip,offset=clip.offsetFrames,start=clip.startSample) =>
    `${clip.trackId}/${clip.assetId}/${offset}/${start}/${clip.gainDb ?? 0}/${clip.invertPolarity??false}/${clip.reverse??false}/${JSON.stringify(clip.reverseWindow??null)}/${JSON.stringify(clip.dcOffsets??[])}`;
  const audioStarts = new Set(project.clips.filter(clip=>clip.type==='audio'&&!clip.mute).map(clip=>audioBoundaryKey(clip)));
  let mixSamples = 0, totalNotes = streams?.noteCount ?? 0;
  const reserve = samples => {
    mixSamples += samples;
    requireValue(mixSamples <= MAX_MIX_SAMPLES, 'RENDER_TOO_COMPLEX',
      'Render exceeds the 150 million source-sample work limit; shorten the range or reduce overlapping voices.');
  };
  for (const clip of project.clips) {
    const mixer = active.get(clip.trackId);
    if (!mixer.enabled || clip.mute) continue;
    if (clip.type === 'midi') {
      requireValue(['sine', 'triangle', 'sawtooth'].includes(mixer.track.instrument ?? 'sine'),
        'UNSUPPORTED_INSTRUMENT', 'Offline synth supports only sine, triangle and sawtooth.');
      if (statefulIds.has(clip.trackId)) continue;
      requireValue(Array.isArray(clip.notes), 'INVALID_RENDER_PROJECT', 'MIDI clip notes must be an array.');
      for (const note of clip.notes) {
        requireValue(++totalNotes <= 200000, 'RENDER_TOO_COMPLEX', 'Render exceeds the 200000 note limit.');
        integer(note.pitch, 0, 127, 'Note pitch'); integer(note.velocity, 1, 127, 'Note velocity');
        integer(note.channel ?? 0, 0, 15, 'Note channel');
        integer(note.startTick, 0, Number.MAX_SAFE_INTEGER, 'Note start');
        integer(note.durationTicks, 0, Number.MAX_SAFE_INTEGER, 'Note duration');
        requireValue(Number.isSafeInteger(clip.startTick+note.startTick+note.durationTicks) && note.startTick < clip.lengthTicks && (clip.allowNoteTails || note.startTick + note.durationTicks <= clip.lengthTicks), 'INVALID_RENDER_PROJECT', 'Note extends beyond its MIDI clip.');
        if (note.durationTicks === 0) continue; // No pedal/state: same-tick note-on/off is silent.
        const start = state.timeline.tickToSeconds(clip.startTick + note.startTick);
        const end = state.timeline.tickToSeconds(clip.startTick + note.startTick + note.durationTicks);
        const first = Math.max(startFrame,Math.min(frames, Math.ceil(start * state.sampleRate)));
        const last = Math.min(frames, Math.ceil((end + RELEASE_SECONDS) * state.sampleRate));
        if (last <= first) continue;
        if (end + RELEASE_SECONDS > frames / state.sampleRate) {
          warnings.add('The render end cuts a synth release; increase the automatic tail or explicit render duration.');
        }
        const frequency = 440 * 2 ** ((note.pitch - 69) / 12);
        if (frequency >= state.sampleRate / 2) {
          warnings.add('Synth notes at or above Nyquist were omitted at the chosen project sample rate.');
          continue;
        }
        reserve(last - first);
        tasks.push({ type: 'midi', mixer, note, start, end, first, last, frequency });
      }
    } else {
      const first = Math.max(startFrame,Math.min(frames, clip.startSample));
      const last = Math.min(frames, Math.ceil(clipEnds.get(clip) * state.sampleRate));
      if (last <= first) continue;
      const source = assets.get(clip.assetId), metadata = state.assets.get(clip.assetId);
      requireValue(source, 'ASSET_MISSING', `Decoded audio asset is missing: ${clip.assetId}.`);
      requireValue(Array.isArray(source.channels) && source.channels.length >= 1 && source.channels.length <= 2,
        'UNSUPPORTED_RENDER_CHANNELS', 'Offline audio rendering supports mono or stereo WAV assets; multichannel layouts are not downmixed.');
      integer(source.sampleRate, 1, 384000, 'Decoded source sample rate');
      integer(source.frames, 1, 64000000, 'Decoded source frames');
      requireValue(source.sampleRate === metadata.sampleRate && source.frames === metadata.frames && source.channels.length === metadata.channels,
        'ASSET_METADATA_MISMATCH', 'Decoded audio does not match the stored asset metadata.');
      for (const channel of source.channels) {
        requireValue(channel instanceof Float32Array && channel.length === source.frames,
          'INVALID_RENDER_ASSETS', 'Decoded WAV channels must be equal-length Float32Arrays.');
      }
      const clipGain = linearGain(clip.gainDb ?? 0, 'Audio clip gain');
      reserve((last - first) * source.channels.length);
      const sourceEnd=clip.offsetFrames+clip.lengthFrames;
      const durationNumerator=clip.lengthFrames*state.sampleRate;
      const continues=durationNumerator%source.sampleRate===0&&audioStarts.has(audioBoundaryKey(clip,sourceEnd,clip.startSample+durationNumerator/source.sampleRate));
      const visible=frontSpans.get(clip.id)??[{start:first,end:last}];for(const span of visible){const spanFirst=Math.max(first,span.start),spanLast=Math.min(last,span.end);if(spanLast>spanFirst)tasks.push({ type: 'audio', mixer, clip, source, clipGain, first:spanFirst, last:spanLast,continues,interpolationEnd:continues?source.frames:sourceEnd });}
      if (source.sampleRate !== state.sampleRate) warnings.add('Audio with a different sample rate uses linear interpolation; this is not a mastering-quality resampler.');
    }
  }
  if (playback) reserve(midiPlaybackSampleCount(playback, state.sampleRate, frames,startFrame));
  const channels = [new Float32Array(outputFrames), new Float32Array(outputFrames)];
  if (tasks.some(task => task.type === 'midi')) {
    warnings.add('MIDI is rendered by the built-in basic oscillator synth, not the original instrument or General MIDI patches. Plugin state is not rendered.');
    if (tasks.some(task => task.type === 'midi' && task.mixer.track.instrument !== 'sine' && task.mixer.track.instrument !== undefined)) {
      warnings.add('Triangle and sawtooth oscillators are not band-limited and may alias at high pitches.');
    }
  }
  for(const mixer of active.values()){const delay=resolveTrackDelay(mixer.track.delay),eqBands=activeEqBands(mixer.track.eq),preSections=preFilterSections(mixer.track.pre,state.sampleRate),delayed=delay?.enabled&&delay.wet>0;if(mixer.enabled&&(delayed||eqBands.length||preSections.length)){reserve(outputFrames*2*(1+eqBands.length+preSections.length));mixer.effectChannels=[new Float32Array(outputFrames),new Float32Array(outputFrames)];if(delayed)warnings.add('Track delay uses the rendered window only; pre-range echoes are not reconstructed. Increase export tail to retain repeats.');if(preSections.length)warnings.add('Pre filters start at the rendered range boundary; earlier filter state is not reconstructed.');if(eqBands.length)warnings.add('Track EQ state starts at the rendered range boundary; pre-range filter state is not reconstructed.');}}
  for (const task of tasks) {
    const { mixer, first, last } = task;
    const [left,right]=mixer.effectChannels??channels;
    if (task.type === 'midi') {
      const duration = task.end - task.start, attack = Math.min(0.005, duration / 4);
      const amplitude = task.note.velocity / 127 * 0.2;
      for (let frame = first; frame < last; frame++) {
        const relative = frame / state.sampleRate - task.start;
        const envelope = relative < attack ? relative / attack
          : relative <= duration ? 1 : Math.max(0, 1 - (relative - duration) / RELEASE_SECONDS);
        const phase = relative * task.frequency;
        let signal;
        if (mixer.track.instrument === 'triangle') signal = (2 / Math.PI) * Math.asin(Math.sin(2 * Math.PI * phase));
        else if (mixer.track.instrument === 'sawtooth') signal = 2 * (phase - Math.floor(phase + 0.5));
        else signal = Math.sin(2 * Math.PI * phase);
        const value = signal * amplitude * envelope;
        left[frame-startFrame] += value * mixer.monoLeft;
        right[frame-startFrame] += value * mixer.monoRight;
      }
    } else {
      const { clip, source, clipGain, interpolationEnd,continues } = task;
      const sourceEnd = clip.offsetFrames + clip.lengthFrames;
      for (let frame = first; frame < last; frame++) {
        // Integer numerator preserves the same source position after a split on
        // the shared source/project grid, including nonzero source offsets.
        const position = (clip.offsetFrames * state.sampleRate + (frame - clip.startSample) * source.sampleRate) / state.sampleRate;
        if (position >= sourceEnd) break;
        // A contiguous split may interpolate across its shared boundary. A real
        // trim/gap must not pull discarded source samples back into the output.
        const reverseWindow=clip.reverseWindow??clip,physicalStart=2*reverseWindow.offsetFrames+reverseWindow.lengthFrames-clip.offsetFrames-clip.lengthFrames;
        const readPosition=clip.reverse?Math.max(continues?reverseWindow.offsetFrames:physicalStart,Math.min(reverseWindow.offsetFrames+reverseWindow.lengthFrames-1,2*reverseWindow.offsetFrames+reverseWindow.lengthFrames-1-position)):position;
        const index=Math.floor(readPosition),next=Math.min(index+1,clip.reverse?reverseWindow.offsetFrames+reverseWindow.lengthFrames-1:interpolationEnd-1),fraction=readPosition-index;
        const fade=audioFadeGain(clip,position);
        const sample = channel => {
          const a = source.channels[channel][index], b = source.channels[channel][next];
          requireValue(Number.isFinite(a) && Number.isFinite(b), 'INVALID_RENDER_ASSETS', 'Audio source contains non-finite samples.');
          return (a + (b - a) * fraction-(clip.dcOffsets?.[channel]??0)) * clipGain * fade * (clip.invertPolarity?-1:1);
        };
        if (source.channels.length === 1) {
          const value = sample(0);
          left[frame-startFrame] += value * mixer.monoLeft;
          right[frame-startFrame] += value * mixer.monoRight;
        } else {
          left[frame-startFrame] += sample(0) * mixer.stereoLeft;
          right[frame-startFrame] += sample(1) * mixer.stereoRight;
        }
      }
    }
  }
  if (playback) {
    const result = renderMidiPlayback(playback, { sampleRate: state.sampleRate, frames,startFrame, channels, mixers: active, warnings });
    if (result.renderedVoices) warnings.add('MIDI is rendered by the built-in basic oscillator synth, not the original instrument or General MIDI patches. Plugin state is not rendered.');
    if (result.nonSine) warnings.add('Triangle and sawtooth oscillators are not band-limited and may alias at high pitches.');
  }
  for(const mixer of active.values())if(mixer.effectChannels){processPreFilters(mixer.effectChannels,state.sampleRate,mixer.track.pre);processTrackEq(mixer.effectChannels,state.sampleRate,mixer.track.eq);processTrackDelay(mixer.effectChannels,state.sampleRate,mixer.track.delay,{tempoMap:project.tempoMap,ppq:project.ppq,startSeconds});for(let c=0;c<2;c++)for(let i=0;i<outputFrames;i++)channels[c][i]+=mixer.effectChannels[c][i];}
  const outputChannels=channels;
  let peak = 0, clippedSamples = 0;
  for (const channel of outputChannels) {
    for (const value of channel) {
      requireValue(Number.isFinite(value), 'RENDER_OVERFLOW', 'The render produced a non-finite sample.');
      const absolute = Math.abs(value);
      peak = Math.max(peak, absolute);
      if (absolute > 1) clippedSamples++;
    }
  }
  if (peak === 0) warnings.add('The rendered range is silent; check clip positions and track mute/solo states.');
  if (clippedSamples) warnings.add(`${clippedSamples} channel samples exceed full scale and will be clipped by integer PCM export (float32 preserves headroom); reduce the master or track gains.`);
  return { effectTail,panLaw, sampleRate: state.sampleRate, channels:outputChannels, frames:outputFrames, durationSeconds:outputFrames / state.sampleRate,
    startTick,startFrame,startSeconds,chaseOptions,chaseStats:chased?.stats??null,timingOptions,lengthAdjustment:allStreams?.lengthAdjustment?{policy:allStreams.lengthAdjustment.policy,stats:allStreams.lengthAdjustment.stats,diagnostics:allStreams.lengthAdjustment.diagnostics}:null,
    peak, clippedSamples, warnings: [...warnings] };
}
