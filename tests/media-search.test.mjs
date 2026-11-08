import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createProject } from '../src/core/engine.mjs';
import { encodeWav } from '../src/media/wav.mjs';
import { createMediaSearch, readMediaCandidate, MEDIA_SEARCH_LIMITS } from '../src/media-search.mjs';

const wav = ({ frames = 100, sampleRate = 48000, channels = 1, value = 0.25 } = {}) => Buffer.from(encodeWav({ sampleRate, channels: Array.from({ length: channels }, () => new Float32Array(frames).fill(value)) }));
const asset = (name, bytes, { id = 'asset-one', sampleRate = 48000, channels = 1, frames = 100 } = {}) => {
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  return { id, name, sha256, path: `assets/${sha256}.wav`, sampleRate, channels, frames };
};
async function fixture(t, targets) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'newdaw-media-search-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const project = createProject(); project.assets = targets ?? [asset('Piano.wav', wav())];
  return { dir, project, assetIds: project.assets.map(item => item.id) };
}
const search = (fixture, options = {}) => createMediaSearch({ project: fixture.project, assetIds: fixture.assetIds, location: fixture.dir, ...options });

test('case-sensitive name search distinguishes names while exact hashes remain discoverable', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.dir, 'piano.WAV'), wav({ value: 0.1 }));
  const insensitive = await search(f).done; assert.equal(insensitive.candidates.length, 1); assert.equal(insensitive.candidates[0].matches[0].match, 'name');
  const sensitive = await search(f, { caseSensitive: true }).done; assert.equal(sensitive.candidates.length, 0);
  await fs.writeFile(path.join(f.dir, 'renamed.wav'), wav());
  const exact = await search(f, { caseSensitive: true }).done; assert.equal(exact.candidates.length, 1); assert.equal(exact.candidates[0].matches[0].match, 'hash');
  assert.equal(exact.byAsset[0].exactCandidateIds.length, 1);
});

test('editable queryName searches the first target and preserves other target/hash discovery', async t => {
  const original = wav(), other = wav({ value: 0.45 });
  const f = await fixture(t, [asset('Original.wav', original), asset('Bass.wav', other, { id: 'asset-two' })]);
  await fs.writeFile(path.join(f.dir, 'New Name.wav'), wav({ value: 0.15 })); await fs.writeFile(path.join(f.dir, 'Bass.wav'), other);
  const result = await search(f, { queryName: 'New Name.wav' }).done;
  assert.equal(result.queryName, 'New Name.wav'); assert.equal(result.candidates.length, 2);
  assert.equal(result.candidates.find(item => item.name === 'New Name.wav').matches[0].assetId, 'asset-one');
  assert.equal(result.candidates.find(item => item.name === 'Bass.wav').matches[0].assetId, 'asset-two');
  const noWildcard = await search(f, { queryName: '*.wav' }).done;
  assert.equal(noWildcard.candidates.some(item => item.name === 'New Name.wav'), false);
});

test('file selection accepts another filename for first asset and exact-hash maps another target', async t => {
  const bytes = wav({ value: 0.7 });
  const f = await fixture(t, [asset('First.wav', wav()), asset('Second.wav', bytes, { id: 'asset-two' })]);
  const filename = path.join(f.dir, 'selected.data'); await fs.writeFile(filename, bytes);
  const job = search(f, { mode: 'file', location: filename }), result = await job.done;
  assert.equal(result.status, 'completed'); assert.equal(result.candidates.length, 1);
  assert.deepEqual(result.candidates[0].matches.map(item => [item.assetId, item.match]), [['asset-one', 'selected'], ['asset-two', 'hash']]);
  const read = await readMediaCandidate(job.getCandidate(result.candidates[0].id)); assert.deepEqual(read.bytes, bytes); assert.equal(read.channels, 1); assert.equal(read.frames, 100);
  assert.equal(job.getCandidate('unknown'), null);
  await assert.rejects(readMediaCandidate(result.candidates[0]), error => error.code === 'INVALID_CANDIDATE');
  await assert.rejects(readMediaCandidate({ path: filename, sha256: result.candidates[0].sha256 }), error => error.code === 'INVALID_CANDIDATE');
});

