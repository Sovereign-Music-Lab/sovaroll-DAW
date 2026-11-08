import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { readSidecar, writeSidecar } from './session-store.mjs';
import { validateProjectFolderPath } from './project-drafts.mjs';

export const DEFAULT_PROJECT_LOCATION_SETTINGS = Object.freeze({ schemaVersion: 1, revision: 0, defaultLocation: null, locationMode: 'prompt' });
const MAX_SETTINGS_BYTES = 64 * 1024, queues = new Map(), uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const encode = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const integer = value => Number.isSafeInteger(value) && value >= 0;
const absolutePath = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 4096 && !value.includes('\0') && path.isAbsolute(value);
const fail = (code, message, status = 422, details) => { throw Object.assign(new Error(message), { code, status, ...(details ? { details } : {}) }); };
const changedRead = error => ['ENOENT', 'FILE_CHANGED'].includes(error.code);
const warning = (code, message) => ({ code, message });

function validateSettings(settings) {
  if (!exact(settings, ['schemaVersion', 'revision', 'defaultLocation', 'locationMode']) || settings.schemaVersion !== 1 || !integer(settings.revision) ||
      !['default', 'prompt'].includes(settings.locationMode) || (settings.defaultLocation !== null && (!absolutePath(settings.defaultLocation) || path.normalize(settings.defaultLocation) !== settings.defaultLocation)) ||
      (settings.locationMode === 'default' && settings.defaultLocation === null)) fail('INVALID_LOCATION_SETTINGS', 'Project location settings are invalid. The original file was preserved.');
  return settings;
}
async function profileFilename(input, { createParent = false } = {}) {
  if (typeof input !== 'string' || !input.trim() || input.includes('\0') || input.length > 4096) fail('INVALID_LOCATION_PROFILE', 'A project-location profile path is required.');
  const filename = path.resolve(input), directory = await validateProjectFolderPath(path.dirname(filename), { create: createParent, allowMissing: !createParent });
  return path.join(directory, path.basename(filename));
}
async function readSettings(filename) {
  for (let attempt = 0; ; attempt++) try {
    const bytes = await readSidecar(filename, MAX_SETTINGS_BYTES);
    let settings; try { settings = JSON.parse(bytes.toString('utf8')); } catch { fail('INVALID_LOCATION_SETTINGS', 'Project location settings JSON is corrupt. The original file was preserved.'); }
    return { status: 'ready', settings: structuredClone(validateSettings(settings)), fingerprint: hash(bytes), warnings: [] };
  } catch (error) {
    if (error.code === 'FILE_CHANGED' && attempt < 3) { await delay(1); continue; }
    if (error.code === 'ENOENT') return { status: 'new', settings: { ...DEFAULT_PROJECT_LOCATION_SETTINGS }, fingerprint: null, warnings: [] };
    if (['UNSAFE_PATH', 'FILE_TOO_LARGE', 'FILE_CHANGED'].includes(error.code) && error.status === undefined) error.status = error.code === 'FILE_CHANGED' ? 409 : 422;
    throw error;
  }
}

/** Absence means a new profile; corrupt/unreadable existing files never become
 * defaults. Read does not create a directory, lock, settings file or project. */
export async function getProjectLocationSettings(input) { return readSettings(await profileFilename(input)); }

