import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine, createProject } from '../src/core/engine.mjs';
import { writeMusicXml } from '../src/media/musicxml.mjs';

const ppq = 960;
function fixture(notes, { extra = [] } = {}) {
  const e = new Engine(createProject({}));
  const run = (command, args) => { const r = e.execute({ command, arguments: args }); assert.equal(r.status, 'applied', JSON.stringify(r)); };
  run('track.add', { id: 'piano', type: 'midi', name: 'Piano & Keys' });
  run('clip.add', { id: 'c', trackId: 'piano', type: 'midi', startTick: 0, lengthTicks: ppq * 8, notes });
  for (const [command, args] of extra) run(command, args);
  return e;
}
const n = (id, pitch, startTick, durationTicks, velocity = 90) => ({ id, pitch, startTick, durationTicks, velocity, channel: 0 });

// Walk each measure: every voice must fill exactly one bar between backups.
function measureTimeline(xmlText, bar) {
  const measures = [...xmlText.matchAll(/<measure number="(\d+)">([\s\S]*?)<\/measure>/g)];
  for (const [, number, body] of measures) {
    let position = 0, max = 0;
    for (const token of body.matchAll(/<note\b[^>]*>([\s\S]*?)<\/note>|<backup><duration>(\d+)<\/duration><\/backup>|<forward><duration>(\d+)<\/duration>/g)) {
      if (token[2]) { assert.equal(position, bar, `measure ${number}: voice must fill the bar before backup`); position -= Number(token[2]); continue; }
      if (token[3]) { position += Number(token[3]); max = Math.max(max, position); continue; }
      if (token[1].includes('<chord/>')) continue;
      position += Number(token[1].match(/<duration>(\d+)<\/duration>/)[1]);
      max = Math.max(max, position);
    }
    assert.equal(position, bar, `measure ${number} ends at the barline`);
    assert.equal(max, bar, `measure ${number} never overflows`);
  }
  return measures.length;
}

test('MusicXML export writes a grand-staff part with spelling, ties, chords, rests and tempo', () => {
  const e = fixture([n('a', 61, 0, ppq), n('b', 67, ppq * 3, ppq * 2), n('c1', 60, ppq * 6, ppq), n('c2', 64, ppq * 6, ppq), n('low', 48, 0, ppq * 4, 45)]);
  const before = structuredClone(e.project);
  const result = writeMusicXml(e.project);
  assert.deepEqual(e.project, before);
  assert.equal(result.partCount, 1);
  assert.equal(result.measureCount, 2);
  assert.equal(result.noteCount, 5);
  const x = result.xml;
  assert.match(x, /^<\?xml version="1.0" encoding="UTF-8"\?>/);
  assert.match(x, /<score-partwise version="4.0">/);
  assert.match(x, /<part-name>Piano &amp; Keys<\/part-name>/);
  assert.match(x, /<divisions>960<\/divisions><key><fifths>0<\/fifths><\/key><time><beats>4<\/beats><beat-type>4<\/beat-type><\/time><staves>2<\/staves>/);
  assert.match(x, /<pitch><step>C<\/step><alter>1<\/alter><octave>4<\/octave><\/pitch><duration>960<\/duration><voice>1<\/voice><type>quarter<\/type><accidental>sharp<\/accidental><staff>1<\/staff>/);
  assert.equal((x.match(/<tie type="start"\/>/g) ?? []).length, 1);
  assert.equal((x.match(/<tie type="stop"\/>/g) ?? []).length, 1);
  assert.match(x, /<chord\/><pitch><step>E<\/step><octave>4<\/octave>/);
  assert.match(x, /<note dynamics="50">[\s\S]*?<step>C<\/step><octave>3<\/octave>[\s\S]*?<type>whole<\/type>[\s\S]*?<staff>2<\/staff>/);
  assert.match(x, /<rest measure="yes"\/><duration>3840<\/duration><voice>5<\/voice><staff>2<\/staff>/);
  assert.match(x, /<metronome><beat-unit>quarter<\/beat-unit><per-minute>120<\/per-minute><\/metronome>/);
  assert.match(x, /<bar-style>light-heavy<\/bar-style>/);
  assert.equal(measureTimeline(x, ppq * 4), 2);
});

test('Overlapping rhythms on one staff become separate voices that still fill each bar', () => {
  const e = fixture([n('long', 72, 0, ppq * 4), n('s1', 76, 0, ppq), n('s2', 77, ppq, ppq), n('s3', 79, ppq * 2, ppq / 2)]);
  const x = writeMusicXml(e.project).xml;
  assert.match(x, /<voice>2<\/voice>/);
  assert.match(x, /<forward><duration>/);
  measureTimeline(x, ppq * 4);
});

test('Key signature, 3/4 meter, tempo changes and off-grid lengths export consistently', () => {
  const e = fixture([n('bb', 70, 0, ppq), n('odd', 62, ppq + 37, ppq + 11)]);
  const project = { ...structuredClone(e.project), timeSignature: { numerator: 3, denominator: 4 }, tempoMap: [{ tick: 0, bpm: 90 }, { tick: ppq * 4, bpm: 132.5 }] };
  const result = writeMusicXml(project, { fifths: -1 });
  assert.match(result.xml, /<key><fifths>-1<\/fifths><\/key><time><beats>3<\/beats><beat-type>4<\/beat-type>/);
  assert.match(result.xml, /<step>B<\/step><alter>-1<\/alter><octave>4<\/octave><\/pitch><duration>960<\/duration><voice>1<\/voice><type>quarter<\/type><staff>1<\/staff>/);
  assert.match(result.xml, /<offset>960<\/offset>[\s\S]*?<per-minute>132.5<\/per-minute>/);
  assert.ok(result.warnings.some((w) => /exact written value/.test(w)));
  measureTimeline(result.xml, ppq * 3);
});

test('Track selection, muted clips and invalid requests are reported without changing the project', () => {
  const e = fixture([n('a', 60, 0, ppq)], { extra: [
    ['track.add', { id: 'second', type: 'midi', name: 'Bass' }],
    ['clip.add', { id: 'm', trackId: 'second', type: 'midi', startTick: 0, lengthTicks: ppq * 4, notes: [n('z', 40, 0, ppq)] }],
    ['clip.update', { clipId: 'm', mute: true }],
    ['track.add', { id: 'aud', type: 'audio' }],
  ] });
  const before = structuredClone(e.project);
  const all = writeMusicXml(e.project);
  assert.equal(all.partCount, 2);
  assert.ok(all.warnings.some((w) => /1 muted MIDI clip/.test(w)));
  const one = writeMusicXml(e.project, { trackIds: ['piano'] });
  assert.equal(one.partCount, 1);
  assert.doesNotMatch(one.xml, /<part-name>Bass/);
  assert.throws(() => writeMusicXml(e.project, { trackIds: ['aud'] }), { code: 'MUSICXML_TRACK_NOT_MIDI' });
  assert.throws(() => writeMusicXml(e.project, { trackIds: ['nope'] }), { code: 'MUSICXML_TRACK_NOT_FOUND' });
  assert.throws(() => writeMusicXml(e.project, { fifths: 9 }), { code: 'SCORE_KEY_INVALID' });
  assert.throws(() => writeMusicXml(e.project, { trackIds: [] }), { code: 'MUSICXML_NO_TRACKS' });
  assert.deepEqual(e.project, before);
});
