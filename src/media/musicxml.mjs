// MusicXML 4.0 (partwise) export of MIDI tracks as grand-staff parts. Read-only: the project is
// never modified. Spelling, accidentals, ties and note values come from score-layout.mjs so the
// file matches the on-screen score. Overlapping rhythms on one staff become extra voices.
// Not represented: audio, instruments/patches, controllers, pedal, mixer, beams, tuplets.
import { layoutScore, barTicks, decomposeDuration, STEP_NAMES } from './score-layout.mjs';

const MAX_PARTS = 256;
const MAX_NOTES = 200000;

function exportError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

const xml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
// Characters MusicXML (XML 1.0) cannot carry are removed from names.
const clean = (s) => String(s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '');

// Notes of one track at project ticks; muted clips are skipped and counted.
function trackNotes(project, track) {
  const notes = [];
  let mutedClips = 0;
  for (const clip of project.clips) {
    if (clip.trackId !== track.id || clip.type !== 'midi') continue;
    if (clip.mute) { mutedClips++; continue; }
    const length = clip.lengthTicks ?? Infinity;
    for (const note of clip.notes ?? []) {
      if (note.startTick >= length || note.startTick < 0) continue;
      const duration = Math.min(Math.max(1, note.durationTicks), length - note.startTick);
      notes.push({ id: `${clip.id}:${note.id}`, pitch: note.pitch, velocity: note.velocity ?? 96, channel: note.channel ?? 0, startTick: clip.startTick + note.startTick, durationTicks: duration });
    }
  }
  return { notes, mutedClips };
}

// Greedy voice assignment: a chord joins the first voice that has finished by its start.
function assignVoices(chords) {
  const ends = [];
  const voices = [];
  for (const chord of [...chords].sort((a, b) => a.startTick - b.startTick || b.durationTicks - a.durationTicks)) {
    let v = ends.findIndex((end) => end <= chord.startTick);
    if (v < 0) { v = ends.length; ends.push(0); voices.push([]); }
    ends[v] = chord.startTick + chord.durationTicks;
    voices[v].push(chord);
  }
  return voices;
}

function noteXml(head, { chord, voice, staff }) {
  const parts = [`<note dynamics="${Math.round((head.velocity / 90) * 10000) / 100}">`];
  if (chord) parts.push('<chord/>');
  parts.push(`<pitch><step>${STEP_NAMES[head.step]}</step>${head.alter ? `<alter>${head.alter}</alter>` : ''}<octave>${head.octave}</octave></pitch>`);
  parts.push(`<duration>${head.durationTicks}</duration>`);
  if (head.tieFromPrevious) parts.push('<tie type="stop"/>');
  if (head.tieToNext) parts.push('<tie type="start"/>');
  parts.push(`<voice>${voice}</voice><type>${head.value}</type>`);
  for (let i = 0; i < head.dots; i++) parts.push('<dot/>');
  if (head.accidental) parts.push(`<accidental>${head.accidental}</accidental>`);
  parts.push(`<staff>${staff}</staff>`);
  if (head.tieFromPrevious || head.tieToNext) {
    parts.push(`<notations>${head.tieFromPrevious ? '<tied type="stop"/>' : ''}${head.tieToNext ? '<tied type="start"/>' : ''}</notations>`);
  }
  parts.push('</note>');
  return parts.join('');
}

function gapXml(from, to, { primary, voice, staff, ppq, bar, measureStart }) {
  if (to <= from) return '';
  if (!primary) return `<forward><duration>${to - from}</duration><voice>${voice}</voice><staff>${staff}</staff></forward>`;
  if (from === measureStart && to - from === bar) {
    return `<note><rest measure="yes"/><duration>${bar}</duration><voice>${voice}</voice><staff>${staff}</staff></note>`;
  }
  return decomposeDuration(to - from, ppq).map((piece) => `<note><rest/><duration>${piece.ticks}</duration><voice>${voice}</voice><type>${piece.value}</type>${piece.dots ? '<dot/>' : ''}<staff>${staff}</staff></note>`).join('');
}

/**
 * @param {object} project
 * @param {{trackIds?: string[], fifths?: number}} options
 * @returns {{xml: string, partCount: number, measureCount: number, noteCount: number, warnings: string[]}}
 */
