import test from 'node:test';
import assert from 'node:assert/strict';
import {
  spellPitch, keyAlterations, keySignaturePositions, pitchFromDiatonic, pitchAtStaffPosition,
  moveDiatonic, staffForPitch, ledgerPositions, decomposeDuration, barTicks, layoutScore,
} from '../src/media/score-layout.mjs';

const ppq = 480;
const four = { numerator: 4, denominator: 4 };
const clip = (notes, lengthTicks = ppq * 4) => ({ id: 'c', type: 'midi', lengthTicks, notes });
const note = (id, pitch, startTick, durationTicks) => ({ id, pitch, startTick, durationTicks, velocity: 96, channel: 0 });

test('Score spelling follows the key signature and prefers sharps or flats by key direction', () => {
  assert.deepEqual(keyAlterations(2), [1, 0, 0, 1, 0, 0, 0]);
  assert.deepEqual(keyAlterations(-3), [0, 0, -1, 0, 0, -1, -1]);
  assert.equal(spellPitch(60).name, 'C4');
  assert.equal(spellPitch(61).name, 'C♯4');
  assert.equal(spellPitch(61, -1).name, 'D♭4');
  assert.equal(spellPitch(70, -1).name, 'B♭4');
  assert.equal(spellPitch(65, 1).name, 'F4');
  assert.equal(spellPitch(66, 1).name, 'F♯4');
  const bSharp = spellPitch(60, 7);
  assert.equal(bSharp.name, 'B♯3');
  assert.equal(bSharp.octave, 3);
  assert.equal(spellPitch(21).name, 'A0');
  assert.equal(spellPitch(127).name, 'G9');
  assert.throws(() => spellPitch(128), { code: 'SCORE_PITCH_INVALID' });
  assert.throws(() => spellPitch(60, 8), { code: 'SCORE_KEY_INVALID' });
});

test('Staff positions map to pitches in the key and diatonic moves stay in the key', () => {
  assert.equal(staffForPitch(60), 'treble');
  assert.equal(staffForPitch(59), 'bass');
  assert.equal(pitchAtStaffPosition('treble', 0), 64);
  assert.equal(pitchAtStaffPosition('treble', 8), 77);
  assert.equal(pitchAtStaffPosition('bass', 0), 43);
  assert.equal(pitchAtStaffPosition('bass', 8), 57);
  assert.equal(pitchAtStaffPosition('treble', 1, 1), 66); // F♯ in G major
  assert.equal(pitchAtStaffPosition('treble', -2), 60); // middle C ledger
  assert.equal(moveDiatonic(64, 1), 65);
  assert.equal(moveDiatonic(64, 1, 1), 66);
  assert.equal(moveDiatonic(71, 1), 72);
  assert.equal(moveDiatonic(61, 1), 62); // C♯ moves to D
  assert.equal(pitchFromDiatonic(28), 60);
  assert.throws(() => pitchFromDiatonic(80), { code: 'SCORE_PITCH_RANGE' });
  assert.throws(() => pitchAtStaffPosition('alto', 0), { code: 'SCORE_STAFF_INVALID' });
  assert.deepEqual(ledgerPositions(-2), [-2]);
  assert.deepEqual(ledgerPositions(-5), [-2, -4]);
  assert.deepEqual(ledgerPositions(12), [10, 12]);
  assert.deepEqual(ledgerPositions(4), []);
});

test('Key signature accidentals use standard staff positions on both clefs', () => {
  assert.deepEqual(keySignaturePositions(2, 'treble').map((k) => k.position), [8, 5]);
  assert.deepEqual(keySignaturePositions(2, 'bass').map((k) => k.position), [6, 3]);
  assert.deepEqual(keySignaturePositions(-2, 'treble').map((k) => [k.position, k.accidental]), [[4, 'flat'], [7, 'flat']]);
  assert.deepEqual(keySignaturePositions(0, 'treble'), []);
});

