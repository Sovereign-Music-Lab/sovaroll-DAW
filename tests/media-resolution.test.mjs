import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { Engine, createProject } from '../src/core/engine.mjs';
import { encodeWav } from '../src/media/wav.mjs';
import { startServer } from '../src/server.mjs';

const exec = promisify(execFile), root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const wav = (frequency = 220, frames = 800, sampleRate = 8000) => Buffer.from(encodeWav({ sampleRate, channels: [Float32Array.from({ length: frames }, (_, i) => Math.sin(2 * Math.PI * frequency * i / sampleRate) * 0.2)] }));
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function fixture(t, { states = ['missing'], serverOptions = {} } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'newdaw-resolution-'));
  let server;
  const assets = [];
  t.after(async () => { await server?.close(); for (const asset of assets) if (asset.state === 'unreadable') await fs.chmod(asset.filename, 0o600).catch(() => {}); await fs.rm(directory, { recursive: true, force: true }); });
  const projectPath = path.join(directory, 'session.newdaw.json'), sources = path.join(directory, 'originals');
  await fs.mkdir(path.join(directory, 'assets')); await fs.mkdir(sources);
  const engine = new Engine(createProject({ name: 'Resolution fixture', sampleRate: 8000 }));
  const commands = [
    { command: 'track.add', arguments: { id: 'audio', type: 'audio' } },
    { command: 'track.add', arguments: { id: 'midi', type: 'midi' } },
    { command: 'clip.add', arguments: { id: 'midi-clip', type: 'midi', trackId: 'midi', notes: [{ id: 'note', pitch: 60, startTick: 0, durationTicks: 120, velocity: 80 }] } },
  ];
  for (const [index, state] of states.entries()) {
    const bytes = wav(220 + index * 53), sha256 = hash(bytes);
    const asset = { id: `asset-${index}`, name: `Original-${index}.wav`, path: `assets/${sha256}.wav`, sha256, sampleRate: 8000, channels: 1, frames: 800 };
    const filename = path.join(directory, asset.path), source = path.join(sources, asset.name);
    await fs.writeFile(source, bytes);
    if (state !== 'missing') await fs.writeFile(filename, state === 'changed' ? Buffer.from(`damaged-${index}`) : bytes);
    if (state === 'unsafe') { await fs.unlink(filename); await fs.symlink(source, filename); }
    if (state === 'unreadable') await fs.chmod(filename, 0);
    assets.push({ ...asset, bytes, filename, source, state });
    commands.push({ command: 'asset.add', arguments: { asset } });
    // Two users exercise shared source references; one starts at a nonzero source offset.
    for (let j = 0; j < 2; j++) commands.push({ command: 'clip.add', arguments: { id: `clip-${index}-${j}`, type: 'audio', trackId: 'audio', assetId: asset.id, startSample: j * 700, offsetFrames: j * 100, lengthFrames: 300 } });
  }
  const setup = engine.execute({ command: 'batch', arguments: { commands } }); assert.equal(setup.status, 'applied', JSON.stringify(setup.errors));
  await fs.writeFile(projectPath, JSON.stringify(engine.project, null, 2) + '\n');
  server = await startServer({ projectPath, port: 0, demo: false, quiet: true, ...serverOptions });
  const session = { directory, projectPath, sources, assets, get url() { return server.url; }, async reopen(options = {}) { await server.close(); server = await startServer({ projectPath, port: 0, demo: false, quiet: true, ...options }); } };
  return session;
}
async function get(s, route = '/api/state') { const response = await fetch(s.url + route); assert.equal(response.status, 200, await response.clone().text()); return response.json(); }
const guards = state => ({ expectedRevision: state.project.revision, expectedMediaRevision: state.mediaRevision });
async function post(s, route, body, headers = {}) { const response = await fetch(s.url + route, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }); return { status: response.status, body: await response.json() }; }
function success(result, status = 200) { assert.equal(result.status, status, JSON.stringify(result.body)); return result.body; }
function failure(result, status, code) { assert.equal(result.status, status, JSON.stringify(result.body)); assert.equal(result.body.applied, false); assert.equal(result.body.errors[0].code, code, JSON.stringify(result.body)); return result.body.errors[0]; }
async function command(s, name, args = {}) { const state = await get(s); return success(await post(s, '/api/command', { command: name, arguments: args, expectedRevision: state.project.revision })); }
async function waitSearch(s, id) {
  for (let i = 0; i < 200; i++) { const job = await get(s, `/api/media/search/${id}`); if (job.status !== 'running') return job; await sleep(5); }
  throw Error('Media search did not reach a terminal state');
}
async function search(s, options = {}) {
  const state = await get(s), asset = s.assets[0];
  const started = success(await post(s, '/api/media/search', { ...guards(state), assetId: asset.id, mode: 'file', location: asset.source, ...options }), 202);
  const job = await waitSearch(s, started.id); assert.equal(job.status, 'completed', JSON.stringify(job.errors)); return job;
}
async function plan(s, job, options = {}) {
  assert.ok(job.candidates.length, JSON.stringify(job));
  return success(await post(s, '/api/media/plan', { ...guards(await get(s)), searchId: job.id, candidateId: job.candidates[0].id, autoMap: false, ...options }));
}
const accept = async (s, planned, options = {}) => post(s, '/api/media/accept', { ...guards(await get(s)), planId: planned.id, ...options });
async function cli(s, ...args) { return JSON.parse((await exec(process.execPath, ['src/cli.mjs', ...args, '--url', s.url], { cwd: root, timeout: 10000 })).stdout); }
async function absent(filename) { await assert.rejects(fs.stat(filename), { code: 'ENOENT' }); }

