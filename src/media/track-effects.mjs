import {estimateTrackEqTail,estimatePreFilterTail} from './track-eq.mjs';
import {estimateTrackDelayTail} from './track-delay.mjs';
/** Sequential effect decay estimate; callers apply their explicit cap/window policy. */
export function estimateTrackEffectsTail(track,sampleRate,tempoMap){return estimatePreFilterTail(track.pre,sampleRate)+estimateTrackEqTail(track.eq,sampleRate)+estimateTrackDelayTail(track.delay,tempoMap);}