test('Durations decompose into dotted and tied values; tiny remainders are marked inexact', () => {
  assert.deepEqual(decomposeDuration(ppq, ppq).map((p) => [p.value, p.dots]), [['quarter', 0]]);
  assert.deepEqual(decomposeDuration(ppq * 3, ppq).map((p) => [p.value, p.dots]), [['half', 1]]);
  assert.deepEqual(decomposeDuration(ppq * 5, ppq).map((p) => [p.value, p.dots]), [['whole', 0], ['quarter', 0]]);
  assert.deepEqual(decomposeDuration(ppq * 1.75, ppq).map((p) => [p.value, p.dots]), [['quarter', 1], ['16th', 0]]);
  const odd = decomposeDuration(ppq + 7, ppq);
  assert.equal(odd.length, 1);
  assert.equal(odd[0].inexact, true);
  assert.equal(odd[0].ticks, ppq + 7);
  assert.equal(decomposeDuration(0, ppq).length, 0);
  assert.equal(barTicks(ppq, { numerator: 6, denominator: 8 }), ppq * 3);
  assert.throws(() => barTicks(ppq, { numerator: 0, denominator: 4 }), { code: 'SCORE_METER_INVALID' });
});

test('Layout ties notes across barlines, places accidentals once per bar and fills rests', () => {
  const layout = layoutScore(clip([
    note('a', 61, 0, ppq), // C♯4 bar 1
    note('b', 61, ppq, ppq), // repeated C♯ in the same bar: no accidental
    note('c', 60, ppq * 2, ppq), // C natural after C♯: natural sign
    note('d', 67, ppq * 3, ppq * 2), // G4 tied across the barline
    note('e', 48, 0, ppq * 4), // C3 whole note on bass staff
  ], ppq * 8), { ppq, timeSignature: four });
  assert.equal(layout.barCount, 2);
  const byId = (id) => layout.heads.filter((h) => h.noteId === id);
  assert.equal(byId('a')[0].accidental, 'sharp');
  assert.equal(byId('b')[0].accidental, null);
  assert.equal(byId('c')[0].accidental, 'natural');
  const tied = byId('d');
  assert.equal(tied.length, 2);
  assert.deepEqual(tied.map((h) => [h.barIndex, h.tieToNext, h.tieFromPrevious]), [[0, true, false], [1, false, true]]);
  assert.equal(byId('e')[0].staff, 'bass');
  assert.equal(byId('e')[0].value, 'whole');
  const wholeChord = layout.chords.find((c) => c.noteIds.includes('e'));
  assert.equal(wholeChord.stem, null);
  const trebleRests = layout.rests.filter((r) => r.staff === 'treble');
  assert.deepEqual(trebleRests.map((r) => [r.startTick, r.durationTicks, r.value]), [[ppq * 5, ppq * 3, 'half']]);
  const bassRests = layout.rests.filter((r) => r.staff === 'bass');
  assert.deepEqual(bassRests.map((r) => [r.startTick, r.value, r.wholeBar === true]), [[ppq * 4, 'whole', true]]);
});

test('Simultaneous equal notes form one chord with a shared stem; key signature changes spelling only', () => {
  const notes = [note('x', 64, 0, ppq), note('y', 67, 0, ppq), note('z', 72, 0, ppq / 2)];
  const source = clip(notes);
  const before = structuredClone(source);
  const layout = layoutScore(source, { ppq, timeSignature: four, fifths: 0 });
  const chord = layout.chords.find((c) => c.noteIds.includes('x'));
  assert.deepEqual(chord.noteIds.sort(), ['x', 'y']);
  assert.equal(chord.stem, 'up');
  const eighth = layout.chords.find((c) => c.noteIds.includes('z'));
  assert.equal(eighth.flags, 1);
  assert.equal(eighth.stem, 'down');
  const flat = layoutScore(clip([note('p', 70, 0, ppq)]), { ppq, timeSignature: four, fifths: -1 });
  assert.equal(flat.heads[0].name, 'B♭4');
  assert.equal(flat.heads[0].accidental, null);
  const sharp = layoutScore(clip([note('p', 70, 0, ppq)]), { ppq, timeSignature: four, fifths: 0 });
  assert.equal(sharp.heads[0].name, 'A♯4');
  assert.equal(sharp.heads[0].accidental, 'sharp');
  assert.deepEqual(source, before);
  assert.throws(() => layoutScore(null, { ppq, timeSignature: four }), { code: 'SCORE_CLIP_INVALID' });
});

test('Empty clip in 3/4 is written with one whole-bar rest per staff per bar', () => {
  const layout = layoutScore(clip([], ppq * 6), { ppq, timeSignature: { numerator: 3, denominator: 4 } });
  assert.equal(layout.barCount, 2);
  assert.equal(layout.heads.length, 0);
  assert.equal(layout.rests.length, 4);
  assert(layout.rests.every((r) => r.value === 'whole' && r.wholeBar));
});