test('search and preview are read-only; exact acceptance repairs bytes without a musical revision or history step', async t => {
  const s = await fixture(t), before = await get(s), disk = await fs.readFile(s.projectPath), files = (await fs.readdir(s.directory)).sort();
  const job = await search(s), preview = await plan(s, job);
  assert.equal(preview.requiresReplacementConsent, false); assert.equal(preview.rows[0].action, 'restore');
  assert.deepEqual(preview.rows[0].clipIds, ['clip-0-0', 'clip-0-1']);
  assert.deepEqual(await get(s), before); assert.deepEqual((await fs.readdir(s.directory)).sort(), files); await absent(s.assets[0].filename);
  const dry = success(await accept(s, preview, { dryRun: true })); assert.equal(dry.status, 'validated'); assert.equal(dry.applied, false); await absent(s.assets[0].filename);
  const repaired = success(await accept(s, preview)); assert.equal(repaired.applied, true); assert.equal(repaired.projectChanged, false); assert.equal(repaired.mediaRevision, before.mediaRevision + 1);
  const after = await get(s); assert.deepEqual(after.project, before.project); assert.deepEqual(after.historyView, before.historyView);
  assert.deepEqual(await fs.readFile(s.projectPath), disk); assert.deepEqual(await fs.readFile(s.assets[0].filename), s.assets[0].bytes); assert.deepEqual(await fs.readFile(s.assets[0].source), s.assets[0].bytes);
  assert.equal((await get(s, '/api/assets')).assets[0].status, 'ready');
});

test('replacement needs consent; dry-run writes nothing and a committed shared-source relink survives undo, reopen and redo', async t => {
  const s = await fixture(t, { states: ['changed'] }), before = await get(s), disk = await fs.readFile(s.projectPath), oldBytes = await fs.readFile(s.assets[0].filename);
  const replacement = wav(671), candidate = path.join(s.sources, 'Different.wav'); await fs.writeFile(candidate, replacement);
  const preview = await plan(s, await search(s, { location: candidate })); assert.equal(preview.requiresReplacementConsent, true);
  failure(await accept(s, preview), 409, 'REPLACEMENT_CONFIRMATION_REQUIRED');
  const newPath = path.join(s.directory, `assets/${hash(replacement)}.wav`);
  const dry = success(await accept(s, preview, { allowReplacement: true, dryRun: true })); assert.equal(dry.applied, false); await absent(newPath); assert.deepEqual(await fs.readFile(s.projectPath), disk);
  const applied = success(await accept(s, preview, { allowReplacement: true })); assert.equal(applied.projectChanged, true); assert.equal(applied.projectRevision, before.project.revision + 1);
  let state = await get(s); assert.equal(state.historyView.entries.length, 1); assert.equal(state.historyView.entries[0].action, 'asset.relink');
  assert.equal(state.project.assets[0].id, before.project.assets[0].id); assert.equal(state.project.assets[0].sha256, hash(replacement)); assert.deepEqual(state.project.clips, before.project.clips);
  assert.deepEqual(await fs.readFile(s.assets[0].filename), oldBytes); assert.deepEqual(await fs.readFile(newPath), replacement); assert.deepEqual(await fs.readFile(candidate), replacement);
  await command(s, 'history.undo'); state = await get(s); assert.deepEqual(state.project.assets, before.project.assets); assert.deepEqual(state.project.clips, before.project.clips);
  await s.reopen(); assert.equal((await get(s)).history.canRedo, true); await command(s, 'history.redo');
  assert.equal((await get(s)).project.assets[0].sha256, hash(replacement)); assert.deepEqual(await fs.readFile(newPath), replacement);
});

