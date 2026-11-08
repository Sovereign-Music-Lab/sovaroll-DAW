import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createProject } from '../src/core/engine.mjs';
import { encodeWav } from '../src/media/wav.mjs';
import { registerCreatedMedia, captureMediaOwnership, planRevertMedia, applyRevertMediaPlan, listRevertMediaTrash, restoreRevertMediaTrash } from '../src/revert-media.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const writeJSON = (filename, value) => fs.writeFile(filename, `${JSON.stringify(value)}\n`);
const exists = async filename => { try { await fs.lstat(filename); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
async function fixture(t) {
  const directory = await fs.mkdtemp('/private/tmp/newdaw-revert-');
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const projectPath = path.join(directory, 'Session.newdaw.json'), saved = createProject({ name: 'Saved' });
  await fs.mkdir(path.join(directory, 'assets')); await writeJSON(projectPath, saved);
  return { directory, projectPath, saved, current: structuredClone(saved) };
}
async function publish(s, id, value = 0.1, { register = true, inPool = true } = {}) {
  const bytes = Buffer.from(encodeWav({ sampleRate: 8000, channels: [new Float32Array(80).fill(value)] })), sha256 = hash(bytes);
  const asset = { id, name: `${id}.wav`, sha256, path: `assets/${sha256}.wav`, sampleRate: 8000, channels: 1, frames: 80 };
  await fs.writeFile(path.join(s.directory, asset.path), bytes);
  const ownership = register ? await registerCreatedMedia(s.projectPath, asset) : null;
  if (inPool) s.current.assets.push(asset);
  return { asset, bytes, ownership };
}
const plan = (s, baseline = []) => planRevertMedia(s.projectPath, s.current, s.saved, { savedOwnershipIds: baseline });
const commitRevert = s => writeJSON(s.projectPath, { ...s.saved, revision: s.current.revision + 1 });
async function files(directory, prefix = '') {
  const result = {};
  for (const name of (await fs.readdir(directory)).sort()) {
    const filename = path.join(directory, name), relative = path.join(prefix, name), stat = await fs.lstat(filename);
    if (stat.isDirectory()) Object.assign(result, await files(filename, relative));
    else result[relative] = stat.isSymbolicLink() ? `link:${await fs.readlink(filename)}` : hash(await fs.readFile(filename));
  }
  return result;
}

test('ownership is explicit, verified, idempotent and persisted before the asset enters the project Pool', async t => {
  const s = await fixture(t), emptyFiles = await files(s.directory);
  assert.deepEqual((await captureMediaOwnership(s.projectPath)).ownershipIds, []);
  assert.deepEqual(await files(s.directory), emptyFiles);
  const a = await publish(s, 'new-source');
  assert.equal(JSON.parse(await fs.readFile(s.projectPath)).assets.length, 0);
  const again = await registerCreatedMedia(s.projectPath, a.asset);
  assert.equal(again.status, 'unchanged'); assert.equal(again.ownershipId, a.ownership.ownershipId);
  const captured = await captureMediaOwnership(s.projectPath);
  assert.equal(captured.projectId, s.saved.id); assert.deepEqual(captured.ownershipIds, [again.ownershipId]);
  const restarted = await import(`../src/revert-media.mjs?ledger-restart=${Date.now()}`);
  assert.deepEqual((await restarted.captureMediaOwnership(s.projectPath)).ownershipIds, captured.ownershipIds);
  const ledger = JSON.parse(await fs.readFile(`${s.projectPath}.media-ownership.json`));
  assert.equal(ledger.entries[0].bytes, a.bytes.length); assert.ok(ledger.entries[0].identity.ino); assert.equal(ledger.projectFile, 'Session.newdaw.json');
});

test('registration rejects forged hashes, metadata, traversal and unsafe source links without changing the ledger', async t => {
  const s = await fixture(t), a = await publish(s, 'source'), before = await files(s.directory);
  await assert.rejects(registerCreatedMedia(s.projectPath, { ...a.asset, frames: 81 }), error => error.code === 'ASSET_METADATA_MISMATCH');
  await assert.rejects(registerCreatedMedia(s.projectPath, { ...a.asset, path: '../outside.wav' }), error => error.code === 'INVALID_OWNED_ASSET');
  assert.deepEqual(await files(s.directory), before);
  await fs.rm(path.join(s.directory, a.asset.path)); await fs.writeFile(path.join(s.directory, 'external.wav'), a.bytes);
  await fs.symlink(path.join(s.directory, 'external.wav'), path.join(s.directory, a.asset.path));
  await assert.rejects(registerCreatedMedia(s.projectPath, a.asset), error => error.code === 'UNSAFE_MEDIA_PATH');
  await fs.rm(path.join(s.directory, a.asset.path)); await fs.writeFile(path.join(s.directory, a.asset.path), 'changed');
  await assert.rejects(registerCreatedMedia(s.projectPath, a.asset), error => error.code === 'ASSET_HASH_MISMATCH');
});

test('Save ownership baseline protects older unused media and saved asset hashes protect new restore registrations', async t => {
  const s = await fixture(t), old = await publish(s, 'old-unused', 0.1, { inPool: false });
  const baseline = (await captureMediaOwnership(s.projectPath)).ownershipIds;
  const restored = await publish(s, 'saved-restore', 0.2); s.saved.assets.push(restored.asset);
  const fresh = await publish(s, 'fresh-unused', 0.3, { inPool: false });
  const preview = await plan(s, baseline);
  assert.deepEqual(preview.candidates.map(row => row.ownershipId), [fresh.ownership.ownershipId]);
  assert.equal(preview.candidates[0].currentAssetIds.length, 0);
  assert.equal(preview.protected.find(row => row.assetId === old.asset.id).reason, 'saved-ownership');
  assert.equal(preview.protected.find(row => row.assetId === restored.asset.id).reason, 'saved-project');
  await assert.rejects(planRevertMedia(s.projectPath, s.current, s.saved), error => error.code === 'INVALID_OWNERSHIP_BASELINE');
});

test('unregistered files and outside source originals never enter the candidate list', async t => {
  const s = await fixture(t), external = await publish(s, 'unregistered', 0.2, { register: false });
  await fs.writeFile(path.join(s.directory, 'original-source.wav'), external.bytes);
  const created = await publish(s, 'created', 0.4);
  const preview = await plan(s);
  assert.deepEqual(preview.candidates.map(row => row.assetId), [created.asset.id]);
  await commitRevert(s); await applyRevertMediaPlan(preview, { policy: 'trash' });
  assert.deepEqual(await fs.readFile(path.join(s.directory, external.asset.path)), external.bytes);
  assert.deepEqual(await fs.readFile(path.join(s.directory, 'original-source.wav')), external.bytes);
});

test('other project versions and saved checkpoints protect shared files while own discarded backups only warn', async t => {
  const s = await fixture(t), a = await publish(s, 'shared-current', 0.1), b = await publish(s, 'shared-save', 0.2), c = await publish(s, 'own-history', 0.3);
  const peer = createProject({ name: 'Other version' }); peer.assets = [a.asset];
  await writeJSON(path.join(s.directory, 'Other.newdaw.json'), peer);
  await writeJSON(path.join(s.directory, 'Other.newdaw.json.saved.json'), { schemaVersion: 1, project: { ...peer, assets: [b.asset] }, mediaOwnershipIds: [] });
  await writeJSON(`${s.projectPath}.bak`, s.current);
  await writeJSON(`${s.projectPath}.history.json`, { schemaVersion: 1, current: { history: { schemaVersion: 2, snapshots: [s.current, null] } } });
  const preview = await plan(s);
  assert.deepEqual(preview.candidates.map(row => row.assetId), [c.asset.id]);
  assert.ok(preview.protected.filter(row => row.reason === 'shared-project').length === 2);
  assert.ok(preview.warnings.some(w => w.code === 'HISTORICAL_MEDIA_MAY_BE_TRASHED'));
});

test('unreadable or symlinked sibling projects conservatively protect all candidates with a warning', async t => {
  const s = await fixture(t); await publish(s, 'created');
  const peerPath = path.join(s.directory, 'Broken.newdaw.json'); await fs.writeFile(peerPath, '{bad json');
  let preview = await plan(s);
  assert.equal(preview.candidates.length, 0); assert.equal(preview.protected[0].reason, 'unreadable-shared-project');
  assert.ok(preview.warnings.some(w => w.code === 'SHARED_REFERENCE_UNREADABLE'));
  await fs.rm(peerPath); await fs.symlink(s.projectPath, peerPath);
  preview = await plan(s); assert.equal(preview.candidates.length, 0); assert.equal(preview.warnings[0].code, 'SHARED_REFERENCE_UNREADABLE');
});

test('keep and trash dry runs are read-only and media moves require a committed Revert', async t => {
  const s = await fixture(t); await publish(s, 'created'); await writeJSON(s.projectPath, s.current);
  let preview = await plan(s), before = await files(s.directory);
  const validated = await applyRevertMediaPlan(preview, { policy: 'trash', dryRun: true });
  assert.equal(validated.status, 'validated'); assert.equal(validated.applied, false); assert.equal(validated.kept[0].plannedAction, 'trash');
  assert.deepEqual(await files(s.directory), before);
  await assert.rejects(applyRevertMediaPlan(preview, { policy: 'trash' }), error => error.code === 'REVERT_NOT_COMMITTED');
  assert.deepEqual(await files(s.directory), before);
  const kept = await applyRevertMediaPlan(preview, { policy: 'keep' }); assert.equal(kept.kept.length, 1); assert.equal(kept.applied, false);
  assert.deepEqual(await files(s.directory), before);
  await assert.rejects(applyRevertMediaPlan(preview, { policy: 'trash' }), error => error.code === 'INVALID_REVERT_MEDIA_PLAN');
});

test('trash moves are recoverable after restart, manifests are durable, and restore never changes project JSON', async t => {
  const s = await fixture(t), a = await publish(s, 'created'), preview = await plan(s);
  await commitRevert(s); const projectBytes = await fs.readFile(s.projectPath);
  const moved = await applyRevertMediaPlan(preview, { policy: 'trash' });
  assert.equal(moved.status, 'trashed'); assert.equal(moved.applied, true); assert.equal(moved.moved.length, 1); assert.equal(moved.failures.length, 0);
  assert.equal(await exists(path.join(s.directory, a.asset.path)), false);
  assert.deepEqual(await fs.readFile(path.join(s.directory, moved.moved[0].trashPath)), a.bytes);
  const restarted = await import(`../src/revert-media.mjs?trash-restart=${Date.now()}`), list = await restarted.listRevertMediaTrash(s.projectPath);
  assert.equal(list.operations[0].files[0].state, 'available'); assert.equal(list.operations[0].operationId, moved.operationId);
  const beforeDryRun = await files(s.directory), dryRun = await restarted.restoreRevertMediaTrash(s.projectPath, moved.operationId, { dryRun: true });
  assert.equal(dryRun.restored[0].plannedAction, 'restore'); assert.deepEqual(await files(s.directory), beforeDryRun);
  const restored = await restarted.restoreRevertMediaTrash(s.projectPath, moved.operationId);
  assert.equal(restored.applied, true); assert.equal(restored.failures.length, 0);
  assert.deepEqual(await fs.readFile(path.join(s.directory, a.asset.path)), a.bytes); assert.deepEqual(await fs.readFile(s.projectPath), projectBytes);
  assert.equal((await restarted.listRevertMediaTrash(s.projectPath)).operations[0].files[0].state, 'active');
  assert.equal((await plan(s)).candidates[0].ownershipId, a.ownership.ownershipId);
});

test('plan capabilities cannot be serialized or forged and public mutation cannot redirect a media move', async t => {
  const s = await fixture(t), a = await publish(s, 'created'), preview = await plan(s);
  await assert.rejects(applyRevertMediaPlan(JSON.parse(JSON.stringify(preview)), { policy: 'trash' }), error => error.code === 'INVALID_REVERT_MEDIA_PLAN');
  preview.candidates[0].path = '../outside.wav'; preview.id = 'forged'; preview.candidates.push({ path: 'other.wav' });
  await commitRevert(s);
  const result = await applyRevertMediaPlan(preview, { policy: 'trash' });
  assert.equal(result.moved.length, 1); assert.equal(result.moved[0].path, a.asset.path);
});

test('stale content and same-byte inode replacement reject the whole plan before any move', async t => {
  for (const mode of ['content', 'inode']) {
    const s = await fixture(t), a = await publish(s, 'first', 0.1), b = await publish(s, 'second', 0.2), preview = await plan(s);
    const filename = path.join(s.directory, b.asset.path);
    if (mode === 'inode') { await fs.rename(filename, `${filename}.old`); await fs.writeFile(filename, b.bytes); }
    else await fs.writeFile(filename, 'changed');
    await commitRevert(s);
    await assert.rejects(applyRevertMediaPlan(preview, { policy: 'trash' }), error => error.code === 'STALE_REVERT_MEDIA_PLAN');
    assert.equal(await exists(path.join(s.directory, a.asset.path)), true); assert.equal(await exists(path.join(s.directory, 'revert-trash')), false);
  }
});

test('new sibling references discovered after preview prevent trash without moving the shared source', async t => {
  const s = await fixture(t), a = await publish(s, 'created'), preview = await plan(s), peer = createProject(); peer.assets.push(a.asset);
  await writeJSON(path.join(s.directory, 'NewVersion.newdaw.json'), peer); await commitRevert(s);
  const result = await applyRevertMediaPlan(preview, { policy: 'trash' });
  assert.equal(result.applied, false); assert.equal(result.skipped[0].reason, 'shared-project'); assert.equal(await exists(path.join(s.directory, a.asset.path)), true);
});

test('a separate project version sharing the active filename prefix is still protected', async t => {
  const s = await fixture(t), a = await publish(s, 'created'), version = createProject(); version.assets.push(a.asset);
  await writeJSON(`${s.projectPath}.version2.newdaw.json`, version);
  const preview = await plan(s);
  assert.equal(preview.candidates.length, 0); assert.equal(preview.protected[0].reason, 'shared-project');
});

test('ordinary JSON peer projects protect current references even when their saved checkpoint is empty or absent', async t => {
  const s = await fixture(t), a = await publish(s, 'saved-empty-peer', 0.1), b = await publish(s, 'without-saved-peer', 0.2), disposable = await publish(s, 'unshared', 0.3);
  const peer = createProject({ name: 'B' }), current = { ...peer, assets: [a.asset] };
  await writeJSON(path.join(s.directory, 'B.json'), current);
  await writeJSON(path.join(s.directory, 'B.json.saved.json'), { schemaVersion: 1, project: peer, mediaOwnershipIds: [] });
  await writeJSON(path.join(s.directory, 'C.json'), { ...createProject({ name: 'C' }), assets: [b.asset] });
  await writeJSON(path.join(s.directory, 'settings.json'), { schemaVersion: 1, color: 'green', assets: [], tracks: [], clips: [] });
  const preview = await plan(s);
  assert.deepEqual(preview.candidates.map(row => row.assetId), [disposable.asset.id]);
  assert.ok(preview.protected.find(row => row.assetId === a.asset.id).references.includes('B.json'));
  assert.ok(preview.protected.find(row => row.assetId === b.asset.id).references.includes('C.json'));
  assert.equal(preview.warnings.some(warning => warning.file === 'settings.json'), false);
});

test('real saved and lock sidecars discover extensionless peers and stale checkpoints retain their prior protection scope', async t => {
  const s = await fixture(t), a = await publish(s, 'saved-sidecar-peer', 0.1), b = await publish(s, 'lock-sidecar-peer', 0.2), disposable = await publish(s, 'unshared', 0.3);
  const peer = createProject({ name: 'No extension' });
  await writeJSON(path.join(s.directory, 'Song'), { ...peer, assets: [a.asset] });
  await writeJSON(path.join(s.directory, 'Song.saved.json'), { schemaVersion: 1, project: peer, mediaOwnershipIds: [] });
  await writeJSON(path.join(s.directory, 'ActiveSong'), { ...createProject(), assets: [b.asset] });
  await writeJSON(path.join(s.directory, 'ActiveSong.lock'), { pid: process.pid, url: 'http://127.0.0.1:4317', token: globalThis.crypto.randomUUID(), startedAt: new Date().toISOString() });
  await writeJSON(path.join(s.directory, 'Gone.saved.json'), { schemaVersion: 1, project: createProject(), mediaOwnershipIds: [] });
  const preview = await plan(s);
  assert.deepEqual(preview.candidates.map(row => row.assetId), [disposable.asset.id]);
  assert.ok(preview.protected.find(row => row.assetId === a.asset.id).references.includes('Song'));
  assert.ok(preview.protected.find(row => row.assetId === b.asset.id).references.includes('ActiveSong'));
  assert.equal(preview.warnings.some(warning => warning.file === 'Gone'), false);
});

test('apply rechecks newly shared JSON and extensionless active peers added after preview', async t => {
  for (const filename of ['Late.json', 'LateSong']) {
    const s = await fixture(t), a = await publish(s, 'created'), preview = await plan(s), peer = createProject(); peer.assets.push(a.asset);
    await writeJSON(path.join(s.directory, filename), peer);
    if (filename === 'LateSong') await writeJSON(path.join(s.directory, `${filename}.history.json`), { schemaVersion: 1, current: { projectId: peer.id, history: { schemaVersion: 2, snapshots: [null] } } });
    await commitRevert(s);
    const result = await applyRevertMediaPlan(preview, { policy: 'trash' });
    assert.equal(result.applied, false); assert.equal(result.skipped[0].reason, 'shared-project');
    assert.deepEqual(await fs.readFile(path.join(s.directory, a.asset.path)), a.bytes);
  }
});

test('partial move failure reports exact progress and its prepared manifest remains recoverable', async t => {
  const s = await fixture(t), a = await publish(s, 'first', 0.1), b = await publish(s, 'second', 0.2), preview = await plan(s); await commitRevert(s);
  const originalLink = fs.link;
  fs.link = async (source, destination) => { if (source === path.join(s.directory, b.asset.path)) throw Object.assign(new Error('injected second-file failure'), { code: 'EIO' }); return originalLink(source, destination); };
  let result; try { result = await applyRevertMediaPlan(preview, { policy: 'trash' }); } finally { fs.link = originalLink; }
  assert.equal(result.status, 'partial'); assert.equal(result.moved.length, 1); assert.equal(result.failures[0].ownershipId, b.ownership.ownershipId);
  assert.equal(await exists(path.join(s.directory, a.asset.path)), false); assert.equal(await exists(path.join(s.directory, b.asset.path)), true);
  const listed = (await listRevertMediaTrash(s.projectPath)).operations[0];
  assert.deepEqual(listed.files.map(file => file.state), ['available', 'active']);
  const restored = await restoreRevertMediaTrash(s.projectPath, result.operationId);
  assert.equal(restored.restored.length, 1); assert.equal(restored.skipped[0].reason, 'already-active');
});

test('post-unlink failures report actual moved/restored files so callers can invalidate media caches', async t => {
  const s = await fixture(t), a = await publish(s, 'created'), preview = await plan(s); await commitRevert(s);
  const originalUnlink = fs.unlink, source = path.join(s.directory, a.asset.path);
  fs.unlink = async filename => { await originalUnlink(filename); if (filename === source) throw Object.assign(new Error('injected post-unlink durability error'), { code: 'EIO' }); };
  let moved;
  try { moved = await applyRevertMediaPlan(preview, { policy: 'trash' }); } finally { fs.unlink = originalUnlink; }
  assert.equal(moved.status, 'partial'); assert.equal(moved.applied, true); assert.equal(moved.moved.length, 1); assert.equal(await exists(source), false);
  const trash = path.join(s.directory, moved.moved[0].trashPath);
  fs.unlink = async filename => { await originalUnlink(filename); if (filename === trash) throw Object.assign(new Error('injected restore post-unlink error'), { code: 'EIO' }); };
  let restored;
  try { restored = await restoreRevertMediaTrash(s.projectPath, moved.operationId); } finally { fs.unlink = originalUnlink; }
  assert.equal(restored.status, 'partial'); assert.equal(restored.applied, true); assert.equal(restored.restored.length, 1);
  assert.deepEqual(await fs.readFile(source), a.bytes);
  assert.equal((await listRevertMediaTrash(s.projectPath)).operations[0].files[0].state, 'active');
});

test('a prepared manifest recovers a moved file even when every post-move manifest update fails', async t => {
  const s = await fixture(t), a = await publish(s, 'first', 0.1), b = await publish(s, 'second', 0.2), preview = await plan(s); await commitRevert(s);
  const originalRename = fs.rename;
  fs.rename = async (source, destination) => { if (path.basename(destination) === 'manifest.json') throw Object.assign(new Error('injected manifest write failure'), { code: 'EIO' }); return originalRename(source, destination); };
  let result; try { result = await applyRevertMediaPlan(preview, { policy: 'trash' }); } finally { fs.rename = originalRename; }
  assert.equal(result.status, 'partial'); assert.equal(result.applied, true); assert.equal(result.moved[0].ownershipId, a.ownership.ownershipId);
  assert.equal(result.skipped[0].ownershipId, b.ownership.ownershipId); assert.equal(result.skipped[0].reason, 'not-attempted-after-manifest-failure');
  const listed = (await listRevertMediaTrash(s.projectPath)).operations[0];
  assert.equal(listed.status, 'prepared'); assert.deepEqual(listed.files.map(file => file.state), ['available', 'active']);
  const restored = await restoreRevertMediaTrash(s.projectPath, result.operationId);
  assert.equal(restored.applied, true); assert.equal(restored.failures.length, 0);
  assert.deepEqual(await fs.readFile(path.join(s.directory, a.asset.path)), a.bytes);
});

test('restore refuses overwrite, altered trash bytes, and traversal operation IDs', async t => {
  const s = await fixture(t), a = await publish(s, 'created'), preview = await plan(s); await commitRevert(s);
  const moved = await applyRevertMediaPlan(preview, { policy: 'trash' }), filename = path.join(s.directory, a.asset.path);
  await fs.writeFile(filename, 'must keep this different destination');
  const collision = await restoreRevertMediaTrash(s.projectPath, moved.operationId);
  assert.equal(collision.applied, false); assert.equal(collision.skipped[0].reason, 'destination-exists'); assert.equal(await fs.readFile(filename, 'utf8'), 'must keep this different destination');
  await fs.rm(filename); await fs.writeFile(path.join(s.directory, moved.moved[0].trashPath), 'altered trash');
  const altered = await restoreRevertMediaTrash(s.projectPath, moved.operationId); assert.equal(altered.applied, false); assert.equal(altered.failures[0].code, 'TRASH_MEDIA_CHANGED');
  await assert.rejects(restoreRevertMediaTrash(s.projectPath, '../assets'), error => error.code === 'INVALID_TRASH_OPERATION');
});

test('corrupt ledger and forged manifest are never silently repaired or used to delete files', async t => {
  const s = await fixture(t), a = await publish(s, 'created'), preview = await plan(s); await commitRevert(s);
  const moved = await applyRevertMediaPlan(preview, { policy: 'trash' }), manifestPath = path.join(s.directory, moved.manifestPath), manifest = JSON.parse(await fs.readFile(manifestPath));
  manifest.entries[0].path = '../outside.wav'; await writeJSON(manifestPath, manifest);
  await assert.rejects(restoreRevertMediaTrash(s.projectPath, moved.operationId), error => error.code === 'INVALID_MEDIA_OWNERSHIP');
  const listed = await listRevertMediaTrash(s.projectPath); assert.equal(listed.operations.length, 0); assert.equal(listed.warnings.length, 1);
  await fs.writeFile(`${s.projectPath}.media-ownership.json`, '{broken');
  await assert.rejects(captureMediaOwnership(s.projectPath));
  assert.deepEqual(await fs.readFile(path.join(s.directory, moved.moved[0].trashPath)), a.bytes);
});

test('unsafe assets and trash directory symlinks are refused without touching their targets', async t => {
  const s = await fixture(t), a = await publish(s, 'created');
  await fs.rename(path.join(s.directory, 'assets'), path.join(s.directory, 'actual-assets')); await fs.symlink(path.join(s.directory, 'actual-assets'), path.join(s.directory, 'assets'));
  const protectedPlan = await plan(s); assert.equal(protectedPlan.candidates.length, 0); assert.equal(protectedPlan.protected[0].reason, 'changed-or-unsafe');
  await fs.rm(path.join(s.directory, 'assets')); await fs.rename(path.join(s.directory, 'actual-assets'), path.join(s.directory, 'assets'));
  const preview = await plan(s); await commitRevert(s);
  await fs.mkdir(path.join(s.directory, 'outside')); await fs.symlink(path.join(s.directory, 'outside'), path.join(s.directory, 'revert-trash'));
  await assert.rejects(applyRevertMediaPlan(preview, { policy: 'trash' }), error => error.code === 'UNSAFE_MEDIA_PATH');
  assert.deepEqual(await fs.readdir(path.join(s.directory, 'outside')), []); assert.deepEqual(await fs.readFile(path.join(s.directory, a.asset.path)), a.bytes);
});
