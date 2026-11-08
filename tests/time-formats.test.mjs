import test from 'node:test';
import assert from 'node:assert/strict';
import { secondsForUnits, unitsForSeconds, formatClockMilliseconds, parseClockMilliseconds } from '../src/media/elapsed-time.mjs';
import { compileTimecode } from '../src/media/timecode.mjs';
import { compileTimelineProjection } from '../src/media/timeline-projection.mjs';
import { compileTempoMap } from '../src/media/time.mjs';

const ratio = (n, d = 1) => ({ numerator: String(n), denominator: String(d) });
const code = code => error => error.code === code;
const df = () => compileTimecode({ nominalFps: 30, rate: ratio(30000, 1001), dropFrame: true });
const close = (a, b, tolerance = 1e-9) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
const map = () => [{ tick: 0, bpm: 120 }, { tick: 3840, bpm: 60 }, { tick: 7680, bpm: 180 }];

test('Elapsed time: samples and rational seconds retain sub-sample precision without floating conversion', () => {
  for (const sr of [1, 44100, 48000, 96000, 192000, 768000]) {
    for (const sample of [0, 1, 100, 44100, 9007199254740991, '123456789012345678901234567890']) {
      const seconds = JSON.parse(JSON.stringify(secondsForUnits(sample, ratio(sr))));
      assert.equal(unitsForSeconds(seconds, ratio(sr)), String(sample));
    }
  }
  assert.deepEqual(secondsForUnits(1, ratio(48000)), ratio(1, 48000));
  assert.deepEqual(secondsForUnits(48000, ratio(48000)), ratio(1));
  assert.deepEqual(secondsForUnits(0, ratio(30000, 1001)), ratio(0));
});

test('Elapsed time: exact is default and explicit rounding is floor ceil or half-up nearest', () => {
  assert.throws(() => unitsForSeconds(ratio(1, 96000), ratio(48000)), code('TIME_NOT_REPRESENTABLE'));
  assert.equal(unitsForSeconds(ratio(1, 96000), ratio(48000), 'floor'), '0');
  assert.equal(unitsForSeconds(ratio(1, 96000), ratio(48000), 'ceil'), '1');
  assert.equal(unitsForSeconds(ratio(1, 96000), ratio(48000), 'nearest'), '1');
  assert.equal(unitsForSeconds(ratio(1, 96001), ratio(48000), 'nearest'), '0');
  assert.equal(unitsForSeconds(ratio(2), ratio(48000), 'ceil'), '96000');
  assert.throws(() => unitsForSeconds(ratio(1), ratio(1), 'truncate'), code('INVALID_TIME_ROUNDING'));
});

test('Elapsed time: clock milliseconds round trip without24-hour wrap or implicit loss', () => {
  for (const [value, label] of [[0, '00:00:00.000'], [1, '00:00:00.001'], [59999, '00:00:59.999'],
    [60000, '00:01:00.000'], [3600000, '01:00:00.000'], [86400000, '24:00:00.000']]) {
    assert.equal(formatClockMilliseconds(value), label);
    assert.equal(parseClockMilliseconds(label), String(value));
  }
  const huge = '9'.repeat(64);
  assert.equal(parseClockMilliseconds(formatClockMilliseconds(huge)), huge);
});

test('Elapsed time: malformed fields unsafe numbers and bounded overflow are rejected', () => {
  for (const value of [-1, 0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, null, {}, '', '1e3', '1\n', '1 ', '9'.repeat(65)]) {
    assert.throws(() => secondsForUnits(value, ratio(1)), code('INVALID_TIME_VALUE'));
  }
  for (const value of [null, [], {}, { ...ratio(1), typo: 1 }, ratio(-1), ratio(1, 0), ratio(1, '1\n')]) {
    assert.throws(() => unitsForSeconds(value, ratio(1)), code('INVALID_TIME_VALUE'));
  }
  assert.throws(() => secondsForUnits(1, ratio(0)), code('INVALID_TIME_VALUE'));
  assert.throws(() => unitsForSeconds(ratio('9'.repeat(64)), ratio(10)), code('TIME_OVERFLOW'));
  for (const value of ['0:00:00.000', '00:60:00.000', '00:00:60.000', '00:00:00.1000', '00:00:00.000\n', '-01:00:00.000', '', null]) {
    assert.throws(() => parseClockMilliseconds(value), code('INVALID_TIME_VALUE'));
  }
  assert.throws(() => parseClockMilliseconds(`${'9'.repeat(64)}:00:00.000`), code('TIME_OVERFLOW'));
});

