// Score view of the selected MIDI clip: an SVG grand staff drawn from the clip's notes.
// It is only a view: every edit goes through the shared command engine (runCommand / addNote),
// and the key signature is a per-viewer display preference that never changes MIDI data.
import { layoutScore, pitchAtStaffPosition, moveDiatonic, KEY_NAMES } from '/media/score-layout.mjs';

const MODE_KEY = 'sovaroll.editorView.v1';
const KEY_KEY = 'sovaroll.scoreKey.v1';
const NS = 'http://www.w3.org/2000/svg';
const HALF = 4; // pixels per staff step (line spacing 8px)
const BOTTOM = { treble: 100, bass: 196 };
const SPLIT_Y = 132; // between the staves: above → treble, below → bass
const HEIGHT = 250;
const GLYPH = { sharp: '♯', flat: '♭', natural: '♮' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function readStored(key, fallback) {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function writeStored(key, value) {
  try { localStorage.setItem(key, value); } catch { /* preference only */ }
}

const ERROR_TEXT = {
  SCORE_PITCH_RANGE: '악보 위치가 MIDI 음높이 0–127 범위를 벗어났습니다.',
  SCORE_KEY_INVALID: '조표 값이 올바르지 않습니다.',
};

export function setupScoreView({ getContext, selectNote, addNote, runCommand, notify, download }) {
  const $ = (id) => document.getElementById(id);
  const host = $('score-scroll');
  const svg = $('score-svg');
  const pianoButton = $('editor-view-piano');
  const scoreButton = $('editor-view-score');
  const keySelect = $('score-key');
  const editor = host.closest('.editor');
  let mode = readStored(MODE_KEY, 'piano') === 'score' ? 'score' : 'piano';
  let fifths = Number(readStored(KEY_KEY, '0'));
  if (!Number.isInteger(fifths) || fifths < -7 || fifths > 7) fifths = 0;
  let left = 0;
  let enabled = false;
  let exporting = false;
  const exportButton = $('score-export-musicxml');

  keySelect.innerHTML = Object.keys(KEY_NAMES).map(Number).sort((a, b) => a - b)
    .map((f) => `<option value="${f}">${esc(KEY_NAMES[f])} 장조 · ${f > 0 ? `♯${f}` : f < 0 ? `♭${-f}` : '조표 없음'}</option>`).join('');
  keySelect.value = String(fifths);

  const y = (staff, position) => BOTTOM[staff] - position * HALF;

  function setMode(next) {
    mode = next;
    writeStored(MODE_KEY, mode);
    update();
  }

  function el(name, attrs = {}, text) {
    const node = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) node.setAttribute(k, String(v));
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function drawRest(group, rest, x, barStartX, barEndX) {
    const staff = rest.staff;
    const g = el('g', { class: 'score-rest', 'data-score-rest': rest.value, 'data-staff': staff, 'data-tick': rest.startTick });
    if (rest.value === 'whole') {
      const cx = rest.wholeBar ? (barStartX + barEndX) / 2 : x + 6;
      g.append(el('rect', { x: cx - 5, y: y(staff, 6), width: 10, height: 4 }));
    } else if (rest.value === 'half') {
      g.append(el('rect', { x: x + 1, y: y(staff, 4) - 4, width: 10, height: 4 }));
    } else if (rest.value === 'quarter') {
      const top = y(staff, 7);
      g.append(el('path', { d: `M${x + 3} ${top} l5 6 l-4 5 l5 6 q-6 -2 -4 4`, fill: 'none', 'stroke-width': 2 }));
    } else {
      const flags = { eighth: 1, '16th': 2, '32nd': 3 }[rest.value] ?? 1;
      const top = y(staff, 6);
      g.append(el('path', { d: `M${x + 9} ${top} L${x + 4} ${top + 8 + flags * 6}`, fill: 'none', 'stroke-width': 1.4 }));
      for (let i = 0; i < flags; i++) g.append(el('circle', { cx: x + 4 + i * -1.5, cy: top + 2 + i * 6, r: 2 }));
    }
    if (rest.dots) g.append(el('circle', { cx: x + 15, cy: y(staff, 5), r: 1.5 }));
    group.append(g);
  }

  function render(context) {
    const { project, clip, view, selectedNoteIds } = context;
    const layout = layoutScore(clip, { ppq: project.ppq, timeSignature: project.timeSignature, fifths });
    const keyWidth = Math.abs(fifths) * 9;
    left = 52 + keyWidth + 24;
    const contentWidth = Math.max(view.tickToX(layout.barCount * layout.barTicks), 1);
    const width = Math.max(left + contentWidth + 16, host.clientWidth);
    svg.setAttribute('width', width);
    svg.setAttribute('height', HEIGHT);
    svg.setAttribute('viewBox', `0 0 ${width} ${HEIGHT}`);
    svg.dataset.fifths = String(fifths);
    svg.dataset.bars = String(layout.barCount);
    svg.replaceChildren();
    const tx = (tick) => left + view.tickToX(tick);

    const staffGroup = el('g', { class: 'score-staff' });
    for (const staff of ['treble', 'bass']) {
      for (let line = 0; line < 5; line++) staffGroup.append(el('line', { x1: 10, x2: left + contentWidth, y1: y(staff, line * 2), y2: y(staff, line * 2) }));
    }
    staffGroup.append(el('line', { x1: 10, x2: 10, y1: y('treble', 8), y2: y('bass', 0), class: 'score-system' }));
    svg.append(staffGroup);
    svg.append(el('text', { x: 14, y: y('treble', 2) + 9, class: 'score-clef', 'data-clef': 'treble', 'font-size': 46 }, '𝄞'));
    svg.append(el('text', { x: 16, y: y('bass', 6) + 7, class: 'score-clef', 'data-clef': 'bass', 'font-size': 30 }, '𝄢'));
    for (const staff of ['treble', 'bass']) {
      layout.keySignature[staff].forEach((k, i) => svg.append(el('text', { x: 50 + i * 9, y: y(staff, k.position) + 4, class: 'score-accidental key', 'data-key-accidental': k.accidental }, GLYPH[k.accidental])));
      const tsX = 52 + keyWidth + 4;
      svg.append(el('text', { x: tsX, y: y(staff, 6) + 4, class: 'score-time' }, String(layout.timeSignature.numerator)));
      svg.append(el('text', { x: tsX, y: y(staff, 2) + 4, class: 'score-time' }, String(layout.timeSignature.denominator)));
    }

    const bars = el('g', { class: 'score-bars' });
    for (let i = 0; i <= layout.barCount; i++) {
      const x = tx(i * layout.barTicks);
      bars.append(el('line', { x1: x, x2: x, y1: y('treble', 8), y2: y('bass', 0), class: i === layout.barCount ? 'score-barline final' : 'score-barline' }));
      if (i < layout.barCount) bars.append(el('text', { x: x + 3, y: y('treble', 8) - 26, class: 'score-bar-number' }, String(i + 1)));
    }
    const clipEnd = tx(layout.lengthTicks);
    if (layout.lengthTicks < layout.barCount * layout.barTicks) bars.append(el('rect', { x: clipEnd, y: y('treble', 8) - 4, width: tx(layout.barCount * layout.barTicks) - clipEnd, height: y('bass', 0) - y('treble', 8) + 8, class: 'score-outside' }));
    svg.append(bars);

    const rests = el('g', { class: 'score-rests' });
    for (const rest of layout.rests) {
      const bar0 = tx(rest.barIndex * layout.barTicks), bar1 = tx((rest.barIndex + 1) * layout.barTicks);
      drawRest(rests, rest, tx(rest.startTick) + 2, bar0, bar1);
    }
    svg.append(rests);

    const notes = el('g', { class: 'score-notes' });
    const headX = (head) => tx(head.startTick) + 7;
    for (const chord of layout.chords) {
      if (!chord.stem) continue;
      const positions = chord.heads.map((h) => h.position);
      const x = headX(chord.heads[0]) + (chord.stem === 'up' ? 5 : -5);
      const low = Math.min(...positions), high = Math.max(...positions);
      const from = chord.stem === 'up' ? y(chord.staff, low) : y(chord.staff, high);
      const tip = chord.stem === 'up' ? y(chord.staff, high) - 28 : y(chord.staff, low) + 28;
      notes.append(el('line', { x1: x, x2: x, y1: from, y2: tip, class: 'score-stem' }));
      for (let f = 0; f < chord.flags; f++) {
        const fy = tip + (chord.stem === 'up' ? f * 6 : -f * 6);
        notes.append(el('path', { d: chord.stem === 'up' ? `M${x} ${fy} q8 6 5 14` : `M${x} ${fy} q8 -6 5 -14`, class: 'score-flag' }));
      }
    }
    const byNote = new Map();
    for (const head of layout.heads) {
      if (!byNote.has(head.noteId)) byNote.set(head.noteId, []);
      byNote.get(head.noteId).push(head);
    }
    for (const [noteId, heads] of byNote) {
      const first = heads[0];
      const g = el('g', {
        class: `score-note${selectedNoteIds.has(noteId) ? ' selected' : ''}`,
        'data-score-note': noteId, 'data-pitch': first.pitch, 'data-spelling': first.name, 'data-staff': first.staff,
        role: 'button', 'aria-label': `${first.name}, ${first.startTick / project.ppq + 1}박, 벨로시티 ${first.velocity}`,
      });
      g.append(el('title', {}, `${first.name} · velocity ${first.velocity}`));
      heads.forEach((head, index) => {
        const x = headX(head), hy = y(head.staff, head.position);
        for (const ledger of head.ledgers) g.append(el('line', { x1: x - 8, x2: x + 8, y1: y(head.staff, ledger), y2: y(head.staff, ledger), class: 'score-ledger' }));
        const hollow = head.value === 'whole' || head.value === 'half';
        g.append(el('ellipse', { cx: x, cy: hy, rx: 5.2, ry: 3.8, transform: `rotate(-20 ${x} ${hy})`, class: `score-head${hollow ? ' hollow' : ''}${head.inexact ? ' inexact' : ''}`, 'data-piece': index, 'data-value': head.value }));
        if (head.accidental) g.append(el('text', { x: x - 15, y: hy + 4, class: 'score-accidental', 'data-accidental': head.accidental }, GLYPH[head.accidental]));
        if (head.dots) g.append(el('circle', { cx: x + 9, cy: hy - (head.position % 2 === 0 ? 2 : 0), r: 1.6, class: 'score-dot' }));
        if (head.tieToNext && heads[index + 1]) {
          const nx = headX(heads[index + 1]);
          const down = head.position >= 4 ? -1 : 1;
          g.append(el('path', { d: `M${x + 4} ${hy + down * 5} Q${(x + nx) / 2} ${hy + down * 13} ${nx - 4} ${hy + down * 5}`, class: 'score-tie' }));
        }
      });
      notes.append(g);
    }
    svg.append(notes);
  }

  function update() {
    const context = getContext();
    enabled = context.enabled === true;
    pianoButton.hidden = !enabled;
    scoreButton.hidden = !enabled;
    const active = enabled && mode === 'score';
    pianoButton.setAttribute('aria-pressed', String(!active));
    scoreButton.setAttribute('aria-pressed', String(active));
    $('score-key-label').hidden = !active;
    exportButton.hidden = !(active && context.musicXml === true);
    exportButton.disabled = exporting || context.busy || !context.connected || context.clip?.type !== 'midi';
    editor?.classList.toggle('score-mode', active);
    const title = $('editor-title');
    if (title) title.textContent = active ? 'Score' : 'Piano roll';
    const midi = context.clip?.type === 'midi' && context.project;
    host.hidden = !(active && midi);
    if (midi) $('piano-scroll').hidden = active;
    if (!active || !midi) { svg.replaceChildren(); return; }
    try {
      render(context);
      delete svg.dataset.error;
    } catch (error) {
      svg.replaceChildren();
      svg.dataset.error = error.code ?? 'SCORE_ERROR';
      notify(ERROR_TEXT[error.code] ?? `${error.code ?? 'SCORE_ERROR'}: ${error.message}`, true);
    }
  }

  function refreshSelection() {
    const { selectedNoteIds } = getContext();
    svg.querySelectorAll('[data-score-note]').forEach((node) => node.classList.toggle('selected', selectedNoteIds.has(node.dataset.scoreNote)));
  }

  pianoButton.addEventListener('click', () => setMode('piano'));
  scoreButton.addEventListener('click', () => setMode('score'));
  keySelect.addEventListener('change', () => {
    const value = Number(keySelect.value);
    if (!Number.isInteger(value) || value < -7 || value > 7) return;
    fifths = value;
    writeStored(KEY_KEY, String(fifths));
    update();
  });

  exportButton.addEventListener('click', async () => {
    const context = getContext();
    const clip = context.clip;
    if (exporting || context.busy || !context.connected || clip?.type !== 'midi') return;
    const track = context.project.tracks.find((t) => t.id === clip.trackId);
    const params = new URLSearchParams({ trackId: clip.trackId, fifths: String(fifths), expectedRevision: String(context.project.revision) });
    exporting = true;
    update();
    try {
      if (await download(`/api/export/musicxml?${params}`, `${context.project.name} - ${track?.name ?? 'MIDI'}.musicxml`, { documentId: context.documentId })) notify('MusicXML 악보 파일을 내보냈습니다.');
    } finally {
      exporting = false;
      update();
    }
  });

  host.addEventListener('pointerdown', (event) => {
    const context = getContext();
    if (event.button !== 0 || context.busy || !context.connected || context.clip?.type !== 'midi') return;
    host.focus({ preventScroll: true });
    const target = event.target.closest('[data-score-note]');
    if (target) {
      event.preventDefault();
      selectNote(target.dataset.scoreNote, event);
      return;
    }
    const rect = svg.getBoundingClientRect();
    const px = event.clientX - rect.left, py = event.clientY - rect.top;
    if (px < left) return;
    const staff = py < SPLIT_Y ? 'treble' : 'bass';
    const position = Math.round((BOTTOM[staff] - py) / HALF);
    let pitch;
    try { pitch = pitchAtStaffPosition(staff, position, fifths); } catch (error) { notify(ERROR_TEXT[error.code] ?? error.message, true); return; }
    const tick = context.view.xToTick(px - left);
    if (tick < 0 || tick >= context.clip.lengthTicks) return;
    addNote(tick, pitch);
  });

  host.addEventListener('keydown', (event) => {
    if (!event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key) || event.metaKey || event.ctrlKey) return;
    const context = getContext();
    const clip = context.clip;
    if (clip?.type !== 'midi' || !context.selectedNoteIds.size || context.busy || !context.connected) return;
    event.preventDefault();
    const steps = (event.key === 'ArrowUp' ? 1 : -1) * (event.shiftKey ? 7 : 1);
    let commands;
    try {
      commands = clip.notes.filter((n) => context.selectedNoteIds.has(n.id)).map((n) => ({
        command: 'midi.notes.update',
        arguments: { clipId: clip.id, noteId: n.id, pitch: moveDiatonic(n.pitch, steps, fifths) },
      }));
    } catch (error) {
      notify(ERROR_TEXT[error.code] ?? error.message, true);
      return;
    }
    void runCommand('batch', { commands }, context.project.revision);
  });

  return {
    update,
    refreshSelection,
    get active() { return enabled && mode === 'score'; },
  };
}