test('Accept auto-maps other missing exact originals and tolerates duplicate files with identical hashes', async t => {
  const s = await fixture(t, { states: ['missing', 'missing', 'missing'] });
  await fs.copyFile(s.assets[1].source, path.join(s.sources, 'Second copy.wav'));
  // A different-content name match is a candidate, never automatic replacement consent.
  await fs.writeFile(s.assets[2].source, wav(913));
  const before = await get(s), preview = await plan(s, await search(s), { autoMap: true });
  assert.deepEqual(preview.rows.map(row => row.assetId), ['asset-0', 'asset-1']); assert.equal(preview.rows[1].automatic, true);
  assert.equal(preview.requiresReplacementConsent, false); assert.deepEqual(preview.unresolved.map(row => row.assetId), ['asset-2']);
  const applied = success(await accept(s, preview)); assert.equal(applied.projectChanged, false); assert.equal(applied.repairs.length, 2);
  assert.deepEqual((await get(s)).project, before.project); assert.deepEqual(await fs.readFile(s.assets[1].filename), s.assets[1].bytes); await absent(s.assets[2].filename);
  assert.equal((await get(s, '/api/assets')).assets.find(a => a.id === 'asset-2').status, 'missing');
});

test('candidate replacement after preview is refused before any media or project publication', async t => {
  const s = await fixture(t), preview = await plan(s, await search(s)), before = await get(s), disk = await fs.readFile(s.projectPath);
  const replacement = path.join(s.sources, 'replacement.tmp'); await fs.writeFile(replacement, s.assets[0].bytes); await fs.rename(replacement, s.assets[0].source);
  failure(await accept(s, preview), 409, 'CANDIDATE_CHANGED'); await absent(s.assets[0].filename);
  assert.deepEqual((await get(s)).project, before.project); assert.equal((await get(s)).mediaRevision, before.mediaRevision); assert.deepEqual(await fs.readFile(s.projectPath), disk);
});

test('search, preview, accept and remove reject stale project revisions without altering later edits', async t => {
  const s = await fixture(t), old = await get(s), job = await search(s), preview = await plan(s, job);
  await command(s, 'project.rename', { name: 'User later edit' }); const latest = await get(s);
  const calls = [
    ['/api/media/search', { assetId: 'asset-0', mode: 'file', location: s.assets[0].source }],
    ['/api/media/plan', { searchId: job.id, candidateId: job.candidates[0].id }],
    ['/api/media/accept', { planId: preview.id }],
    ['/api/media/remove-missing', { expectedAssetIds: ['asset-0'] }],
  ];
  for (const [route, args] of calls) failure(await post(s, route, { ...guards(old), ...args }), 409, 'REVISION_CONFLICT');
  // Even fresh client guards cannot make an old search/plan current.
  failure(await post(s, '/api/media/plan', { ...guards(latest), searchId: job.id, candidateId: job.candidates[0].id }), 409, 'REVISION_CONFLICT');
  failure(await accept(s, preview), 409, 'REVISION_CONFLICT'); assert.equal((await get(s, `/api/media/search/${job.id}`)).stale, true);
  assert.deepEqual((await get(s)).project, latest.project); await absent(s.assets[0].filename);
});

test('physical repair invalidates other search plans through mediaRevision while project revision stays fixed', async t => {
  const s = await fixture(t, { states: ['missing', 'missing'] }), before = await get(s);
  const a = await plan(s, await search(s)), jobB = await search(s, { assetId: 'asset-1', location: s.assets[1].source }), b = await plan(s, jobB);
  success(await accept(s, a)); const after = await get(s); assert.equal(after.project.revision, before.project.revision); assert.equal(after.mediaRevision, 1);
  failure(await post(s, '/api/media/accept', { ...guards(before), planId: b.id }), 409, 'REVISION_CONFLICT');
  failure(await accept(s, b), 409, 'REVISION_CONFLICT'); assert.equal((await get(s, `/api/media/search/${jobB.id}`)).stale, true); await absent(s.assets[1].filename);
});

