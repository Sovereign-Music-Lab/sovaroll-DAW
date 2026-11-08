import { promises as fs, constants } from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { Engine, validateProject } from './core/engine.mjs';
import { canonicalProjectHash, readSidecar, writeSidecar, assertSidecarLocation, updateSessionSettings, DEFAULT_SESSION_SETTINGS, MAX_JOURNAL_BYTES } from './session-store.mjs';

export const MAX_SAVED_CHECKPOINT_BYTES = MAX_JOURNAL_BYTES;
const MAX_PROJECT_BYTES = 16 * 1024 * 1024;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const encoded = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const fault = (code, message) => Object.assign(new Error(message), { code, status: ['OUTPUT_EXISTS', 'SAVE_CONFLICT'].includes(code) ? 409 : 422 });
const exact = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const sidecarPath = projectPath => `${projectPath}.saved.json`;

/** Revisions describe operations, not user-visible project content. */
export function contentProjectHash(project) {
  validateProject(project);
  return canonicalProjectHash({ ...project, revision: 0 });
}

function ownershipIds(value = []) {
  if (!Array.isArray(value) || value.length > 100000 || new Set(value).size !== value.length || value.some(id => typeof id !== 'string' || !id.length || id.length > 256 || id.includes('\0'))) throw fault('INVALID_SAVE_CHECKPOINT', 'Media ownership IDs must be unique nonempty strings.');
  return [...value];
}

function makeSaved(project, { origin, now = new Date(), ownershipIds: ids = [] }) {
  validateProject(project);
  const date = new Date(now);
  if (!Number.isFinite(date.getTime())) throw fault('INVALID_SAVE_CHECKPOINT', 'Save timestamp is invalid.');
  const checkpoint = { schemaVersion: 1, project: structuredClone(project), projectHash: canonicalProjectHash(project), savedAt: date.toISOString(), saveId: randomUUID(), origin, mediaOwnershipIds: ownershipIds(ids) };
  if (encoded(checkpoint).length > MAX_SAVED_CHECKPOINT_BYTES) throw fault('SAVE_CHECKPOINT_TOO_LARGE', 'Saved checkpoint exceeds the 64 MiB limit.');
  return checkpoint;
}

function validateSaved(checkpoint, project) {
  if (!exact(checkpoint, ['schemaVersion', 'project', 'projectHash', 'savedAt', 'saveId', 'origin', 'mediaOwnershipIds']) || checkpoint.schemaVersion !== 1 ||
      !uuid.test(checkpoint.saveId) || !['explicit', 'opened-project'].includes(checkpoint.origin) ||
      typeof checkpoint.savedAt !== 'string' || !Number.isFinite(Date.parse(checkpoint.savedAt)) || new Date(checkpoint.savedAt).toISOString() !== checkpoint.savedAt) throw fault('INVALID_SAVE_CHECKPOINT', 'Saved checkpoint envelope is invalid.');
  validateProject(checkpoint.project); ownershipIds(checkpoint.mediaOwnershipIds);
  if (canonicalProjectHash(checkpoint.project) !== checkpoint.projectHash) throw fault('INVALID_SAVE_CHECKPOINT', 'Saved checkpoint checksum does not match its project.');
  if (checkpoint.project.id !== project.id || checkpoint.project.ppq !== project.ppq || checkpoint.project.sampleRate !== project.sampleRate) throw fault('SAVE_CHECKPOINT_MISMATCH', 'Saved checkpoint belongs to another project identity or timebase.');
  return checkpoint;
}

async function readSaved(projectPath, project) {
  try {
    const bytes = await readSidecar(sidecarPath(projectPath), MAX_SAVED_CHECKPOINT_BYTES);
    return { checkpoint: validateSaved(JSON.parse(bytes.toString('utf8')), project), missing: false, error: null };
  } catch (error) { return { checkpoint: null, missing: error.code === 'ENOENT', error }; }
}

function result(project, checkpoint, status, warnings = []) {
  return { available: Boolean(checkpoint), checkpoint: checkpoint ? structuredClone(checkpoint) : null, dirty: checkpoint ? contentProjectHash(project) !== contentProjectHash(checkpoint.project) : null, persistence: { status, warnings } };
}

