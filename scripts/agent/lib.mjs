// Shared helpers for the agent harness (scripts/agent/*). No npm dependencies.
import {promises as fs, existsSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

export const ROOT = path.resolve(import.meta.dirname, '..', '..');
export const AGENT_DIR = path.join(ROOT, '.agent');
export const CHECKPOINT_DIR = path.join(AGENT_DIR, 'checkpoints');
/** Source trees an agent may edit. Checkpoints, change detection and guards cover exactly these. */
export const TRACKED = ['src', 'public', 'tests', 'scripts', 'native', 'docs', 'skills', 'AGENTS.md', 'CONTEXT.md', 'CONTINUE.md', 'README.md', 'README.ko.md', 'PHILOSOPHY.en.md', 'PHILOSOPHY.ko.md', 'LICENSE', 'NOTICE', 'package.json'];
/** User data and evidence an agent must never modify. Guard hashes these. */
export const PROTECTED = ['sessions', 'examples'];

export const sha256 = data => createHash('sha256').update(data).digest('hex');
export const rel = p => path.relative(ROOT, p) || '.';

export async function walk(entry, out = []) {
  const abs = path.isAbsolute(entry) ? entry : path.join(ROOT, entry);
  if (!existsSync(abs)) return out;
  const st = await fs.stat(abs);
  if (st.isFile()) { out.push(abs); return out; }
  for (const d of await fs.readdir(abs, {withFileTypes: true})) {
    if (d.name === '.DS_Store' || d.name === 'node_modules' || d.name === '__pycache__') continue;
    const p = path.join(abs, d.name);
    if (d.isDirectory()) await walk(p, out); else if (d.isFile()) out.push(p);
  }
  return out;
}

/** {relativePath: sha256} for a list of roots. */
export async function hashTree(roots) {
  const map = {};
  for (const r of roots) for (const f of await walk(r)) map[rel(f)] = sha256(await fs.readFile(f));
  return map;
}

export function diffMaps(before, after) {
  const added = [], removed = [], changed = [];
  for (const k of Object.keys(after)) if (!(k in before)) added.push(k); else if (before[k] !== after[k]) changed.push(k);
  for (const k of Object.keys(before)) if (!(k in after)) removed.push(k);
  return {added: added.sort(), removed: removed.sort(), changed: changed.sort()};
}

export async function readJson(file, fallback = null) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; }
}
export async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), {recursive: true});
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2) + '\n');
  await fs.rename(tmp, file);
}

export async function listCheckpoints() {
  if (!existsSync(CHECKPOINT_DIR)) return [];
  const ids = (await fs.readdir(CHECKPOINT_DIR)).filter(n => existsSync(path.join(CHECKPOINT_DIR, n, 'manifest.json'))).sort();
  return Promise.all(ids.map(async id => ({id, ...(await readJson(path.join(CHECKPOINT_DIR, id, 'manifest.json')))})));
}
/** Latest checkpoint used as the comparison baseline. Automatic "pre-restore" snapshots are skipped (they may hold the broken state). */
export async function latestCheckpoint({includePreRestore = false} = {}) { return (await listCheckpoints()).filter(c => includePreRestore || !String(c.label).startsWith('pre-restore')).at(-1) ?? null; }

/** Files changed since the latest checkpoint (or null when no checkpoint exists). */
export async function changedSinceCheckpoint() {
  const cp = await latestCheckpoint();
  if (!cp) return null;
  const now = await hashTree(TRACKED);
  return {checkpoint: cp.id, ...diffMaps(cp.files, now)};
}

/** Run a command, capture output, never throw. */
export function run(cmd, args, options = {}) {
  const started = Date.now();
  const r = spawnSync(cmd, args, {cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...options});
  return {status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '', ms: Date.now() - started, error: r.error?.message};
}

/** Truncate a long line around a column so small-context models can read it. */
export function clip(line, center = 0, width = 160) {
  if (line.length <= width) return line;
  const start = Math.max(0, Math.min(center - Math.floor(width / 2), line.length - width));
  return `${start > 0 ? '…' : ''}${line.slice(start, start + width)}${start + width < line.length ? '…' : ''}`;
}

/** Locate a Playwright module: env NEWDAW_PLAYWRIGHT_MODULE, local node_modules, or npx caches. */
export async function findPlaywright() {
  const candidates = [process.env.NEWDAW_PLAYWRIGHT_MODULE, path.join(ROOT, 'node_modules/playwright/index.mjs')].filter(Boolean);
  const npx = path.join(os.homedir(), '.npm/_npx');
  if (existsSync(npx)) for (const d of await fs.readdir(npx)) candidates.push(path.join(npx, d, 'node_modules/playwright/index.mjs'));
  return candidates.find(c => existsSync(c)) ?? null;
}

export function printBlock(title, text, maxLines = 40) {
  const lines = text.split('\n');
  console.log(`--- ${title} (${lines.length} lines${lines.length > maxLines ? `, first ${maxLines} shown` : ''}) ---`);
  console.log(lines.slice(0, maxLines).map(l => clip(l, 0, 220)).join('\n'));
}
