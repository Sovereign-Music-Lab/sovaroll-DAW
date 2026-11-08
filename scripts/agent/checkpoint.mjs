#!/usr/bin/env node
// Snapshot / compare / restore the editable source trees (see TRACKED in lib.mjs).
//   node scripts/agent/checkpoint.mjs save "short label"   → creates .agent/checkpoints/<id>/
//   node scripts/agent/checkpoint.mjs list
//   node scripts/agent/checkpoint.mjs diff [ID]            → files changed since ID (default latest)
//   node scripts/agent/checkpoint.mjs restore ID --yes     → put changed/removed files back, delete added files
//   node scripts/agent/checkpoint.mjs restore ID --file src/x.mjs --yes   → restore one file only
// Restore first saves an automatic "pre-restore" checkpoint, so a restore can itself be undone.
import {promises as fs, existsSync} from 'node:fs';
import path from 'node:path';
import {ROOT, CHECKPOINT_DIR, TRACKED, hashTree, diffMaps, walk, rel, writeJson, listCheckpoints, latestCheckpoint} from './lib.mjs';

const [action = 'list', ...rest] = process.argv.slice(2);
const flag = name => rest.includes(name);
const option = name => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };

async function save(label) {
  const id = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '') + '-' + Math.random().toString(36).slice(2, 6);
  const dir = path.join(CHECKPOINT_DIR, id), filesDir = path.join(dir, 'files');
  const files = {};
  for (const root of TRACKED) for (const f of await walk(root)) {
    const r = rel(f), bytes = await fs.readFile(f);
    const target = path.join(filesDir, r);
    await fs.mkdir(path.dirname(target), {recursive: true});
    await fs.writeFile(target, bytes);
  }
  Object.assign(files, await hashTree(TRACKED));
  await writeJson(path.join(dir, 'manifest.json'), {label: label || '(no label)', createdAt: new Date().toISOString(), fileCount: Object.keys(files).length, files});
  // keep the newest 30 checkpoints
  const all = await listCheckpoints();
  for (const old of all.slice(0, Math.max(0, all.length - 30))) await fs.rm(path.join(CHECKPOINT_DIR, old.id), {recursive: true, force: true});
  console.log(`CHECKPOINT ${id} saved (${Object.keys(files).length} files) — ${label || ''}`);
  return id;
}

async function resolve(id) {
  const cp = id ? (await listCheckpoints()).find(c => c.id === id) : await latestCheckpoint();
  if (!cp) { console.error(id ? `No checkpoint ${id}. Run: node scripts/agent/checkpoint.mjs list` : 'No checkpoint yet. Run: node scripts/agent/checkpoint.mjs save "label"'); process.exit(2); }
  return cp;
}

if (action === 'save') await save(rest.filter(a => !a.startsWith('--')).join(' '));
else if (action === 'list') {
  const all = await listCheckpoints();
  if (!all.length) console.log('No checkpoints.');
  for (const c of all) console.log(`${c.id}  ${c.fileCount} files  ${c.label}`);
} else if (action === 'diff') {
  const cp = await resolve(rest.find(a => !a.startsWith('--')));
  const d = diffMaps(cp.files, await hashTree(TRACKED));
  console.log(`Since checkpoint ${cp.id} (${cp.label}):`);
  for (const [k, list] of Object.entries(d)) for (const f of list) console.log(`  ${k.padEnd(7)} ${f}`);
  if (!d.added.length && !d.removed.length && !d.changed.length) console.log('  (no changes)');
} else if (action === 'restore') {
  const id = rest.find(a => !a.startsWith('--') && a !== option('--file'));
  const cp = await resolve(id);
  if (!id) { console.error('restore needs an explicit checkpoint ID.'); process.exit(2); }
  const d = diffMaps(cp.files, await hashTree(TRACKED));
  const only = option('--file');
  const restoreList = [...d.changed, ...d.removed].filter(f => !only || f === only);
  const deleteList = d.added.filter(f => !only || f === only);
  console.log(`Restore from ${cp.id}: ${restoreList.length} file(s) to put back, ${deleteList.length} added file(s) to delete.`);
  for (const f of restoreList) console.log(`  restore ${f}`);
  for (const f of deleteList) console.log(`  delete  ${f}`);
  if (!flag('--yes')) { console.log('Dry run. Add --yes to apply.'); process.exit(0); }
  await save(`pre-restore of ${cp.id}`);
  for (const f of restoreList) { const src = path.join(CHECKPOINT_DIR, cp.id, 'files', f), dst = path.join(ROOT, f); await fs.mkdir(path.dirname(dst), {recursive: true}); await fs.copyFile(src, dst); }
  for (const f of deleteList) if (existsSync(path.join(ROOT, f))) await fs.rm(path.join(ROOT, f));
  console.log('RESTORED.');
} else {
  console.error('Usage: checkpoint.mjs save "label" | list | diff [ID] | restore ID [--file PATH] --yes');
  process.exit(2);
}
