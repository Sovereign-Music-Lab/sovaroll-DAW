import { requireValue, finite, integer } from './common.mjs';
import { compileTempoMap } from './time.mjs';
import { compileMusicalTime } from './musical-time.mjs';
import { compileTimecode } from './timecode.mjs';
import { formatClockMilliseconds } from './elapsed-time.mjs';

export const TIME_FORMATS = Object.freeze(['bars-beats', 'seconds', 'samples', 'timecode', 'user-fps']);
export const TIME_FORMAT_LABELS = Object.freeze({ 'bars-beats': 'Bars+Beats', seconds: 'Seconds', samples: 'Samples', timecode: 'Timecode', 'user-fps': 'fps (User)' });
const int = (min, max) => ({ type: 'integer', minimum: min, maximum: max });
const frameProperties = { nominalFps: int(1, 120), numerator: int(1, 1000000000), denominator: int(1, 1000000000), dropFrame: { type: 'boolean' } };
export const timeDisplaySchema = {
  type: 'object', additionalProperties: false,
  properties: {
    primaryFormat: { type: 'string', enum: [...TIME_FORMATS] },
    timelineFormat: { type: 'string', enum: ['inherit', ...TIME_FORMATS] },
    pianoFormat: { type: 'string', enum: ['inherit', ...TIME_FORMATS] },
    timelineMode: { type:'string', enum:['beat-linear','time-linear'] },
    pianoMode: { type:'string', enum:['beat-linear','time-linear'] },
    frameRate: { type: 'object', additionalProperties: false, properties: frameProperties, required: Object.keys(frameProperties) },
    userFps: int(1, 120), showSubframes: { type: 'boolean' }
  },
  required: ['primaryFormat', 'timelineFormat', 'pianoFormat', 'frameRate', 'userFps', 'showSubframes']
};
export const defaultTimeDisplay = () => ({ primaryFormat: 'bars-beats', timelineFormat: 'inherit', pianoFormat: 'inherit', timelineMode:'beat-linear', pianoMode:'beat-linear',
  frameRate: { nominalFps: 30, numerator: 30, denominator: 1, dropFrame: false }, userFps: 60, showSubframes: false });

export function resolveTimeDisplay(input = {}) {
  requireValue(input && typeof input === 'object' && !Array.isArray(input) &&
    Object.keys(input).every(k => Object.hasOwn(timeDisplaySchema.properties,k)), 'INVALID_TIME_DISPLAY', 'Unknown time display setting.');
  const value = { ...defaultTimeDisplay(), ...input };
  requireValue(TIME_FORMATS.includes(value.primaryFormat) &&
    ['timelineFormat', 'pianoFormat'].every(k => ['inherit', ...TIME_FORMATS].includes(value[k])) &&
    ['timelineMode','pianoMode'].every(k=>['beat-linear','time-linear'].includes(value[k])) &&
    typeof value.showSubframes === 'boolean', 'INVALID_TIME_DISPLAY', 'Invalid time format or subframe setting.');
  integer(value.userFps, 1, 120, 'User FPS');
  const frame = value.frameRate;
  requireValue(frame && typeof frame === 'object' && !Array.isArray(frame) &&
    Object.keys(frame).length === 4 && Object.keys(frame).every(k => Object.hasOwn(frameProperties, k)),
  'INVALID_TIME_DISPLAY', 'Replace frame rate as a complete nominal/actual/drop-frame configuration.');
  for (const k of ['nominalFps', 'numerator', 'denominator']) integer(frame[k], 1, k === 'nominalFps' ? 120 : 1000000000, k);
  compileTimecode({ nominalFps: frame.nominalFps, rate: { numerator: frame.numerator, denominator: frame.denominator }, dropFrame: frame.dropFrame });
  return { ...value, frameRate: { ...frame } };
}

/** Readouts only: float64 step-tempo seconds, explicit floor to the displayed unit.
 * Never use a rendered string as a lossless edit value. Stored ticks retain exact Bars+Beats.
 * A local position is elapsed from originTick; durations need both project endpoints.
 */
export function compileProjectTimeDisplay(project, displayPpq = 480) {
  const options = resolveTimeDisplay(project.timeDisplay);
  const musical = compileMusicalTime({ ppq: project.ppq, displayPpq, timeSignature: project.timeSignature });
  const tempo = compileTempoMap(project.tempoMap, project.ppq);
  const sampleRate = integer(project.sampleRate, 1, Number.MAX_SAFE_INTEGER, 'Project sample rate');
  const f = options.frameRate;
  const timecode = compileTimecode({ nominalFps: f.nominalFps, rate: { numerator: f.numerator, denominator: f.denominator }, dropFrame: f.dropFrame });
  const user = compileTimecode({ nominalFps: options.userFps });
  const bounded = (n, label) => finite(n, 0, Number.MAX_SAFE_INTEGER, label);
  const floor = (n, label) => Math.floor(bounded(n, label));
  function formatFor(scope = 'primary') {
    requireValue(['primary', 'timeline', 'piano'].includes(scope), 'INVALID_TIME_DISPLAY', 'Unknown time display scope.');
    const value = scope === 'primary' ? options.primaryFormat : options[scope + 'Format'];
    return value === 'inherit' ? options.primaryFormat : value;
  }
  function text(seconds, tick, format, duration, samples) {
    if (format === 'bars-beats') return musical[duration ? 'formatDuration' : 'formatPosition'](floor(tick, 'Display tick'));
    if (format === 'seconds') return formatClockMilliseconds(floor(seconds * 1000, 'Milliseconds'));
    if (format === 'samples') return String(samples ?? floor(seconds * sampleRate, 'Samples'));
    const tc = format === 'timecode' ? timecode : user;
    const rate = format === 'timecode' ? f.numerator / f.denominator : options.userFps;
    // Select the frame first when subframes are hidden; avoid a second rounding path.
    const units = floor(seconds * rate * (options.showSubframes ? 80 : 1), 'Timecode units');
    return tc.format(options.showSubframes ? String(units) : (BigInt(units) * 80n).toString(), options.showSubframes);
  }
  function result(tick, seconds, scope, duration = false, samples) {
    const format = formatFor(scope);
    return { format, text: text(seconds, tick, format, duration, samples), tick, seconds,
      quantization: 'display-only-floor', precision: format === 'bars-beats' && Number.isSafeInteger(tick) ? 'exact-source-tick' :
        format === 'samples' && samples !== undefined ? 'exact-source-sample' : 'float64-display' };
  }
  return Object.freeze({ options: Object.freeze({ ...options, frameRate: Object.freeze(options.frameRate) }), displayPpq, formatFor,
    position(tick, scope = 'primary', originTick = 0) {
      bounded(tick, 'Tick'); bounded(originTick, 'Origin tick'); bounded(originTick + tick, 'Absolute tick');
      return result(tick, tempo.tickToSeconds(originTick + tick) - tempo.tickToSeconds(originTick), scope);
    },
    duration(startTick, endTick, scope = 'primary') {
      bounded(startTick, 'Start tick'); bounded(endTick, 'End tick');
      requireValue(endTick >= startTick, 'INVALID_TIME_DISPLAY', 'Duration end must follow start.');
      return result(endTick - startTick, tempo.tickToSeconds(endTick) - tempo.tickToSeconds(startTick), scope, true);
    },
    samplePosition(sample, scope = 'primary') {
      integer(sample, 0, Number.MAX_SAFE_INTEGER, 'Sample');
      const seconds = sample / sampleRate;
      return result(tempo.secondsToTick(seconds), seconds, scope, false, sample);
    }
  });
}
