import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Engine, validateProject } from './core/engine.mjs';
import { canonicalProjectHash, readSidecar, loadSessionState, validateSessionSettings, DEFAULT_SESSION_SETTINGS, MAX_JOURNAL_BYTES } from './session-store.mjs';
import { loadSavedCheckpoint } from './project-save.mjs';
import { captureMediaOwnership } from './revert-media.mjs';
import { assetInventory } from './project-files.mjs';
import { listBackups, validateBackupRegistry } from './auto-backup.mjs';

const MAX_PROJECT_BYTES = 16 * 1024 * 1024, MAX_REGISTRY_BYTES = 8 * 1024 * 1024;
const sha = /^[a-f0-9]{64}$/, uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const fault = (code, message, status = 422) => Object.assign(new Error(message), { code, status });
const exact = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const identity = stat => ({ dev: stat.dev, ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs });
const sameIdentity = (a, b) => ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'].every(key => a[key] === b[key]);
const sameFingerprint = (a, b) => sameIdentity(a, b) && a.sha256 === b.sha256;

async function safePath(input) {
  if (typeof input !== 'string' || !input.trim() || input.includes('\0')) throw fault('INVALID_PROJECT_PATH', 'Choose an existing project file.');
  let filename = path.resolve(input);
  for (const alias of ['/var', '/tmp', '/etc']) {
    if (filename !== alias && !filename.startsWith(`${alias}/`)) continue;
    if ((await fs.lstat(alias)).isSymbolicLink() && await fs.realpath(alias) === `/private${alias}`) filename = `/private${filename}`;
    break;
  }
  const parsed = path.parse(filename), parts = filename.slice(parsed.root.length).split(path.sep).filter(Boolean);
  let cursor = parsed.root;
  for (const [index, part] of parts.entries()) {
    cursor = path.join(cursor, part);
    const stat = await fs.lstat(cursor);
    if (stat.isSymbolicLink() || (index < parts.length - 1 ? !stat.isDirectory() : !stat.isFile())) throw fault('UNSAFE_PROJECT_PATH', 'Project files and their parent directories must not be symbolic links or special files.');
  }
  return filename;
}

async function readProject(projectPath, draftId) {
  const filename = await safePath(projectPath), before = await fs.lstat(filename);
  const managedDraft = path.basename(filename).match(/^\.newdaw-draft-([a-f0-9-]{36})\.newdaw\.json$/);
  if (managedDraft && (draftId !== managedDraft[1] || !uuid.test(draftId))) throw fault('DRAFT_RECOVERY_REQUIRED', 'This is an internal unsaved-project working file. Use its registered draft recovery action.', 409);
  const bytes = await readSidecar(filename, MAX_PROJECT_BYTES);
  await safePath(filename);
  const after = await fs.lstat(filename);
  if (!sameIdentity(identity(before), identity(after))) throw fault('PROJECT_FILE_CHANGED', 'The selected project changed while it was read. Inspect it again.', 409);
  let project;
  try { project = JSON.parse(bytes.toString('utf8')); } catch { throw fault('INVALID_PROJECT_JSON', 'The selected file is not valid project JSON.'); }
  validateProject(project);
  return { projectPath: filename, directory: path.dirname(filename), project, fingerprint: { sha256: digest(bytes), ...identity(after) } };
}

