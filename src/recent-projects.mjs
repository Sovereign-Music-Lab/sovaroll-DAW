import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { validateProject } from './core/engine.mjs';
import { readSidecar, writeSidecar } from './session-store.mjs';

// Twenty entries is a newdaw product choice, not a manual-derived restriction.
export const MAX_RECENT_PROJECTS = 20;
const MAX_REGISTRY_BYTES = 256 * 1024, MAX_PROJECT_BYTES = 16 * 1024 * 1024;
const queues = new Map(), uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/, sha = /^[a-f0-9]{64}$/;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const clone = value => structuredClone(value);
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const integer = value => Number.isSafeInteger(value) && value >= 0;
const fail = (code, message, details) => { throw Object.assign(new Error(message), { code, status: ['RECENT_REVISION_CONFLICT', 'RECENT_LOCKED'].includes(code) ? 409 : 422, ...(details ? { details } : {}) }); };
const empty = () => ({ schemaVersion: 1, revision: 0, sequence: 0, entries: [] });
const encoded = value => Buffer.from(`${JSON.stringify(value)}\n`);

function checkedPath(value, kind) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0') || value.length > 4096) fail('INVALID_RECENT_PATH', `${kind} must be a nonempty filesystem path.`);
  return path.resolve(value);
}
async function canonicalRegistry(input, { createParent = false } = {}) {
  const resolved = checkedPath(input, 'Registry path'), parent = path.dirname(resolved);
  if (createParent) await fs.mkdir(parent, { recursive: true });
  // Canonicalize existing parents for process/local alias deduplication, but
  // never follow the registry file itself if somebody replaces it with a link.
  try { return path.join(await fs.realpath(parent), path.basename(resolved)); }
  catch (error) { if (error.code === 'ENOENT' && !createParent) return resolved; throw error; }
}
function validateRegistry(value) {
  if (!exact(value, ['schemaVersion', 'revision', 'sequence', 'entries']) || value.schemaVersion !== 1 || !integer(value.revision) || !integer(value.sequence) ||
      !Array.isArray(value.entries) || value.entries.length > MAX_RECENT_PROJECTS) fail('INVALID_RECENT_REGISTRY', 'Recent-project registry envelope is invalid; it was preserved.');
  const ids = new Set(), paths = new Set(), sequences = new Set(); let previous = Number.POSITIVE_INFINITY;
  for (const entry of value.entries) {
    if (!exact(entry, ['id', 'projectPath', 'projectId', 'name', 'lastOpened', 'sequence', 'sha256']) || !uuid.test(entry.id) ||
        typeof entry.projectPath !== 'string' || !path.isAbsolute(entry.projectPath) || path.normalize(entry.projectPath) !== entry.projectPath || entry.projectPath.includes('\0') || entry.projectPath.length > 4096 ||
        typeof entry.projectId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(entry.projectId) || typeof entry.name !== 'string' || !entry.name.trim() || entry.name.length > 256 ||
        !iso(entry.lastOpened) || !integer(entry.sequence) || entry.sequence < 1 || entry.sequence > value.sequence || entry.sequence >= previous || !sha.test(entry.sha256) ||
        ids.has(entry.id) || paths.has(entry.projectPath) || sequences.has(entry.sequence)) fail('INVALID_RECENT_REGISTRY', 'Recent-project entry is invalid, duplicated, or out of order; the registry was preserved.');
    previous = entry.sequence; ids.add(entry.id); paths.add(entry.projectPath); sequences.add(entry.sequence);
  }
  return value;
}
async function readRegistry(filename) {
  try {
    const bytes = await readSidecar(filename, MAX_REGISTRY_BYTES); let value;
    try { value = JSON.parse(bytes.toString('utf8')); } catch { fail('INVALID_RECENT_REGISTRY', 'Recent-project registry JSON is corrupt; the original was preserved.'); }
    return { registry: validateRegistry(value), exists: true, bytes };
  }
  catch (error) { if (error.code === 'ENOENT') return { registry: empty(), exists: false, bytes: null }; throw error; }
}
async function inspectProject(filename) {
  // Stored paths are canonical. A later final-component symbolic-link swap is
  // unreadable, rather than silently following it to an unrelated project.
  const bytes = await readSidecar(filename, MAX_PROJECT_BYTES);
  const project = JSON.parse(bytes.toString('utf8')); validateProject(project);
  return { project, sha256: hash(bytes) };
}
function inspectionStatus(error) {
  if (error.code === 'ENOENT') return 'missing';
  if (error instanceof SyntaxError || error.name === 'EngineError') return 'invalid';
  return 'unreadable';
}