test('Timecode:80 subframes carry through frame second minute and hour boundaries', () => {
  const time = compileTimecode();
  for (const [count, label] of [[0, '00:00:00:00.00'], [79, '00:00:00:00.79'], [80, '00:00:00:01.00'],
    [2399, '00:00:00:29.79'], [2400, '00:00:01:00.00'], [144000, '00:01:00:00.00'], [8640000, '01:00:00:00.00']]) {
    assert.equal(time.format(count), label);
    assert.equal(time.parse(label), String(count));
  }
  assert.equal(time.format(2399, false), '00:00:00:29');
  assert.equal(time.parse('00:00:00:29'), '2320');
  assert.deepEqual(time.secondsAt(1), ratio(1, 2400));
});

test('Timecode: frame-label count remains independent from true playback rate including30df', () => {
  const ndf = compileTimecode({ nominalFps: 30, rate: ratio(30000, 1001) });
  const true30df = compileTimecode({ nominalFps: 30, dropFrame: true });
  assert.equal(ndf.parse('01:00:00:00'), '8640000');
  assert.deepEqual(ndf.secondsAt(ndf.parse('01:00:00:00')), ratio(18018, 5));
  assert.equal(df().parse('01:00:00;00'), '8631360');
  assert.deepEqual(df().secondsAt(df().parse('01:00:00;00')), ratio(8999991, 2500));
  assert.equal(true30df.parse('01:00:00;00'), '8631360');
  assert.deepEqual(true30df.secondsAt(true30df.parse('01:00:00;00')), ratio(17982, 5));
});

test('Timecode: drop-frame first minute tenth minute hour and day transitions preserve every frame', () => {
  const time = df();
  for (const [frame, label] of [[1799, '00:00:59;29'], [1800, '00:01:00;02'], [3597, '00:01:59;29'],
    [3598, '00:02:00;02'], [17981, '00:09:59;29'], [17982, '00:10:00;00'],
    [107891, '00:59:59;29'], [107892, '01:00:00;00'], [2589408, '24:00:00;00']]) {
    assert.equal(time.format(frame * 80, false), label);
    assert.equal(time.parse(label), String(frame * 80));
    assert.equal(time.parse(time.format(frame * 80 + 79)), String(frame * 80 + 79));
  }
});

test('Timecode: dropped labels and conflicting separators cannot silently become another position', () => {
  const time = df();
  for (let minute = 0; minute < 60; minute++) {
    for (const frame of [0, 1]) {
      const label = `01:${String(minute).padStart(2, '0')}:00;0${frame}.79`;
      if (minute % 10) assert.throws(() => time.parse(label), code('INVALID_TIMECODE_LABEL'));
      else assert.equal(time.format(time.parse(label)), label);
    }
  }
  assert.throws(() => time.parse('00:00:00:00'), code('INVALID_TIME_VALUE'));
  assert.throws(() => compileTimecode().parse('00:00:00;00'), code('INVALID_TIME_VALUE'));
});

test('Timecode: independent sequential label oracle checks every frame of two ten-minute blocks', () => {
  const time = df();
  let frame = 0;
  for (let minute = 0; minute < 20; minute++) {
    for (let second = 0; second < 60; second++) {
      for (let labelFrame = 0; labelFrame < 30; labelFrame++) {
        if (minute % 10 && second === 0 && labelFrame < 2) continue;
        const pad = n => String(n).padStart(2, '0');
        const label = `00:${pad(minute)}:${pad(second)};${pad(labelFrame)}`;
        assert.equal(time.format(frame * 80, false), label);
        assert.equal(time.parse(label), String(frame * 80));
        frame++;
      }
    }
  }
  assert.equal(frame, 35964);
});

test('Timecode: explicit film PAL NTSC and high-frame-rate rational configurations are reversible', () => {
  for (const [nominalFps, n, d] of [[24, 24000, 1001], [24, 24, 1], [25, 25000, 1001], [25, 25, 1],
    [30, 30000, 1001], [30, 30, 1], [50, 50, 1], [60, 60000, 1001], [60, 60, 1], [120, 120, 1]]) {
    const time = compileTimecode({ nominalFps, rate: ratio(n, d) });
    for (const count of [0, 1, 79, 80, 9600001, '999999999999999999999999999999999999']) {
      assert.equal(time.parse(time.format(count)), String(count));
      assert.equal(time.subframesAt(time.secondsAt(count)), String(count));
    }
  }
  assert.equal(compileTimecode({ nominalFps: 120 }).format(119 * 80, false), '00:00:00:119');
});

