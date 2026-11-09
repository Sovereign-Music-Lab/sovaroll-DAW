// Grand-staff score layout for one MIDI clip. Pure functions only: no DOM, no project edits.
// The score is a view of the clip's MIDI notes. Spacing is time-proportional (ticks), so the
// GUI maps ticks to pixels with the same geometry as the piano roll.
// Known limits: one rhythmic layer per staff, no beams or tuplets, split point at middle C,
// one project-wide time signature.

export const STEP_NAMES = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const NATURAL_PC = [0, 2, 4, 5, 7, 9, 11];
const SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6]; // F C G D A E B
const FLAT_ORDER = [6, 2, 5, 1, 4, 0, 3]; // B E A D G C F

// Staff reference: diatonic number = octave * 7 + step (C4 = 28).
export const STAFF = Object.freeze({
  treble: Object.freeze({ bottomLine: 30, clef: 'treble' }), // E4
  bass: Object.freeze({ bottomLine: 18, clef: 'bass' }), // G2
});
export const SPLIT_PITCH = 60; // notes at or above middle C use the treble staff

// Note values in quarter notes, longest first. Dotted values are tried before the plain value
// below them so a dotted half fills a 3/4 bar.
const VALUES = [
  { value: 'whole', quarters: 4, dots: 0 },
  { value: 'half', quarters: 3, dots: 1 },
  { value: 'half', quarters: 2, dots: 0 },
  { value: 'quarter', quarters: 1.5, dots: 1 },
  { value: 'quarter', quarters: 1, dots: 0 },
  { value: 'eighth', quarters: 0.75, dots: 1 },
  { value: 'eighth', quarters: 0.5, dots: 0 },
  { value: '16th', quarters: 0.375, dots: 1 },
  { value: '16th', quarters: 0.25, dots: 0 },
  { value: '32nd', quarters: 0.125, dots: 0 },
];
export const FLAGS = Object.freeze({ whole: 0, half: 0, quarter: 0, eighth: 1, '16th': 2, '32nd': 3 });

function scoreError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function checkFifths(fifths) {
  if (!Number.isInteger(fifths) || fifths < -7 || fifths > 7) {
    throw scoreError('SCORE_KEY_INVALID', 'Key signature must be an integer from -7 to 7 fifths.');
  }
}

// Alteration of each diatonic step (C..B) in a key signature.
export function keyAlterations(fifths = 0) {
  checkFifths(fifths);
  const alter = [0, 0, 0, 0, 0, 0, 0];
  const order = fifths >= 0 ? SHARP_ORDER : FLAT_ORDER;
  for (let i = 0; i < Math.abs(fifths); i++) alter[order[i]] = fifths >= 0 ? 1 : -1;
  return alter;
}

// Staff positions (lines/spaces above the bottom line) of the key-signature accidentals.
export function keySignaturePositions(fifths, clef) {
  checkFifths(fifths);
  const treble = fifths >= 0 ? [8, 5, 9, 6, 3, 7, 4] : [4, 7, 3, 6, 2, 5, 1];
  const offset = clef === 'bass' ? -2 : 0;
  return treble.slice(0, Math.abs(fifths)).map((position) => ({
    position: position + offset,
    accidental: fifths >= 0 ? 'sharp' : 'flat',
  }));
}

// Spell a MIDI pitch in a key: in-key spelling first, then sharps in sharp/C keys, flats in flat keys.
export function spellPitch(pitch, fifths = 0) {
  if (!Number.isInteger(pitch) || pitch < 0 || pitch > 127) {
    throw scoreError('SCORE_PITCH_INVALID', 'Pitch must be an integer MIDI note from 0 to 127.');
  }
  const key = keyAlterations(fifths);
  const pc = pitch % 12;
  const candidates = [];
  for (let step = 0; step < 7; step++) {
    let alter = pc - NATURAL_PC[step];
    if (alter > 6) alter -= 12;
    if (alter < -6) alter += 12;
    if (Math.abs(alter) <= 1) candidates.push({ step, alter });
  }
  const preferred = fifths < 0 ? -1 : 1;
  const rank = (c) => (c.alter === key[c.step] ? 0 : c.alter === 0 ? 1 : c.alter === preferred ? 2 : 3);
  candidates.sort((a, b) => rank(a) - rank(b));
  const { step, alter } = candidates[0];
  const octave = Math.floor((pitch - NATURAL_PC[step] - alter) / 12) - 1;
  return { step, alter, octave, diatonic: octave * 7 + step, name: `${STEP_NAMES[step]}${alter > 0 ? '♯' : alter < 0 ? '♭' : ''}${octave}` };
}

