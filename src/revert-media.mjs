import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { validateProject } from './core/engine.mjs';
import { decodeWav } from './media/wav.mjs';
import { readSidecar, writeSidecar, canonicalProjectHash } from './session-store.mjs';

// Only files explicitly registered after a successful new publication belong to
// this ledger. Merely referencing/importing an existing file is not ownership.
const MAX_FILE_BYTES = 64 * 1024 * 1024, MAX_LEDGER_BYTES = 8 * 1024 * 1024;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const sha = /^[a-f0-9]{64}$/;
const queues = new Map(), plans = new WeakMap();
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const copy = value => structuredClone(value);
const fault = (code, message, details) => Object.assign(new Error(message), { code, status: 422, ...(details ? { details } : {}) });
const fail = (code, message, details) => { throw fault(code, message, details); };
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const identity = stat => ({ dev: stat.dev, ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs });
const sameIdentity = (a, b) => ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'].every(key => a[key] === b[key]);
const validIdentity = value => exact(value, ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs']) && Object.values(value).every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0);
const contentHash = project => canonicalProjectHash({ ...project, revision: 0 });
const ledgerPath = projectPath => `${projectPath}.media-ownership.json`;
const jsonBytes = value => Buffer.from(`${JSON.stringify(value)}\n`);

async function location(input) {
  let filename = path.resolve(input);
  for (const alias of ['/tmp', '/var', '/etc']) {
    if (filename !== alias && !filename.startsWith(`${alias}/`)) continue;
    try { if ((await fs.lstat(alias)).isSymbolicLink() && await fs.realpath(alias) === `/private${alias}`) filename = `/private${filename}`; } catch {}
    break;
  }
  await safeAncestors(path.dirname(filename));
  return filename;
}
async function safeAncestors(filename) {
  const absolute = path.resolve(filename), parsed = path.parse(absolute);
  let cursor = parsed.root;
  for (const part of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    const stat = await fs.lstat(cursor);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('UNSAFE_MEDIA_PATH', 'Media paths must use regular directories without symbolic links.', { path: cursor });
  }
}
async function checkedFile(filename, maxBytes = MAX_FILE_BYTES) {
  await safeAncestors(path.dirname(filename));
  const before = await fs.lstat(filename);
  if (!before.isFile() || before.isSymbolicLink()) fail('UNSAFE_MEDIA_PATH', 'Expected a regular file, not a symbolic link.', { path: filename });
  const bytes = await readSidecar(filename, maxBytes), after = await fs.lstat(filename);
  await safeAncestors(path.dirname(filename));
  if (!sameIdentity(identity(before), identity(after))) fail('MEDIA_FILE_CHANGED', 'File changed while being inspected.', { path: filename });
  return { bytes, sha256: digest(bytes), identity: identity(after) };
}
async function projectAt(projectPath) {
  const project = JSON.parse((await checkedFile(projectPath)).bytes.toString('utf8'));
  validateProject(project); return project;
}
async function exclusive(projectPath, work) {
  const previous = queues.get(projectPath) ?? Promise.resolve(), result = previous.catch(() => {}).then(work);
  queues.set(projectPath, result);
  try { return await result; } finally { if (queues.get(projectPath) === result) queues.delete(projectPath); }
}
function validateEntry(entry) {
  if (!exact(entry, ['id', 'assetId', 'sha256', 'path', 'bytes', 'identity', 'createdAt']) || !uuid.test(entry.id) || typeof entry.assetId !== 'string' ||
      !sha.test(entry.sha256) || entry.path !== `assets/${entry.sha256}.wav` || !Number.isSafeInteger(entry.bytes) || entry.bytes < 1 || entry.bytes > MAX_FILE_BYTES ||
      !validIdentity(entry.identity) || entry.identity.size !== entry.bytes || !iso(entry.createdAt)) fail('INVALID_MEDIA_OWNERSHIP', 'Invalid ownership ledger entry.');
}
async function readLedger(projectPath, projectId) {
  let ledger;
  try { ledger = JSON.parse((await checkedFile(ledgerPath(projectPath), MAX_LEDGER_BYTES)).bytes.toString('utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  if (!exact(ledger, ['schemaVersion', 'projectId', 'projectFile', 'owner', 'entries']) || ledger.schemaVersion !== 1 || ledger.projectId !== projectId ||
      ledger.projectFile !== path.basename(projectPath) || !uuid.test(ledger.owner) || !Array.isArray(ledger.entries) || ledger.entries.length > 20000) fail('INVALID_MEDIA_OWNERSHIP', 'Ownership ledger identity does not match this project.');
  const ids = new Set();
  for (const entry of ledger.entries) { validateEntry(entry); if (ids.has(entry.id)) fail('INVALID_MEDIA_OWNERSHIP', 'Duplicate ownership ID.'); ids.add(entry.id); }
  return ledger;
}
async function persistLedger(projectPath, ledger) {
  const bytes = jsonBytes(ledger);
  if (bytes.length > MAX_LEDGER_BYTES) fail('MEDIA_OWNERSHIP_LIMIT', 'Ownership ledger exceeds its size limit.');
  await writeSidecar(ledgerPath(projectPath), bytes);
}

export async function registerCreatedMedia(input, asset) {
  const projectPath = await location(input);
  return exclusive(projectPath, async () => {
    const project = await projectAt(projectPath);
    if (!asset || typeof asset.id !== 'string' || !sha.test(asset.sha256) || asset.path !== `assets/${asset.sha256}.wav`) fail('INVALID_OWNED_ASSET', 'Only canonical managed WAV assets can be registered.');
    const file = await checkedFile(path.join(path.dirname(projectPath), asset.path));
    if (file.sha256 !== asset.sha256) fail('ASSET_HASH_MISMATCH', 'Published WAV does not match its content address.');
    const decoded = decodeWav(file.bytes);
    if (decoded.sampleRate !== asset.sampleRate || decoded.frames !== asset.frames || decoded.channels.length !== asset.channels) fail('ASSET_METADATA_MISMATCH', 'Published WAV does not match its metadata.');
    const ledger = await readLedger(projectPath, project.id) ?? { schemaVersion: 1, projectId: project.id, projectFile: path.basename(projectPath), owner: randomUUID(), entries: [] };
    const existing = ledger.entries.findLast(entry => entry.path === asset.path && sameIdentity(entry.identity, file.identity));
    if (existing) return { status: 'unchanged', ownershipId: existing.id, entry: copy(existing) };
    if (ledger.entries.length >= 20000) fail('MEDIA_OWNERSHIP_LIMIT', 'Ownership ledger entry limit reached.');
    const entry = { id: randomUUID(), assetId: asset.id, sha256: asset.sha256, path: asset.path, bytes: file.bytes.length, identity: file.identity, createdAt: new Date().toISOString() };
    ledger.entries.push(entry); await persistLedger(projectPath, ledger);
    return { status: 'registered', ownershipId: entry.id, entry: copy(entry) };
  });
}

export async function captureMediaOwnership(input) {
  const projectPath = await location(input);
  return exclusive(projectPath, async () => {
    const project = await projectAt(projectPath), ledger = await readLedger(projectPath, project.id);
    return { projectId: project.id, ownershipIds: ledger?.entries.map(entry => entry.id) ?? [], capturedAt: new Date().toISOString() };
  });
}

// Explicit sibling project versions and saved checkpoints protect shared media.
// The active project's own discarded history/backups warn but do not veto the
// user's trash choice; Revert resets that history in the document controller.
async function references(projectPath) {
  const directory = path.dirname(projectPath), basename = path.basename(projectPath), refs = new Map(), warnings = [];
  let uncertain = false;
  const add = (hash, file) => { const names = refs.get(hash) ?? []; names.push(file); refs.set(hash, names); };
  const names = (await fs.readdir(directory)).sort(), existing = new Set(names), documents = new Map(), inspected = new Map();
  const projectShape = value => value && typeof value === 'object' && !Array.isArray(value) && typeof value.id === 'string' && Number.isSafeInteger(value.schemaVersion) && Array.isArray(value.assets) && Array.isArray(value.tracks) && Array.isArray(value.clips);
  const inspect = async name => {
    if (!inspected.has(name)) {
      try { inspected.set(name, { document: JSON.parse((await checkedFile(path.join(directory, name))).bytes.toString('utf8')) }); }
      catch (error) { inspected.set(name, { error }); }
    }
    return inspected.get(name);
  };
  const include = (name, required = true) => { if (name !== basename) documents.set(name, required || documents.get(name) === true); };
  for (const name of names) {
    const own = name.startsWith(`${basename}.`);
    const recognized = name.endsWith('.newdaw.json') || name.endsWith('.saved.json') || /\.newdaw\.json(?:\.bak|\.history\.json|\.autosave-.+\.bak)$/.test(name) || (own && /(?:\.bak|\.history\.json)$/.test(name));
    if (recognized) include(name);
    else if (name.endsWith('.json')) include(name, false);
    // Filenames are deliberately unrestricted by Save As. Real newdaw sidecars
    // discover active peers named B.json, "Song", or another extension. Never
    // manufacture a required missing peer from a stale saved checkpoint: that
    // checkpoint's own verified project references remain protected as before.
    const suffix = ['.saved.json', '.history.json', '.media-ownership.json', '.autobackups.json', '.lock'].find(value => name.endsWith(value));
    if (!suffix) continue;
    const { document } = await inspect(name), base = name.slice(0, -suffix.length);
    if (!document || !base) continue;
    const isSaved = suffix === '.saved.json' && document.schemaVersion === 1 && projectShape(document.project);
    const isHistory = suffix === '.history.json' && document.schemaVersion === 1 && typeof document.current?.projectId === 'string' && [1, 2].includes(document.current?.history?.schemaVersion);
    const isRegistry = ['.media-ownership.json', '.autobackups.json'].includes(suffix) && document.schemaVersion === 1 && document.projectFile === base && typeof document.projectId === 'string' && uuid.test(document.owner) && Array.isArray(document.entries);
    const isLock = suffix === '.lock' && Number.isSafeInteger(document.pid) && document.pid > 0 && typeof document.url === 'string' && /^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(document.url) && uuid.test(document.token) && iso(document.startedAt);
    if (isSaved || isHistory || isRegistry || isLock) {
      if (existing.has(base)) include(base);
      if (isHistory) include(name);
      if (isRegistry && suffix === '.autobackups.json') for (const entry of document.entries) if (typeof entry?.file === 'string' && path.basename(entry.file) === entry.file && existing.has(entry.file)) include(entry.file);
    }
  }
  for (const [name, required] of documents) {
    const ownHistorical = name === `${basename}.bak` || name === `${basename}.history.json` || (name.startsWith(`${basename}.autosave-`) && name.endsWith('.bak'));
    try {
      const inspectedFile = await inspect(name); if (inspectedFile.error) throw inspectedFile.error;
      const document = inspectedFile.document;
      // Ordinary configuration/package JSON is not a project. A document that
      // has a project shape must still pass validateProject below; malformed
      // project data is conservatively protected rather than silently ignored.
      if (!required && !projectShape(document)) continue;
      const found = new Set(); let nodes = 0, projects = 0;
      const visit = (value, depth = 0) => {
        if (++nodes > 500000 || depth > 40) fail('REFERENCE_SCAN_LIMIT', 'Reference document exceeds traversal limits.');
        if (!value || typeof value !== 'object') return;
        if (!Array.isArray(value) && Array.isArray(value.assets) && Array.isArray(value.tracks) && Array.isArray(value.clips)) {
          validateProject(value); projects++; for (const asset of value.assets) found.add(asset.sha256); return;
        }
        for (const child of Object.values(value)) visit(child, depth + 1);
      };
      visit(document);
      // Empty history has no full snapshots, but its live project is scanned
      // separately. Other wrappers without a valid project are not trusted.
      if (!projects && !(name.endsWith('.history.json') && document.schemaVersion === 1 && document.current?.history?.schemaVersion === 2 && document.current.history.snapshots?.every(item => item === null))) fail('INVALID_REFERENCE_PROJECT', 'No valid project was found in a reference document.');
      if (ownHistorical) {
        if (found.size) warnings.push({ code: 'HISTORICAL_MEDIA_MAY_BE_TRASHED', file: name, sha256: [...found], message: 'This discarded history or JSON-only backup may require restoring media from Revert trash.' });
      } else for (const hash of found) add(hash, name);
    } catch (error) {
      warnings.push({ code: ownHistorical ? 'HISTORICAL_REFERENCE_UNREADABLE' : 'SHARED_REFERENCE_UNREADABLE', file: name, message: error.message });
      if (!ownHistorical) uncertain = true;
    }
  }
  return { refs, warnings, uncertain };
}
async function verifyOwned(directory, entry, { strictIdentity = true } = {}) {
  const checked = await checkedFile(path.join(directory, entry.path));
  if (checked.sha256 !== entry.sha256 || checked.bytes.length !== entry.bytes || (strictIdentity && !sameIdentity(checked.identity, entry.identity))) fail('OWNED_MEDIA_CHANGED', 'Registered media content or identity changed; it will not be moved.', { ownershipId: entry.id, path: entry.path });
  return checked;
}

export async function planRevertMedia(input, currentProject, savedProject, { savedOwnershipIds } = {}) {
  const projectPath = await location(input);
  validateProject(currentProject); validateProject(savedProject);
  if (currentProject.id !== savedProject.id || currentProject.sampleRate !== savedProject.sampleRate || currentProject.ppq !== savedProject.ppq) fail('PROJECT_IDENTITY_MISMATCH', 'Revert media planning must preserve project identity and timebase.');
  if (!Array.isArray(savedOwnershipIds) || savedOwnershipIds.some(id => typeof id !== 'string' || !uuid.test(id)) || new Set(savedOwnershipIds).size !== savedOwnershipIds.length) fail('INVALID_OWNERSHIP_BASELINE', 'Pass the explicit saved checkpoint ownership ID list.');
  return exclusive(projectPath, async () => {
    const ledger = await readLedger(projectPath, currentProject.id), shared = await references(projectPath), baseline = new Set(savedOwnershipIds), savedHashes = new Set(savedProject.assets.map(asset => asset.sha256));
    const candidates = [], protectedFiles = [], warnings = [...shared.warnings], directory = path.dirname(projectPath);
    const latest = new Map(); for (const entry of ledger?.entries ?? []) latest.set(entry.path, entry);
    for (const entry of latest.values()) {
      let reason = baseline.has(entry.id) ? 'saved-ownership' : savedHashes.has(entry.sha256) ? 'saved-project' : shared.uncertain ? 'unreadable-shared-project' : shared.refs.has(entry.sha256) ? 'shared-project' : null;
      if (!reason) { try { await verifyOwned(directory, entry); } catch (error) { reason = error.code === 'ENOENT' ? 'missing' : 'changed-or-unsafe'; warnings.push({ code: error.code ?? 'MEDIA_UNREADABLE', ownershipId: entry.id, message: error.message }); } }
      const row = { ownershipId: entry.id, assetId: entry.assetId, sha256: entry.sha256, path: entry.path, bytes: entry.bytes, createdAt: entry.createdAt,
        currentAssetIds: currentProject.assets.filter(asset => asset.sha256 === entry.sha256).map(asset => asset.id) };
      if (reason) protectedFiles.push({ ...row, reason, references: shared.refs.get(entry.sha256) ?? [] }); else candidates.push(row);
    }
    const plan = { id: randomUUID(), projectId: currentProject.id, projectRevision: currentProject.revision, createdAt: new Date().toISOString(), candidates, protected: protectedFiles, warnings,
      totals: { files: candidates.length, bytes: candidates.reduce((sum, row) => sum + row.bytes, 0) } };
    plans.set(plan, { projectPath, projectId: currentProject.id, owner: ledger?.owner ?? null, savedHash: contentHash(savedProject), entries: candidates.map(row => copy(latest.get(row.path))), public: copy(plan), consumed: false });
    return plan;
  });
}

async function mkdirRegular(directory) {
  await safeAncestors(path.dirname(directory));
  try { await fs.mkdir(directory, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  await safeAncestors(directory);
}
async function syncDirectory(directory) { const handle = await fs.open(directory, 'r'); try { await handle.sync(); } finally { await handle.close(); } }
async function moveExclusive(source, destination, expected) {
  await safeAncestors(path.dirname(source)); await safeAncestors(path.dirname(destination));
  const before = identity(await fs.lstat(source));
  if (!sameIdentity(before, expected)) fail('OWNED_MEDIA_CHANGED', 'File identity changed before moving.');
  await fs.link(source, destination); // Exclusive publication: never overwrite a destination.
  await syncDirectory(path.dirname(destination));
  const linked = await fs.lstat(destination), named = await fs.lstat(source);
  if (!linked.isFile() || linked.isSymbolicLink() || !named.isFile() || named.isSymbolicLink() || linked.dev !== expected.dev || linked.ino !== expected.ino || named.dev !== linked.dev || named.ino !== linked.ino || named.size !== expected.size || named.mtimeMs !== expected.mtimeMs) fail('OWNED_MEDIA_CHANGED', 'File changed during recoverable move; the retained copy was not discarded.');
  await fs.unlink(source); await syncDirectory(path.dirname(source));
  return identity(await fs.lstat(destination));
}

export async function applyRevertMediaPlan(plan, { policy = 'keep', dryRun = false } = {}) {
  const bound = plans.get(plan);
  if (!bound || bound.consumed) fail('INVALID_REVERT_MEDIA_PLAN', 'Use an unconsumed plan from this process; serialized or altered plan IDs are not capabilities.');
  if (!['keep', 'trash'].includes(policy) || typeof dryRun !== 'boolean') fail('INVALID_REVERT_MEDIA_POLICY', 'Use keep or trash and a boolean dryRun.');
  return exclusive(bound.projectPath, async () => {
    if (bound.consumed) fail('INVALID_REVERT_MEDIA_PLAN', 'This media plan was already applied.');
    const base = { status: dryRun ? 'validated' : 'kept', applied: false, policy, operationId: null, manifestPath: null, moved: [], kept: [], skipped: [], failures: [], warnings: copy(bound.public.warnings) };
    if (policy === 'keep') { base.kept = copy(bound.public.candidates); if (!dryRun) bound.consumed = true; return base; }
    const directory = path.dirname(bound.projectPath), ledger = await readLedger(bound.projectPath, bound.projectId), shared = await references(bound.projectPath);
    if ((ledger?.owner ?? null) !== bound.owner) fail('STALE_REVERT_MEDIA_PLAN', 'Ownership ledger changed after planning.');
    const eligible = [];
    base.warnings = shared.warnings;
    for (const entry of bound.entries) {
      if (!ledger.entries.some(row => JSON.stringify(row) === JSON.stringify(entry))) fail('STALE_REVERT_MEDIA_PLAN', 'Ownership entry changed after planning.');
      try { await verifyOwned(directory, entry); } catch (error) { fail('STALE_REVERT_MEDIA_PLAN', error.message, { ownershipId: entry.id, cause: error.code }); }
      if (shared.uncertain || shared.refs.has(entry.sha256)) base.skipped.push({ ownershipId: entry.id, path: entry.path, reason: shared.uncertain ? 'unreadable-shared-project' : 'shared-project' }); else eligible.push(entry);
    }
    if (dryRun) { base.kept = eligible.map(entry => ({ ownershipId: entry.id, path: entry.path, plannedAction: 'trash' })); return base; }
    const active = await projectAt(bound.projectPath);
    if (active.id !== bound.projectId || contentHash(active) !== bound.savedHash) fail('REVERT_NOT_COMMITTED', 'Commit the saved project content before moving its discarded media.');
    if (!eligible.length) { bound.consumed = true; return base; }
    const operationId = randomUUID(), root = path.join(directory, 'revert-trash'), operationDirectory = path.join(root, operationId);
    await mkdirRegular(root); await fs.mkdir(operationDirectory, { mode: 0o700 }); await safeAncestors(operationDirectory);
    const manifestPath = path.join(operationDirectory, 'manifest.json');
    const manifest = { schemaVersion: 1, operationId, projectId: bound.projectId, projectFile: path.basename(bound.projectPath), owner: bound.owner, createdAt: new Date().toISOString(), status: 'prepared',
      entries: eligible.map(entry => ({ ...copy(entry), trashFile: `${entry.id}.wav`, state: 'planned', trashIdentity: null, error: null })) };
    await writeSidecar(manifestPath, jsonBytes(manifest), { noClobber: true });
    bound.consumed = true; base.operationId = operationId; base.manifestPath = path.relative(directory, manifestPath);
    for (const entry of manifest.entries) {
      try {
        const checked = await verifyOwned(directory, entry);
        entry.trashIdentity = await moveExclusive(path.join(directory, entry.path), path.join(operationDirectory, entry.trashFile), checked.identity);
        entry.state = 'trashed'; base.moved.push({ ownershipId: entry.id, path: entry.path, trashPath: path.relative(directory, path.join(operationDirectory, entry.trashFile)) });
      } catch (error) {
        entry.state = 'failed'; entry.error = { code: error.code ?? 'MEDIA_MOVE_FAILED', message: error.message };
        // unlink may have succeeded before a directory-sync error. Report the
        // observed move, not merely whether the entire helper returned cleanly.
        try {
          const retained = await checkedFile(path.join(operationDirectory, entry.trashFile));
          if (retained.sha256 === entry.sha256 && retained.identity.dev === entry.identity.dev && retained.identity.ino === entry.identity.ino) {
            entry.trashIdentity = retained.identity;
            try { await fs.lstat(path.join(directory, entry.path)); }
            catch (missing) { if (missing.code === 'ENOENT') { entry.state = 'trashed'; base.moved.push({ ownershipId: entry.id, path: entry.path, trashPath: path.relative(directory, path.join(operationDirectory, entry.trashFile)) }); } }
          }
        } catch {}
        base.failures.push({ ownershipId: entry.id, path: entry.path, ...entry.error });
      }
      // A prepared manifest already lists every possible destination. If this
      // update fails, list/restore reconcile actual files instead of trusting state.
      try { await writeSidecar(manifestPath, jsonBytes(manifest)); } catch (error) {
        base.failures.push({ code: 'TRASH_MANIFEST_WRITE_FAILED', message: error.message });
        base.skipped.push(...manifest.entries.filter(row => row.state === 'planned').map(row => ({ ownershipId: row.id, path: row.path, reason: 'not-attempted-after-manifest-failure' })));
        break;
      }
    }
    manifest.status = base.failures.length ? 'partial' : 'completed';
    try { await writeSidecar(manifestPath, jsonBytes(manifest)); } catch (error) { base.failures.push({ code: 'TRASH_MANIFEST_WRITE_FAILED', message: error.message }); }
    base.applied = base.moved.length > 0; base.status = base.failures.length ? 'partial' : 'trashed'; return base;
  });
}

async function loadManifest(projectPath, operationId) {
  if (!uuid.test(operationId)) fail('INVALID_TRASH_OPERATION', 'Trash operation must be a UUID.');
  const filename = path.join(path.dirname(projectPath), 'revert-trash', operationId, 'manifest.json');
  const manifest = JSON.parse((await checkedFile(filename, MAX_LEDGER_BYTES)).bytes.toString('utf8')), project = await projectAt(projectPath), ledger = await readLedger(projectPath, project.id);
  if (!exact(manifest, ['schemaVersion', 'operationId', 'projectId', 'projectFile', 'owner', 'createdAt', 'status', 'entries']) || manifest.schemaVersion !== 1 || manifest.operationId !== operationId ||
      manifest.projectId !== project.id || manifest.projectFile !== path.basename(projectPath) || manifest.owner !== ledger?.owner || !iso(manifest.createdAt) ||
      !['prepared', 'partial', 'completed', 'restored'].includes(manifest.status) || !Array.isArray(manifest.entries)) fail('INVALID_TRASH_MANIFEST', 'Trash manifest does not belong to this project.');
  const ids = new Set();
  for (const row of manifest.entries) {
    const { trashFile, state, trashIdentity, error, ...entry } = row; validateEntry(entry);
    if (ids.has(entry.id) || trashFile !== `${entry.id}.wav` || !['planned', 'trashed', 'failed', 'restored'].includes(state) || (trashIdentity !== null && !validIdentity(trashIdentity)) ||
        !ledger.entries.some(item => ['id', 'assetId', 'sha256', 'path', 'bytes', 'createdAt'].every(key => item[key] === entry[key]))) fail('INVALID_TRASH_MANIFEST', 'Trash entry was altered or is not owned by this project.');
    ids.add(entry.id);
  }
  return { filename, manifest, ledger };
}
async function inspectTrashEntry(projectPath, operationId, entry) {
  const filename = path.join(path.dirname(projectPath), 'revert-trash', operationId, entry.trashFile);
  try {
    const file = await checkedFile(filename);
    if (file.sha256 !== entry.sha256 || file.bytes.length !== entry.bytes || (entry.trashIdentity ? !sameIdentity(file.identity, entry.trashIdentity) : file.identity.dev !== entry.identity.dev || file.identity.ino !== entry.identity.ino)) fail('TRASH_MEDIA_CHANGED', 'Trash WAV identity or checksum does not match the manifest.');
    return { state: 'available', file };
  } catch (error) {
    if (error.code !== 'ENOENT') return { state: 'unsafe-or-changed', error: { code: error.code ?? 'TRASH_UNREADABLE', message: error.message } };
    try { await verifyOwned(path.dirname(projectPath), entry, { strictIdentity: false }); return { state: 'active' }; }
    catch { return { state: 'missing' }; }
  }
}

export async function listRevertMediaTrash(input) {
  const projectPath = await location(input), root = path.join(path.dirname(projectPath), 'revert-trash');
  const operations = [], warnings = [];
  try { await safeAncestors(root); } catch (error) { if (error.code === 'ENOENT') return { operations, warnings }; throw error; }
  for (const operationId of (await fs.readdir(root)).filter(id => uuid.test(id)).sort()) {
    try {
      const { manifest } = await loadManifest(projectPath, operationId), files = [];
      for (const entry of manifest.entries) {
        const inspected = await inspectTrashEntry(projectPath, operationId, entry);
        files.push({ ownershipId: entry.id, path: entry.path, bytes: entry.bytes, recordedState: entry.state, state: inspected.state, ...(inspected.error ? { error: inspected.error } : {}) });
      }
      operations.push({ operationId, createdAt: manifest.createdAt, files, status: manifest.status, manifestPath: `revert-trash/${operationId}/manifest.json` });
    } catch (error) { warnings.push({ operationId, code: error.code ?? 'INVALID_TRASH_MANIFEST', message: error.message }); }
  }
  return { operations: operations.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt)), warnings };
}

export async function restoreRevertMediaTrash(input, operationId, { dryRun = false } = {}) {
  if (typeof dryRun !== 'boolean') fail('INVALID_RESTORE_OPTIONS', 'dryRun must be boolean.');
  const projectPath = await location(input);
  return exclusive(projectPath, async () => {
    const { filename, manifest, ledger } = await loadManifest(projectPath, operationId), directory = path.dirname(projectPath);
    const result = { status: dryRun ? 'validated' : 'restored', applied: false, operationId, restored: [], skipped: [], failures: [], warnings: [] };
    for (const entry of manifest.entries) {
      const inspected = await inspectTrashEntry(projectPath, operationId, entry);
      if (inspected.state !== 'available') {
        if (inspected.state === 'active') result.skipped.push({ ownershipId: entry.id, reason: 'already-active' });
        else result.failures.push({ ownershipId: entry.id, code: inspected.error?.code ?? 'TRASH_MEDIA_MISSING', message: inspected.error?.message ?? 'No verified trash or active copy is available.' });
        continue;
      }
      const destination = path.join(directory, entry.path);
      try { await fs.lstat(destination); result.skipped.push({ ownershipId: entry.id, reason: 'destination-exists' }); continue; }
      catch (error) { if (error.code !== 'ENOENT') { result.failures.push({ ownershipId: entry.id, code: error.code, message: error.message }); continue; } }
      if (dryRun) { result.restored.push({ ownershipId: entry.id, path: entry.path, plannedAction: 'restore' }); continue; }
      try {
        await mkdirRegular(path.join(directory, 'assets'));
        const newIdentity = await moveExclusive(path.join(path.dirname(filename), entry.trashFile), destination, inspected.file.identity);
        // Preserve the ownership ID so old Save baselines still protect it. The
        // file's link count/ctime changed as part of our own recoverable move.
        const registered = ledger.entries.find(row => row.id === entry.id); registered.identity = newIdentity;
        entry.identity = newIdentity; entry.state = 'restored'; entry.trashIdentity = null; entry.error = null;
        result.restored.push({ ownershipId: entry.id, path: entry.path }); result.applied = true;
        await persistLedger(projectPath, ledger); await writeSidecar(filename, jsonBytes(manifest));
      } catch (error) {
        try {
          const restored = await checkedFile(destination);
          if (restored.sha256 === entry.sha256 && restored.identity.dev === inspected.file.identity.dev && restored.identity.ino === inspected.file.identity.ino) {
            result.applied = true;
            if (!result.restored.some(row => row.ownershipId === entry.id)) result.restored.push({ ownershipId: entry.id, path: entry.path });
            ledger.entries.find(row => row.id === entry.id).identity = restored.identity;
            entry.identity = restored.identity; entry.state = 'restored'; entry.trashIdentity = null;
            try { await persistLedger(projectPath, ledger); } catch (failure) { result.failures.push({ code: 'MEDIA_OWNERSHIP_WRITE_FAILED', message: failure.message }); }
          }
        } catch {}
        result.failures.push({ ownershipId: entry.id, code: error.code ?? 'TRASH_RESTORE_FAILED', message: error.message });
      }
    }
    if (!dryRun) {
      manifest.status = result.failures.length || result.skipped.some(row => row.reason === 'destination-exists') ? 'partial' : 'restored';
      try { await writeSidecar(filename, jsonBytes(manifest)); } catch (error) { result.failures.push({ code: 'TRASH_MANIFEST_WRITE_FAILED', message: error.message }); }
      if (result.failures.length || manifest.status === 'partial') result.status = 'partial';
    }
    if (dryRun && result.failures.length) result.status = 'partial';
    return result;
  });
}