test('Remove Missing removes all missing shared users, excludes changed and unsafe assets, and undoes after restart', async t => {
  const s = await fixture(t, { states: ['missing', 'missing', 'changed', 'unsafe', 'ready'] }), before = await get(s);
  const changed = await fs.readFile(s.assets[2].filename), ready = await fs.readFile(s.assets[4].filename);
  const inventory = await get(s, '/api/assets'); assert.deepEqual(inventory.assets.map(a => a.status), ['missing', 'missing', 'changed', 'unsafe', 'ready']);
  const input = { ...guards(before), expectedAssetIds: ['asset-1', 'asset-0'] };
  const dry = success(await post(s, '/api/media/remove-missing', { ...input, dryRun: true })); assert.equal(dry.status, 'validated'); assert.deepEqual((await get(s)).project, before.project);
  const removed = success(await post(s, '/api/media/remove-missing', input));
  assert.deepEqual(removed.changes.removedMissing.assetIds, ['asset-0', 'asset-1']); assert.equal(removed.changes.removedMissing.clipCount, 4);
  const after = await get(s); assert.equal(after.project.revision, before.project.revision + 1); assert.equal(after.mediaRevision, before.mediaRevision);
  assert.deepEqual(after.project.tracks, before.project.tracks); assert.ok(after.project.clips.some(c => c.id === 'midi-clip')); assert.equal(after.project.assets.length, 3);
  assert.deepEqual(await fs.readFile(s.assets[2].filename), changed); assert.deepEqual(await fs.readFile(s.assets[4].filename), ready); assert.equal((await fs.lstat(s.assets[3].filename)).isSymbolicLink(), true);
  await s.reopen(); await command(s, 'history.undo'); const restored = await get(s); assert.deepEqual(restored.project.assets, before.project.assets); assert.deepEqual(restored.project.clips, before.project.clips);
  await command(s, 'history.redo'); assert.equal((await get(s)).project.assets.length, 3);
});

test('Remove Missing keeps unreadable regular files instead of misclassifying them as missing', async t => {
  if (process.getuid?.() === 0) { t.skip('Root can read mode-000 files; this permission fixture needs an unprivileged process.'); return; }
  const s = await fixture(t, { states: ['missing', 'unreadable'] }), before = await get(s), inventory = await get(s, '/api/assets');
  assert.equal(inventory.assets[1].status, 'unreadable');
  success(await post(s, '/api/media/remove-missing', { ...guards(before), expectedAssetIds: ['asset-0'] }));
  const after = await get(s); assert.deepEqual(after.project.assets.map(a => a.id), ['asset-1']); assert.equal(after.project.clips.filter(c => c.type === 'audio').length, 2);
  assert.ok((await fs.stat(s.assets[1].filename)).isFile()); await fs.chmod(s.assets[1].filename, 0o600); assert.deepEqual(await fs.readFile(s.assets[1].filename), s.assets[1].bytes);
});

test('Remove Missing rechecks the full set when a file reappears outside the session', async t => {
  const s = await fixture(t, { states: ['missing', 'missing'] }), before = await get(s);
  await fs.writeFile(s.assets[0].filename, s.assets[0].bytes);
  failure(await post(s, '/api/media/remove-missing', { ...guards(before), expectedAssetIds: ['asset-0', 'asset-1'] }), 409, 'MISSING_SET_CHANGED');
  failure(await post(s, '/api/media/remove-missing', { ...guards(before), expectedAssetIds: ['asset-1', 'asset-1'] }), 409, 'MISSING_SET_CHANGED');
  assert.deepEqual((await get(s)).project, before.project); assert.deepEqual(await fs.readFile(s.assets[0].filename), s.assets[0].bytes);
});