async function writeVerified(filename, bytes, write, options) {
  try { await write(filename, bytes, options); return []; }
  catch (error) {
    if (error.code === 'EEXIST') throw fault('OUTPUT_EXISTS', 'The destination appeared before publication; it was not overwritten.');
    let committed = false;
    try { committed = (await readSidecar(filename, Math.max(MAX_SAVED_CHECKPOINT_BYTES, bytes.length))).equals(bytes); } catch {}
    if (!committed) throw error;
    return [{ code: 'SAVE_COMMITTED_WITH_WARNING', message: `The file was published, but its writer reported: ${error.message}` }];
  }
}

// Preserve an invalid sidecar while keeping it at its original path until a
// replacement actually commits. A failed explicit Save therefore cannot turn
// a corrupt checkpoint into a seemingly never-saved project on next startup.
async function preserveInvalid(filename) {
  const parent = await fs.lstat(path.dirname(path.resolve(filename)));
  if (!parent.isDirectory() || parent.isSymbolicLink()) throw fault('UNSAFE_SAVE_PATH', 'The project directory must be a regular directory.');
  const stat = await fs.lstat(filename);
  if (!stat.isFile() && !stat.isSymbolicLink()) throw fault('UNSAFE_SAVE_PATH', 'A directory occupies the saved checkpoint path and was not changed.');
  const preserved = `${filename}.quarantine-${randomUUID()}`;
  if (stat.isSymbolicLink()) await fs.symlink(await fs.readlink(filename), preserved);
  else await fs.link(filename, preserved);
  return path.basename(preserved);
}

export async function loadSavedCheckpoint(projectPath, project, { now, initialize = true, ownershipIds: ids = [], writeCheckpoint = writeSidecar } = {}) {
  validateProject(project);
  if (typeof initialize !== 'boolean') throw fault('INVALID_SAVE_CHECKPOINT', 'Initialize must be a boolean.');
  const loaded = await readSaved(projectPath, project);
  if (loaded.checkpoint) return result(project, loaded.checkpoint, 'ready');
  if (!loaded.missing) return result(project, null, 'unavailable', [{ code: loaded.error.code ?? 'INVALID_SAVE_CHECKPOINT', message: `${loaded.error.message} The original saved checkpoint was preserved; an explicit Save is required to establish a new baseline.` }]);
  if (!initialize) return result(project, null, 'unavailable', [{ code: 'SAVE_CHECKPOINT_MISSING', message: 'No saved checkpoint is available.' }]);
  const checkpoint = makeSaved(project, { origin: 'opened-project', now, ownershipIds: ids });
  const warnings = await writeVerified(sidecarPath(projectPath), encoded(checkpoint), writeCheckpoint, { noClobber: true });
  return result(project, checkpoint, 'initialized', warnings);
}

export async function saveExplicitCheckpoint(projectPath, project, { now, ownershipIds: ids = [], writeCheckpoint = writeSidecar } = {}) {
  const checkpoint = makeSaved(project, { origin: 'explicit', now, ownershipIds: ids }), loaded = await readSaved(projectPath, project), warnings = [];
  if (!loaded.checkpoint && !loaded.missing) {
    const preserved = await preserveInvalid(sidecarPath(projectPath));
    warnings.push({ code: 'SAVE_CHECKPOINT_PRESERVED', message: 'The invalid previous saved checkpoint was preserved before explicit Save.', preserved });
    // writeSidecar deliberately rejects symlinks. The link itself is already
    // preserved, so remove only that link before publishing the replacement.
    if ((await fs.lstat(sidecarPath(projectPath))).isSymbolicLink()) await fs.unlink(sidecarPath(projectPath));
  }
  try { warnings.push(...await writeVerified(sidecarPath(projectPath), encoded(checkpoint), writeCheckpoint)); }
  catch (error) {
    // Restore an invalid symbolic-link marker if publication failed before it
    // existed. Regular invalid files never left their original path.
    const preserved = warnings.find(item => item.preserved)?.preserved;
    if (preserved) {
      const original = path.join(path.dirname(projectPath), preserved);
      try {
        if ((await fs.lstat(original)).isSymbolicLink()) {
          try { await fs.symlink(await fs.readlink(original), sidecarPath(projectPath)); } catch (restoreError) { if (restoreError.code !== 'EEXIST') throw restoreError; }
        }
      } catch (restoreError) { error.restoreWarning = restoreError.message; }
    }
    throw error;
  }
  return result(project, checkpoint, 'saved', warnings);
}

async function absent(filename) {
  try { await fs.lstat(filename); } catch (error) { if (error.code === 'ENOENT') return true; throw error; }
  return false;
}

