import { DEFAULT_MIDI_DISPLAY_PPQ } from './midi-display-time.mjs';

const MAX = BigInt(Number.MAX_SAFE_INTEGER);
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
function integer(value, min, max, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    fail('INVALID_MUSICAL_TIME', `${label} must be a safe integer in ${min}…${max}`);
  }
  return BigInt(value);
}
function object(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !keys.includes(key))) {
    fail('INVALID_MUSICAL_TIME', `${label} contains unknown fields or is not an object`);
  }
}
function unsigned(value, label) {
  if (typeof value === 'number') return integer(value, 0, Number.MAX_SAFE_INTEGER, label);
  if (typeof value !== 'string' || !/^[0-9]{1,64}$/.test(value)) {
    fail('INVALID_MUSICAL_TIME', `${label} must be a nonnegative integer or at most64 decimal digits`);
  }
  return BigInt(value);
}
function fraction(numerator, denominator) {
  let a = numerator, b = denominator;
  while (b) [a, b] = [b, a % b];
  return { numerator: (numerator / a).toString(), denominator: Number(denominator / a) };
}
function projectTick(n, d, rounding) {
  if (!['exact', 'floor', 'ceil', 'nearest'].includes(rounding)) {
    fail('INVALID_MIDI_TICK_ROUNDING', 'Use exact, floor, ceil or nearest');
  }
  const remainder = n % d;
  if (rounding === 'exact' && remainder) {
    fail('MIDI_TICK_NOT_REPRESENTABLE', 'Musical time does not fall on a stored project tick');
  }
  let value = n / d;
  if ((rounding === 'ceil' && remainder) || (rounding === 'nearest' && 2n * remainder >= d)) value++;
  if (value > MAX) fail('MIDI_TICK_OVERFLOW', 'Musical time exceeds safe project position range');
  return Number(value);
}

/** Fixed project meter, without offsets or signature changes. Tempo does not
 * affect musical position. Positions are 1-based, elapsed durations 0-based.
 * The beat is the signature denominator's note value, including compound meter;
 * no dotted-beat grouping is inferred. For denominators32/64 a beat is shorter
 * than a sixteenth: the sixteenth field stays at its origin and ticks reset at
 * the next beat. This is an explicit newdaw boundary policy.
 *
 * Integer source ticks and BigInt intermediates make every readout reversible,
 * even when display PPQ or bar boundaries do not divide source PPQ. Bars are
 * decimal strings because at low PPQ a bar number can exceed MAX_SAFE_INTEGER.
 * Fractions are JSON-safe. No state or source event is modified.
 */