test('Timecode: exact sample and subframe conversion detects incompatible grids', () => {
  const time = df();
  assert.equal(time.subframesAt(secondsForUnits(1001, ratio(48000))), '50');
  const oneSample = secondsForUnits(1, ratio(48000));
  assert.throws(() => time.subframesAt(oneSample), code('TIME_NOT_REPRESENTABLE'));
  assert.equal(time.subframesAt(oneSample, 'floor'), '0');
  assert.equal(time.subframesAt(oneSample, 'ceil'), '1');
  assert.equal(unitsForSeconds(time.secondsAt(50), ratio(48000)), '1001');
});

test('Timecode: immutable snapshot survives caller mutation and JSON serializes exact rate', () => {
  const options = { nominalFps: 30, rate: ratio(30000, 1001), dropFrame: true }, time = compileTimecode(options);
  options.rate.numerator = '24'; options.dropFrame = false;
  assert.equal(time.format(144000, false), '00:01:00;02');
  assert.deepEqual(JSON.parse(JSON.stringify(time.rate)), ratio(30000, 1001));
  assert.ok(Object.isFrozen(time)); assert.ok(Object.isFrozen(time.rate));
  assert.throws(() => { time.rate.numerator = '1'; }, TypeError);
});

test('Timecode: malformed configuration unsupported drop rates and carry aliases fail explicitly', () => {
  for (const options of [null, [], { typo: 1 }, { nominalFps: 0 }, { nominalFps: 121 }, { nominalFps: 29.97 },
    { nominalFps: '30' }, { dropFrame: 1 }, { nominalFps: 60, dropFrame: true }, { rate: ratio(0) },
    { rate: ratio(121) }, { rate: ratio(1, 0) }, { rate: null }]) {
    assert.throws(() => compileTimecode(options), code('INVALID_TIME_VALUE'));
  }
  const time = compileTimecode();
  for (const text of ['', null, '0:00:00:00', '00:60:00:00', '00:00:60:00', '00:00:00:30',
    '00:00:00:00.80', '00:00:00:00.100', '00:00:00:0', '00:00:00:00\n', ' 00:00:00:00',
    '-01:00:00:00', '9'.repeat(81)]) assert.throws(() => time.parse(text), code('INVALID_TIME_VALUE'));
  assert.throws(() => time.format(0, 1), code('INVALID_TIME_VALUE'));
  assert.throws(() => time.parse(`${'9'.repeat(64)}:00:00:00`), code('TIME_OVERFLOW'));
  assert.equal(time.parse(time.format('9'.repeat(64))), '9'.repeat(64));
});

test('Projection: time-linear keeps equal seconds while bar widths follow step tempo', () => {
  const time = compileTimelineProjection({ tempoMap: map(), mode: 'time-linear', scale: 100 });
  assert.equal(time.tickSpanToPixels(0, 3840), 200);
  assert.equal(time.tickSpanToPixels(3840, 7680), 400);
  close(time.tickSpanToPixels(7680, 11520), 400 / 3);
  assert.equal(time.secondsToPixel(5) - time.secondsToPixel(4), 100);
  assert.equal(time.secondsToPixel(2), time.tickToPixel(3840));
});

test('Projection: beat-linear preserves equal quarter spacing while seconds vary with tempo', () => {
  const time = compileTimelineProjection({ tempoMap: map(), mode: 'beat-linear', scale: 96 });
  for (const start of [0, 3840, 7680]) assert.equal(time.tickSpanToPixels(start, start + 3840), 384);
  assert.equal(time.secondsToPixel(1), 192);
  assert.equal(time.secondsToPixel(2) - time.secondsToPixel(1), 192);
  assert.equal(time.secondsToPixel(3) - time.secondsToPixel(2), 96);
  assert.equal(time.secondsToPixel(7) - time.secondsToPixel(6), 288);
});

test('Projection: MIDI positions and audio sample positions coincide on either side of tempo boundaries', () => {
  for (const mode of ['time-linear', 'beat-linear']) {
    const time = compileTimelineProjection({ tempoMap: map(), mode, sampleRate: 48000 });
    for (const [tick, sample] of [[0, 0], [1920, 48000], [3840, 96000], [4800, 144000], [7680, 288000], [10560, 336000]]) {
      close(time.tickToPixel(tick), time.sampleToPixel(sample));
      close(time.pixelToTick(time.sampleToPixel(sample)), tick);
      close(time.pixelToSample(time.tickToPixel(tick)), sample);
    }
    assert.equal(time.sampleToPixel(0.5), time.secondsToPixel(0.5 / 48000));
  }
});

