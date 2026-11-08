import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { validateProject } from './core/engine.mjs';
import { canonicalProjectHash, readSidecar, writeSidecar, quarantineSidecar, MAX_JOURNAL_BYTES } from './session-store.mjs';

const MAX_REGISTRY_BYTES = 8 * 1024 * 1024;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const sha = /^[a-f0-9]{64}$/;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const exact = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const fault = (message, code = 'INVALID_BACKUP') => Object.assign(new Error(message), { code, status: code === 'NOT_FOUND' ? 404 : 422 });
const queues = new Map();

async function exclusive(projectPath, work) {
  const key = path.resolve(projectPath), previous = queues.get(key) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(work);
  queues.set(key, current);
  try { return await current; } finally { if (queues.get(key) === current) queues.delete(key); }
}

const registryPath = projectPath => `${projectPath}.autobackups.json`;
const backupName = (projectPath, owner, sequence, id) => `${path.basename(projectPath)}.autosave-${owner}-${sequence}-${id}.bak`;
const numberedName = (baseName, sequence) => `${baseName}-${String(sequence).padStart(2, '0')}.bak`;
export function backupBaseName(projectPath) {
  const name = path.basename(projectPath), extension = name.endsWith('.newdaw.json') ? '.newdaw.json' : path.extname(name);
  return (extension ? name.slice(0, -extension.length) : name) || name;
}
function validateBaseName(baseName, projectPath) {
  if (typeof baseName !== 'string' || !baseName.trim() || ['.', '..'].includes(baseName) || /[/\\\0]/.test(baseName) || Buffer.byteLength(baseName) > 220 ||
      (/^\.newdaw-draft-[a-f0-9-]{36}\.newdaw\.json$/.test(path.basename(projectPath)) ? !/^Untitled[1-9]\d*$/.test(baseName) : baseName !== backupBaseName(projectPath))) throw fault('Invalid numbered backup base name.', 'INVALID_BACKUP_SETTINGS');
}
const registryBytes = registry => Buffer.from(`${JSON.stringify(registry)}\n`);
const order = entries => entries.toSorted((a, b) => b.sequence - a.sequence);

// Pure validation shared with read-only project/draft previews. It must never
// quarantine files or initialize a registry while inspecting an open target.
export function validateBackupRegistry(value, projectPath, expectedProjectId) {
  if (!exact(value, ['schemaVersion', 'projectFile', 'projectId', 'owner', 'sequence', 'entries', ...(value?.schemaVersion === 2 ? ['baseName'] : [])]) || ![1, 2].includes(value.schemaVersion) ||
      value.projectFile !== path.basename(projectPath) || typeof value.projectId !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(value.projectId) ||
      !uuid.test(value.owner) || !Number.isSafeInteger(value.sequence) || value.sequence < 0 || !Array.isArray(value.entries) || value.entries.length > 10000 ||
      (expectedProjectId !== undefined && value.projectId !== expectedProjectId)) throw fault('Invalid auto-backup registry.');
  if (value.schemaVersion === 2) validateBaseName(value.baseName, projectPath);
  const ids = new Set(), sequences = new Set();
  for (const entry of value.entries) {
    if (!exact(entry, ['id', 'sequence', 'file', 'projectId', 'revision', 'fingerprint', 'sha256', 'bytes', 'createdAt']) || !uuid.test(entry.id) ||
        !Number.isSafeInteger(entry.sequence) || entry.sequence < 1 || entry.sequence > value.sequence ||
        (entry.file !== backupName(projectPath, value.owner, entry.sequence, entry.id) && !(value.schemaVersion === 2 && entry.file === numberedName(value.baseName, entry.sequence))) || entry.projectId !== value.projectId ||
        !Number.isSafeInteger(entry.revision) || entry.revision < 0 || !sha.test(entry.fingerprint) || !sha.test(entry.sha256) ||
        !Number.isSafeInteger(entry.bytes) || entry.bytes < 1 || entry.bytes > MAX_JOURNAL_BYTES ||
        typeof entry.createdAt !== 'string' || !Number.isFinite(Date.parse(entry.createdAt)) || new Date(entry.createdAt).toISOString() !== entry.createdAt ||
        ids.has(entry.id) || sequences.has(entry.sequence)) throw fault('Invalid auto-backup registry entry.');
    ids.add(entry.id); sequences.add(entry.sequence);
  }
  return value;
}

