#!/usr/bin/env node
// Lists Korean UI text segments in public/ and reports which lack an English entry
// in public/i18n-dictionary.mjs. Usage:
//   node scripts/i18n-coverage.mjs            summary + missing keys
//   node scripts/i18n-coverage.mjs --json     machine-readable {total,missing:[...]}
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(root, 'public');
const HANGUL = /[가-힣]/;
const CODE_LIKE = /\$\{|=>|['"`]\s*[,)\]]|\(\s*['"`]|:''/;
const SKIP = new Set(['i18n.mjs', 'i18n-dictionary.mjs']);

// Turn a source literal into the visible text segments a browser would show.
export function segmentsOf(literal) {
  let n = 0;
  const withSlots = literal.replace(/\$\{(?:[^{}]|\{[^{}]*\})*\}/g, () => `{${n++}}`);
  return withSlots
    .replace(/\\n/g, '\n')
    .split(/<[^>]*>|\n/)
    .map((part) => part.replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim())
    .filter((part) => HANGUL.test(part))
    // A fragment of nested template code: keep only the strings inside it.
    .flatMap((part) => (CODE_LIKE.test(part) ? stringLiterals(part).flatMap(segmentsOf) : [part]))
    .map((part) => {
      // Renumber slots inside each segment from {0}.
      let i = 0; const map = new Map();
      return part.replace(/\{(\d+)\}/g, (_, d) => { if (!map.has(d)) map.set(d, i++); return `{${map.get(d)}}`; });
    });
}

// Character scanner for string and template literals, including templates nested inside
// ${…} expressions. Each template expression becomes a ${x} slot in its parent body.
export function stringLiterals(src) {
  const out = [];
  let i = 0;
  const readQuoted = (quote) => {
    let body = ''; i++;
    while (i < src.length && src[i] !== quote && src[i] !== '\n') {
      if (src[i] === '\\') { body += src.slice(i, i + 2); i += 2; continue; }
      body += src[i++];
    }
    i++; return body;
  };
  const skipExpression = () => {
    let depth = 0;
    while (i < src.length) {
      const c = src[i];
      if (c === "'" || c === '"') { readQuoted(c); continue; }
      if (c === '`') { readTemplate(); continue; }
      if (c === '{') depth++;
      else if (c === '}') { if (depth === 0) return; depth--; }
      i++;
    }
  };
  const readTemplate = () => {
    let body = ''; i++;
    while (i < src.length && src[i] !== '`') {
      if (src[i] === '\\') { body += src.slice(i, i + 2); i += 2; continue; }
      if (src[i] === '$' && src[i + 1] === '{') {
        i += 2; const start = i; skipExpression();
        out.push(...stringLiterals(src.slice(start, i)));
        i++; body += '${x}'; continue;
      }
      body += src[i++];
    }
    i++; return body;
  };
  while (i < src.length) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { const end = src.indexOf('\n', i); i = end < 0 ? src.length : end; continue; }
    if (c === '/' && src[i + 1] === '*') { const end = src.indexOf('*/', i + 2); i = end < 0 ? src.length : end + 2; continue; }
    if (c === "'" || c === '"' || c === '`') {
      const body = c === '`' ? readTemplate() : readQuoted(c);
      if (HANGUL.test(body)) out.push(body);
      continue;
    }
    i++;
  }
  return out;
}

export async function collectKoreanSegments() {
  const found = new Map();
  const files = (await fs.readdir(publicDir)).filter((f) => /\.(mjs|html)$/.test(f) && !SKIP.has(f));
  for (const file of files) {
    const source = await fs.readFile(path.join(publicDir, file), 'utf8');
    const literals = [];
    if (file.endsWith('.html')) {
      for (const m of source.matchAll(/>([^<>]*[가-힣][^<>]*)</g)) literals.push(m[1]);
    } else {
      literals.push(...stringLiterals(source));
    }
    for (const m of source.matchAll(/(?:title|aria-label|placeholder)="([^"]*[가-힣][^"]*)"/g)) literals.push(m[1]);
    for (const literal of literals) for (const seg of segmentsOf(literal)) {
      if (!found.has(seg)) found.set(seg, new Set());
      found.get(seg).add(file);
    }
  }
  return found;
}

async function main() {
  const { KO_EN } = await import(pathToFileURL(path.join(publicDir, 'i18n-dictionary.mjs')).href);
  const found = await collectKoreanSegments();
  const missing = [...found.keys()].filter((k) => !Object.hasOwn(KO_EN, k)).sort();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ total: found.size, translated: found.size - missing.length, missing }, null, 1));
  } else {
    for (const key of missing) console.log(`${[...found.get(key)].join(',')}\t${key}`);
    console.log(`\nKorean UI segments: ${found.size}  translated: ${found.size - missing.length}  missing: ${missing.length}`);
  }
  process.exitCode = missing.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
