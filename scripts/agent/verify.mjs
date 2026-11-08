#!/usr/bin/env node
// One command that tells an agent whether its change is acceptable. Short output, clear verdict.
//   node scripts/agent/verify.mjs            → changed-files mode (needs a checkpoint): guard + syntax + related tests
//   node scripts/agent/verify.mjs --full     → guard + syntax of all modules + the whole unit/integration suite
//   node scripts/agent/verify.mjs --e2e      → add the first-delivery browser acceptance test (real Chrome)
//   node scripts/agent/verify.mjs tests/core.test.mjs tests/editing.test.mjs   → guard + only these tests
// Final line is always  VERIFY PASS  or  VERIFY FAIL: <reason>.  Details: .agent/last-verify.json
import path from 'node:path';
import {promises as fs} from 'node:fs';
import {ROOT, AGENT_DIR, run, changedSinceCheckpoint, walk, rel, writeJson, printBlock} from './lib.mjs';

const args = process.argv.slice(2);
const full = args.includes('--full'), e2e = args.includes('--e2e');
const explicit = args.filter(a => a.endsWith('.test.mjs'));
const report = {startedAt: new Date().toISOString(), mode: explicit.length ? 'explicit' : full ? 'full' : 'changed', steps: []};
let failed = null;
const step = (name, result, extra = {}) => { report.steps.push({name, status: result.status === 0 ? 'pass' : 'fail', ms: result.ms, ...extra}); console.log(`${result.status === 0 ? 'ok  ' : 'FAIL'} ${name} (${(result.ms / 1000).toFixed(1)}s)`); if (result.status !== 0 && !failed) failed = name; };

// 1. guard
const guard = run(process.execPath, ['scripts/agent/guard.mjs']);
step('guard', guard);
if (guard.status !== 0) printBlock('guard', guard.stdout);

// 2. syntax
const syntax = run(process.execPath, ['scripts/check.mjs']);
step('syntax (all .mjs)', syntax);
if (syntax.status !== 0) printBlock('syntax', syntax.stderr + syntax.stdout);

// 3. choose tests
const allTests = (await walk('tests')).filter(f => f.endsWith('.test.mjs')).map(rel).sort();
let tests = explicit, gui = [];
if (!explicit.length && full) tests = allTests;
else if (!explicit.length) {
  const changes = await changedSinceCheckpoint();
  if (!changes) { console.log('No checkpoint, so changed files are unknown → running the full suite. (Save one: npm run agent:checkpoint -- save "start")'); tests = allTests; }
  else {
    const touched = [...changes.added, ...changes.changed];
    const sources = touched.filter(f => /^(src|public)\/.*\.mjs$/.test(f));
    gui = touched.filter(f => f.startsWith('public/'));
    const selected = new Set(touched.filter(f => f.startsWith('tests/') && f.endsWith('.test.mjs')));
    const contents = await Promise.all(allTests.map(async t => [t, await fs.readFile(path.join(ROOT, t), 'utf8')]));
    for (const s of sources) {
      const base = path.basename(s), module = base.replace(/\.mjs$/, '');
      for (const [t, text] of contents) if (text.includes(`/${base}'`) || text.includes(`/${base}"`) || path.basename(t, '.test.mjs').startsWith(module)) selected.add(t);
    }
    // core files are imported almost everywhere: run the full suite for them.
    if (sources.some(s => /src\/(core\/(engine|schema)|server|storage|session-store)\.mjs$/.test(s))) { tests = allTests; console.log('Core module changed → full suite.'); }
    else tests = [...selected].sort();
    report.changes = changes;
    console.log(`Changed since ${changes.checkpoint}: ${touched.length} file(s); ${tests.length} related test file(s).`);
  }
}
report.tests = tests;

// 4. run tests
if (tests.length) {
  const r = run(process.execPath, ['--test', '--test-reporter=dot', ...tests], {timeout: 30 * 60 * 1000});
  const out = r.stdout + r.stderr;
  const failedNames = [...out.matchAll(/^✖ (.+?)(?: \([\d.]+m?s\))?$/gm)].map(m => m[1]);
  step(`unit/integration tests (${tests.length} files)`, r, {failedTests: failedNames});
  if (r.status !== 0) {
    const i = out.indexOf('Failed tests:');
    printBlock('test failures', i >= 0 ? out.slice(i) : out.slice(-6000), 80);
  }
} else console.log('skip unit tests (no related test files; GUI-only change?)');

// 5. browser acceptance
if (e2e) {
  const r = run(process.execPath, ['scripts/agent/e2e.mjs'], {timeout: 20 * 60 * 1000});
  step('first-delivery E2E (Chrome)', r);
  console.log(r.stdout.split('\n').filter(l => /^(E2E|FAIL|PASS:|  )/.test(l)).slice(-25).join('\n'));
} else if (gui.length) console.log(`GUI files changed (${gui.join(', ')}). Also run: npm run agent:e2e`);

report.finishedAt = new Date().toISOString(); report.verdict = failed ? `FAIL: ${failed}` : 'PASS';
await writeJson(path.join(AGENT_DIR, 'last-verify.json'), report);
console.log(failed ? `VERIFY FAIL: ${failed}` : 'VERIFY PASS');
process.exit(failed ? 1 : 0);