test('generic command entry points cannot bypass trusted asset checks, including nested batches and dry runs', async t => {
  const s = await fixture(t), before = await get(s), asset = before.project.assets[0];
  const forbidden = [
    { command: 'asset.add', arguments: { asset: { ...asset, id: 'injected' } } },
    { command: 'asset.relink', arguments: { mappings: [{ assetId: asset.id, sha256: asset.sha256, path: asset.path, frames: 800, sampleRate: 8000, channels: 1 }] } },
    { command: 'asset.removeMissing', arguments: { assetIds: [asset.id] } },
  ];
  for (const item of forbidden) for (const command of [item, { command: 'batch', arguments: { commands: [{ command: 'project.rename', arguments: { name: 'Must not commit' } }, item] } }, { command: 'batch', arguments: { commands: [{ command: 'batch', arguments: { commands: [item] } }] } }]) for (const dryRun of [false, true]) {
    failure(await post(s, '/api/command', { ...command, expectedRevision: before.project.revision, dryRun, internal: true }), 422, 'ASSET_IMPORT_REQUIRED');
  }
  assert.deepEqual((await get(s)).project, before.project); assert.deepEqual((await get(s)).historyView, before.historyView); await absent(s.assets[0].filename);
});

test('search supports editable literal names and optional case matching without accepting filename-only content automatically', async t => {
  const s = await fixture(t), other = wav(739), candidate = path.join(s.sources, 'renamed.wav'); await fs.writeFile(candidate, other);
  // Remove exact-hash originals so the case check cannot match through stronger hash identity.
  await fs.unlink(s.assets[0].source);
  const sensitive = await search(s, { mode: 'search', location: s.sources, queryName: 'Renamed.wav', caseSensitive: true }); assert.equal(sensitive.candidates.length, 0);
  const insensitive = await search(s, { mode: 'search', location: s.sources, queryName: 'Renamed.wav', caseSensitive: false }); assert.equal(insensitive.candidates.length, 1);
  const preview = await plan(s, insensitive); assert.equal(preview.requiresReplacementConsent, true); assert.equal(preview.rows[0].exactHash, false);
  failure(await accept(s, preview), 409, 'REPLACEMENT_CONFIRMATION_REQUIRED'); await absent(s.assets[0].filename);
});

test('Stop ends a real in-flight directory search and no later candidates or writes appear', async t => {
  const s = await fixture(t), folder = path.join(s.directory, 'many'); await fs.mkdir(folder);
  await Promise.all(Array.from({ length: 300 }, (_, i) => fs.writeFile(path.join(folder, `copy-${i}.wav`), s.assets[0].bytes)));
  const before = await get(s), started = success(await post(s, '/api/media/search', { ...guards(before), assetId: 'asset-0', mode: 'search', location: folder }), 202);
  assert.equal(started.status, 'running'); success(await post(s, `/api/media/search/${started.id}/stop`, {}));
  const stopped = await waitSearch(s, started.id); assert.equal(stopped.status, 'stopped'); assert.equal(stopped.stopRequested, true);
  await sleep(20); const again = await get(s, `/api/media/search/${started.id}`); assert.deepEqual(again.candidates, stopped.candidates); assert.deepEqual(again.progress, stopped.progress);
  assert.deepEqual((await get(s)).project, before.project); await absent(s.assets[0].filename);
});

test('invalid guards and unknown paths or handles never become successful resolution plans', async t => {
  const s = await fixture(t), before = await get(s), base = { ...guards(before), assetId: 'asset-0', location: s.assets[0].source, mode: 'file' };
  failure(await post(s, '/api/media/search', { ...base, expectedMediaRevision: undefined }), 422, 'EXPECTED_REVISION_REQUIRED');
  failure(await post(s, '/api/media/search', { ...base, unexpected: true }), 422, 'INVALID_RESOLUTION_OPTIONS');
  const invalid = success(await post(s, '/api/media/search', { ...base, location: path.join(s.sources, 'absent.wav') }), 202), failed = await waitSearch(s, invalid.id);
  assert.equal(failed.status, 'failed'); assert.equal(failed.candidates.length, 0);
  failure(await post(s, '/api/media/plan', { ...guards(before), searchId: invalid.id, candidateId: 'invented' }), 404, 'CANDIDATE_NOT_FOUND');
  failure(await post(s, '/api/media/accept', { ...guards(before), planId: 'invented' }), 404, 'PLAN_NOT_FOUND');
  assert.deepEqual((await get(s)).project, before.project); await absent(s.assets[0].filename);
});

test('too-short replacement fails at preview without staging media or altering shared clips', async t => {
  const s = await fixture(t), before = await get(s), candidate = path.join(s.sources, 'Too short.wav'); await fs.writeFile(candidate, wav(812, 100));
  const job = await search(s, { location: candidate });
  failure(await post(s, '/api/media/plan', { ...guards(before), searchId: job.id, candidateId: job.candidates[0].id }), 422, 'AUDIO_OUT_OF_BOUNDS');
  assert.deepEqual((await get(s)).project, before.project); assert.deepEqual(await fs.readdir(path.join(s.directory, 'assets')), []);
});