test('folder is direct-only, search recurses, duplicate candidates remain ambiguous', async t => {
  const f = await fixture(t); await fs.mkdir(path.join(f.dir, 'nested'));
  await fs.writeFile(path.join(f.dir, 'Piano.wav'), wav()); await fs.writeFile(path.join(f.dir, 'nested', 'Piano.wav'), wav());
  const folder = await search(f, { mode: 'folder' }).done; assert.equal(folder.candidates.length, 1); assert.equal(folder.recursive, false);
  const recursive = await search(f).done; assert.equal(recursive.candidates.length, 2); assert.equal(recursive.byAsset[0].ambiguous, true); assert.equal(recursive.byAsset[0].exactAmbiguous, true);
  assert.equal((await search(f, { recursive: false }).done).candidates.length, 1);
  assert.throws(() => search(f, { mode: 'folder', recursive: true }), error => error.code === 'INVALID_SEARCH');
});

test('exact hash maps all matching assets without selecting an ambiguous path automatically', async t => {
  const bytes = wav(), f = await fixture(t, [asset('One.wav', bytes), asset('Two.wav', bytes, { id: 'asset-two' })]);
  await fs.writeFile(path.join(f.dir, 'renamed-a.wav'), bytes); await fs.writeFile(path.join(f.dir, 'renamed-b.wav'), bytes);
  const result = await search(f).done;
  assert.equal(result.candidates.length, 2); assert.ok(result.candidates.every(item => item.matches.length === 2));
  assert.ok(result.byAsset.every(item => item.exactAmbiguous && item.exactCandidateIds.length === 2));
});

test('reread rejects changed bytes, same-bytes inode replacement and symlink substitution', async t => {
  const f = await fixture(t), filename = path.join(f.dir, 'Piano.wav'); await fs.writeFile(filename, wav());
  const first = search(f), result = await first.done, handle = first.getCandidate(result.candidates[0].id);
  await fs.writeFile(filename, wav({ value: 0.5 })); await assert.rejects(readMediaCandidate(handle), error => error.code === 'CANDIDATE_CHANGED');
  const second = search(f), secondResult = await second.done, secondHandle = second.getCandidate(secondResult.candidates[0].id);
  await fs.unlink(filename); await fs.writeFile(filename, wav({ value: 0.5 })); await assert.rejects(readMediaCandidate(secondHandle), error => error.code === 'CANDIDATE_CHANGED');
  const third = search(f), thirdResult = await third.done, thirdHandle = third.getCandidate(thirdResult.candidates[0].id), external = path.join(f.dir, 'external.bin');
  await fs.writeFile(external, wav({ value: 0.5 })); await fs.unlink(filename); await fs.symlink(external, filename);
  await assert.rejects(readMediaCandidate(thirdHandle), error => error.code === 'CANDIDATE_CHANGED' && error.status === 409); assert.deepEqual(await fs.readFile(external), wav({ value: 0.5 }));
});

test('deleted bound candidate reports a 409 conflict instead of a raw filesystem error', async t => {
  const f = await fixture(t), filename = path.join(f.dir, 'Piano.wav'); await fs.writeFile(filename, wav());
  const job = search(f), result = await job.done, handle = job.getCandidate(result.candidates[0].id);
  await fs.unlink(filename);
  await assert.rejects(readMediaCandidate(handle), error => error.code === 'CANDIDATE_CHANGED' && error.status === 409);
});

test('replaced candidate directory reports a 409 conflict and does not read its replacement', async t => {
  const f = await fixture(t), directory = path.join(f.dir, 'source'), filename = path.join(directory, 'Piano.wav');
  await fs.mkdir(directory); await fs.writeFile(filename, wav());
  const job = search(f), result = await job.done, handle = job.getCandidate(result.candidates[0].id);
  await fs.rename(directory, path.join(f.dir, 'preserved')); await fs.writeFile(directory, 'replacement directory entry');
  await assert.rejects(readMediaCandidate(handle), error => error.code === 'CANDIDATE_CHANGED' && error.status === 409);
  assert.equal(await fs.readFile(directory, 'utf8'), 'replacement directory entry');
});