const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; } };
async function regularDirectory(filename) { const stat = await fs.lstat(filename); if (!stat.isDirectory() || stat.isSymbolicLink()) fail('UNSAFE_LOCATION_LOCK', 'Location settings lock must be a regular directory.'); }
async function lockOwner(lock) {
  await regularDirectory(lock);
  let owner; try { owner = JSON.parse((await readSidecar(path.join(lock, 'owner.json'), 4096)).toString('utf8')); }
  catch (error) { if (error instanceof SyntaxError) fail('INVALID_LOCATION_LOCK', 'Location lock owner is invalid and was preserved.'); throw error; }
  if (!exact(owner, ['pid', 'token', 'createdAt']) || !Number.isSafeInteger(owner.pid) || owner.pid <= 0 || !uuid.test(owner.token) || typeof owner.createdAt !== 'string' || !Number.isFinite(Date.parse(owner.createdAt))) fail('INVALID_LOCATION_LOCK', 'Location lock owner cannot be verified.');
  return owner;
}
async function acquireLock(filename, timeoutMs) {
  const lock = `${filename}.lock`, reclaim = `${lock}.reclaim`, deadline = performance.now() + timeoutMs;
  for (;;) {
    try { await regularDirectory(reclaim); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      try {
        await fs.mkdir(lock, { mode: 0o700 }); const mine = { pid: process.pid, token: randomUUID(), createdAt: new Date().toISOString() };
        try { await writeSidecar(path.join(lock, 'owner.json'), encode(mine), { noClobber: true }); }
        catch (error) { await fs.unlink(path.join(lock, 'owner.json')).catch(() => {}); await fs.rmdir(lock).catch(() => {}); throw error; }
        return async () => { if ((await lockOwner(lock)).token !== mine.token) fail('LOCATION_LOCK_CHANGED', 'A replacement location lock was preserved.', 409); await fs.unlink(path.join(lock, 'owner.json')); await fs.rmdir(lock); };
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        let owner; try { owner = await lockOwner(lock); } catch (error) { if (!changedRead(error)) throw error; }
        if (owner && !alive(owner.pid)) {
          let held = false;
          try {
            await fs.mkdir(reclaim, { mode: 0o700 }); held = true; const fresh = await lockOwner(lock);
            if (fresh.token === owner.token && !alive(fresh.pid)) {
              if ((await fs.readdir(lock)).sort().join(',') !== 'owner.json') fail('INVALID_LOCATION_LOCK', 'Unknown files in a stale location lock were preserved.');
              await fs.unlink(path.join(lock, 'owner.json')); await fs.rmdir(lock);
            }
          } catch (error) { if (error.code !== 'EEXIST' && !changedRead(error)) throw error; }
          finally { if (held) await fs.rmdir(reclaim); }
        }
      }
    }
    if (performance.now() >= deadline) fail('LOCATION_SETTINGS_LOCKED', 'Another process is updating project location settings. Retry after it finishes.', 409);
    await delay(15);
  }
}
function checkedUpdate(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['expectedRevision', 'defaultLocation', 'locationMode', 'dryRun'].includes(key)) ||
      !integer(input.expectedRevision) || (input.dryRun !== undefined && typeof input.dryRun !== 'boolean') || (!Object.hasOwn(input, 'defaultLocation') && !Object.hasOwn(input, 'locationMode'))) fail('INVALID_LOCATION_UPDATE', 'Provide expectedRevision and at least one location preference.');
  if (Object.hasOwn(input, 'defaultLocation') && input.defaultLocation !== null && !absolutePath(input.defaultLocation)) fail('INVALID_DEFAULT_LOCATION', 'Default location must be an absolute existing folder or null.');
  if (Object.hasOwn(input, 'locationMode') && !['default', 'prompt'].includes(input.locationMode)) fail('INVALID_LOCATION_MODE', 'Location mode must be default or prompt.');
}
async function nextSettings(current, input) {
  if (current.settings.revision !== input.expectedRevision) fail('LOCATIONS_CONFLICT', 'Project location settings changed. Read them again before updating.', 409, { expectedRevision: input.expectedRevision, actualRevision: current.settings.revision });
  const next = { ...current.settings, ...(Object.hasOwn(input, 'defaultLocation') ? { defaultLocation: input.defaultLocation } : {}), ...(Object.hasOwn(input, 'locationMode') ? { locationMode: input.locationMode } : {}) };
  if (next.locationMode === 'default' && next.defaultLocation === null) fail('DEFAULT_LOCATION_REQUIRED', 'Choose a default folder before enabling default location.');
  // An obsolete default may remain stored while switching to prompt. Choosing
  // a new default or actually enabling it always validates its current folder.
  if (next.defaultLocation !== null && (Object.hasOwn(input, 'defaultLocation') || next.locationMode === 'default')) next.defaultLocation = await validateProjectFolderPath(next.defaultLocation);
  return validateSettings(next);
}

/** Serialized CAS update. The injectable writer/timeout are local test hooks;
 * HTTP callers supply only the second argument's preference fields. */
export async function updateProjectLocationSettings(inputPath, input, { writeSettings = writeSidecar, lockTimeoutMs = 2000 } = {}) {
  checkedUpdate(input);
  if (typeof writeSettings !== 'function' || !Number.isInteger(lockTimeoutMs) || lockTimeoutMs < 50 || lockTimeoutMs > 10000) fail('INVALID_LOCATION_UPDATE', 'Invalid settings writer or lock timeout.');
  const filename = await profileFilename(inputPath, { createParent: !input.dryRun }), previous = queues.get(filename) ?? Promise.resolve();
  const operation = previous.catch(() => {}).then(async () => {
    const release = input.dryRun ? null : await acquireLock(filename, lockTimeoutMs); let result;
    try {
      const current = await readSettings(filename), next = await nextSettings(current, input);
      if (next.defaultLocation === current.settings.defaultLocation && next.locationMode === current.settings.locationMode) return result = { ...current, status: 'unchanged', applied: false };
      if (next.revision >= Number.MAX_SAFE_INTEGER) fail('LOCATION_REVISION_OVERFLOW', 'Location settings revision cannot be incremented safely.');
      next.revision++;
      if (input.dryRun) return result = { status: 'validated', applied: false, settings: next, fingerprint: current.fingerprint, warnings: [] };
      const bytes = encode(next), warnings = [];
      try { await writeSettings(filename, bytes, { noClobber: current.status === 'new' }); }
      catch (error) {
        let committed = false; try { committed = (await readSidecar(filename, MAX_SETTINGS_BYTES)).equals(bytes); } catch {}
        if (!committed) throw error;
        warnings.push(warning('LOCATION_SETTINGS_COMMITTED_WITH_WARNING', `Location settings committed, but finalization reported: ${error.message}`));
      }
      return result = { status: 'saved', applied: true, settings: next, fingerprint: hash(bytes), warnings };
    } finally { if (release) try { await release(); } catch (error) { if (result) result.warnings.push(warning('LOCATION_LOCK_RELEASE_FAILED', error.message)); } }
  });
  queues.set(filename, operation); try { return await operation; } finally { if (queues.get(filename) === operation) queues.delete(filename); }
}