test('real CLI search/status/plan/accept and Remove Missing share the guarded server workflow', async t => {
  const s = await fixture(t, { states: ['missing', 'missing'] });
  const started = await cli(s, 'media-search', JSON.stringify({ assetId: 'asset-0', mode: 'file', location: s.assets[0].source }));
  await waitSearch(s, started.id); const job = await cli(s, 'media-search-status', started.id); assert.equal(job.status, 'completed');
  assert.equal((await cli(s, 'media-search-stop', started.id)).status, 'completed');
  const preview = await cli(s, 'media-plan', JSON.stringify({ searchId: job.id, candidateId: job.candidates[0].id, autoMap: false }));
  assert.equal((await cli(s, 'media-accept', preview.id, '--dry-run')).status, 'validated'); await absent(s.assets[0].filename);
  const before = await get(s), applied = await cli(s, 'media-accept', preview.id); assert.equal(applied.projectChanged, false); assert.equal((await get(s)).project.revision, before.project.revision);
  const dry = await cli(s, 'remove-missing', '--dry-run'); assert.equal(dry.status, 'validated'); assert.deepEqual(dry.changes.removedMissing.assetIds, ['asset-1']);
  const removed = await cli(s, 'remove-missing'); assert.equal(removed.changes.removedMissing.clipCount, 2); assert.deepEqual((await get(s)).project.assets.map(a => a.id), ['asset-0']);
});

test('failed project persistence reports retained source copies and never claims the replacement committed', async t => {
  const s = await fixture(t, { serverOptions: { persistProject: async () => { throw Error('injected project persistence failure'); } } });
  const before = await get(s), disk = await fs.readFile(s.projectPath), replacement = wav(987), source = path.join(s.sources, 'New.wav'); await fs.writeFile(source, replacement);
  const preview = await plan(s, await search(s, { location: source }));
  const error = failure(await accept(s, preview, { allowReplacement: true }), 500, 'SAVE_FAILED');
  assert.equal(error.details.projectCommitted, false); assert.deepEqual(error.details.retainedCopies, [`assets/${hash(replacement)}.wav`]);
  const after = await get(s); assert.deepEqual(after.project, before.project); assert.deepEqual(after.historyView, before.historyView); assert.equal(after.mediaRevision, before.mediaRevision + 1);
  assert.deepEqual(await fs.readFile(s.projectPath), disk); assert.deepEqual(await fs.readFile(path.join(s.directory, error.details.retainedCopies[0])), replacement); assert.deepEqual(await fs.readFile(source), replacement);
  await s.reopen(); assert.deepEqual((await get(s)).project, before.project); assert.equal((await get(s)).history.canUndo, false);
});

test('more than 1000 missing assets still permit explicitly selected file discovery with a bounded warning', async t => {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'newdaw-many-missing-'));
  let server;t.after(async()=>{await server?.close();await fs.rm(directory,{recursive:true,force:true});});
  const bytes=wav(),sha256=hash(bytes),project=createProject({name:'Many missing'});
  project.assets=Array.from({length:1001},(_,i)=>({id:`asset-${i}`,name:`Source-${i}.wav`,path:`assets/${sha256}.wav`,sha256,sampleRate:8000,channels:1,frames:800}));
  const projectPath=path.join(directory,'session.newdaw.json'),source=path.join(directory,'chosen.wav');
  await fs.writeFile(projectPath,JSON.stringify(project));await fs.writeFile(source,bytes);
  server=await startServer({projectPath,port:0,quiet:true});const s={url:server.url};
  const started=success(await post(s,'/api/media/search',{...guards(await get(s)),assetId:'asset-1000',mode:'file',location:source}),202);
  const result=await waitSearch(s,started.id);assert.equal(result.status,'completed');assert.equal(result.assetIds.length,1000);assert.equal(result.assetIds[0],'asset-1000');assert.ok(result.warnings.some(w=>w.code==='SEARCH_TARGET_LIMIT'));
  assert.ok(result.candidates[0].matches.some(m=>m.assetId==='asset-1000'));assert.deepEqual((await get(s)).project,project);
});