test('permission loss on candidate file or directory reports a 422 unreadable result', async t => {
  if (process.getuid?.() === 0) return t.skip('Root bypasses ordinary filesystem permission checks.');
  const f = await fixture(t), directory = path.join(f.dir, 'source'), filename = path.join(directory, 'Piano.wav');
  await fs.mkdir(directory); await fs.writeFile(filename, wav());
  const first = search(f), firstResult = await first.done, firstHandle = first.getCandidate(firstResult.candidates[0].id);
  try {
    await fs.chmod(filename, 0);
    await assert.rejects(readMediaCandidate(firstHandle), error => error.code === 'CANDIDATE_UNREADABLE' && error.status === 422);
  } finally { await fs.chmod(filename, 0o600); }
  const second = search(f), secondResult = await second.done, secondHandle = second.getCandidate(secondResult.candidates[0].id);
  try {
    await fs.chmod(directory, 0);
    await assert.rejects(readMediaCandidate(secondHandle), error => error.code === 'CANDIDATE_UNREADABLE' && error.status === 422);
  } finally { await fs.chmod(directory, 0o700); }
});

test('file, directory and ancestor symlinks are refused; traversal does not follow child links', async t => {
  const f = await fixture(t), nested = path.join(f.dir, 'real'), alias = path.join(f.dir, 'alias');
  await fs.mkdir(nested); await fs.writeFile(path.join(nested, 'Piano.wav'), wav()); await fs.symlink(nested, alias);
  const viaAncestor = await search(f, { mode: 'file', location: path.join(alias, 'Piano.wav') }).done;
  assert.equal(viaAncestor.status, 'failed'); assert.equal(viaAncestor.errors[0].code, 'UNSAFE_SEARCH_PATH');
  const viaDirectory = await search(f, { location: alias }).done; assert.equal(viaDirectory.status, 'failed');
  const result = await search(f).done; assert.equal(result.candidates.length, 1); assert.ok(result.warnings.some(item => item.code === 'SYMLINK_SKIPPED'));
});

test('unsupported, malformed, empty, oversized and multichannel WAVs show explicit reasons', async t => {
  const f = await fixture(t);
  const cases = [
    ['broken.wav', Buffer.from('not a WAV'), 'UNSUPPORTED_WAV'],
    ['high.wav', wav({ sampleRate: 192000 }), 'UNSUPPORTED_CANDIDATE'],
    ['surround.wav', wav({ channels: 3 }), 'UNSUPPORTED_CANDIDATE'],
    ['empty.wav', wav({ frames: 0 }), 'UNSUPPORTED_CANDIDATE'],
  ];
  for (const [name, bytes] of cases) await fs.writeFile(path.join(f.dir, name), bytes);
  const result = await search(f).done; assert.equal(result.candidates.length, 0); assert.equal(result.status, 'completed');
  for (const [name, , code] of cases) assert.equal(result.errors.find(item => item.name === name).code, code);
  const huge = path.join(f.dir, 'huge.wav'), fd = await fs.open(huge, 'w'); await fd.truncate(MEDIA_SEARCH_LIMITS.maxFileBytes + 1); await fd.close();
  const limited = await search(f, { mode: 'file', location: huge }).done; assert.equal(limited.errors[0].code, 'CANDIDATE_TOO_LARGE'); assert.equal(limited.progress.bytesRead, 0);
});

test('frame compatibility permits exact rate conversion and diagnoses fractional/short sources', async t => {
  const original = wav({ frames: 48000 }), f = await fixture(t, [asset('Piano.wav', original, { frames: 48000 })]);
  f.project.tracks.push({ id: 'track-audio', type: 'audio', name: 'Audio', color: '#ffffff', gainDb: 0, pan: 0, mute: false, solo: false });
  f.project.clips.push({ id: 'clip-audio', type: 'audio', trackId: 'track-audio', name: 'Audio clip', assetId: 'asset-one', startSample: 0, offsetFrames: 24000, lengthFrames: 24000, gainDb: 0 });
  const filename = path.join(f.dir, 'Piano.wav'); await fs.writeFile(filename, wav({ sampleRate: 24000, frames: 24000 }));
  assert.equal((await search(f).done).candidates[0].matches[0].compatible, true);
  await fs.writeFile(filename, wav({ sampleRate: 24000, frames: 12000 }));
  assert.equal((await search(f).done).candidates[0].matches[0].reasons[0].code, 'AUDIO_OUT_OF_BOUNDS');
  f.project.clips[0].offsetFrames = 1; f.project.clips[0].lengthFrames = 24000;
  await fs.writeFile(filename, wav({ sampleRate: 24000, frames: 24000 }));
  assert.equal((await search(f).done).candidates[0].matches[0].reasons[0].code, 'ASSET_RATE_INCOMPATIBLE');
});