export function compileMusicalTime(options = {}) {
  object(options, ['ppq', 'displayPpq', 'timeSignature'], 'Musical time options');
  const ppq = options.ppq === undefined ? 960 : options.ppq;
  const displayPpq = options.displayPpq === undefined ? DEFAULT_MIDI_DISPLAY_PPQ : options.displayPpq;
  const timeSignature = options.timeSignature === undefined ? { numerator: 4, denominator: 4 } : options.timeSignature;
  object(timeSignature, ['numerator', 'denominator'], 'Time signature');
  const p = integer(ppq, 1, 32767, 'Project PPQ');
  const display = integer(displayPpq, 1, 32767, 'Display PPQ');
  const numerator = integer(timeSignature.numerator, 1, Number.MAX_SAFE_INTEGER, 'Time signature numerator');
  const denominator = timeSignature.denominator;
  if (![1, 2, 4, 8, 16, 32, 64].includes(denominator)) {
    fail('INVALID_MUSICAL_TIME', 'Time signature denominator must be 1,2,4,8,16,32 or64');
  }
  // Units are 1/scale of a project tick. All bar/beat/sixteenth boundaries
  // become integers here, even for PPQ1 and a64th-note denominator.
  const scale = BigInt(Math.max(16, denominator));
  const beatUnits = p * 4n * scale / BigInt(denominator);
  const barUnits = beatUnits * numerator, sixteenthUnits = p * scale / 4n;
  const cellUnits = beatUnits < sixteenthUnits ? beatUnits : sixteenthUnits;
  const sixteenthsPerBeat = denominator <= 16 ? 16 / denominator : 1;

  function at(tick, origin) {
    let rest = integer(tick, 0, Number.MAX_SAFE_INTEGER, 'Project tick') * scale;
    const bars = rest / barUnits + origin;
    rest %= barUnits;
    const beats = rest / beatUnits + origin;
    rest %= beatUnits;
    const sixteenths = rest / sixteenthUnits + origin;
    rest %= sixteenthUnits;
    return { bars: bars.toString(), beats: Number(beats), sixteenths: Number(sixteenths),
      ticks: fraction(rest * display, p * scale) };
  }
  function from(value, origin, rounding) {
    object(value, ['bars', 'beats', 'sixteenths', 'ticks'], 'Musical position');
    const bars = unsigned(value.bars, 'Bars');
    const beats = integer(value.beats, Number(origin), Number(numerator - 1n + origin), 'Beats');
    const sixteenths = integer(value.sixteenths, Number(origin), sixteenthsPerBeat - 1 + Number(origin), 'Sixteenths');
    if (bars < origin) fail('INVALID_MUSICAL_TIME', 'Positions begin at bar1; durations begin at bar0');
    object(value.ticks, ['numerator', 'denominator'], 'Display tick fraction');
    const tn = unsigned(value.ticks.numerator, 'Display tick numerator');
    const td = integer(value.ticks.denominator, 1, Number.MAX_SAFE_INTEGER, 'Display tick denominator');
    if (tn * p * scale >= cellUnits * display * td) {
      fail('INVALID_MUSICAL_TIME', 'Tick remainder reaches the next sixteenth or shorter beat; use canonical fields');
    }
    const units = (bars - origin) * barUnits + (beats - origin) * beatUnits + (sixteenths - origin) * sixteenthUnits;
    return projectTick(units * display * td + tn * p * scale, scale * display * td, rounding);
  }
  function format(tick, origin) {
    const value = at(tick, origin), t = value.ticks;
    const tail = t.denominator === 1 ? t.numerator.padStart(3, '0') : `${t.numerator}/${t.denominator}`;
    return `${value.bars.padStart(3, '0')}.${value.beats}.${value.sixteenths}.${tail}`;
  }
  function parse(text, origin, rounding) {
    if (typeof text !== 'string' || text.length > 256) fail('INVALID_MUSICAL_TIME', 'Musical time must be a bounded string');
    const match = /^([0-9]{1,64})\.([0-9]{1,16})\.([0-9]{1,2})\.([0-9]{1,64})(?:\/([0-9]{1,16}))?$/.exec(text);
    if (!match) fail('INVALID_MUSICAL_TIME', 'Use bars.beats.sixteenths.ticks, with optional numerator/denominator ticks');
    return from({ bars: match[1], beats: Number(match[2]), sixteenths: Number(match[3]),
      ticks: { numerator: match[4], denominator: match[5] ? Number(match[5]) : 1 } }, origin, rounding);
  }
  return Object.freeze({
    options: Object.freeze({ ppq, displayPpq, timeSignature: Object.freeze({ numerator: Number(numerator), denominator }) }),
    positionAt: tick => at(tick, 1n),
    durationAt: ticks => at(ticks, 0n),
    tickAt: (value, rounding = 'exact') => from(value, 1n, rounding),
    ticksForDuration: (value, rounding = 'exact') => from(value, 0n, rounding),
    formatPosition: tick => format(tick, 1n),
    formatDuration: ticks => format(ticks, 0n),
    parsePosition: (text, rounding = 'exact') => parse(text, 1n, rounding),
    parseDuration: (text, rounding = 'exact') => parse(text, 0n, rounding)
  });
}