export function writeMusicXml(project, { trackIds, fifths = 0 } = {}) {
  if (!project || !Array.isArray(project.tracks) || !Array.isArray(project.clips)) throw exportError('MUSICXML_PROJECT_INVALID', 'A project is required.');
  if (trackIds !== undefined && (!Array.isArray(trackIds) || trackIds.some((id) => typeof id !== 'string'))) throw exportError('MUSICXML_TRACKS_INVALID', 'Track IDs must be an array of strings.');
  const ppq = project.ppq;
  const signature = project.timeSignature ?? { numerator: 4, denominator: 4 };
  const bar = barTicks(ppq, signature);
  if (!Number.isInteger(bar)) throw exportError('MUSICXML_METER_UNSUPPORTED', 'The bar length is not a whole number of ticks at this PPQ.');
  if (trackIds) {
    for (const id of trackIds) {
      const track = project.tracks.find((t) => t.id === id);
      if (!track) throw exportError('MUSICXML_TRACK_NOT_FOUND', `Track ${id} does not exist.`);
      if (track.type !== 'midi') throw exportError('MUSICXML_TRACK_NOT_MIDI', `Track ${id} is not a MIDI track.`);
    }
  }
  const tracks = project.tracks.filter((t) => t.type === 'midi' && (!trackIds || trackIds.includes(t.id)));
  if (!tracks.length) throw exportError('MUSICXML_NO_TRACKS', 'There are no MIDI tracks to export.');
  if (tracks.length > MAX_PARTS) throw exportError('MUSICXML_TOO_LARGE', `MusicXML export supports at most ${MAX_PARTS} parts.`);

  const warnings = [];
  const collected = tracks.map((track) => ({ track, ...trackNotes(project, track) }));
  const noteCount = collected.reduce((sum, c) => sum + c.notes.length, 0);
  if (noteCount > MAX_NOTES) throw exportError('MUSICXML_TOO_LARGE', `MusicXML export supports at most ${MAX_NOTES} notes.`);
  const muted = collected.reduce((sum, c) => sum + c.mutedClips, 0);
  if (muted) warnings.push(`${muted} muted MIDI clip(s) were not exported.`);
  const endTick = Math.max(bar, ...collected.flatMap((c) => c.notes.map((n) => n.startTick + n.durationTicks)), ...(project.tempoMap ?? []).map((p) => p.tick + 1));
  const measureCount = Math.ceil(endTick / bar);

  const out = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">',
    '<score-partwise version="4.0">',
    `<work><work-title>${xml(clean(project.name ?? 'Untitled'))}</work-title></work>`,
    '<identification><encoding><software>Sovereign DAW / SovaRoll</software></encoding></identification>',
    '<part-list>',
  ];
  collected.forEach(({ track, notes }, i) => {
    const channel = (notes[0]?.channel ?? 0) + 1;
    out.push(`<score-part id="P${i + 1}"><part-name>${xml(clean(track.name ?? `MIDI ${i + 1}`))}</part-name><score-instrument id="P${i + 1}-I1"><instrument-name>${xml(clean(track.name ?? `MIDI ${i + 1}`))}</instrument-name></score-instrument><midi-instrument id="P${i + 1}-I1"><midi-channel>${channel}</midi-channel></midi-instrument></score-part>`);
  });
  out.push('</part-list>');

  const tempos = (project.tempoMap ?? []).filter((p) => Number.isFinite(p.bpm) && p.bpm > 0);
  collected.forEach(({ notes }, partIndex) => {
    const layout = layoutScore({ notes, lengthTicks: measureCount * bar }, { ppq, timeSignature: signature, fifths });
    const staffVoices = {
      treble: assignVoices(layout.chords.filter((c) => c.staff === 'treble')),
      bass: assignVoices(layout.chords.filter((c) => c.staff === 'bass')),
    };
    out.push(`<part id="P${partIndex + 1}">`);
    for (let m = 0; m < measureCount; m++) {
      const start = m * bar, end = start + bar;
      out.push(`<measure number="${m + 1}">`);
      if (m === 0) {
        out.push(`<attributes><divisions>${ppq}</divisions><key><fifths>${fifths}</fifths></key><time><beats>${signature.numerator}</beats><beat-type>${signature.denominator}</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>`);
      }
      if (partIndex === 0) {
        for (const tempo of tempos.filter((p) => p.tick >= start && p.tick < end)) {
          const bpm = Math.round(tempo.bpm * 1000) / 1000;
          out.push(`<direction placement="above">${tempo.tick > start ? `<offset>${tempo.tick - start}</offset>` : ''}<direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${bpm}</per-minute></metronome></direction-type><staff>1</staff><sound tempo="${bpm}"/></direction>`);
        }
      }
      let emitted = false;
      for (const [staffName, staff, firstVoice] of [['treble', 1, 1], ['bass', 2, 5]]) {
        const voices = staffVoices[staffName].length ? staffVoices[staffName] : [[]];
        voices.forEach((voiceChords, v) => {
          const primary = v === 0;
          const chords = voiceChords.filter((c) => c.startTick >= start && c.startTick < end);
          if (!primary && !chords.length) return;
          if (emitted) out.push(`<backup><duration>${bar}</duration></backup>`);
          emitted = true;
          const voice = firstVoice + v;
          let cursor = start;
          for (const chord of chords) {
            out.push(gapXml(cursor, chord.startTick, { primary, voice, staff, ppq, bar, measureStart: start }));
            chord.heads.sort((a, b) => a.position - b.position).forEach((head, index) => out.push(noteXml(head, { chord: index > 0, voice, staff })));
            cursor = chord.startTick + chord.durationTicks;
          }
          out.push(gapXml(cursor, end, { primary, voice, staff, ppq, bar, measureStart: start }));
        });
      }
      if (m === measureCount - 1) out.push('<barline location="right"><bar-style>light-heavy</bar-style></barline>');
      out.push('</measure>');
    }
    out.push('</part>');
  });
  out.push('</score-partwise>');
  if (layoutHasInexact(collected, ppq)) warnings.push('Some note lengths have no exact written value; MusicXML keeps the exact duration with the nearest shorter type.');
  return { xml: out.filter(Boolean).join('\n'), partCount: collected.length, measureCount, noteCount, warnings };
}

function layoutHasInexact(collected, ppq) {
  const minimum = ppq / 8;
  return collected.some((c) => c.notes.some((n) => decomposeDuration(n.durationTicks, ppq).some((p) => p.inexact) || n.startTick % minimum !== 0));
}