test('Projection: anchored spans crossing tempo changes are not duration-from-zero conversions', () => {
  const time = compileTimelineProjection({ tempoMap: map(), mode: 'time-linear', scale: 100 });
  assert.equal(time.tickSpanToPixels(2880, 4800), 150);
  assert.equal(time.tickSpanToPixels(0, 1920), 100);
  assert.equal(time.tickSpanToPixels(4800, 4800), 0);
  assert.throws(() => time.tickSpanToPixels(4800, 2880), code('INVALID_TIME_VALUE'));
});

test('Projection: viewport origin and fractional drag coordinates round trip without implicit snap', () => {
  for (const mode of ['time-linear', 'beat-linear']) {
    const time = compileTimelineProjection({ tempoMap: map(), mode, scale: 73.5, originTick: 4500, originPixel: 120 });
    assert.equal(time.tickToPixel(4500), 120);
    assert.equal(time.pixelToTick(120), 4500);
    for (const tick of [0, 1, 3839.5, 3840, 4500.25, 7679.99, 7680, 1000000.125]) {
      close(time.pixelToTick(time.tickToPixel(tick)), tick, 1e-8);
    }
    assert.ok(time.tickToPixel(0) < 0);
  }
});

test('Projection: immutable tempo snapshot and multiple windows cannot change project data', () => {
  const tempoMap = map(), before = structuredClone(tempoMap);
  const a = compileTimelineProjection({ tempoMap, mode: 'time-linear' });
  const b = compileTimelineProjection({ tempoMap, mode: 'beat-linear', scale: 200 });
  for (let tick = 0; tick < 20000; tick += 7) { a.tickToPixel(tick); b.pixelToSample(b.tickToPixel(tick)); }
  assert.deepEqual(tempoMap, before);
  tempoMap[0].bpm = 300; tempoMap.length = 1;
  assert.equal(a.tickToPixel(3840), 192);
  assert.equal(b.tickToPixel(3840), 800);
  assert.ok(Object.isFrozen(a));
});

test('Projection: invalid domains geometry overflow and negative project positions fail explicitly', () => {
  for (const extra of [{ mode: 'frames' }, { scale: 0 }, { scale: NaN }, { scale: Infinity }, { ppq: 0 },
    { sampleRate: 0 }, { sampleRate: 1.5 }, { sampleRate: Number.MAX_SAFE_INTEGER + 1 }, { originTick: -1 }, { originPixel: Infinity }, { typo: 1 }]) {
    assert.throws(() => compileTimelineProjection({ tempoMap: map(), ...extra }));
  }
  assert.throws(() => compileTimelineProjection(null), code('INVALID_TIME_VALUE'));
  for (const mode of ['beat-linear', 'time-linear']) {
    const time = compileTimelineProjection({ tempoMap: map(), mode });
    for (const value of [-1, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
      for (const name of ['tickToPixel', 'secondsToPixel', 'sampleToPixel']) assert.throws(() => time[name](value));
    }
    assert.throws(() => time.pixelToTick(-1));
    assert.throws(() => time.pixelToSeconds(-1));
    assert.throws(() => time.pixelToSample(-1));
  }
  assert.throws(() => compileTimelineProjection({ tempoMap: map(), scale: Number.MAX_SAFE_INTEGER }).tickToPixel(1920));
});

test('Projection: deterministic many-tempo oracle covers fractional source positions and both coordinate modes', () => {
  const tempoMap = Array.from({ length: 1000 }, (_, i) => ({ tick: i * 997, bpm: 20 + (i * 37 % 281) }));
  const ppq = 997, tempo = compileTempoMap(tempoMap, ppq);
  let elapsed = 0;
  for (const mode of ['time-linear', 'beat-linear']) {
    const projection = compileTimelineProjection({ tempoMap, ppq, mode, scale: 87.25 });
    elapsed = 0;
    for (let i = 0; i < tempoMap.length; i++) {
      const point = tempoMap[i], tick = point.tick + 498.5;
      const seconds = elapsed + 30 / point.bpm;
      const pixel = mode === 'time-linear' ? seconds * 87.25 : tick / ppq * 87.25;
      close(projection.tickToPixel(tick), pixel, 1e-7);
      close(projection.pixelToTick(pixel), tick, 1e-6);
      close(projection.pixelToSeconds(pixel), tempo.tickToSeconds(tick), 1e-8);
      elapsed += 60 / point.bpm;
    }
  }
});
