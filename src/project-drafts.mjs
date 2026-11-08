import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Engine, createProject, validateProject } from './core/engine.mjs';
import { canonicalProjectHash, DEFAULT_SESSION_SETTINGS, validateSessionSettings, readSidecar, writeSidecar, updateSessionSettings, loadSessionState } from './session-store.mjs';
import { inspectExistingProject } from './project-open.mjs';

const MAX_REGISTRY_BYTES = 2 * 1024 * 1024, MAX_DESCRIPTOR_BYTES = 16384, MAX_PROJECT_BYTES = 16 * 1024 * 1024, MAX_DRAFTS = 1000;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/, sha = /^[a-f0-9]{64}$/, queues = new Map();
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const integer = value => Number.isSafeInteger(value) && value >= 0;
const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const encode = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const fail = (code, message, status = 422, details) => { throw Object.assign(new Error(message), { code, status, ...(details ? { details } : {}) }); };
const warning = (code, message) => ({ code, message });
const neverSaved = () => ({ available: false, checkpoint: null, dirty: true, persistence: { status: 'never-saved', warnings: [] } });
const workingPath = entry => path.join(entry.projectFolder, `.newdaw-draft-${entry.id}.newdaw.json`);
const descriptorPath = entry => `${workingPath(entry)}.draft.json`;
const sameFingerprint = (a, b) => a && b && ['sha256', 'dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'].every(key => a[key] === b[key]);
const pathString = value => typeof value === 'string' && value.trim() && value.length <= 4096 && !value.includes('\0');