/** Read-only, including on absent/corrupt stores. Never silently resets a file. */
export async function listRecentProjects(input, { inspect = true } = {}) {
  if (typeof inspect !== 'boolean') fail('INVALID_RECENT_OPTIONS', 'inspect must be boolean.');
  checkedPath(input, 'Registry path');
  let loaded;
  try { loaded = await readRegistry(await canonicalRegistry(input)); }
  catch (error) { return { status: 'unavailable', revision: null, entries: [], warnings: [{ code: error.code ?? 'INVALID_RECENT_REGISTRY', message: `${error.message} Recent projects are unavailable; the original registry was preserved.` }] }; }
  const entries = [];
  for (const entry of loaded.registry.entries) {
    const row = clone(entry);
    if (inspect) {
      try {
        const current = await inspectProject(entry.projectPath);
        row.status = current.sha256 === entry.sha256 ? 'ready' : 'changed';
        row.currentProjectId = current.project.id; row.currentName = current.project.name;
      } catch (error) { row.status = inspectionStatus(error); row.error = { code: error.code ?? 'INVALID_PROJECT', message: error.message }; }
    }
    entries.push(row);
  }
  return { status: loaded.exists ? 'ready' : 'new', revision: loaded.registry.revision, entries, warnings: [] };
}

const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; } };
async function regularDirectory(filename) {
  const stat = await fs.lstat(filename);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail('UNSAFE_RECENT_LOCK', 'Recent registry lock must be a regular directory.');
  return stat;
}
async function lockOwner(lockPath) {
  await regularDirectory(lockPath);
  const owner = JSON.parse((await readSidecar(path.join(lockPath, 'owner.json'), 4096)).toString('utf8'));
  if (!exact(owner, ['pid', 'token', 'createdAt']) || !Number.isSafeInteger(owner.pid) || owner.pid <= 0 || !uuid.test(owner.token) || !iso(owner.createdAt)) fail('INVALID_RECENT_LOCK', 'Recent registry lock owner cannot be verified.');
  return owner;
}
// A cooperating writer may remove its owner and a successor may publish a new
// inode between readSidecar's lstat/open/read checks. Such observations prove no
// owner identity, so wait and re-read; never infer that the lock is abandoned.
const transientOwnerRead = error => ['ENOENT', 'FILE_CHANGED'].includes(error.code);
async function acquireLock(filename, timeoutMs) {
  const lockPath = `${filename}.lock`, reclaim = `${lockPath}.reclaim`, deadline = performance.now() + timeoutMs;
  for (;;) {
    try { await regularDirectory(reclaim); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      try {
        await fs.mkdir(lockPath, { mode: 0o700 });
        const owner = { pid: process.pid, token: randomUUID(), createdAt: new Date().toISOString() };
        try { await writeSidecar(path.join(lockPath, 'owner.json'), encoded(owner), { noClobber: true }); }
        catch (failure) { await fs.unlink(path.join(lockPath, 'owner.json')).catch(() => {}); await fs.rmdir(lockPath).catch(() => {}); throw failure; }
        return async () => {
          const current = await lockOwner(lockPath);
          if (current.token !== owner.token) fail('RECENT_LOCK_CHANGED', 'Recent registry lock ownership changed; its replacement was preserved.');
          await fs.unlink(path.join(lockPath, 'owner.json')); await fs.rmdir(lockPath);
        };
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        let owner;
        try { owner = await lockOwner(lockPath); }
        catch (readError) { if (!transientOwnerRead(readError)) throw readError; }
        if (owner && !alive(owner.pid)) {
          let held = false;
          try {
            await fs.mkdir(reclaim, { mode: 0o700 }); held = true;
            const current = await lockOwner(lockPath);
            if (current.token === owner.token && !alive(current.pid)) {
              if ((await fs.readdir(lockPath)).sort().join(',') !== 'owner.json') fail('INVALID_RECENT_LOCK', 'Unknown files in a stale lock were preserved.');
              // The reclaim directory prevents another cooperating writer from
              // replacing this owner between the final check and removal.
              await fs.unlink(path.join(lockPath, 'owner.json')); await fs.rmdir(lockPath);
            }
          } catch (recoveryError) { if (recoveryError.code !== 'EEXIST' && !transientOwnerRead(recoveryError)) throw recoveryError; }
          finally { if (held) await fs.rmdir(reclaim); }
        }
      }
    }
    if (performance.now() >= deadline) fail('RECENT_LOCKED', 'Another process is updating recent projects; retry after it finishes.');
    await delay(15);
  }
}
function options(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['expectedRegistryRevision', 'dryRun', 'lockTimeoutMs'].includes(key)) ||
      !integer(value.expectedRegistryRevision) || (value.dryRun !== undefined && typeof value.dryRun !== 'boolean') ||
      (value.lockTimeoutMs !== undefined && (!Number.isSafeInteger(value.lockTimeoutMs) || value.lockTimeoutMs < 50 || value.lockTimeoutMs > 10000))) fail('INVALID_RECENT_OPTIONS', 'Provide expectedRegistryRevision, optional boolean dryRun and lockTimeoutMs 50..10000.');
  return { ...value, dryRun: value.dryRun ?? false, lockTimeoutMs: value.lockTimeoutMs ?? 2000 };
}
async function publish(filename, registry, existed) {
  const bytes = encoded(validateRegistry(registry));
  if (bytes.length > MAX_REGISTRY_BYTES) fail('RECENT_REGISTRY_TOO_LARGE', 'Recent registry exceeds its byte limit.');
  try { await writeSidecar(filename, bytes, { noClobber: !existed }); return []; }
  catch (error) {
    // A directory-sync error can occur after atomic publication. Do not report
    // an uncommitted edit if the new exact bytes are already the durable target.
    let committed = false;
    try { committed = (await readSidecar(filename, MAX_REGISTRY_BYTES)).equals(bytes); } catch {}
    if (committed) return [{ code: 'RECENT_COMMITTED_WITH_WARNING', message: `Recent projects were published, but finalization reported: ${error.message}` }];
    throw error;
  }
}
async function mutate(input, suppliedOptions, change) {
  const config = options(suppliedOptions), filename = await canonicalRegistry(input, { createParent: !config.dryRun });
  const previous = queues.get(filename) ?? Promise.resolve();
  const operation = previous.catch(() => {}).then(async () => {
    const release = config.dryRun ? null : await acquireLock(filename, config.lockTimeoutMs); let result;
    try {
      const { registry, exists } = await readRegistry(filename);
      if (registry.revision !== config.expectedRegistryRevision) fail('RECENT_REVISION_CONFLICT', 'Recent projects changed; refresh the registry before retrying.', { expectedRegistryRevision: config.expectedRegistryRevision, actualRegistryRevision: registry.revision });
      const next = clone(registry), changed = await change(next);
      if (changed.status === 'unchanged') return result = { ...changed, applied: false, revision: registry.revision, entries: clone(registry.entries), warnings: [] };
      if (registry.revision === Number.MAX_SAFE_INTEGER) fail('RECENT_REVISION_OVERFLOW', 'Recent registry revision cannot be incremented safely.');
      next.revision++; validateRegistry(next);
      const warnings = config.dryRun ? [] : await publish(filename, next, exists);
      return result = { ...changed, status: config.dryRun ? 'validated' : changed.status, applied: !config.dryRun, revision: config.dryRun ? registry.revision : next.revision, ...(config.dryRun ? { plannedRevision: next.revision } : {}), entries: clone(next.entries), warnings };
    } finally {
      if (release) try { await release(); } catch (error) { if (result) result.warnings.push({ code: 'RECENT_LOCK_RELEASE_FAILED', message: error.message }); }
    }
  });
  queues.set(filename, operation);
  try { return await operation; } finally { if (queues.get(filename) === operation) queues.delete(filename); }
}