/** Keep the preference identity stable across the caller's actual project
 * creation. Cooperating updates use this same queue and process lock. work must
 * not recursively update the same location profile. */
export async function withProjectLocationSettings(inputPath, expected, work) {
  if (!exact(expected, ['expectedRevision', 'expectedFingerprint']) || !integer(expected.expectedRevision) ||
      !(expected.expectedFingerprint === null || (typeof expected.expectedFingerprint === 'string' && /^[a-f0-9]{64}$/.test(expected.expectedFingerprint))) || typeof work !== 'function') fail('INVALID_LOCATION_GUARD', 'Provide the settings revision and fingerprint from the location preview.');
  const filename = await profileFilename(inputPath, { createParent: true }), previous = queues.get(filename) ?? Promise.resolve();
  const operation = previous.catch(() => {}).then(async () => {
    const release = await acquireLock(filename, 2000); let result, failure;
    try {
      const current = await readSettings(filename);
      if (current.settings.revision !== expected.expectedRevision || current.fingerprint !== expected.expectedFingerprint) fail('LOCATIONS_CONFLICT', 'Project location settings changed after preview. Inspect the location again.', 409);
      return result = await work(current);
    } catch (error) { failure = error; throw error; }
    finally {
      try { await release(); }
      catch (error) {
        const diagnostic = warning('LOCATION_LOCK_RELEASE_FAILED', error.message);
        if (result && typeof result === 'object') { result.warnings ??= []; result.warnings.push(diagnostic); }
        else if (failure) { failure.warnings ??= []; failure.warnings.push(diagnostic); }
        else fail('LOCATION_LOCK_RELEASE_FAILED', error.message, 500, { workCompleted: true });
      }
    }
  });
  queues.set(filename, operation); try { return await operation; } finally { if (queues.get(filename) === operation) queues.delete(filename); }
}

export async function inspectProjectFolder(input, { allowMissing = false } = {}) {
  if (!absolutePath(input) || typeof allowMissing !== 'boolean') fail('INVALID_CHOSEN_FOLDER', 'Select an absolute folder path.');
  return validateProjectFolderPath(input, { allowMissing });
}

export function validateProjectFolderName(input) {
  if (input === undefined || input === '') return 'Untitled';
  if (typeof input !== 'string') fail('INVALID_PROJECT_FOLDER_NAME', 'Project folder name must be a single folder name.');
  const name = input.trim() || 'Untitled';
  if (['.', '..'].includes(name) || /[/\\\x00-\x1f\x7f]/.test(name) || Buffer.byteLength(name) > 255) fail('INVALID_PROJECT_FOLDER_NAME', 'Use one folder name, without separators, control characters or more than 255 UTF-8 bytes.');
  return name;
}

/** Resolve only. Default location joins parent + folderName. Prompt selection
 * already denotes the final project folder and never appends that name. */
export async function resolveProjectLocation(inputPath, input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['folderName', 'chosenFolder', 'locationMode'].includes(key))) fail('INVALID_LOCATION_REQUEST', 'Invalid project location selection.');
  const profile = await getProjectLocationSettings(inputPath), mode = input.locationMode ?? profile.settings.locationMode;
  if (!['default', 'prompt'].includes(mode)) fail('INVALID_LOCATION_MODE', 'Location mode must be default or prompt.');
  const common = { settingsRevision: profile.settings.revision, settingsFingerprint: profile.fingerprint, locationMode: mode, defaultLocation: profile.settings.defaultLocation, warnings: [] };
  if (mode === 'prompt') {
    if (input.chosenFolder === undefined || input.chosenFolder === null || input.chosenFolder === '') return { ...common, folderName: null, projectFolder: null, requiresPrompt: true };
    if (!absolutePath(input.chosenFolder)) fail('INVALID_CHOSEN_FOLDER', 'Select an absolute project folder.');
    return { ...common, folderName: null, projectFolder: await validateProjectFolderPath(input.chosenFolder), requiresPrompt: false };
  }
  if (input.chosenFolder !== undefined && input.chosenFolder !== null) fail('INVALID_LOCATION_REQUEST', 'A chosen final folder is only used in prompt mode.');
  if (profile.settings.defaultLocation === null) fail('DEFAULT_LOCATION_REQUIRED', 'Choose a default folder before creating a project there.');
  const parent = await validateProjectFolderPath(profile.settings.defaultLocation), folderName = validateProjectFolderName(input.folderName);
  return { ...common, folderName, projectFolder: await validateProjectFolderPath(path.join(parent, folderName), { allowMissing: true }), requiresPrompt: false };
}
