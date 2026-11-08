import { requireValue } from './common.mjs';

// Exact, nonnegative elapsed-time units. No floating-point seconds enter this API.
export function timeInteger(value) {
  requireValue((typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) ||
    (typeof value === 'string' && value.length >= 1 && value.length <= 64 && !/[^0-9]/.test(value)),
  'INVALID_TIME_VALUE', 'Time integers must be nonnegative safe integers or decimal strings of at most64 digits.');
  return BigInt(value);
}

export function timeFields(value, keys) {
  requireValue(value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).every(key => keys.includes(key)), 'INVALID_TIME_VALUE', 'Invalid time fields.');
}

export function timeRatio(value) {
  timeFields(value, ['numerator', 'denominator']);
  const n = timeInteger(value.numerator), d = timeInteger(value.denominator);
  requireValue(d > 0n, 'INVALID_TIME_VALUE', 'Time denominator must be positive.');
  return [n, d];
}

export function timeString(value) {
  const text = value.toString();
  requireValue(value >= 0n && text.length <= 64, 'TIME_OVERFLOW', 'Time result exceeds64 digits.');
  return text;
}

function fraction(n, d) {
  let a = n, b = d;
  while (b) [a, b] = [b, a % b];
  return { numerator: timeString(n / a), denominator: timeString(d / a) };
}

/** Unit rate is a rational units/second, e.g. samples={48000/1}, frames={30000/1001}. */
export function secondsForUnits(units, unitRate) {
  const count = timeInteger(units), [n, d] = timeRatio(unitRate);
  requireValue(n > 0n, 'INVALID_TIME_VALUE', 'Unit rate must be positive.');
  return fraction(count * d, n);
}

export function unitsForSeconds(seconds, unitRate, rounding = 'exact') {
  const [n, d] = timeRatio(seconds), [rn, rd] = timeRatio(unitRate);
  requireValue(rn > 0n, 'INVALID_TIME_VALUE', 'Unit rate must be positive.');
  requireValue(['exact', 'floor', 'ceil', 'nearest'].includes(rounding),
    'INVALID_TIME_ROUNDING', 'Use exact, floor, ceil or nearest rounding.');
  const numerator = n * rn, denominator = d * rd;
  let result = numerator / denominator;
  const remainder = numerator % denominator;
  requireValue(rounding !== 'exact' || remainder === 0n,
    'TIME_NOT_REPRESENTABLE', 'Time is not exactly representable in the requested unit.');
  if ((rounding === 'ceil' && remainder > 0n) ||
      (rounding === 'nearest' && remainder * 2n >= denominator)) result++;
  return timeString(result);
}

/** Elapsed HH:MM:SS.mmm; hours never wrap at24. Display truncation is a caller decision. */
export function formatClockMilliseconds(milliseconds) {
  const value = timeInteger(milliseconds), seconds = value / 1000n;
  const pad = (n, width = 2) => n.toString().padStart(width, '0');
  return `${pad(seconds / 3600n)}:${pad(seconds / 60n % 60n)}:${pad(seconds % 60n)}.${pad(value % 1000n, 3)}`;
}

export function parseClockMilliseconds(text) {
  requireValue(typeof text === 'string' && text.length <= 74,
    'INVALID_TIME_VALUE', 'Expected bounded HH:MM:SS.mmm text.');
  const match = /^([0-9]{2,64}):([0-5][0-9]):([0-5][0-9])\.([0-9]{3})$/.exec(text);
  requireValue(match && match[0] === text, 'INVALID_TIME_VALUE', 'Expected HH:MM:SS.mmm without field carry.');
  return timeString(((BigInt(match[1]) * 60n + BigInt(match[2])) * 60n + BigInt(match[3])) * 1000n + BigInt(match[4]));
}