test('stop before starting and during traversal yields honest stopped partial results', async t => {
  const f = await fixture(t);
  const immediate = search(f); immediate.stop(); const immediateResult = await immediate.done;
  assert.equal(immediateResult.status, 'stopped'); assert.equal(immediateResult.progress.visitedEntries, 0);
  for (let i = 0; i < 80; i++) await fs.writeFile(path.join(f.dir, `${i}.wav`), wav());
  const running = search(f);
  while (running.snapshot().progress.scannedFiles < 2 && running.snapshot().status === 'running') await new Promise(resolve => setImmediate(resolve));
  running.stop(); const result = await running.done; assert.equal(result.status, 'stopped'); assert.ok(result.progress.scannedFiles < 80);
  assert.equal(result.stopRequested, true); assert.equal(result.errors.some(item => item.code === 'SEARCH_STOPPED'), false);
});

test('entry/file/candidate/byte/depth bounds are explicit and progress/results remain bounded', async t => {
  const f = await fixture(t); for (let i = 0; i < 5; i++) await fs.writeFile(path.join(f.dir, `${i}.wav`), wav());
  for (const [limits, code] of [[{ maxEntries: 1 }, 'SEARCH_ENTRY_LIMIT'], [{ maxFiles: 1 }, 'SEARCH_FILE_LIMIT'], [{ maxCandidates: 1 }, 'SEARCH_CANDIDATE_LIMIT'], [{ maxTotalBytes: 244 }, 'SEARCH_BYTE_LIMIT']]) {
    const result = await search(f, { limits }).done; assert.equal(result.truncated, true); assert.ok(result.warnings.some(item => item.code === code), JSON.stringify(result.warnings));
    assert.ok(result.candidates.length <= (limits.maxCandidates ?? MEDIA_SEARCH_LIMITS.maxCandidates));
  }
  await fs.mkdir(path.join(f.dir, 'one', 'two'), { recursive: true }); await fs.writeFile(path.join(f.dir, 'one', 'two', 'Piano.wav'), wav());
  const depth = await search(f, { limits: { maxDepth: 1 } }).done; assert.equal(depth.truncated, true); assert.ok(depth.warnings.some(item => item.code === 'SEARCH_DEPTH_LIMIT'));
});

test('search snapshots are detached and search/read do not modify source files or project', async t => {
  const f = await fixture(t), beforeProject = structuredClone(f.project), filename = path.join(f.dir, 'Piano.wav'); await fs.writeFile(filename, wav());
  const beforeBytes = await fs.readFile(filename), job = search(f), result = await job.done;
  result.candidates[0].path = '/forged'; result.candidates[0].matches[0].compatible = false; result.limits.maxFiles = 99;
  const fresh = job.snapshot(); assert.equal(fresh.candidates[0].path, await fs.realpath(filename)); assert.equal(fresh.candidates[0].matches[0].compatible, true);
  await readMediaCandidate(job.getCandidate(fresh.candidates[0].id)); assert.deepEqual(await fs.readFile(filename), beforeBytes); assert.deepEqual(f.project, beforeProject);
  assert.deepEqual(await fs.readdir(f.dir), ['Piano.wav']);
});

test('invalid options fail synchronously while missing filesystem roots fail as jobs', async t => {
  const f = await fixture(t);
  for (const options of [{ assetIds: [] }, { assetIds: ['unknown'] }, { assetIds: ['asset-one', 'asset-one'] }, { location: [f.dir] }, { mode: 'other' }, { queryName: '../Piano.wav' }, { caseSensitive: 'yes' }, { limits: { maxFiles: 2001 } }]) assert.throws(() => search(f, options));
  const missing = await search(f, { location: path.join(f.dir, 'missing') }).done; assert.equal(missing.status, 'failed'); assert.equal(missing.errors[0].code, 'ENOENT'); assert.equal(missing.candidates.length, 0);
});
