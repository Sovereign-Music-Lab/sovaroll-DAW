#!/usr/bin/env node
// Safety invariants for agent edits. Exit 0 = OK, 1 = violation.
//   node scripts/agent/guard.mjs            → check
//   node scripts/agent/guard.mjs --init     → record the protected-file baseline (run once, by a human or at handoff)
// Checks:
//   1. Protected example data unchanged since baseline.
//   2. The public product catalogue still has FD-01 through FD-30 exactly once.
//   3. Versus the latest checkpoint: no test file deleted, no test() count decrease, no source file shrunk >40%.
//   4. No focused/skipped tests (test.only / { only: true } / test.skip) and no leftover DBG logging.
//   5. Every changed .mjs parses (node --check) and package.json is valid JSON.
import {promises as fs, existsSync} from 'node:fs';
import path from 'node:path';
import {ROOT, AGENT_DIR, PROTECTED, hashTree, diffMaps, readJson, writeJson, latestCheckpoint, changedSinceCheckpoint, run, walk, rel} from './lib.mjs';

const baselineFile = path.join(AGENT_DIR, 'protected-baseline.json');
const protectedRoots = PROTECTED.filter(p => p !== 'sessions'); // sessions/ is the user's live project; the user's own server writes it.
const problems = [], notes = [];

if (process.argv.includes('--init')) {
  await writeJson(baselineFile, {createdAt: new Date().toISOString(), files: await hashTree(protectedRoots)});
  console.log(`GUARD baseline recorded for ${protectedRoots.join(', ')}`);
  process.exit(0);
}

// 1. protected files
const baseline = await readJson(baselineFile);
if (!baseline) notes.push('No protected baseline yet (run: node scripts/agent/guard.mjs --init).');
else {
  const d = diffMaps(baseline.files, await hashTree(protectedRoots));
  for (const [kind, list] of Object.entries(d)) for (const f of list) problems.push(`protected file ${kind}: ${f} (restore it; agents must not edit ${protectedRoots.join(', ')})`);
}

// 2. public product requirements: preserve all 30 stable acceptance IDs.
const requirements = path.join(ROOT, 'docs/agent/REQUIREMENTS.md');
if (existsSync(requirements)) {
  const content = await fs.readFile(requirements, 'utf8');
  const ids = [...content.matchAll(/^\| (FD-\d{2}) \|/gm)].map(m => m[1]);
  const expected = Array.from({length: 30}, (_, i) => `FD-${String(i + 1).padStart(2, '0')}`);
  if (ids.length !== 30 || new Set(ids).size !== 30 || expected.some(id => !ids.includes(id))) {
    problems.push('Product requirements must keep FD-01 through FD-30 exactly once');
  }
} else problems.push('docs/agent/REQUIREMENTS.md is missing');

// 3. compare with latest checkpoint
const cp = await latestCheckpoint();
const changes = await changedSinceCheckpoint();
if (!cp) notes.push('No checkpoint: shrink/test-deletion checks skipped (run: node scripts/agent/checkpoint.mjs save "start").');
else {
  const cpFile = f => path.join(AGENT_DIR, 'checkpoints', cp.id, 'files', f);
  for (const f of changes.removed) if (f.startsWith('tests/')) problems.push(`test file deleted: ${f}`);
  for (const f of changes.changed) {
    const before = await fs.readFile(cpFile(f), 'utf8').catch(() => null), after = await fs.readFile(path.join(ROOT, f), 'utf8');
    if (before === null) continue;
    if (f.startsWith('tests/') && f.endsWith('.mjs')) {
      const c = s => (s.match(/(^|[^.\w])test\(/g) ?? []).length;
      if (c(after) < c(before)) problems.push(`${f}: test() count dropped ${c(before)} → ${c(after)} (do not delete tests to make them pass)`);
    }
    if (/\.(mjs|js|html|css|md|json)$/.test(f) && before.length > 2000 && after.length < before.length * 0.6) problems.push(`${f}: shrank ${before.length} → ${after.length} chars (>40%). Possible truncation; compare with checkpoint ${cp.id}.`);
  }
}

// 4. focused/skipped tests and debug leftovers
for (const f of await walk('tests')) {
  if (!f.endsWith('.mjs')) continue;
  const s = await fs.readFile(f, 'utf8');
  if (/\btest\.only\(|\{\s*only:\s*true|\btest\.skip\(|\{\s*skip:\s*true/.test(s)) problems.push(`${rel(f)}: contains test.only/skip`);
}
for (const root of ['src', 'public']) for (const f of await walk(root)) {
  if (!f.endsWith('.mjs')) continue;
  const s = await fs.readFile(f, 'utf8');
  if (/console\.(log|error)\(\s*['"`]DBG/.test(s)) problems.push(`${rel(f)}: leftover DBG logging`);
}

// 5. syntax of changed files + package.json
const toCheck = changes ? [...changes.added, ...changes.changed].filter(f => f.endsWith('.mjs')) : [];
for (const f of toCheck) { const r = run(process.execPath, ['--check', f]); if (r.status !== 0) problems.push(`syntax error in ${f}: ${(r.stderr.split('\n').find(l => /Error/.test(l)) ?? r.stderr).trim().slice(0, 200)}`); }
try { JSON.parse(await fs.readFile(path.join(ROOT, 'package.json'), 'utf8')); } catch (e) { problems.push(`package.json invalid: ${e.message}`); }

for (const n of notes) console.log(`note: ${n}`);
if (problems.length) { console.log(`GUARD FAIL (${problems.length})`); for (const p of problems) console.log(`  - ${p}`); process.exit(1); }
console.log(`GUARD PASS${changes ? ` (${changes.added.length} added, ${changes.changed.length} changed, ${changes.removed.length} removed since ${changes.checkpoint})` : ''}`);