async function targetAvailable(filename) {
  for (const suffix of ['', '.saved.json', '.history.json', '.bak', '.autobackups.json', '.media-ownership.json', '.lock', '.lock.guard', '.save-prepare.lock']) if (!await absent(`${filename}${suffix}`)) return false;
  return true;
}

function versionParts(projectPath) {
  const name = path.basename(projectPath), extension = name.endsWith('.newdaw.json') ? '.newdaw.json' : path.extname(name), stem = name.slice(0, name.length - extension.length);
  const match = stem.match(/^(.*)-(\d+)$/), number = match ? Number(match[2]) : 0;
  if (!Number.isSafeInteger(number) || number >= Number.MAX_SAFE_INTEGER) throw fault('VERSION_NUMBER_OVERFLOW', 'Project version number cannot be incremented safely.');
  return { stem: match ? match[1] : stem, number, width: Math.max(2, match?.[2].length ?? 2), extension };
}

async function selectFilename(source, mode, outputPath, { reserve = false } = {}) {
  const parts = mode === 'version' ? versionParts(source) : null;
  for (let attempt = 1; attempt <= 10000; attempt++) {
    const filename = mode === 'version' ? path.join(path.dirname(source), `${parts.stem}-${String(parts.number + attempt).padStart(parts.width, '0')}${parts.extension}`) : path.resolve(outputPath);
    if (parts && !Number.isSafeInteger(parts.number + attempt)) throw fault('VERSION_NUMBER_OVERFLOW', 'Project version number cannot be incremented safely.');
    if (!await targetAvailable(filename)) { if (mode === 'version') continue; throw fault('OUTPUT_EXISTS', 'Save As destination or its session sidecars already exist.'); }
    await assertSidecarLocation(filename);
    await fs.access(path.dirname(filename), constants.W_OK);
    if (!reserve) return { filename, guard: null };
    const guard = `${filename}.save-prepare.lock`;
    try { await fs.mkdir(guard, { mode: 0o700 }); }
    catch (error) { if (error.code === 'EEXIST' && mode === 'version') continue; if (error.code === 'EEXIST') throw fault('OUTPUT_EXISTS', 'Another operation is preparing this destination.'); throw error; }
    return { filename, guard };
  }
  throw fault('VERSION_SEARCH_LIMIT', 'No free version filename was found within 10000 attempts.');
}

async function validatePreparation(projectPath, checkpoint, mode, outputPath) {
  if (!['version', 'saveAs'].includes(mode) || (mode === 'saveAs' && (typeof outputPath !== 'string' || !outputPath.trim() || outputPath.includes('\0')))) throw fault('INVALID_PROJECT_SAVE', 'Invalid project save preparation options.');
  const source = path.resolve(projectPath), engine = new Engine(checkpoint?.project); engine.restoreCheckpoint(checkpoint);
  const project = engine.project, originalBytes = encoded(project);
  if (originalBytes.length > MAX_PROJECT_BYTES) throw fault('PROJECT_TOO_LARGE', 'Project JSON exceeds the 16 MiB save limit.');
  const sourceProject = JSON.parse((await readSidecar(source, MAX_PROJECT_BYTES)).toString('utf8'));
  validateProject(sourceProject);
  if (sourceProject.id !== project.id || sourceProject.ppq !== project.ppq || sourceProject.sampleRate !== project.sampleRate) throw fault('PROJECT_SAVE_MISMATCH', 'The prepared project must retain the source project identity and timebase.');
  return { source, engine, project, originalBytes };
}

/** Read-only filename/source validation. No lock, directory, file or media is
 * created. The result is advisory: application reserves and rechecks afresh. */
export async function previewProjectVersion(projectPath, { checkpoint, mode = 'version', outputPath } = {}) {
  const { source } = await validatePreparation(projectPath, checkpoint, mode, outputPath);
  const { filename } = await selectFilename(source, mode, outputPath);
  return { projectPath: filename, warnings: [{ code: 'DESTINATION_NOT_RESERVED', message: 'The destination was checked but is not reserved. Save will recheck it before publication.' }] };
}

async function cleanPublished(files, warnings) {
  for (const item of files.toReversed()) {
    try {
      const stat = await fs.lstat(item.filename);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.dev !== item.dev || stat.ino !== item.ino || hash(await readSidecar(item.filename)) !== item.hash) {
        warnings.push({ code: 'SAVE_CLEANUP_PRESERVED', message: 'A changed published sidecar was preserved during rollback.', file: path.basename(item.filename) }); continue;
      }
      await fs.unlink(item.filename);
    } catch (error) { if (error.code !== 'ENOENT') warnings.push({ code: 'SAVE_CLEANUP_FAILED', message: error.message, file: path.basename(item.filename) }); }
  }
}

