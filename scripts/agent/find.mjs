#!/usr/bin/env node
// Search code with SHORT output. Lines in this repo can exceed 8,000 characters, so plain grep floods context.
//   node scripts/agent/find.mjs PATTERN [PATH...] [--regex] [--max 40] [--width 160] [--ignore-case]
// Prints  file:line:col  and ~width characters around each match. Default paths: src public tests scripts.
// Example: node scripts/agent/find.mjs "case 'clip.split'" src/core
import {promises as fs} from 'node:fs';
import {walk, rel, clip} from './lib.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); if (i < 0) return fallback; const v = args[i + 1]; args.splice(i, 2); return v; };
const bool = name => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
const max = Number(opt('--max', 40)), width = Number(opt('--width', 160)), isRegex = bool('--regex'), ignoreCase = bool('--ignore-case');
const [pattern, ...paths] = args;
if (!pattern) { console.error('Usage: find.mjs PATTERN [PATH...] [--regex] [--max N] [--width N] [--ignore-case]'); process.exit(2); }
let re;
try { re = isRegex ? new RegExp(pattern, ignoreCase ? 'gi' : 'g') : new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), ignoreCase ? 'gi' : 'g'); }
catch (e) { console.error(`Invalid --regex pattern: ${e.message}. For alternatives use JS syntax a|b (not a\\|b), or run two searches.`); process.exit(2); }
const files = [];
for (const p of paths.length ? paths : ['src', 'public', 'tests', 'scripts']) await walk(p, files);
let count = 0, fileHits = new Map();
outer: for (const f of files.filter(f => /\.(mjs|js|json|html|css|md|py|swift|c|m)$/.test(f))) {
  const lines = (await fs.readFile(f, 'utf8')).split('\n');
  for (let i = 0; i < lines.length; i++) {
    re.lastIndex = 0; let m;
    while ((m = re.exec(lines[i]))) {
      count++; fileHits.set(rel(f), (fileHits.get(rel(f)) ?? 0) + 1);
      if (count <= max) console.log(`${rel(f)}:${i + 1}:${m.index + 1}  ${clip(lines[i], m.index, width)}`);
      if (!re.global || m[0] === '') break;
      if (count > max * 50) break outer;
    }
  }
}
if (count > max) console.log(`… ${count - max} more match(es). Per file: ${[...fileHits].map(([f, n]) => `${f}(${n})`).join(', ')}`);
if (!count) { console.log('No matches.'); process.exit(1); }
