import { finite, integer, requireValue } from './common.mjs';
import { resolveTimeDisplay } from './time-display.mjs';
import { compileTempoMap } from './time.mjs';
import { compileTimelineProjection } from './timeline-projection.mjs';
import { compileTimecode } from './timecode.mjs';
import { formatClockMilliseconds } from './elapsed-time.mjs';

const MAX = Number.MAX_SAFE_INTEGER;
function niceInteger(minimum) {
  const base = 10 ** Math.max(0, Math.floor(Math.log10(Math.max(1, minimum))));
  for (const m of [1, 2, 5, 10]) if (m * base >= minimum) return integer(m * base, 1, MAX, 'Ruler interval');
  throw new Error('Unreachable interval');
}

/** Bounded viewport ruler for elapsed formats. Coordinates are float64 display-only;
 * labels originate from integer unit counts, never a seconds→tick→seconds roundtrip.
 * This is a visual interval policy, not an editing or snap API.
 */
export function compileRulerIntervals(project, { scope = 'timeline', originTick = 0, zoom = 48 } = {}) {
  requireValue(['timeline', 'piano'].includes(scope), 'INVALID_RULER', 'Unknown ruler scope.');
  integer(originTick, 0, MAX, 'Ruler origin'); finite(zoom, 1, 10000, 'Ruler zoom');
  const settings = resolveTimeDisplay(project.timeDisplay), selected = settings[scope + 'Format'];
  const format = selected === 'inherit' ? settings.primaryFormat : selected;
  requireValue(format !== 'bars-beats', 'INVALID_RULER', 'Musical rulers use the musical grid.');
  const mode = settings[scope + 'Mode'], tempo = compileTempoMap(project.tempoMap, project.ppq);
  const originSeconds = tempo.tickToSeconds(originTick), scale = mode === 'time-linear' ? zoom * 2 : zoom;
  const projection = compileTimelineProjection({tempoMap:project.tempoMap,ppq:project.ppq,sampleRate:project.sampleRate,mode,scale,originTick});
  // Global lower bound gives stable intervals while scrolling and prevents overlap at every tempo.
  const minPixelsPerSecond = mode === 'time-linear' ? scale : zoom * project.tempoMap.reduce((v,p)=>Math.min(v,p.bpm),300) / 60;
  const frame = format === 'user-fps' ? {nominalFps:settings.userFps,numerator:settings.userFps,denominator:1,dropFrame:false} : settings.frameRate;
  const isFrame = format === 'timecode' || format === 'user-fps', subframes = isFrame && settings.showSubframes;
  const rate = format === 'seconds' ? 1000 : format === 'samples' ? project.sampleRate : frame.numerator / frame.denominator * (subframes ? 80 : 1);
  const unit = format === 'seconds' ? 'millisecond' : format === 'samples' ? 'sample' : subframes ? 'subframe' : 'frame';
  const tc = isFrame ? compileTimecode({nominalFps:frame.nominalFps,rate:{numerator:frame.numerator,denominator:frame.denominator},dropFrame:frame.dropFrame}) : null;
  function interval(minimum) {
    if (!isFrame) return niceInteger(minimum);
    const factor = subframes ? 80 : 1;
    const candidates = [...(subframes ? [1,2,5,10,20,40] : []), ...[1,2,5,10].map(n=>n*factor), ...[1,2,5,10,30,60].map(n=>n*frame.nominalFps*factor)].sort((a,b)=>a-b);
    return candidates.find(n=>n>=minimum) ?? niceInteger(minimum/(frame.nominalFps*factor))*frame.nominalFps*factor;
  }
  function label(count) {
    return format === 'seconds' ? formatClockMilliseconds(count) : format === 'samples' ? String(count) : tc.format((BigInt(count) * (subframes ? 1n : 80n)).toString(),settings.showSubframes);
  }
  return Object.freeze({format,mode,unit,originTick,
    range(fromPixel, toPixel, { minSpacing = 96, maxLines = 256 } = {}) {
      finite(fromPixel,0,MAX,'Viewport start'); finite(toPixel,fromPixel,MAX,'Viewport end');
      finite(minSpacing,16,2000,'Ruler label spacing'); integer(maxLines,4,2048,'Ruler label limit');
      const fromSeconds = projection.pixelToSeconds(fromPixel)-originSeconds, toSeconds = projection.pixelToSeconds(toPixel)-originSeconds;
      const firstUnit = finite(Math.max(0,fromSeconds*rate),0,MAX,'Ruler start unit'), lastUnit = finite(Math.max(0,toSeconds*rate),0,MAX,'Ruler end unit');
      const step = integer(interval(Math.max(1,minSpacing/minPixelsPerSecond*rate,(lastUnit-firstUnit)/(maxLines-2))),1,MAX,'Ruler interval');
      const first = Math.max(0,Math.floor(firstUnit/step)), ticks = [];
      for (let index=first,count=0;count<maxLines;index++,count++) {
        const units = BigInt(index)*BigInt(step); if(units>BigInt(MAX))break;
        const n=Number(units);if(n>lastUnit+step)break;
        const seconds=originSeconds+n/rate,tick=tempo.secondsToTick(seconds)-originTick,x=projection.secondsToPixel(seconds);
        ticks.push({unit:units.toString(),tick:Math.max(0,tick),x,label:label(n)});
      }
      return {format,mode,unit,step:String(step),ticks};
    }
  });
}