/** Prepare a distinct project identity path; activate it in the caller only
 * after success. Sidecars precede the no-clobber project publication (commit
 * point). reserveTarget's release function is retained on success for adoption.
 */
export async function prepareProjectVersion(projectPath, { checkpoint, settings = structuredClone(DEFAULT_SESSION_SETTINGS), mode = 'version', outputPath, ownershipIds: ids = [], now,
  prepareAssets, reserveTarget, publishFile = writeSidecar } = {}) {
  if ((prepareAssets !== undefined && typeof prepareAssets !== 'function') || (reserveTarget !== undefined && typeof reserveTarget !== 'function')) throw fault('INVALID_PROJECT_SAVE', 'Invalid project save preparation callbacks.');
  const { source, engine, project, originalBytes } = await validatePreparation(projectPath, checkpoint, mode, outputPath);
  ownershipIds(ids);
  const reservation = await selectFilename(source, mode, outputPath, { reserve: true }), target = reservation.filename, warnings = [], published = [];
  let staging, releaseLock, assets, committed = false;
  try {
    if (reserveTarget) {
      releaseLock = await reserveTarget(target);
      if (typeof releaseLock !== 'function') throw fault('INVALID_PROJECT_SAVE', 'Target reservation must return a release function.');
    }
    const sourceDirectory = path.dirname(source), directory = path.dirname(target);
    if (await fs.realpath(sourceDirectory) !== await fs.realpath(directory) && project.assets.length && !prepareAssets) throw fault('MEDIA_COLLECTION_REQUIRED', 'Save As in another directory requires verified media collection.');
    staging = await fs.mkdtemp(path.join(directory, '.newdaw-save-'));
    const stagedProjectPath = path.join(staging, 'project.newdaw.json');
    const stored = await updateSessionSettings(stagedProjectPath, engine.checkpoint(), settings);
    warnings.push(...stored.warnings);
    const savedCheckpoint = makeSaved(project, { origin: 'explicit', now, ownershipIds: ids });
    await writeSidecar(`${stagedProjectPath}.saved.json`, encoded(savedCheckpoint), { noClobber: true });
    await writeSidecar(stagedProjectPath, originalBytes, { noClobber: true });
    if (prepareAssets) {
      assets = await prepareAssets({ project: structuredClone(project), directory, sourceDirectory });
      if (assets?.warnings) warnings.push(...assets.warnings);
    }
    for (const suffix of ['.history.json', '.saved.json', '']) {
      const bytes = await readSidecar(`${stagedProjectPath}${suffix}`), filename = `${target}${suffix}`;
      if (!await absent(filename)) throw fault('OUTPUT_EXISTS', 'The destination appeared while preparing the project.');
      warnings.push(...await writeVerified(filename, bytes, publishFile, { noClobber: true }));
      if (!suffix) { committed = true; break; }
      const stat = await fs.lstat(filename); published.push({ filename, dev: stat.dev, ino: stat.ino, hash: hash(bytes) });
    }
    return { status: 'prepared', projectPath: target, project, checkpoint: stored.checkpoint, savedCheckpoint, warnings, releaseLock: releaseLock ?? null };
  } catch (error) {
    if (!committed) {
      await cleanPublished(published, warnings);
      try { await assets?.rollback?.(); } catch (rollbackError) { warnings.push({ code: 'MEDIA_ROLLBACK_FAILED', message: rollbackError.message }); }
      try { await releaseLock?.(); } catch (releaseError) { warnings.push({ code: 'LOCK_RELEASE_FAILED', message: releaseError.message }); }
      error.details = { ...error.details, projectCommitted: false,
        ...(assets?.retainedCopies ? { retainedCopies: [...new Set([...(error.details?.retainedCopies ?? []), ...assets.retainedCopies])] } : {}) };
    }
    if (warnings.length) error.warnings = warnings;
    throw error;
  } finally {
    if (staging) await fs.rm(staging, { recursive: true, force: true }).catch(error => warnings.push({ code: 'SAVE_STAGING_CLEANUP_FAILED', message: error.message }));
    await fs.rmdir(reservation.guard).catch(error => warnings.push({ code: 'SAVE_RESERVATION_CLEANUP_FAILED', message: error.message }));
  }
}
