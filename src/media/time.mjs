import { finite, integer, requireValue } from './common.mjs';

/** Compile a validated snapshot. Tempo changes are steps and the new tempo owns its boundary. */
export function compileTempoMap(tempoMap, ppq = 960) {
  integer(ppq, 1, Number.MAX_SAFE_INTEGER, 'PPQ');
  requireValue(Array.isArray(tempoMap) && tempoMap.length > 0 && tempoMap.length <= 100000,
    'INVALID_TEMPO_MAP', 'Tempo map must contain 1–100000 ordered points beginning at tick 0.');
  const ticks = [], seconds = [], rates = [], bpms = [];
  let elapsed = 0;
  for (let index = 0; index < tempoMap.length; index++) {
    const point = tempoMap[index];
    requireValue(point && typeof point === 'object', 'INVALID_TEMPO_MAP', 'Invalid tempo point.');
    integer(point.tick, 0, Number.MAX_SAFE_INTEGER, 'Tempo tick');
    finite(point.bpm, 20, 300, 'Tempo BPM');
    requireValue(index ? point.tick > ticks[index - 1] : point.tick === 0,
      'INVALID_TEMPO_MAP', 'Tempo ticks must start at 0 and strictly increase.');
    if (index) elapsed += (point.tick - ticks[index - 1]) * rates[index - 1];
    bpms.push(point.bpm);
    ticks.push(point.tick);
    seconds.push(elapsed);
    rates.push(60 / (point.bpm * ppq));
  }
  function segment(values, target) {
    let low = 0, high = values.length;
    while (low + 1 < high) {
      const middle = Math.floor((low + high) / 2);
      if (values[middle] <= target) low = middle;
      else high = middle;
    }
    return low;
  }
  return {
    bpmAtTick(tick){finite(tick,0,Number.MAX_SAFE_INTEGER,'Tick');return bpms[segment(ticks,tick)];},
    tickToSeconds(tick) {
      finite(tick, 0, Number.MAX_SAFE_INTEGER, 'Tick');
      const index = segment(ticks, tick);
      return seconds[index] + (tick - ticks[index]) * rates[index];
    },
    secondsToTick(value) {
      finite(value, 0, Number.MAX_SAFE_INTEGER, 'Seconds');
      const index = segment(seconds, value);
      const result = ticks[index] + (value - seconds[index]) / rates[index];
      finite(result, 0, Number.MAX_SAFE_INTEGER, 'Converted tick');
      return result;
    }
  };
}

export function tickToSeconds(tick, tempoMap, ppq = 960) {
  return compileTempoMap(tempoMap, ppq).tickToSeconds(tick);
}

/** Fractional ticks are retained; callers editing integer MIDI positions choose their rounding. */
export function secondsToTick(seconds, tempoMap, ppq = 960) {
  return compileTempoMap(tempoMap, ppq).secondsToTick(seconds);
}
