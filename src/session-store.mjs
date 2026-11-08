import { promises as fs, constants } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Engine, validateProject } from './core/engine.mjs';
import { atomicWrite, saveProject } from './storage.mjs';

export const MAX_JOURNAL_BYTES = 64 * 1024 * 1024;
export const DEFAULT_SESSION_SETTINGS = Object.freeze({ revision: 0, autoBackup: Object.freeze({ enabled: true, intervalMinutes: 5, maxCount: 10 }) });
const defaults = () => structuredClone(DEFAULT_SESSION_SETTINGS);
const hashPattern = /^[a-f0-9]{64}$/;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => record(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const fault = (message, code = 'INVALID_SESSION_STATE') => Object.assign(new Error(message), { code });
const stable = value => Array.isArray(value) ? value.map(stable) : record(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;

export function canonicalProjectHash(project) {
  validateProject(project);
  return createHash('sha256').update(JSON.stringify(stable(project))).digest('hex');
}

export function validateSessionSettings(settings) {
  if (!exact(settings, ['revision', 'autoBackup']) || !Number.isSafeInteger(settings.revision) || settings.revision < 0 ||
      !exact(settings.autoBackup, ['enabled', 'intervalMinutes', 'maxCount']) || typeof settings.autoBackup.enabled !== 'boolean' ||
      !Number.isInteger(settings.autoBackup.intervalMinutes) || settings.autoBackup.intervalMinutes < 1 || settings.autoBackup.intervalMinutes > 1440 ||
      !Number.isInteger(settings.autoBackup.maxCount) || settings.autoBackup.maxCount < 1 || settings.autoBackup.maxCount > 1000) {
    throw fault('Invalid session settings. Backup interval must be 1–1440 minutes and retention 1–1000.');
  }
  return structuredClone(settings);
}

// Only derived sibling paths are used by this module. Do not follow a sidecar
// symlink or a symlink in place of its containing project directory.
export async function assertSidecarLocation(filename) {
  const parent = await fs.lstat(path.dirname(path.resolve(filename)));
  if (!parent.isDirectory() || parent.isSymbolicLink()) throw fault('The project directory must be a regular directory.', 'UNSAFE_PATH');
  try {
    const stat = await fs.lstat(filename);
    if (!stat.isFile() || stat.isSymbolicLink()) throw fault('The session file must be a regular file, not a symlink.', 'UNSAFE_PATH');
    return stat;
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export async function readSidecar(filename, maxBytes = MAX_JOURNAL_BYTES) {
  const before = await assertSidecarLocation(filename);
  if (!before) throw Object.assign(new Error('File does not exist.'), { code: 'ENOENT' });
  if (before.size > maxBytes) throw fault('Session file exceeds its byte limit.', 'FILE_TOO_LARGE');
  const handle = await fs.open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) throw fault('File identity changed while opening.', 'FILE_CHANGED');
    const chunks = []; let size = 0;
    while (true) {
      const chunk = Buffer.alloc(Math.min(65536, maxBytes + 1 - size));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
      if (!bytesRead) break;
      size += bytesRead;
      if (size > maxBytes) throw fault('Session file exceeds its byte limit.', 'FILE_TOO_LARGE');
      chunks.push(chunk.subarray(0, bytesRead));
    }
    const after = await handle.stat();
    if (opened.size !== after.size || opened.mtimeMs !== after.mtimeMs || opened.ctimeMs !== after.ctimeMs || size !== after.size) throw fault('File changed while reading.', 'FILE_CHANGED');
    return Buffer.concat(chunks, size);
  } finally { await handle.close(); }
}

async function syncDirectory(filename) {
  const handle = await fs.open(path.dirname(path.resolve(filename)), 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}

export async function writeSidecar(filename, bytes, options = {}) {
  await assertSidecarLocation(filename);
  await atomicWrite(filename, bytes, options);
  await syncDirectory(filename);
}

export async function quarantineSidecar(filename) {
  const parent = await fs.lstat(path.dirname(path.resolve(filename)));
  if (!parent.isDirectory() || parent.isSymbolicLink()) throw fault('The project directory must be a regular directory.', 'UNSAFE_PATH');
  let stat;
  try { stat = await fs.lstat(filename); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  if (!stat.isFile() && !stat.isSymbolicLink()) throw fault('An unsafe directory occupies the sidecar path; it was not changed.', 'UNSAFE_PATH');
  const target = `${filename}.quarantine-${randomUUID()}`;
  // Renaming the link itself preserves it without reading or changing its target.
  await fs.rename(filename, target);
  await syncDirectory(filename);
  return path.basename(target);
}

function checkpointEngine(checkpoint) {
  const engine = new Engine(checkpoint?.project);
  engine.restoreCheckpoint(checkpoint);
  return engine;
}

function generation(engine, settings) {
  const project = engine.project;
  return { projectId: project.id, projectRevision: project.revision, projectHash: canonicalProjectHash(project), history: engine.exportHistory(), settings };
}

function validateGeneration(value, project) {
  if (!exact(value, ['projectId', 'projectRevision', 'projectHash', 'history', 'settings']) || value.projectId !== project.id ||
      !Number.isSafeInteger(value.projectRevision) || value.projectRevision < 0 || !hashPattern.test(value.projectHash)) throw fault('Invalid journal generation identity.');
  validateSessionSettings(value.settings);
  // The other generation's current state is intentionally omitted. A surrogate
  // of the same immutable project identity/timebase validates its history schema.
  const surrogate = structuredClone(project);
  surrogate.revision = value.projectRevision;
  const engine = new Engine(surrogate);
  engine.restoreHistory(value.history);
}

async function readJournal(projectPath, project) {
  const filename = `${projectPath}.history.json`, warnings = [];
  try {
    const journal = JSON.parse((await readSidecar(filename)).toString('utf8'));
    if (!exact(journal, ['schemaVersion', 'previous', 'current']) || journal.schemaVersion !== 1) throw fault('Invalid session journal envelope.');
    if (journal.previous !== null) validateGeneration(journal.previous, project);
    validateGeneration(journal.current, project);
    const fingerprint = canonicalProjectHash(project);
    const match = [journal.current, journal.previous].find(item => item && item.projectId === project.id && item.projectRevision === project.revision && item.projectHash === fingerprint);
    if (!match) throw fault('Session journal does not match the committed project.', 'JOURNAL_MISMATCH');
    // Validate against the actual committed project, not just its identity.
    new Engine(project).restoreHistory(match.history);
    return { journal, match, status: match === journal.current ? 'restored' : 'restored-previous', warnings };
  } catch (error) {
    if (error.code === 'ENOENT') return { journal: null, match: null, status: 'new', warnings };
    const preserved = await quarantineSidecar(filename);
    warnings.push({ code: error.code === 'JOURNAL_MISMATCH' ? 'JOURNAL_MISMATCH' : 'JOURNAL_INVALID', message: `${error.message} History was reset; the original sidecar was preserved.`, preserved });
    return { journal: null, match: null, status: 'reset', warnings };
  }
}

export async function loadSessionState(projectPath, project) {
  validateProject(project);
  const result = await readJournal(projectPath, project);
  let checkpoint = null;
  if (result.match) {
    const engine = new Engine(project);
    const report = engine.restoreHistory(result.match.history);
    checkpoint = engine.checkpoint();
    if (report.migrated) result.warnings.push({ code: 'HISTORY_MIGRATED', message: 'Legacy undo/redo history was migrated.' });
    if (report.droppedEntryIds?.length) result.warnings.push({ code: 'HISTORY_TRIMMED', message: 'History beyond the retention limit was removed.', count: report.droppedEntryIds.length });
  }
  return { history: checkpoint?.history ?? null, checkpoint, settings: result.match ? structuredClone(result.match.settings) : defaults(), persistence: { status: result.status, warnings: result.warnings } };
}

function journalBytes(previous, current) { return Buffer.from(`${JSON.stringify({ schemaVersion: 1, previous, current })}\n`); }

function fitJournal(previousEngine, nextEngine, previousSettings, settings, maxBytes) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 4096 || maxBytes > MAX_JOURNAL_BYTES) throw fault('Journal byte limit must be between 4096 and 64 MiB.');
  const warnings = [];
  const make = () => journalBytes(previousEngine ? generation(previousEngine, previousSettings) : null, generation(nextEngine, settings));
  let bytes = make();
  // Budget each generation equally when necessary. Trimming is restricted to
  // history snapshots; the live project is never modified or stored twice.
  if (bytes.length > maxBytes) {
    const engines = [previousEngine, nextEngine].filter(Boolean);
    const budget = Math.max(1024, Math.floor((maxBytes - 1800) / engines.length));
    let dropped = 0;
    for (const engine of engines) dropped += engine.trimHistoryToBytes(budget).droppedEntryIds.length;
    bytes = make();
    if (bytes.length > maxBytes) throw fault('Journal metadata exceeds its byte limit.', 'JOURNAL_BYTE_LIMIT');
    warnings.push({ code: 'HISTORY_TRIMMED', message: 'Old history was trimmed to keep the durable journal within its byte limit.', count: dropped, maxBytes });
  }
  return { bytes, checkpoint: nextEngine.checkpoint(), warnings };
}

/** Journal first, project JSON second. Project JSON is the commit point. Call
 * under the session's exclusive operation queue/project lock. This is not a
 * filesystem-wide compare-and-swap against unrelated external writers.
 */
export async function commitSessionState(projectPath, { currentCheckpoint, nextCheckpoint, settings = defaults(), persistProject = saveProject, maxBytes = MAX_JOURNAL_BYTES, writeJournal = writeSidecar }) {
  const currentEngine = checkpointEngine(currentCheckpoint), nextEngine = checkpointEngine(nextCheckpoint);
  const current = currentEngine.project, next = nextEngine.project;
  if (current.id !== next.id || current.ppq !== next.ppq || current.sampleRate !== next.sampleRate) throw fault('A journal transaction cannot change project identity or timebase.');
  const checkedSettings = validateSessionSettings(settings);
  await assertSidecarLocation(projectPath);
  const existing = await readJournal(projectPath, current);
  const previousSettings = existing.match?.settings ?? checkedSettings;
  const fitted = fitJournal(currentEngine, nextEngine, previousSettings, checkedSettings, maxBytes);
  await writeJournal(`${projectPath}.history.json`, fitted.bytes);
  const warnings = [...existing.warnings, ...fitted.warnings];
  try {
    await persistProject(projectPath, next);
  } catch (error) {
    // A writer may report a post-rename durability error. If the candidate is
    // already the committed file, keep in-memory state aligned and warn.
    let committed = false;
    try { committed = canonicalProjectHash(JSON.parse((await readSidecar(projectPath)).toString('utf8'))) === canonicalProjectHash(next); } catch {}
    if (!committed) throw error;
    warnings.push({ code: 'PROJECT_COMMITTED_WITH_WARNING', message: `The project file committed, but its writer reported: ${error.message}` });
  }
  return { checkpoint: fitted.checkpoint, status: 'saved', warnings };
}

export async function updateSessionSettings(projectPath, checkpoint, settings, { maxBytes = MAX_JOURNAL_BYTES, writeJournal = writeSidecar } = {}) {
  const engine = checkpointEngine(checkpoint), checkedSettings = validateSessionSettings(settings);
  const existing = await readJournal(projectPath, engine.project);
  const previousEngine = checkpointEngine(checkpoint);
  const fitted = fitJournal(previousEngine, engine, existing.match?.settings ?? checkedSettings, checkedSettings, maxBytes);
  const warnings = [...existing.warnings, ...fitted.warnings];
  try { await writeJournal(`${projectPath}.history.json`, fitted.bytes); }
  catch (error) {
    let committed = false;
    try { committed = (await readSidecar(`${projectPath}.history.json`)).equals(fitted.bytes); } catch {}
    if (!committed) throw error;
    warnings.push({ code: 'SETTINGS_COMMITTED_WITH_WARNING', message: `Session settings committed, but the journal writer reported: ${error.message}` });
  }
  return { checkpoint: fitted.checkpoint, settings: checkedSettings, status: 'saved', warnings };
}
