import { requireValue } from './common.mjs';
import { timeFields, timeInteger, timeRatio, timeString, secondsForUnits, unitsForSeconds } from './elapsed-time.mjs';

export const TIMECODE_SUBFRAMES = 80;

/** Frame-label count and playback rate are independent. All positions are nonnegative elapsed time.
 * Explicit rational rate avoids silently interpreting rounded labels such as23.98 or24.98.
 * Drop numbering currently supports nominal30 (two labels/minute, except every tenth minute).
 */
export function compileTimecode(options = {}) {
  timeFields(options, ['nominalFps', 'rate', 'dropFrame']);
  const { nominalFps = 30, rate = { numerator: nominalFps, denominator: 1 }, dropFrame = false } = options;
  requireValue(Number.isSafeInteger(nominalFps) && nominalFps >= 1 && nominalFps <= 120 &&
    typeof dropFrame === 'boolean' && (!dropFrame || nominalFps === 30),
  'INVALID_TIME_VALUE', 'Timecode needs a nominal rate of1–120; drop numbering currently requires30.');
  const [rn, rd] = timeRatio(rate);
  requireValue(rn > 0n && rn <= 120n * rd, 'INVALID_TIME_VALUE', 'Playback rate must be positive and at most120 fps.');
  const fps = BigInt(nominalFps), frameWidth = Math.max(2, String(nominalFps - 1).length);
  const subframeRate = Object.freeze({ numerator: timeString(rn * 80n), denominator: timeString(rd) });
  const separator = dropFrame ? ';' : ':';
  const pattern = new RegExp(`^([0-9]{2,64}):([0-5][0-9]):([0-5][0-9])${separator}([0-9]{${frameWidth}})(?:\\.([0-9]{2}))?$`);

  function format(subframes, showSubframes = true) {
    requireValue(typeof showSubframes === 'boolean', 'INVALID_TIME_VALUE', 'showSubframes must be boolean.');
    const value = timeInteger(subframes), frame = value / 80n;
    let label = frame;
    if (dropFrame) {
      // A ten-minute block starts with1800 frames, followed by nine1798-frame minutes.
      const block = frame / 17982n, rest = frame % 17982n;
      const shortMinutes = rest < 1800n ? 0n : 1n + (rest - 1800n) / 1798n;
      label += block * 18n + shortMinutes * 2n;
    }
    const seconds = label / fps, pad = (n, width = 2) => n.toString().padStart(width, '0');
    return `${pad(seconds / 3600n)}:${pad(seconds / 60n % 60n)}:${pad(seconds % 60n)}${separator}${pad(label % fps, frameWidth)}` +
      (showSubframes ? `.${pad(value % 80n)}` : '');
  }

  function parse(text) {
    requireValue(typeof text === 'string' && text.length <= 80, 'INVALID_TIME_VALUE', 'Expected bounded timecode text.');
    const match = pattern.exec(text);
    requireValue(match && match[0] === text, 'INVALID_TIME_VALUE', 'Timecode syntax or drop-frame separator does not match.');
    const [, hours, minutes, seconds, frames, subframes = '0'] = match;
    const hh = BigInt(hours), mm = BigInt(minutes), ss = BigInt(seconds), ff = BigInt(frames), sf = BigInt(subframes);
    requireValue(ff < fps && sf < 80n, 'INVALID_TIME_VALUE', 'Frame or subframe is outside its range.');
    requireValue(!dropFrame || mm % 10n === 0n || ss !== 0n || ff >= 2n,
      'INVALID_TIMECODE_LABEL', 'Drop-frame labels00 and01 do not exist at this minute boundary.');
    const totalMinutes = hh * 60n + mm;
    let frame = (totalMinutes * 60n + ss) * fps + ff;
    if (dropFrame) frame -= 2n * (totalMinutes - totalMinutes / 10n);
    return timeString(frame * 80n + sf);
  }

  return Object.freeze({
    nominalFps, dropFrame, rate: Object.freeze({ numerator: timeString(rn), denominator: timeString(rd) }),
    subframesPerFrame: TIMECODE_SUBFRAMES,
    format, parse,
    secondsAt: subframes => secondsForUnits(subframes, subframeRate),
    subframesAt: (seconds, rounding = 'exact') => unitsForSeconds(seconds, subframeRate, rounding)
  });
}