function validateFingerprint(value) {
  if (!exact(value, ['sha256', 'dev', 'ino', 'size', 'mtimeMs', 'ctimeMs']) || !sha.test(value.sha256) ||
      ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'].some(key => !Number.isFinite(value[key]) || value[key] < 0)) throw fault('EXPECTED_FINGERPRINT_REQUIRED', 'Pass the fingerprint from a fresh project inspection.');
}

// Read-only equivalents intentionally do not call loaders that quarantine bad
// sidecars. Preview must not rename, initialize, repair or reserve anything.
async function inspectHistory(projectPath, project) {
  const engine = new Engine(project), warnings = [];
  try {
    const journal = JSON.parse((await readSidecar(`${projectPath}.history.json`)).toString('utf8'));
    if (!exact(journal, ['schemaVersion', 'previous', 'current']) || journal.schemaVersion !== 1) throw fault('JOURNAL_INVALID', 'Invalid history journal envelope.');
    const generations = [journal.current, journal.previous];
    for (const [index, value] of generations.entries()) {
      if (value === null && index === 1) continue;
      if (!exact(value, ['projectId', 'projectRevision', 'projectHash', 'history', 'settings']) || value.projectId !== project.id || !Number.isSafeInteger(value.projectRevision) || value.projectRevision < 0 || !sha.test(value.projectHash)) throw fault('JOURNAL_INVALID', 'Invalid history journal generation.');
      validateSessionSettings(value.settings);
      new Engine({ ...project, revision: value.projectRevision }).restoreHistory(value.history);
    }
    const projectHash = canonicalProjectHash(project), match = generations.find(value => value && value.projectId === project.id && value.projectRevision === project.revision && value.projectHash === projectHash);
    if (!match) throw fault('JOURNAL_MISMATCH', 'History journal does not match the selected project content.');
    const report = engine.restoreHistory(match.history);
    if (report.migrated) warnings.push({ code: 'HISTORY_MIGRATED', message: 'Legacy undo/redo history will be migrated when opened.' });
    if (report.droppedEntryIds?.length) warnings.push({ code: 'HISTORY_TRIMMED', message: 'History beyond the retention limit will be omitted.', count: report.droppedEntryIds.length });
    return { checkpoint: engine.checkpoint(), settings: structuredClone(match.settings), persistence: { status: match === journal.current ? 'restored' : 'restored-previous', warnings } };
  } catch (error) {
    if (error.code !== 'ENOENT') warnings.push({ code: error.code === 'JOURNAL_MISMATCH' ? 'JOURNAL_MISMATCH' : 'JOURNAL_INVALID', message: `${error.message} The original was left untouched; opening will preserve it and start without this history.` });
    return { checkpoint: new Engine(project).checkpoint(), settings: structuredClone(DEFAULT_SESSION_SETTINGS), persistence: { status: error.code === 'ENOENT' ? 'new' : 'reset', warnings } };
  }
}

async function inspectBackups(projectPath, project) {
  let registry;
  try {
    registry = JSON.parse((await readSidecar(`${projectPath}.autobackups.json`, MAX_REGISTRY_BYTES)).toString('utf8'));
    validateBackupRegistry(registry, projectPath, project.id);
  } catch (error) {
    return { status: error.code === 'ENOENT' ? 'new' : 'reset', files: [], lastFingerprint: null,
      warnings: error.code === 'ENOENT' ? [] : [{ code: 'BACKUP_REGISTRY_INVALID', message: `${error.message} The registry was left untouched during inspection.` }] };
  }
  const files = [], warnings = [];
  for (const entry of registry.entries.toSorted((a, b) => b.sequence - a.sequence)) {
    try {
      const bytes = await readSidecar(path.join(path.dirname(projectPath), entry.file));
      if (bytes.length !== entry.bytes || digest(bytes) !== entry.sha256) throw fault('BACKUP_CHANGED', 'Backup bytes do not match their recorded checksum.');
      const backup = JSON.parse(bytes.toString('utf8')); validateProject(backup);
      if (backup.id !== entry.projectId || backup.revision !== entry.revision || canonicalProjectHash(backup) !== entry.fingerprint) throw fault('BACKUP_CHANGED', 'Backup project does not match its recorded identity.');
      files.push({ ...entry, valid: true, available: true });
    } catch (error) {
      files.push({ ...entry, valid: false, available: error.code !== 'ENOENT', error: { code: error.code ?? 'INVALID_BACKUP', message: error.message } });
      warnings.push({ code: 'BACKUP_UNAVAILABLE', message: `Backup ${entry.file} could not be verified and was left untouched.`, id: entry.id });
    }
  }
  return { status: 'ready', files, warnings, lastFingerprint: files.find(entry => entry.valid)?.fingerprint ?? null };
}

async function savedMissing(projectPath) {
  try { await fs.lstat(`${projectPath}.saved.json`); return false; } catch (error) { if (error.code === 'ENOENT') return true; throw error; }
}

function combined(base, history, saved, media, backups, willInitializeSavedCheckpoint = false) {
  const mediaWarnings = media.assets.filter(asset => !['ready', 'deferred'].includes(asset.status)).map(asset => ({ code: asset.error?.code ?? 'ASSET_UNAVAILABLE', message: asset.error?.message ?? `Media ${asset.name} is unavailable.`, assetId: asset.id }));
  return { ...base, ...history, saved, media, backups, resources: media.deferred ? 'deferred' : 'initialized', willInitializeSavedCheckpoint,
    warnings: [...history.persistence.warnings, ...saved.persistence.warnings, ...backups.warnings, ...mediaWarnings] };
}

function mediaState(project, directory, deferredMedia) {
  if (typeof deferredMedia !== 'boolean') throw fault('INVALID_PROJECT_OPEN', 'deferredMedia must be a boolean.');
  if (!deferredMedia) return assetInventory(project, directory);
  return { projectId: project.id, projectRevision: project.revision, deferred: true, assets: project.assets.map(asset => {
    const users = project.clips.filter(clip => clip.type === 'audio' && clip.assetId === asset.id).map(clip => ({ clipId: clip.id, trackId: clip.trackId, clipName: clip.name }));
    return { id: asset.id, name: asset.name, path: asset.path, sha256: asset.sha256, users, referenceCount: users.length, available: null, hashValid: null, bytes: null, status: 'deferred' };
  }) };
}

export async function inspectExistingProject(projectPath, { deferredMedia = false, draftId } = {}) {
  if (typeof deferredMedia !== 'boolean') throw fault('INVALID_PROJECT_OPEN', 'deferredMedia must be a boolean.');
  // draftId is an internal capability used only after project-drafts validates
  // its registry and descriptor. Public existing-project APIs never accept it.
  const base = await readProject(projectPath, draftId);
  const history = await inspectHistory(base.projectPath, base.project);
  const saved = await loadSavedCheckpoint(base.projectPath, base.project, { initialize: false });
  const media = await mediaState(base.project, base.directory, deferredMedia), backups = await inspectBackups(base.projectPath, base.project);
  const current = await readProject(base.projectPath, draftId);
  if (!sameFingerprint(base.fingerprint, current.fingerprint)) throw fault('PROJECT_FILE_CHANGED', 'The selected project changed during inspection. Inspect it again.', 409);
  return combined(base, history, saved, media, backups, await savedMissing(base.projectPath));
}

/** Lock the existing target, then re-read the exact inspected file. No demo,
 * project creation or project JSON rewrite is part of opening. The lock is
 * retained on success so the caller can atomically adopt the prepared context.
 */
export async function prepareExistingProject(projectPath, { expectedFingerprint, reserveTarget, deferredMedia = false } = {}) {
  if (typeof deferredMedia !== 'boolean') throw fault('INVALID_PROJECT_OPEN', 'deferredMedia must be a boolean.');
  validateFingerprint(expectedFingerprint);
  if (typeof reserveTarget !== 'function') throw fault('TARGET_RESERVATION_REQUIRED', 'Opening requires a target project lock reservation.');
  // Metadata-only path check prevents reserveTarget from creating directories
  // for a nonexistent destination before it acquires the actual session lock.
  const filename = await safePath(projectPath);
  if (/^\.newdaw-draft-[a-f0-9-]{36}\.newdaw\.json$/.test(path.basename(filename))) throw fault('DRAFT_RECOVERY_REQUIRED', 'Recover this internal unsaved project through its draft descriptor.', 409);
  let releaseLock;
  try {
    releaseLock = await reserveTarget(filename);
    if (typeof releaseLock !== 'function') throw fault('TARGET_RESERVATION_REQUIRED', 'Target reservation must return a release function.');
    const base = await readProject(filename);
    if (!sameFingerprint(base.fingerprint, expectedFingerprint)) throw fault('PROJECT_FILE_CHANGED', 'The selected file changed after preview. Inspect it again before opening.', 409);
    const loaded = await loadSessionState(filename, base.project);
    const engine = new Engine(base.project); if (loaded.history) engine.restoreHistory(loaded.history);
    const history = { checkpoint: engine.checkpoint(), settings: loaded.settings, persistence: loaded.persistence };
    let saved = await loadSavedCheckpoint(filename, base.project, { initialize: false });
    const media = await mediaState(base.project, base.directory, deferredMedia), backups = await listBackups(filename);
    if (backups.files.some(entry => entry.projectId !== base.project.id)) {
      backups.files = []; backups.lastFingerprint = null; backups.status = 'reset';
      backups.warnings.push({ code: 'BACKUP_PROJECT_MISMATCH', message: 'Backup records from another project were preserved and are not used for this session.' });
    }
    const current = await readProject(filename);
    if (!sameFingerprint(current.fingerprint, expectedFingerprint)) throw fault('PROJECT_FILE_CHANGED', 'The selected file changed while opening. Inspect it again.', 409);
    if (await savedMissing(filename)) {
      const ownership = await captureMediaOwnership(filename);
      saved = await loadSavedCheckpoint(filename, base.project, { ownershipIds: ownership.ownershipIds });
    }
    const final = await readProject(filename);
    if (!sameFingerprint(final.fingerprint, expectedFingerprint)) throw fault('PROJECT_FILE_CHANGED', 'The selected file changed before preparation completed. Inspect it again.', 409);
    return { ...combined(base, history, saved, media, backups), releaseLock };
  } catch (error) {
    try { await releaseLock?.(); } catch (releaseError) { error.warnings = [...(error.warnings ?? []), { code: 'TARGET_LOCK_RELEASE_FAILED', message: releaseError.message }]; }
    throw error;
  }
}
