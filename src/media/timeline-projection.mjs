import { finite, integer, requireValue } from './common.mjs';
import { timeFields } from './elapsed-time.mjs';
import { compileTempoMap } from './time.mjs';

/** Display-only floating-point projection. Never rounds, snaps, edits MIDI, or applies display offsets.
 * scale = pixels/quarter in beat-linear, pixels/second in time-linear.
 * originTick maps to originPixel; negative pixels are valid, negative source time is not.
 */
export function compileTimelineProjection(options) {
  timeFields(options, ['tempoMap', 'ppq', 'sampleRate', 'mode', 'scale', 'originTick', 'originPixel']);
  const { tempoMap, ppq = 960, sampleRate = 48000, mode = 'beat-linear', scale = 96,
    originTick = 0, originPixel = 0 } = options;
  requireValue(['beat-linear', 'time-linear'].includes(mode), 'INVALID_TIME_VALUE', 'Unknown timeline projection mode.');
  integer(sampleRate, 1, Number.MAX_SAFE_INTEGER, 'Sample rate');
  finite(scale, Number.MIN_VALUE, Number.MAX_SAFE_INTEGER, 'Projection scale');
  finite(originTick, 0, Number.MAX_SAFE_INTEGER, 'Origin tick');
  finite(originPixel, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 'Origin pixel');
  const tempo = compileTempoMap(tempoMap, ppq), originSeconds = tempo.tickToSeconds(originTick);
  const bounded = value => finite(value, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 'Projected pixel');
  const nonnegative = (value, name) => finite(value, 0, Number.MAX_SAFE_INTEGER, name);
  function tickToPixel(tick) {
    nonnegative(tick, 'Tick');
    return bounded(originPixel + (mode === 'beat-linear' ? (tick - originTick) / ppq :
      tempo.tickToSeconds(tick) - originSeconds) * scale);
  }
  function pixelToTick(pixel) {
    bounded(pixel);
    const delta = (pixel - originPixel) / scale;
    return nonnegative(mode === 'beat-linear' ? originTick + delta * ppq :
      tempo.secondsToTick(originSeconds + delta), 'Projected tick');
  }
  function secondsToPixel(seconds) {
    nonnegative(seconds, 'Seconds');
    return mode === 'time-linear' ? bounded(originPixel + (seconds - originSeconds) * scale) :
      tickToPixel(tempo.secondsToTick(seconds));
  }
  function pixelToSeconds(pixel) {
    bounded(pixel);
    return mode === 'time-linear' ? nonnegative(originSeconds + (pixel - originPixel) / scale, 'Projected seconds') :
      tempo.tickToSeconds(pixelToTick(pixel));
  }
  return Object.freeze({
    mode, scale, ppq, sampleRate, originTick, originPixel,
    tickToPixel, pixelToTick, secondsToPixel, pixelToSeconds,
    sampleToPixel: sample => secondsToPixel(nonnegative(sample, 'Sample') / sampleRate),
    pixelToSample: pixel => nonnegative(pixelToSeconds(pixel) * sampleRate, 'Projected sample'),
    // Length is anchored: durations crossing a tempo change cannot be converted as absolute positions.
    tickSpanToPixels(start, end) {
      nonnegative(start, 'Start tick'); nonnegative(end, 'End tick');
      requireValue(end >= start, 'INVALID_TIME_VALUE', 'Span end must follow start.');
      return bounded(tickToPixel(end) - tickToPixel(start));
    }
  });
}
