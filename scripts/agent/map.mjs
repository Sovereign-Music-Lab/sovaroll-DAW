#!/usr/bin/env node
// Generate docs/agent/CODEMAP.md: every module with line count, longest line, exports, and the engine command list.
//   node scripts/agent/map.mjs            → rewrite docs/agent/CODEMAP.md
//   node scripts/agent/map.mjs --check    → exit 1 if CODEMAP.md is stale
import path from 'node:path';
import {promises as fs} from 'node:fs';
import {ROOT, walk, rel} from './lib.mjs';
import {getCommandCatalog} from '../../src/core/engine.mjs';

const groups = [
  ['src/core', 'Engine core: project schema, validation, command application, undo history. Pure functions, no I/O.'],
  ['src/media', 'Media & time math: WAV/AIFF/MIDI codecs, offline renderer, tempo/time conversion, controller curves. Mostly pure.'],
  ['src', 'Server, CLI, persistence, workspace/documents, workers (top-level files only).'],
  ['public', 'Browser GUI (no framework). app.mjs owns state/rendering; other files are feature modules wired from app.mjs.'],
  ['scripts', 'Build/check tools and gui-*-smoke.mjs browser tests (top-level files only).'],
  ['scripts/agent', 'Agent harness (verify, checkpoint, find, show, guard, e2e, task, map).'],
];
const lines = ['# CODEMAP (generated — do not edit by hand)', '', 'Regenerate: `npm run agent:map`. Line counts help you choose `show.mjs` ranges; files with a large *max line* contain very long single lines — use `find.mjs`/`show.mjs`, never retype them.', ''];
for (const [dir, about] of groups) {
  const files = (await walk(dir)).filter(f => f.endsWith('.mjs') && path.dirname(rel(f)) === dir).sort();
  if (!files.length) continue;
  lines.push(`## ${dir}/`, '', about, '', '| file | lines | max line | exports |', '|---|---:|---:|---|');
  for (const f of files) {
    const text = await fs.readFile(f, 'utf8'), ls = text.split('\n');
    const exports = [...text.matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z0-9_$]+)/gm)].map(m => m[1]);
    const named = [...text.matchAll(/^export\s*\{([^}]+)\}/gm)].flatMap(m => m[1].split(',').map(s => s.trim().split(/\s+as\s+/).pop()));
    const all = [...exports, ...named];
    lines.push(`| ${path.basename(f)} | ${ls.length} | ${Math.max(...ls.map(l => l.length))} | ${all.slice(0, 12).join(', ')}${all.length > 12 ? ` … (+${all.length - 12})` : ''} |`);
  }
  lines.push('');
}
const catalog = getCommandCatalog();
lines.push(`## Engine commands (${catalog.length})`, '', 'Defined in `src/core/schema.mjs` (`definitions` array → name, description, argument schema) and applied in `src/core/engine.mjs` (`applyCommand` switch). CLI: `node src/cli.mjs command NAME JSON`; live schemas: `node src/cli.mjs commands`.', '', '| command | description |', '|---|---|');
for (const c of catalog.sort((a, b) => a.command.localeCompare(b.command))) lines.push(`| \`${c.command}\` | ${c.description.replace(/\|/g, '/').replace(/\s+/g, ' ').slice(0, 140)}${c.description.length > 140 ? '…' : ''} |`);
const output = lines.join('\n') + '\n', target = path.join(ROOT, 'docs/agent/CODEMAP.md');
if (process.argv.includes('--check')) {
  const current = await fs.readFile(target, 'utf8').catch(() => '');
  if (current !== output) { console.log('CODEMAP stale: run npm run agent:map'); process.exit(1); }
  console.log('CODEMAP up to date'); process.exit(0);
}
await fs.mkdir(path.dirname(target), {recursive: true});
await fs.writeFile(target, output);
console.log(`wrote docs/agent/CODEMAP.md (${catalog.length} commands)`);
