import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sovaroll-guard-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'scripts/agent'), { recursive: true });
  await fs.mkdir(path.join(root, 'docs/agent'), { recursive: true });
  await fs.mkdir(path.join(root, 'examples'));
  await fs.mkdir(path.join(root, 'tests'));
  for (const name of ['guard.mjs', 'lib.mjs', 'checkpoint.mjs']) {
    await fs.copyFile(new URL(`../scripts/agent/${name}`, import.meta.url), path.join(root, 'scripts/agent', name));
  }
  const requirements = Array.from({ length: 30 }, (_, i) => `| FD-${String(i + 1).padStart(2, '0')} | criterion |`).join('\n');
  await fs.writeFile(path.join(root, 'docs/agent/REQUIREMENTS.md'), requirements);
  await fs.writeFile(path.join(root, 'package.json'), '{}\n');
  await fs.writeFile(path.join(root, 'examples/protected.json'), '{"original":true}\n');
  await fs.writeFile(path.join(root, 'tests/example.test.mjs'), "test('preserved assertion', () => {});\n");
  const run = (script, ...args) => spawnSync(process.execPath, [`scripts/agent/${script}.mjs`, ...args], { cwd: root, encoding: 'utf8' });
  return { root, run, requirements };
}

test('public guard accepts a complete standalone product catalogue', async t => {
  const { run } = await fixture(t);
  assert.equal(run('guard', '--init').status, 0);
  const result = run('guard');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /GUARD PASS/);
});

test('public guard rejects a missing or duplicate acceptance ID', async t => {
  const { root, run, requirements } = await fixture(t);
  const file = path.join(root, 'docs/agent/REQUIREMENTS.md');
  for (const broken of [requirements.replace('FD-30', 'FD-29'), requirements.split('\n').slice(0, -1).join('\n')]) {
    await fs.writeFile(file, broken);
    const result = run('guard');
    assert.equal(result.status, 1);
    assert.match(result.stdout, /must keep FD-01 through FD-30 exactly once/);
    assert.equal(await fs.readFile(file, 'utf8'), broken, 'validation must not repair or overwrite evidence');
  }
});

test('public guard preserves fixture protection and test-deletion detection', async t => {
  const { root, run } = await fixture(t);
  assert.equal(run('guard', '--init').status, 0);
  assert.equal(run('checkpoint', 'save', 'baseline').status, 0);
  await fs.writeFile(path.join(root, 'examples/protected.json'), '{"original":false}\n');
  await fs.unlink(path.join(root, 'tests/example.test.mjs'));
  const result = run('guard');
  assert.equal(result.status, 1);
  assert.match(result.stdout, /protected file changed: examples\/protected.json/);
  assert.match(result.stdout, /test file deleted: tests\/example.test.mjs/);
});
