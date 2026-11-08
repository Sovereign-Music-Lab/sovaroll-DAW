#!/usr/bin/env node
// Show part of a file with line numbers, splitting very long lines into numbered column segments.
//   node scripts/agent/show.mjs FILE LINE [--count 20] [--width 200]
//   node scripts/agent/show.mjs FILE LINE:COL [--width 400]     → only the segment around COL of that line
// Segments print as  "  1234.c3200|..." meaning line 1234 starting at column 3200 (1-based).
// Use the exact text you see as old_string for an edit; never retype long lines from memory.
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {ROOT, clip} from './lib.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); if (i < 0) return fallback; const v = args[i + 1]; args.splice(i, 2); return v; };
const count = Number(opt('--count', 20)), width = Number(opt('--width', 200));
const [file, where = '1'] = args;
if (!file) { console.error('Usage: show.mjs FILE LINE[:COL] [--count N] [--width N]'); process.exit(2); }
const lines = (await fs.readFile(path.resolve(ROOT, file), 'utf8')).split('\n');
const [lineText, colText] = where.split(':');
const first = Math.max(1, Number(lineText));
if (colText) {
  const l = lines[first - 1] ?? '';
  console.log(`${first}:${colText} (line length ${l.length})`);
  console.log(clip(l, Number(colText) - 1, width));
  process.exit(0);
}
console.log(`${file} lines ${first}-${Math.min(lines.length, first + count - 1)} of ${lines.length}`);
for (let n = first; n < Math.min(lines.length, first + count - 1) + 1; n++) {
  const l = lines[n - 1];
  if (l.length <= width) { console.log(`${String(n).padStart(6)}|${l}`); continue; }
  for (let c = 0; c < l.length; c += width) console.log(`${String(n).padStart(6)}.c${c + 1}|${l.slice(c, c + width)}`);
}