// Only the platform's /var, /tmp and /etc aliases are normalized. User-created
// symlink ancestors are refused, including for a not-yet-created chosen folder.
async function folderPath(input, { create = false, allowMissing = false } = {}) {
  if (!pathString(input)) fail('INVALID_DRAFT_FOLDER', 'Choose a project folder.');
  let filename = path.resolve(input);
  for (const alias of ['/var', '/tmp', '/etc']) if (filename === alias || filename.startsWith(`${alias}/`)) {
    if ((await fs.lstat(alias)).isSymbolicLink() && await fs.realpath(alias) === `/private${alias}`) filename = `/private${filename}`;
    break;
  }
  const root = path.parse(filename).root; let cursor = root, missing = false;
  for (const part of filename.slice(root.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    try { const stat = await fs.lstat(cursor); if (!stat.isDirectory() || stat.isSymbolicLink()) fail('UNSAFE_DRAFT_PATH', 'Draft folders must be regular directories without symbolic-link ancestors.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; missing = true; if (!allowMissing && !create) throw error; }
  }
  if (missing && create) { await fs.mkdir(filename, { recursive: true, mode: 0o700 }); return folderPath(filename); }
  return filename;
}
// Shared by location preferences so preview and creation enforce the same
// directory/ancestor policy. Callers choose whether creation is authorized.
export { folderPath as validateProjectFolderPath };
async function registryPath(input, { create = false } = {}) {
  if (!pathString(input)) fail('INVALID_DRAFT_REGISTRY', 'A draft registry path is required.');
  return path.join(await folderPath(path.dirname(path.resolve(input)), { create, allowMissing: !create }), path.basename(input));
}
function validateRegistry(value) {
  if (!exact(value, ['schemaVersion', 'id', 'revision', 'nextNumber', 'entries']) || value.schemaVersion !== 1 || !uuid.test(value.id) || !integer(value.revision) ||
      !Number.isSafeInteger(value.nextNumber) || value.nextNumber < 1 || !Array.isArray(value.entries) || value.entries.length > MAX_DRAFTS) fail('INVALID_DRAFT_REGISTRY', 'The draft registry is invalid and was preserved.');
  const ids = new Set(), numbers = new Set();
  for (const entry of value.entries) {
    if (!exact(entry, ['id', 'projectId', 'number', 'name', 'projectFolder', 'createdAt']) || !uuid.test(entry.id) || typeof entry.projectId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(entry.projectId) ||
        !Number.isSafeInteger(entry.number) || entry.number < 1 || entry.number >= value.nextNumber || entry.name !== `Untitled${entry.number}` ||
        !pathString(entry.projectFolder) || !path.isAbsolute(entry.projectFolder) || path.normalize(entry.projectFolder) !== entry.projectFolder || !iso(entry.createdAt) || ids.has(entry.id) || numbers.has(entry.number)) fail('INVALID_DRAFT_REGISTRY', 'A draft registry entry is invalid and was preserved.');
    ids.add(entry.id); numbers.add(entry.number);
  }
  return value;
}
async function readRegistry(filename) {
  for (let attempt = 0; ; attempt++) try { return { registry: validateRegistry(JSON.parse((await readSidecar(filename, MAX_REGISTRY_BYTES)).toString('utf8'))), exists: true }; }
  catch (error) {
    if (error.code === 'FILE_CHANGED' && attempt < 3) { await delay(1); continue; }
    if (error.code === 'ENOENT') return { registry: { schemaVersion: 1, id: null, revision: 0, nextNumber: 1, entries: [] }, exists: false };
    if (error instanceof SyntaxError) fail('INVALID_DRAFT_REGISTRY', 'Draft registry JSON is corrupt and was preserved.');
    throw error;
  }
}
async function writeChecked(filename, value, { noClobber = false, limit = MAX_REGISTRY_BYTES } = {}) {
  const bytes = encode(value); if (bytes.length > limit) fail('DRAFT_FILE_TOO_LARGE', 'Draft metadata exceeds its size limit.');
  try { await writeSidecar(filename, bytes, { noClobber }); return []; }
  catch (error) {
    let committed = false; try { committed = (await readSidecar(filename, limit)).equals(bytes); } catch {}
    if (committed) return [warning('DRAFT_COMMITTED_WITH_WARNING', `Draft metadata was published, but finalization reported: ${error.message}`)];
    throw error;
  }
}
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; } };
async function directory(filename) { const stat = await fs.lstat(filename); if (!stat.isDirectory() || stat.isSymbolicLink()) fail('UNSAFE_DRAFT_LOCK', 'The draft registry lock is not a regular directory.'); }
async function owner(lock) {
  await directory(lock); const value = JSON.parse((await readSidecar(path.join(lock, 'owner.json'), 4096)).toString('utf8'));
  if (!exact(value, ['pid', 'token', 'createdAt']) || !Number.isSafeInteger(value.pid) || value.pid <= 0 || !uuid.test(value.token) || !iso(value.createdAt)) fail('INVALID_DRAFT_LOCK', 'Draft registry lock ownership cannot be verified.');
  return value;
}
const transient = error => ['ENOENT', 'FILE_CHANGED'].includes(error.code);
async function acquireRegistryLock(filename) {
  const lock = `${filename}.lock`, reclaim = `${lock}.reclaim`, deadline = performance.now() + 2000;
  for (;;) {
    try { await directory(reclaim); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      try {
        await fs.mkdir(lock, { mode: 0o700 }); const mine = { pid: process.pid, token: randomUUID(), createdAt: new Date().toISOString() };
        try { await writeChecked(path.join(lock, 'owner.json'), mine, { noClobber: true, limit: 4096 }); }
        catch (error) { await fs.unlink(path.join(lock, 'owner.json')).catch(() => {}); await fs.rmdir(lock).catch(() => {}); throw error; }
        return async () => { if ((await owner(lock)).token !== mine.token) fail('DRAFT_LOCK_CHANGED', 'Replacement draft registry lock was preserved.', 409); await fs.unlink(path.join(lock, 'owner.json')); await fs.rmdir(lock); };
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        let observed; try { observed = await owner(lock); } catch (error) { if (!transient(error)) throw error; }
        if (observed && !alive(observed.pid)) {
          let held = false;
          try {
            await fs.mkdir(reclaim); held = true; const fresh = await owner(lock);
            if (fresh.token === observed.token && !alive(fresh.pid)) {
              if ((await fs.readdir(lock)).sort().join(',') !== 'owner.json') fail('INVALID_DRAFT_LOCK', 'Unknown stale-lock files were preserved.');
              await fs.unlink(path.join(lock, 'owner.json')); await fs.rmdir(lock);
            }
          } catch (error) { if (error.code !== 'EEXIST' && !transient(error)) throw error; }
          finally { if (held) await fs.rmdir(reclaim); }
        }
      }
    }
    if (performance.now() >= deadline) fail('DRAFT_REGISTRY_LOCKED', 'Another process is updating drafts. Retry after it finishes.', 409);
    await delay(15);
  }
}
async function withRegistry(input, action) {
  const filename = await registryPath(input, { create: true }), previous = queues.get(filename) ?? Promise.resolve();
  const operation = previous.catch(() => {}).then(async () => {
    const release = await acquireRegistryLock(filename); let result;
    try { return result = await action(filename, await readRegistry(filename)); }
    finally { try { await release(); } catch (error) { if (result?.warnings) result.warnings.push(warning('DRAFT_LOCK_RELEASE_FAILED', error.message)); } }
  });
  queues.set(filename, operation); try { return await operation; } finally { if (queues.get(filename) === operation) queues.delete(filename); }
}
function entryFor(registry, id) { if (!uuid.test(id)) fail('INVALID_DRAFT_ID', 'Choose a registered draft UUID.'); const entry = registry.entries.find(item => item.id === id); if (!entry) fail('DRAFT_NOT_FOUND', 'This draft is not registered.', 404); return entry; }
function descriptorFor(registry, entry) { return { schemaVersion: 1, registryId: registry.id, draftId: entry.id, projectId: entry.projectId, number: entry.number, name: entry.name, projectFolder: entry.projectFolder, createdAt: entry.createdAt, state: 'ready', publication: null }; }
async function readDescriptor(registry, entry) {
  await folderPath(entry.projectFolder);
  let value;
  try { value = JSON.parse((await readSidecar(descriptorPath(entry), MAX_DESCRIPTOR_BYTES)).toString('utf8')); }
  catch (error) { if (error instanceof SyntaxError) fail('INVALID_DRAFT_DESCRIPTOR', 'Draft descriptor JSON is corrupt and was preserved.'); throw error; }
  const expected = descriptorFor(registry, entry);
  if (!exact(value, Object.keys(expected)) || Object.keys(expected).filter(key => !['state', 'publication'].includes(key)).some(key => value[key] !== expected[key]) || !['ready', 'publishing', 'published'].includes(value.state)) fail('INVALID_DRAFT_DESCRIPTOR', 'Draft ownership metadata does not match its registry and was preserved.');
  const publication = value.publication;
  if (value.state === 'ready' ? publication !== null : !exact(publication, ['id', 'targetPath', 'projectHash', 'revision', 'createdAt', 'publishedAt']) ||
      !uuid.test(publication.id) || !pathString(publication.targetPath) || !path.isAbsolute(publication.targetPath) || path.normalize(publication.targetPath) !== publication.targetPath ||
      !sha.test(publication.projectHash) || !integer(publication.revision) || !iso(publication.createdAt) || (value.state === 'published' ? !iso(publication.publishedAt) : publication.publishedAt !== null)) fail('INVALID_DRAFT_DESCRIPTOR', 'Draft publication metadata is invalid and was preserved.');
  return value;
}
async function publicationState(descriptor) {
  if (descriptor.state === 'ready') return { status: 'ready', resumable: true, warnings: [] };
  if (descriptor.state === 'published') return { status: 'published', resumable: false, targetPath: descriptor.publication.targetPath, warnings: [] };
  const point = descriptor.publication;
  try {
    await folderPath(path.dirname(point.targetPath));
    const project = JSON.parse((await readSidecar(point.targetPath, MAX_PROJECT_BYTES)).toString('utf8')); validateProject(project);
    if (project.id !== descriptor.projectId || project.revision !== point.revision || canonicalProjectHash(project) !== point.projectHash) fail('DRAFT_PUBLICATION_AMBIGUOUS', 'A different file occupies the first-Save destination. The draft cannot be resumed automatically.', 409);
    return { status: 'published', resumable: false, targetPath: point.targetPath, warnings: [warning('DRAFT_PUBLICATION_RECOVERED', 'First Save committed before draft metadata was finalized. Open the named project instead.')] };
  } catch (error) {
    if (error.code === 'ENOENT') return { status: 'incomplete', resumable: true, targetPath: point.targetPath, warnings: [warning('DRAFT_PUBLICATION_INCOMPLETE', 'First Save did not publish a project file. The draft remains recoverable; any partial destination sidecars were retained.')] };
    if (error.code === 'DRAFT_PUBLICATION_AMBIGUOUS') throw error;
    fail('DRAFT_PUBLICATION_AMBIGUOUS', `The first-Save destination cannot be verified: ${error.message}`, 409);
  }
}
function draftMetadata(registry, entry, descriptor) { return { id: entry.id, registryId: registry.id, neverSaved: true, number: entry.number, name: entry.name, projectFolder: entry.projectFolder, workingPath: workingPath(entry), descriptorPath: descriptorPath(entry), state: descriptor.state }; }
async function inspectOwned(registry, entry, { deferredMedia = true } = {}) {
  const descriptor = await readDescriptor(registry, entry), lifecycle = await publicationState(descriptor);
  if (!lifecycle.resumable) fail('DRAFT_ALREADY_PUBLISHED', 'This draft has already been saved as a named project. Open that project instead.', 409, { targetPath: lifecycle.targetPath });
  const inspected = await inspectExistingProject(workingPath(entry), { draftId: entry.id, deferredMedia });
  if (inspected.project.id !== entry.projectId) fail('DRAFT_PROJECT_MISMATCH', 'Draft working project does not match its registered identity.');
  return { ...inspected, saved: neverSaved(), draft: draftMetadata(registry, entry, descriptor), lifecycle, willInitializeSavedCheckpoint: false,
    warnings: [...inspected.warnings.filter(item => item.code !== 'SAVE_CHECKPOINT_MISSING'), ...lifecycle.warnings] };
}

export async function previewDraft(input, { projectFolder, sampleRate = 48000 } = {}) {
  const filename = await registryPath(input), folder = await folderPath(projectFolder, { allowMissing: true }), loaded = await readRegistry(filename);
  new Engine(createProject({ sampleRate }));
  if (loaded.registry.entries.length >= MAX_DRAFTS) fail('DRAFT_LIMIT', `At most ${MAX_DRAFTS} draft descriptors may be registered.`);
  return { revision: loaded.registry.revision, nextNumber: loaded.registry.nextNumber, name: `Untitled${loaded.registry.nextNumber}`, projectFolder: folder, sampleRate, warnings: [] };
}
export async function createDraft(input, { projectFolder, existingFolder, sampleRate = 48000, expectedRegistryRevision, reserveTarget, settings = structuredClone(DEFAULT_SESSION_SETTINGS) } = {}) {
  if (!integer(expectedRegistryRevision)) fail('EXPECTED_DRAFT_REVISION_REQUIRED', 'Provide the draft registry revision from preview.');
  if (typeof reserveTarget !== 'function') fail('TARGET_RESERVATION_REQUIRED', 'Draft creation requires a project lock reservation.');
  validateSessionSettings(settings); new Engine(createProject({ sampleRate }));
  const folder = await folderPath(projectFolder, { allowMissing: true });
  const requiredFolder = existingFolder === undefined ? null : await folderPath(existingFolder);
  if (requiredFolder !== null && folder !== requiredFolder && path.dirname(folder) !== requiredFolder) fail('INVALID_DRAFT_FOLDER', 'The project folder must be the selected existing folder or its immediate child.');
  return withRegistry(input, async (filename, loaded) => {
    const registry = loaded.registry;
    if (registry.revision !== expectedRegistryRevision) fail('DRAFT_REGISTRY_CONFLICT', 'Draft numbering changed. Preview the new project again.', 409);
    if (registry.entries.length >= MAX_DRAFTS) fail('DRAFT_LIMIT', `At most ${MAX_DRAFTS} draft descriptors may be registered.`);
    if (registry.revision >= Number.MAX_SAFE_INTEGER || registry.nextNumber >= Number.MAX_SAFE_INTEGER) fail('DRAFT_COUNTER_OVERFLOW', 'Draft numbering cannot be incremented safely.');
    if (requiredFolder !== null) await folderPath(requiredFolder);
    const id = randomUUID(), number = registry.nextNumber, project = createProject({ name: `Untitled${number}`, sampleRate,fixedTempo:true }), engine = new Engine(project);
    const entry = { id, projectId: project.id, number, name: project.name, projectFolder: folder, createdAt: new Date().toISOString() };
    registry.id ??= randomUUID(); registry.entries.push(entry); registry.nextNumber++; registry.revision++;
    // Reserve the global number and recovery pointer before any working files.
    // Interrupted creation remains discoverable as incomplete; numbers never reuse.
    const warnings = await writeChecked(filename, validateRegistry(registry), { noClobber: !loaded.exists });
    let releaseLock;
    try {
      if (requiredFolder === null) await folderPath(folder, { create: true });
      else {
        // Location preferences authorize one child only. A removed selected
        // folder must never be recreated by recursive mkdir or lock setup.
        await folderPath(requiredFolder);
        if (folder !== requiredFolder) {
          try { await fs.mkdir(folder, { recursive: false, mode: 0o700 }); }
          catch (error) { if (error.code !== 'EEXIST') throw error; }
        }
        await folderPath(folder);
      }
      releaseLock = await reserveTarget(workingPath(entry), ...(requiredFolder === null ? [] : [{ createParent: false }]));
      if (typeof releaseLock !== 'function') fail('TARGET_RESERVATION_REQUIRED', 'Reservation must return a lock release function.');
      for (const suffix of ['', '.history.json', '.saved.json', '.bak', '.autobackups.json', '.media-ownership.json', '.draft.json']) {
        try { await fs.lstat(`${workingPath(entry)}${suffix}`); fail('OUTPUT_EXISTS', 'A file already occupies the reserved draft path; it was preserved.', 409); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      const descriptor = descriptorFor(registry, entry);
      warnings.push(...await writeChecked(descriptorPath(entry), descriptor, { noClobber: true, limit: MAX_DESCRIPTOR_BYTES }));
      const stored = await updateSessionSettings(workingPath(entry), engine.checkpoint(), settings); warnings.push(...stored.warnings);
      warnings.push(...await writeChecked(workingPath(entry), project, { noClobber: true, limit: MAX_PROJECT_BYTES }));
      const prepared = await inspectOwned(registry, entry, { deferredMedia: true });
      return { ...prepared, releaseLock, registryRevision: registry.revision, warnings: [...warnings, ...prepared.warnings] };
    } catch (error) {
      await releaseLock?.().catch(() => {});
      error.details = { ...error.details, draftId: id, numberReserved: true, recoveryRetained: true }; throw error;
    }
  });
}
export async function listDrafts(input) {
  let loaded;
  try { loaded = await readRegistry(await registryPath(input)); }
  catch (error) { return { status: 'unavailable', revision: null, nextNumber: null, entries: [], warnings: [warning(error.code ?? 'INVALID_DRAFT_REGISTRY', `${error.message} The registry was preserved.`)] }; }
  const entries = [];
  for (const entry of loaded.registry.entries.toReversed()) {
    try {
      const descriptor = await readDescriptor(loaded.registry, entry), lifecycle = await publicationState(descriptor);
      if (lifecycle.resumable) {
        const project = JSON.parse((await readSidecar(workingPath(entry), MAX_PROJECT_BYTES)).toString('utf8')); validateProject(project);
        if (project.id !== entry.projectId) fail('DRAFT_PROJECT_MISMATCH', 'Draft project identity changed.');
        entries.push({ id: entry.id, name: project.name, number: entry.number, projectFolder: entry.projectFolder, createdAt: entry.createdAt, projectRevision: project.revision, ...lifecycle });
      } else entries.push({ id: entry.id, name: entry.name, number: entry.number, projectFolder: entry.projectFolder, createdAt: entry.createdAt, ...lifecycle });
    } catch (error) { entries.push({ id: entry.id, name: entry.name, number: entry.number, projectFolder: entry.projectFolder, createdAt: entry.createdAt, status: error.code === 'DRAFT_PUBLICATION_AMBIGUOUS' ? 'ambiguous' : 'unavailable', resumable: false, warnings: [warning(error.code ?? 'INVALID_DRAFT', error.message)] }); }
  }
  return { status: loaded.exists ? 'ready' : 'new', revision: loaded.registry.revision, nextNumber: loaded.registry.nextNumber, entries, warnings: [] };
}
export async function inspectDraft(input, id, options = {}) {
  const { registry } = await readRegistry(await registryPath(input)); return inspectOwned(registry, entryFor(registry, id), options);
}
export async function prepareDraft(input, id, { expectedFingerprint, reserveTarget, deferredMedia = true } = {}) {
  if (typeof reserveTarget !== 'function') fail('TARGET_RESERVATION_REQUIRED', 'Draft recovery requires a project lock.');
  if (!expectedFingerprint || !sha.test(expectedFingerprint.sha256) || ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'].some(key => !Number.isFinite(expectedFingerprint[key]) || expectedFingerprint[key] < 0)) fail('EXPECTED_FINGERPRINT_REQUIRED', 'Inspect the draft before recovery.');
  return withRegistry(input, async (filename, { registry }) => {
    const entry = entryFor(registry, id); await readDescriptor(registry, entry);
    let releaseLock;
    try {
      releaseLock = await reserveTarget(workingPath(entry)); if (typeof releaseLock !== 'function') fail('TARGET_RESERVATION_REQUIRED', 'Reservation must return a release function.');
      const inspected = await inspectOwned(registry, entry, { deferredMedia });
      if (!sameFingerprint(inspected.fingerprint, expectedFingerprint)) fail('PROJECT_FILE_CHANGED', 'Draft working file changed after preview.', 409);
      const loaded = await loadSessionState(workingPath(entry), inspected.project), engine = new Engine(inspected.project); if (loaded.history) engine.restoreHistory(loaded.history);
      if (inspected.lifecycle.status === 'incomplete') {
        const descriptor = await readDescriptor(registry, entry); descriptor.state = 'ready'; descriptor.publication = null;
        inspected.warnings.push(...await writeChecked(descriptorPath(entry), descriptor, { limit: MAX_DESCRIPTOR_BYTES })); inspected.draft.state = 'ready';
      }
      const final = await inspectOwned(registry, entry, { deferredMedia: true });
      if (!sameFingerprint(final.fingerprint, expectedFingerprint)) fail('PROJECT_FILE_CHANGED', 'Draft changed during recovery.', 409);
      return { ...inspected, checkpoint: engine.checkpoint(), settings: loaded.settings, persistence: loaded.persistence, releaseLock,
        warnings: [...inspected.warnings, ...loaded.persistence.warnings] };
    } catch (error) { await releaseLock?.().catch(() => {}); throw error; }
  });
}
export async function beginDraftPublication(input, id, { targetPath, project } = {}) {
  validateProject(project); if (!pathString(targetPath)) fail('INVALID_DRAFT_DESTINATION', 'Choose a filename for the first Save.');
  const target = path.join(await folderPath(path.dirname(path.resolve(targetPath))), path.basename(targetPath));
  return withRegistry(input, async (filename, { registry }) => {
    const entry = entryFor(registry, id), inspected = await inspectOwned(registry, entry, { deferredMedia: true });
    if (target === workingPath(entry) || /^\.newdaw-draft-[a-f0-9-]{36}\.newdaw\.json$/.test(path.basename(target))) fail('INVALID_DRAFT_DESTINATION', 'First Save needs a named project filename.');
    if (project.id !== entry.projectId || project.ppq !== inspected.project.ppq || project.sampleRate !== inspected.project.sampleRate) fail('DRAFT_PROJECT_MISMATCH', 'First Save must retain the draft identity and timebase.');
    if (canonicalProjectHash(project) !== canonicalProjectHash(inspected.project)) fail('PROJECT_FILE_CHANGED', 'The draft working project changed before first Save. Refresh before publishing it.', 409);
    try { await fs.lstat(target); fail('OUTPUT_EXISTS', 'First Save destination already exists.', 409); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const descriptor = await readDescriptor(registry, entry);
    if (descriptor.state === 'publishing') fail('DRAFT_PUBLICATION_PENDING', 'Resolve the previous first-Save attempt before starting another.', 409);
    descriptor.state = 'publishing'; descriptor.publication = { id: randomUUID(), targetPath: target, projectHash: canonicalProjectHash(project), revision: project.revision, createdAt: new Date().toISOString(), publishedAt: null };
    const warnings = await writeChecked(descriptorPath(entry), descriptor, { limit: MAX_DESCRIPTOR_BYTES });
    return { status: 'publishing', intentId: descriptor.publication.id, targetPath: target, warnings };
  });
}
async function finishPublication(input, id, intentId, abort) {
  if (!uuid.test(intentId)) fail('INVALID_DRAFT_INTENT', 'A first-Save intent UUID is required.');
  return withRegistry(input, async (filename, { registry }) => {
    const entry = entryFor(registry, id), descriptor = await readDescriptor(registry, entry);
    if (descriptor.publication?.id !== intentId) fail('DRAFT_PUBLICATION_CONFLICT', 'The first-Save intent changed.', 409);
    const lifecycle = await publicationState(descriptor), warnings = [...lifecycle.warnings];
    if (lifecycle.status === 'incomplete') {
      if (!abort) fail('DRAFT_NOT_PUBLISHED', 'No matching named project has committed yet.', 409);
      descriptor.state = 'ready'; descriptor.publication = null;
    } else {
      descriptor.state = 'published'; descriptor.publication.publishedAt ??= new Date().toISOString();
    }
    warnings.push(...await writeChecked(descriptorPath(entry), descriptor, { limit: MAX_DESCRIPTOR_BYTES }));
    return { status: descriptor.state, resumable: descriptor.state === 'ready', targetPath: descriptor.publication?.targetPath ?? null, warnings };
  });
}
export const finalizeDraftPublication = (input, id, { intentId } = {}) => finishPublication(input, id, intentId, false);
export const abortDraftPublication = (input, id, { intentId } = {}) => finishPublication(input, id, intentId, true);