async function readRegistry(projectPath) {
  const filename = registryPath(projectPath);
  try {
    const registry = validateBackupRegistry(JSON.parse((await readSidecar(filename, MAX_REGISTRY_BYTES)).toString('utf8')), projectPath);
    return { registry, warnings: [], status: 'ready' };
  } catch (error) {
    if (error.code === 'ENOENT') return { registry: null, warnings: [], status: 'new' };
    const preserved = await quarantineSidecar(filename);
    return { registry: null, status: 'reset', warnings: [{ code: 'BACKUP_REGISTRY_INVALID', message: `${error.message} The registry was preserved; unregistered backups will not be deleted.`, preserved }] };
  }
}

async function verifyEntry(projectPath, entry) {
  const bytes = await readSidecar(path.join(path.dirname(projectPath), entry.file));
  if (bytes.length !== entry.bytes || hash(bytes) !== entry.sha256) throw fault('Backup bytes do not match the registered checksum.', 'BACKUP_CHANGED');
  const project = JSON.parse(bytes.toString('utf8'));
  validateProject(project);
  if (project.id !== entry.projectId || project.revision !== entry.revision || canonicalProjectHash(project) !== entry.fingerprint) throw fault('Backup project does not match its registry identity.', 'BACKUP_CHANGED');
  return { bytes, project, entry: structuredClone(entry) };
}

async function removeCreated(projectPath, entry) {
  // A failed registry write must not remove a file somebody replaced after
  // publication, even if it still occupies our numbered filename.
  try { await verifyEntry(projectPath, entry); await fs.unlink(path.join(path.dirname(projectPath), entry.file)); }
  catch { /* A changed or missing snapshot is retained for inspection. */ }
}

async function inspect(projectPath, registry) {
  const files = [], warnings = [];
  for (const entry of order(registry?.entries ?? [])) {
    try {
      await verifyEntry(projectPath, entry);
      files.push({ ...entry, valid: true, available: true });
    } catch (error) {
      files.push({ ...entry, valid: false, available: error.code !== 'ENOENT', error: { code: error.code ?? 'INVALID_BACKUP', message: error.message } });
      warnings.push({ code: 'BACKUP_UNAVAILABLE', message: `Backup ${entry.file} could not be verified and will not be removed automatically.`, id: entry.id });
    }
  }
  return { files, warnings, lastFingerprint: files.find(entry => entry.valid)?.fingerprint ?? null };
}

async function listInternal(projectPath) {
  const loaded = await readRegistry(projectPath), inspected = await inspect(projectPath, loaded.registry);
  return { status: loaded.status, files: inspected.files, warnings: [...loaded.warnings, ...inspected.warnings], lastFingerprint: inspected.lastFingerprint };
}

export async function listBackups(projectPath) {
  return exclusive(projectPath, () => listInternal(projectPath));
}

export async function readBackup(projectPath, id) {
  if (typeof id !== 'string' || !uuid.test(id)) throw fault('Backup ID must be a registered UUID.', 'INVALID_BACKUP_ID');
  return exclusive(projectPath, async () => {
    const loaded = await readRegistry(projectPath);
    const entry = loaded.registry?.entries.find(entry => entry.id === id);
    if (!entry) throw fault('Backup ID was not found in the registry.', 'NOT_FOUND');
    return verifyEntry(projectPath, entry);
  });
}

/** JSON-only snapshots: referenced WAV files remain in the project media store.
 * Rotation is based on registry ownership plus a verified byte checksum, never
 * on a wildcard filename match. The caller owns timer/dirty-state semantics.
 */
