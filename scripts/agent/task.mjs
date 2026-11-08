#!/usr/bin/env node
// Task queue for agents. Source of truth: docs/agent/tasks.json. Log: docs/agent/task-log.jsonl.
//   node scripts/agent/task.mjs list [--all]          → open tasks by priority (todo/doing/blocked)
//   node scripts/agent/task.mjs next                  → the single task to work on now
//   node scripts/agent/task.mjs show ID               → full task card (goal, files, acceptance, verify commands)
//   node scripts/agent/task.mjs start ID              → mark doing (only one task may be doing)
//   node scripts/agent/task.mjs done ID --evidence "verify PASS; tests X; E2E PASS"   → requires evidence text
//   node scripts/agent/task.mjs block ID --reason "why, what was tried"
//   node scripts/agent/task.mjs add --json '{"id":"T-123","title":"...","priority":3,...}'   → append a task (follow-up you discovered)
import path from 'node:path';
import {promises as fs} from 'node:fs';
import {ROOT, readJson, writeJson} from './lib.mjs';

const file = path.join(ROOT, 'docs/agent/tasks.json'), log = path.join(ROOT, 'docs/agent/task-log.jsonl');
const [action = 'next', id, ...rest] = process.argv.slice(2);
const opt = name => { const all = [id, ...rest]; const i = all.indexOf(name); return i >= 0 ? all[i + 1] : undefined; };
const data = await readJson(file);
if (!data?.tasks) { console.error('docs/agent/tasks.json missing or invalid.'); process.exit(2); }
const order = t => [{doing: 0, todo: 1, blocked: 2, done: 3}[t.status] ?? 4, t.priority ?? 9, t.id];
const sorted = [...data.tasks].sort((a, b) => { const x = order(a), y = order(b); return x[0] - y[0] || x[1] - y[1] || String(x[2]).localeCompare(String(y[2])); });
const find = key => data.tasks.find(t => t.id === key) ?? (console.error(`No task ${key}.`), process.exit(2));
const line = t => `${t.id.padEnd(8)} [${t.status}] P${t.priority} ${t.title}${t.requirements?.length ? `  (${t.requirements.join(',')})` : ''}`;
const card = t => [
  `# ${t.id} — ${t.title}`, `status: ${t.status} · priority: P${t.priority} · area: ${t.area} · size: ${t.size ?? '?'}`,
  t.requirements?.length ? `requirements: ${t.requirements.join(', ')}  (see docs/agent/REQUIREMENTS.md)` : null,
  '', '## Goal', t.goal, '', '## Context', ...(t.context ?? []).map(c => `- ${c}`), '', '## Files to read first', ...(t.files ?? []).map(f => `- ${f}`),
  '', '## Acceptance criteria (all must hold)', ...(t.acceptance ?? []).map((a, i) => `${i + 1}. ${a}`), '', '## Verify', ...(t.verify ?? []).map(v => `- ${v}`),
  ...(t.notes?.length ? ['', '## Notes', ...t.notes.map(n => `- ${n}`)] : []), ...(t.evidence ? ['', `## Evidence\n${t.evidence}`] : []), ...(t.blockedReason ? ['', `## Blocked\n${t.blockedReason}`] : []),
].filter(x => x !== null).join('\n');
async function save(entry) { data.updatedAt = new Date().toISOString(); await writeJson(file, data); await fs.appendFile(log, JSON.stringify({at: data.updatedAt, ...entry}) + '\n'); }

if (action === 'list') { for (const t of sorted.filter(t => process.argv.includes('--all') || t.status !== 'done')) console.log(line(t)); }
else if (action === 'next') {
  const t = sorted.find(t => t.status === 'doing') ?? sorted.find(t => t.status === 'todo' && (t.dependsOn ?? []).every(d => data.tasks.find(x => x.id === d)?.status === 'done'));
  console.log(t ? card(t) : 'No open task. Add follow-ups with: task.mjs add --json ...  or ask the human.');
}
else if (action === 'show') console.log(card(find(id)));
else if (action === 'start') {
  const t = find(id), other = data.tasks.find(x => x.status === 'doing' && x.id !== id);
  if (other) { console.error(`${other.id} is already doing. Finish (done) or block it first.`); process.exit(1); }
  const unmet = (t.dependsOn ?? []).filter(d => data.tasks.find(x => x.id === d)?.status !== 'done');
  if (unmet.length) { console.error(`Depends on unfinished: ${unmet.join(', ')}`); process.exit(1); }
  t.status = 'doing'; t.startedAt = new Date().toISOString(); await save({id, action}); console.log(`STARTED ${id}. Next: npm run agent:checkpoint -- save "${id} start"`);
}
else if (action === 'done') {
  const t = find(id), evidence = opt('--evidence');
  if (!evidence || evidence.length < 12) { console.error('done needs --evidence "what passed" (verify output, test names, E2E result).'); process.exit(1); }
  const last = await readJson(path.join(ROOT, '.agent/last-verify.json'));
  if (!last || last.verdict !== 'PASS') { console.error('Last verify is not PASS. Run: npm run agent:verify (and agent:e2e for GUI work) first.'); process.exit(1); }
  t.status = 'done'; t.evidence = evidence; t.doneAt = new Date().toISOString(); await save({id, action, evidence, verify: last.verdict}); console.log(`DONE ${id}`);
}
else if (action === 'block') { const t = find(id), reason = opt('--reason'); if (!reason) { console.error('block needs --reason'); process.exit(1); } t.status = 'blocked'; t.blockedReason = reason; await save({id, action, reason}); console.log(`BLOCKED ${id}`); }
else if (action === 'add') {
  const json = opt('--json'); let t; try { t = JSON.parse(json); } catch { console.error('add needs --json with a task object'); process.exit(1); }
  for (const k of ['id', 'title', 'goal', 'acceptance', 'verify']) if (!t[k]) { console.error(`task needs "${k}"`); process.exit(1); }
  if (data.tasks.some(x => x.id === t.id)) { console.error(`duplicate id ${t.id}`); process.exit(1); }
  data.tasks.push({status: 'todo', priority: 5, area: 'misc', ...t}); await save({id: t.id, action}); console.log(`ADDED ${t.id}`);
}
else { console.error('Usage: task.mjs list|next|show ID|start ID|done ID --evidence TEXT|block ID --reason TEXT|add --json JSON'); process.exit(2); }
