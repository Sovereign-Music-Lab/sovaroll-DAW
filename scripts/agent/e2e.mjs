#!/usr/bin/env node
// Run the browser acceptance tests with an auto-located Playwright + system Chrome.
//   node scripts/agent/e2e.mjs                    → scripts/gui-first-delivery-smoke.mjs (the first-delivery contract)
//   node scripts/agent/e2e.mjs scripts/gui-recording-workflow-smoke.mjs   → any other gui-*-smoke.mjs
// Prints PASS lines, the failing step, and where the screenshot/log is. Uses an isolated temp project.
import path from 'node:path';
import {promises as fs} from 'node:fs';
import {ROOT, run, findPlaywright, readJson} from './lib.mjs';

const script = process.argv[2] ?? 'scripts/gui-first-delivery-smoke.mjs';
const playwright = await findPlaywright();
if (!playwright) {
  console.log('E2E BLOCKED: Playwright not found. Install externally:  npx --yes playwright --version  (Chrome must be installed),');
  console.log('or set NEWDAW_PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs');
  process.exit(2);
}
await fs.mkdir(path.join(ROOT, '.test-output'), {recursive: true});
const r = run(process.execPath, [script], {env: {...process.env, NEWDAW_PLAYWRIGHT_MODULE: playwright}, timeout: 20 * 60 * 1000});
const out = r.stdout + '\n' + r.stderr;
const passes = out.split('\n').filter(l => l.startsWith('PASS '));
console.log(`E2E ${path.basename(script)}: ${passes.length} step(s) passed`);
for (const p of passes) console.log('  ' + p);
if (r.status !== 0) {
  const err = out.split('\n').filter(l => /Error|expected|actual|at file|gui-.*smoke\.mjs:\d+/.test(l)).slice(0, 12);
  console.log('FAIL: ' + (err[0] ?? 'see output'));
  for (const l of err.slice(1)) console.log('  ' + l.trim().slice(0, 220));
  if (script.includes('first-delivery')) {
    const rep = await readJson(path.join(ROOT, '.test-output/first-delivery-workflow.json'));
    if (rep) console.log(`  last passed step: ${rep.tests.at(-1) ?? '(none)'}; notice: ${rep.summary?.failureNotice ?? ''}; http errors: ${(rep.httpErrors ?? []).slice(0, 5).join(', ')}`);
    console.log('  screenshot: .test-output/first-delivery-failure.png  (open it to see the GUI at the failure)');
  }
  process.exit(1);
}
console.log('E2E PASS');