export async function createAutoBackup(projectPath, project, { maxCount = 10, force = false, now = new Date(), writeRegistry = writeSidecar, baseName } = {}) {
  validateProject(project);
  if (baseName !== undefined) validateBaseName(baseName, projectPath);
  if (!Number.isInteger(maxCount) || maxCount < 1 || maxCount > 1000) throw fault('Backup retention must be 1–1000.', 'INVALID_BACKUP_SETTINGS');
  if (typeof force !== 'boolean') throw fault('Backup force must be a boolean.', 'INVALID_BACKUP_SETTINGS');
  const date = now instanceof Date ? new Date(now) : new Date(now);
  if (!Number.isFinite(date.getTime())) throw fault('Backup timestamp is invalid.', 'INVALID_BACKUP_SETTINGS');
  const snapshot = structuredClone(project), fingerprint = canonicalProjectHash(snapshot);
  const bytes = Buffer.from(`${JSON.stringify(snapshot, null, 2)}\n`);
  if (bytes.length > MAX_JOURNAL_BYTES) throw fault('Project JSON exceeds the 64 MiB backup limit.', 'FILE_TOO_LARGE');
  return exclusive(projectPath, async () => {
    const loaded = await readRegistry(projectPath), warnings = [...loaded.warnings];
    let registry = loaded.registry;
    if (registry && registry.projectId !== snapshot.id) {
      const preserved = await quarantineSidecar(registryPath(projectPath));
      warnings.push({ code: 'BACKUP_PROJECT_MISMATCH', message: 'The registry belonged to another project and was preserved. Its backups will not be removed.', preserved });
      registry = null;
    }
    registry ??= { schemaVersion: 1, projectFile: path.basename(projectPath), projectId: snapshot.id, owner: randomUUID(), sequence: 0, entries: [] };
    if (baseName !== undefined) {
      if (registry.schemaVersion === 2 && registry.baseName !== baseName) throw fault('Backup naming policy changed; its registry was preserved.');
      registry = { ...registry, schemaVersion: 2, baseName };
    }
    const before = await inspect(projectPath, registry);
    warnings.push(...before.warnings);
    const changed = force || before.lastFingerprint !== fingerprint;
    let created = null;
    if (changed) {
      if (registry.sequence === Number.MAX_SAFE_INTEGER) throw fault('Backup sequence cannot be incremented safely.');
      const id = randomUUID();
      for (let attempt = 1; attempt <= 10000; attempt++) {
        const sequence = registry.sequence + attempt;
        if (!Number.isSafeInteger(sequence)) throw fault('Backup sequence cannot be incremented safely.');
        const file = registry.schemaVersion === 2 ? numberedName(registry.baseName, sequence) : backupName(projectPath, registry.owner, sequence, id);
        const entry = { id, sequence, file, projectId: snapshot.id, revision: snapshot.revision, fingerprint, sha256: hash(bytes), bytes: bytes.length, createdAt: date.toISOString() };
        try { await fs.lstat(path.join(path.dirname(projectPath), file)); continue; }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        try { await writeSidecar(path.join(path.dirname(projectPath), file), bytes, { noClobber: true }); created = entry; break; }
        catch (error) {
          if (error.code === 'EEXIST') continue;
          if (error.code === 'UNSAFE_PATH') { try { await fs.lstat(path.join(path.dirname(projectPath), file)); continue; } catch {} }
          throw error;
        }
      }
      if (!created) throw fault('No free numbered backup filename was found within 10000 attempts.', 'BACKUP_NAME_LIMIT');
    }
    const verified = new Set(before.files.filter(entry => entry.valid).map(entry => entry.id));
    if (created) verified.add(created.id);
    const all = [...registry.entries, ...(created ? [created] : [])];
    const remove = order(all).filter(entry => verified.has(entry.id)).slice(maxCount);
    const removeIds = new Set(remove.map(entry => entry.id));
    const next = { ...registry, sequence: created?.sequence ?? registry.sequence, entries: all.filter(entry => !removeIds.has(entry.id)) };
    const nextBytes = registryBytes(next);
    if (nextBytes.length > MAX_REGISTRY_BYTES || next.entries.length > 10000) {
      if (created) await removeCreated(projectPath, created);
      throw fault('Backup registry is full; inspect unavailable backup entries before adding more.', 'BACKUP_REGISTRY_FULL');
    }
    if (created || remove.length) {
      try { await writeRegistry(registryPath(projectPath), nextBytes); }
      catch (error) {
        // The old registry/backups remain authoritative if publication failed.
        // Check a post-rename failure before cleaning up the new snapshot.
        let committed = false;
        try { committed = (await readSidecar(registryPath(projectPath), MAX_REGISTRY_BYTES)).equals(nextBytes); } catch {}
        if (!committed) {
          if (created) await removeCreated(projectPath, created);
          throw error;
        }
        warnings.push({ code: 'BACKUP_COMMITTED_WITH_WARNING', message: `Backup registry committed, but its writer reported: ${error.message}` });
      }
      // Recheck before deleting. External modifications are preserved. Session
      // queues protect cooperating operations, not hostile filesystem writers.
      for (const entry of remove) {
        try { await verifyEntry(projectPath, entry); await fs.unlink(path.join(path.dirname(projectPath), entry.file)); }
        catch (error) { warnings.push({ code: 'BACKUP_ROTATION_PRESERVED', message: `Could not safely remove ${entry.file}; it was preserved.`, id: entry.id }); }
      }
    }
    const after = await inspect(projectPath, next);
    return { status: created ? 'created' : 'skipped', files: after.files, id: created?.id ?? null, fingerprint, warnings: [...warnings, ...after.warnings], lastFingerprint: after.lastFingerprint, removed: remove.map(entry => entry.id), createdAt: created?.createdAt ?? null };
  });
}