// Pitch of a diatonic number using the key's alteration for that step.
export function pitchFromDiatonic(diatonic, fifths = 0) {
  if (!Number.isInteger(diatonic)) throw scoreError('SCORE_POSITION_INVALID', 'Staff position must be an integer.');
  const key = keyAlterations(fifths);
  const step = ((diatonic % 7) + 7) % 7;
  const octave = Math.floor(diatonic / 7);
  const pitch = (octave + 1) * 12 + NATURAL_PC[step] + key[step];
  if (pitch < 0 || pitch > 127) throw scoreError('SCORE_PITCH_RANGE', 'The staff position is outside MIDI pitch 0–127.');
  return pitch;
}

export function staffForPitch(pitch) {
  return pitch >= SPLIT_PITCH ? 'treble' : 'bass';
}

// Position on a staff (0 = bottom line, 8 = top line) to MIDI pitch in the key.
export function pitchAtStaffPosition(staff, position, fifths = 0) {
  if (!STAFF[staff]) throw scoreError('SCORE_STAFF_INVALID', 'Staff must be treble or bass.');
  return pitchFromDiatonic(STAFF[staff].bottomLine + position, fifths);
}

// Move a pitch by scale steps in the key. Out-of-key notes snap into the key on the first step.
export function moveDiatonic(pitch, steps, fifths = 0) {
  if (!Number.isInteger(steps)) throw scoreError('SCORE_STEP_INVALID', 'Scale steps must be an integer.');
  return pitchFromDiatonic(spellPitch(pitch, fifths).diatonic + steps, fifths);
}

export function ledgerPositions(position) {
  const out = [];
  for (let p = -2; p >= position; p -= 2) out.push(p);
  for (let p = 10; p <= position; p += 2) out.push(p);
  return out;
}

// Split a duration into representable (optionally dotted) values. Remainders shorter than a
// 32nd note are added to the last piece and reported as inexact.
export function decomposeDuration(ticks, ppq) {
  if (!Number.isInteger(ppq) || ppq <= 0) throw scoreError('SCORE_PPQ_INVALID', 'PPQ must be a positive integer.');
  if (!Number.isFinite(ticks) || ticks <= 0) return [];
  const pieces = [];
  let left = ticks;
  const minimum = ppq / 8;
  while (left >= minimum) {
    const pick = VALUES.find((v) => v.quarters * ppq <= left + 1e-9);
    const length = Math.round(pick.quarters * ppq);
    pieces.push({ value: pick.value, dots: pick.dots, ticks: length, inexact: false });
    left -= length;
  }
  if (left > 0) {
    if (pieces.length) {
      const last = pieces.at(-1);
      last.ticks += left;
      last.inexact = true;
    } else {
      pieces.push({ value: '32nd', dots: 0, ticks: left, inexact: true });
    }
  }
  return pieces;
}

export function barTicks(ppq, timeSignature = { numerator: 4, denominator: 4 }) {
  const { numerator, denominator } = timeSignature ?? {};
  if (!Number.isInteger(numerator) || numerator <= 0 || !Number.isInteger(denominator) || denominator <= 0) {
    throw scoreError('SCORE_METER_INVALID', 'Time signature must have positive integer parts.');
  }
  return (ppq * 4 * numerator) / denominator;
}

// Split [start, end) at barlines, then into note values. Each piece knows its bar.
function rhythmPieces(start, end, bar, ppq) {
  const pieces = [];
  let at = start;
  while (at < end) {
    const barIndex = Math.floor(at / bar);
    const barEnd = (barIndex + 1) * bar;
    const segmentEnd = Math.min(end, barEnd);
    let cursor = at;
    for (const piece of decomposeDuration(segmentEnd - at, ppq)) {
      pieces.push({ ...piece, startTick: cursor, barIndex });
      cursor += piece.ticks;
    }
    at = segmentEnd;
  }
  return pieces;
}

function stemDirection(positions) {
  const average = positions.reduce((sum, p) => sum + p, 0) / positions.length;
  return average >= 4 ? 'down' : 'up';
}