/** Call only after an open/version/Save As actually succeeded. Registry errors
 * must be surfaced as warnings without rolling back the active document. */
export async function recordRecentProject(recentPath, projectPath, suppliedOptions) {
  const requested = checkedPath(projectPath, 'Project path');
  return mutate(recentPath, suppliedOptions, async registry => {
    const canonical = await fs.realpath(requested), current = await inspectProject(canonical);
    if (canonical.length > 4096) fail('INVALID_RECENT_PATH', 'Canonical project path exceeds its length limit.');
    if (registry.sequence === Number.MAX_SAFE_INTEGER) fail('RECENT_SEQUENCE_OVERFLOW', 'Recent project order cannot be incremented safely.');
    const existing = registry.entries.find(entry => entry.projectPath === canonical);
    const entry = { id: existing?.id ?? randomUUID(), projectPath: canonical, projectId: current.project.id, name: current.project.name, lastOpened: new Date().toISOString(), sequence: ++registry.sequence, sha256: current.sha256 };
    registry.entries = [entry, ...registry.entries.filter(row => row.projectPath !== canonical)].slice(0, MAX_RECENT_PROJECTS);
    return { status: 'recorded', entry: clone(entry) };
  });
}

export async function removeRecentProject(recentPath, entryId, suppliedOptions) {
  if (typeof entryId !== 'string' || !uuid.test(entryId)) fail('INVALID_RECENT_ID', 'Recent entry ID must be an opaque UUID.');
  return mutate(recentPath, suppliedOptions, registry => {
    const entry = registry.entries.find(row => row.id === entryId);
    if (!entry) fail('RECENT_NOT_FOUND', 'Recent entry does not exist or was already removed.');
    registry.entries = registry.entries.filter(row => row.id !== entryId);
    return { status: 'removed', removedIds: [entryId] };
  });
}

export async function clearRecentProjects(recentPath, suppliedOptions) {
  return mutate(recentPath, suppliedOptions, registry => {
    if (!registry.entries.length) return { status: 'unchanged', removedIds: [] };
    const removedIds = registry.entries.map(entry => entry.id); registry.entries = [];
    return { status: 'cleared', removedIds };
  });
}