// Lay out a MIDI clip on a grand staff.
export function layoutScore(clip, { ppq, timeSignature, fifths = 0 } = {}) {
  checkFifths(fifths);
  if (!clip || !Array.isArray(clip.notes)) throw scoreError('SCORE_CLIP_INVALID', 'A MIDI clip with notes is required.');
  const bar = barTicks(ppq, timeSignature);
  const lengthTicks = Math.max(1, clip.lengthTicks ?? 0);
  const barCount = Math.max(1, Math.ceil(lengthTicks / bar));
  const key = keyAlterations(fifths);
  const heads = [];
  for (const note of clip.notes) {
    const spelled = spellPitch(note.pitch, fifths);
    const staff = staffForPitch(note.pitch);
    const position = spelled.diatonic - STAFF[staff].bottomLine;
    const start = Math.max(0, note.startTick);
    const end = Math.min(lengthTicks, start + Math.max(1, note.durationTicks));
    if (end <= start) continue;
    const pieces = rhythmPieces(start, end, bar, ppq);
    pieces.forEach((piece, index) => heads.push({
      noteId: note.id, pitch: note.pitch, velocity: note.velocity, staff, position,
      step: spelled.step, octave: spelled.octave, alter: spelled.alter, name: spelled.name,
      startTick: piece.startTick, durationTicks: piece.ticks, barIndex: piece.barIndex,
      value: piece.value, dots: piece.dots, inexact: piece.inexact,
      tieFromPrevious: index > 0, tieToNext: index < pieces.length - 1,
      ledgers: ledgerPositions(position), accidental: null,
    }));
  }
  heads.sort((a, b) => a.startTick - b.startTick || a.position - b.position);

  // Accidentals: a bar remembers alterations by staff and diatonic step; ties carry silently.
  const memory = new Map();
  for (const head of heads) {
    const id = `${head.staff}:${head.barIndex}:${head.octave * 7 + head.step}`;
    const current = memory.has(id) ? memory.get(id) : key[head.step];
    if (!head.tieFromPrevious && head.alter !== current) {
      head.accidental = head.alter > 0 ? 'sharp' : head.alter < 0 ? 'flat' : 'natural';
    }
    memory.set(id, head.alter);
  }

  // Chords share a stem when they start together with the same written value on one staff.
  const chords = new Map();
  for (const head of heads) {
    const id = `${head.staff}:${head.startTick}:${head.durationTicks}:${head.value}:${head.dots}`;
    if (!chords.has(id)) chords.set(id, { staff: head.staff, startTick: head.startTick, durationTicks: head.durationTicks, value: head.value, dots: head.dots, heads: [] });
    chords.get(id).heads.push(head);
  }
  const chordList = [...chords.values()].map((chord) => ({
    ...chord,
    stem: chord.value === 'whole' ? null : stemDirection(chord.heads.map((h) => h.position)),
    flags: FLAGS[chord.value],
    noteIds: [...new Set(chord.heads.map((h) => h.noteId))],
  }));

  // Rests fill time on a staff that no note covers.
  const rests = [];
  for (const staff of ['treble', 'bass']) {
    const spans = clip.notes
      .filter((n) => staffForPitch(n.pitch) === staff)
      .map((n) => [Math.max(0, n.startTick), Math.min(lengthTicks, n.startTick + Math.max(1, n.durationTicks))])
      .filter(([s, e]) => e > s)
      .sort((a, b) => a[0] - b[0]);
    let cursor = 0;
    const gap = (from, to) => {
      for (const piece of rhythmPieces(from, to, bar, ppq)) rests.push({ staff, startTick: piece.startTick, durationTicks: piece.ticks, value: piece.value, dots: piece.dots, barIndex: piece.barIndex });
    };
    for (const [s, e] of spans) {
      if (s > cursor) gap(cursor, s);
      cursor = Math.max(cursor, e);
    }
    if (cursor < barCount * bar) gap(cursor, barCount * bar);
  }

  // A rest filling a whole bar is written as a whole rest (any meter).
  for (const rest of rests) {
    if (rest.startTick % bar === 0 && rest.durationTicks === bar) { rest.value = 'whole'; rest.dots = 0; rest.wholeBar = true; }
  }

  return {
    ppq, fifths, barTicks: bar, barCount, lengthTicks,
    timeSignature: { numerator: timeSignature?.numerator ?? 4, denominator: timeSignature?.denominator ?? 4 },
    keySignature: { treble: keySignaturePositions(fifths, 'treble'), bass: keySignaturePositions(fifths, 'bass') },
    heads, chords: chordList, rests,
  };
}

export const KEY_NAMES = Object.freeze({
  '-7': 'C♭', '-6': 'G♭', '-5': 'D♭', '-4': 'A♭', '-3': 'E♭', '-2': 'B♭', '-1': 'F',
  0: 'C', 1: 'G', 2: 'D', 3: 'A', 4: 'E', 5: 'B', 6: 'F♯', 7: 'C♯',
});
