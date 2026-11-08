import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { readSidecar, writeSidecar } from './session-store.mjs';
import { validateProjectFolderPath } from './project-drafts.mjs';

const MAX_BYTES = 1024 * 1024, queues = new Map();
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const integer = n => Number.isSafeInteger(n) && n >= 0;
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const exact = (x, keys) => object(x) && Object.keys(x).length === keys.length && keys.every(k => Object.hasOwn(x, k));
const fail = (code, message, status = 422) => { throw Object.assign(new Error(message), { code, status }); };
const changedRead = e => ['ENOENT', 'FILE_CHANGED'].includes(e.code);
const encode = x => Buffer.from(JSON.stringify(x, null, 2) + '\n');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const defaultControllerSettings = () => ({ schemaVersion: 1, revision: 0, visibleControllers: Array.from({ length: 128 }, (_, i) => i), newEventType: 'step', presets: [] });
function checkedLanes(lanes) {
  if (!Array.isArray(lanes) || !lanes.length || lanes.length > 64) fail('INVALID_CONTROLLER_PRESET', 'A preset needs 1–64 displayed lanes.');
  for (const l of lanes) {
    const keys = ['kind', 'channel', ...(l?.kind === 'cc' ? ['controller'] : l?.kind === 'polyPressure' ? ['pitch'] : [])];
    if (!exact(l, keys) || !['velocity','releaseVelocity','cc','pitchBend','channelPressure','polyPressure','program','sysex'].includes(l.kind) ||
        !(l.channel === 'all' || integer(l.channel) && l.channel < 16) ||
        (l.kind === 'cc' && !(integer(l.controller) && l.controller < 128)) ||
        (l.kind === 'polyPressure' && !(integer(l.pitch) && l.pitch < 128))) fail('INVALID_CONTROLLER_PRESET', 'Invalid lane type, channel, controller or key.');
  }
  return structuredClone(lanes);
}
function nameOf(name) {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 80 || /[\x00-\x1f\x7f]/.test(name)) fail('INVALID_CONTROLLER_PRESET_NAME', 'Preset names must contain 1–80 characters without control characters.');
  return name.trim().normalize('NFC');
}
function validate(s) {
  if (!exact(s, ['schemaVersion','revision','visibleControllers','newEventType','presets']) || s.schemaVersion !== 1 || !integer(s.revision) ||
      !['step','ramp'].includes(s.newEventType) || !Array.isArray(s.visibleControllers) || s.visibleControllers.length > 128 ||
      s.visibleControllers.some((n, i, a) => !integer(n) || n > 127 || i > 0 && n <= a[i-1]) || !Array.isArray(s.presets) || s.presets.length > 128)
    fail('INVALID_CONTROLLER_SETTINGS', 'Invalid controller profile. Existing file preserved.');
  const ids = new Set(), names = new Set();
  for (const p of s.presets) {
    if (!exact(p, ['id','name','lanes']) || typeof p.id !== 'string' || !uuid.test(p.id) || ids.has(p.id) || nameOf(p.name) !== p.name || names.has(p.name)) fail('INVALID_CONTROLLER_SETTINGS', 'Invalid or duplicate controller preset.');
    checkedLanes(p.lanes); ids.add(p.id); names.add(p.name);
  }
  return s;
}
async function filenameOf(input, create = false) {
  if (typeof input !== 'string' || !input.trim() || input.includes('\0') || input.length > 4096) fail('INVALID_CONTROLLER_PROFILE', 'Provide a controller profile filename.');
  const filename = path.resolve(input), parent = await validateProjectFolderPath(path.dirname(filename), { create, allowMissing: !create });
  return path.join(parent, path.basename(filename));
}
async function read(filename) {
  for (let attempt = 0; ; attempt++) try {
    const bytes = await readSidecar(filename, MAX_BYTES);
    let s; try { s = JSON.parse(bytes.toString('utf8')); } catch { fail('INVALID_CONTROLLER_SETTINGS', 'Corrupt controller profile. Existing file preserved.'); }
    return { status: 'ready', settings: validate(s), fingerprint: hash(bytes), warnings: [] };
  } catch (e) {
    if (e.code === 'FILE_CHANGED' && attempt < 3) { await delay(1); continue; }
    if (e.code === 'ENOENT') return { status: 'new', settings: defaultControllerSettings(), fingerprint: null, warnings: [] };
    e.status ??= e.code === 'FILE_CHANGED' ? 409 : 422; throw e;
  }
}
export async function getControllerSettings(input) { return read(await filenameOf(input)); }

// Cooperating processes serialize using the same owner-token lock protocol as
// project locations. A dead owner is reclaimed; malformed/unknown locks survive.
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; } };
async function regularDirectory(filename) { const stat = await fs.lstat(filename); if (!stat.isDirectory() || stat.isSymbolicLink()) fail('UNSAFE_CONTROLLER_LOCK', 'Controller settings lock must be a regular directory.'); }
async function lockOwner(lock) {
  await regularDirectory(lock);
  let owner; try { owner = JSON.parse((await readSidecar(path.join(lock, 'owner.json'), 4096)).toString('utf8')); }
  catch (error) { if (error instanceof SyntaxError) fail('INVALID_CONTROLLER_LOCK', 'Controller lock owner is invalid and was preserved.'); throw error; }
  if (!exact(owner, ['pid', 'token', 'createdAt']) || !Number.isSafeInteger(owner.pid) || owner.pid <= 0 || !uuid.test(owner.token) || typeof owner.createdAt !== 'string' || !Number.isFinite(Date.parse(owner.createdAt))) fail('INVALID_CONTROLLER_LOCK', 'Controller lock owner cannot be verified.');
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
        return async () => { if ((await lockOwner(lock)).token !== mine.token) fail('CONTROLLER_LOCK_CHANGED', 'A replacement controller lock was preserved.', 409); await fs.unlink(path.join(lock, 'owner.json')); await fs.rmdir(lock); };
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        let owner; try { owner = await lockOwner(lock); } catch (error) { if (!changedRead(error)) throw error; }
        if (owner && !alive(owner.pid)) {
          let held = false;
          try {
            await fs.mkdir(reclaim, { mode: 0o700 }); held = true; const fresh = await lockOwner(lock);
            if (fresh.token === owner.token && !alive(fresh.pid)) {
              if ((await fs.readdir(lock)).sort().join(',') !== 'owner.json') fail('INVALID_CONTROLLER_LOCK', 'Unknown files in a stale controller lock were preserved.');
              await fs.unlink(path.join(lock, 'owner.json')); await fs.rmdir(lock);
            }
          } catch (error) { if (error.code !== 'EEXIST' && !changedRead(error)) throw error; }
          finally { if (held) await fs.rmdir(reclaim); }
        }
      }
    }
    if (performance.now() >= deadline) fail('CONTROLLER_SETTINGS_LOCKED', 'Another process is updating project controller settings. Retry after it finishes.', 409);
    await delay(15);
  }
}


function nextSettings(current, input) {
  if (!object(input) || Object.keys(input).some(k => !['expectedRevision','expectedFingerprint','visibleControllers','newEventType','preset','dryRun'].includes(k)) ||
      !integer(input.expectedRevision) || !(input.expectedFingerprint === null || typeof input.expectedFingerprint === 'string' && /^[a-f0-9]{64}$/.test(input.expectedFingerprint)) ||
      (input.dryRun !== undefined && typeof input.dryRun !== 'boolean') || !['visibleControllers','newEventType','preset'].some(k => Object.hasOwn(input, k))) fail('INVALID_CONTROLLER_UPDATE', 'Provide revision, fingerprint and at least one controller setting.');
  if (input.expectedRevision !== current.settings.revision || input.expectedFingerprint !== current.fingerprint) fail('CONTROLLER_SETTINGS_CONFLICT', 'Controller settings changed. Reload before applying; your draft was not saved.', 409);
  const next = structuredClone(current.settings);
  if (Object.hasOwn(input, 'visibleControllers')) next.visibleControllers = structuredClone(input.visibleControllers);
  if (Object.hasOwn(input, 'newEventType')) next.newEventType = input.newEventType;
  if (Object.hasOwn(input, 'preset')) {
    const p = input.preset, action = p?.action;
    if (!exact(p, action === 'save' ? ['action','name','lanes'] : action === 'rename' ? ['action','id','name'] : ['action','id']) || !['save','rename','delete'].includes(action)) fail('INVALID_CONTROLLER_PRESET', 'Use save, rename or delete with the required fields.');
    if (action === 'save') next.presets.push({ id: randomUUID(), name: nameOf(p.name), lanes: checkedLanes(p.lanes) });
    else {
      const found = next.presets.find(x => x.id === p.id);
      if (!found) fail('CONTROLLER_PRESET_NOT_FOUND', 'Controller preset no longer exists.', 404);
      if (action === 'rename') found.name = nameOf(p.name);
      else next.presets = next.presets.filter(x => x.id !== p.id);
    }
  }
  validate(next); return next;
}
export async function updateControllerSettings(inputPath, input, { writeSettings = writeSidecar, lockTimeoutMs = 2000 } = {}) {
  // Preflight before mkdir/lock. CAS is rechecked after locking.
  const before = await getControllerSettings(inputPath); nextSettings(before, input);
  if (typeof writeSettings !== 'function' || !Number.isInteger(lockTimeoutMs) || lockTimeoutMs < 50 || lockTimeoutMs > 10000) fail('INVALID_CONTROLLER_UPDATE', 'Invalid writer or timeout.');
  const filename = await filenameOf(inputPath, !input.dryRun), previous = queues.get(filename) ?? Promise.resolve();
  const operation = previous.catch(() => {}).then(async () => {
    const release = input.dryRun ? null : await acquireLock(filename, lockTimeoutMs); let result;
    try {
      const current = await read(filename), next = nextSettings(current, input);
      if (JSON.stringify(next) === JSON.stringify(current.settings)) return result = { ...current, status: 'unchanged', applied: false };
      if (next.revision >= Number.MAX_SAFE_INTEGER) fail('CONTROLLER_REVISION_OVERFLOW', 'Controller settings revision overflow.');
      next.revision++;
      if (input.dryRun) return result = { status: 'validated', applied: false, settings: next, fingerprint: current.fingerprint, warnings: [] };
      const bytes = encode(next), warnings = [];
      if (bytes.length > MAX_BYTES) fail('CONTROLLER_SETTINGS_TOO_LARGE', 'Controller profile exceeds 1 MiB.');
      try { await writeSettings(filename, bytes, { noClobber: current.status === 'new' }); }
      catch (e) {
        let committed = false; try { committed = (await readSidecar(filename, MAX_BYTES)).equals(bytes); } catch {}
        if (!committed) throw e;
        warnings.push({ code: 'CONTROLLER_SETTINGS_COMMITTED_WITH_WARNING', message: e.message });
      }
      return result = { status: 'saved', applied: true, settings: next, fingerprint: hash(bytes), warnings };
    } finally { if (release) try { await release(); } catch (e) { if (result) result.warnings.push({ code: 'CONTROLLER_LOCK_RELEASE_FAILED', message: e.message }); } }
  });
  queues.set(filename, operation); try { return await operation; } finally { if (queues.get(filename) === operation) queues.delete(filename); }
}

/** Resolve one profile snapshot for every implicit Draw/Paint/Line in a batch. Explicit
 * curves (including null/Step), raw events, clipboard and musical history keep
 * their own values. Core Engine callers remain deterministic and explicit. */
export async function withControllerDefaults(envelope, profilePath) {
  function needs(c) { return ['midi.controllers.paint','midi.controllers.draw','midi.controllers.line'].includes(c?.command) && object(c.arguments) && !Object.hasOwn(c.arguments, 'curve') && ['cc','pitchBend','channelPressure','polyPressure'].includes(c.arguments.lane?.kind) || c?.command === 'batch' && Array.isArray(c.arguments?.commands) && c.arguments.commands.some(needs); }
  if (!needs(envelope)) return envelope;
  const { settings } = await getControllerSettings(profilePath), next = structuredClone(envelope);
  function visit(c) {
    if (c?.command === 'batch' && Array.isArray(c.arguments?.commands)) c.arguments.commands.forEach(visit);
    else if (needs(c)) c.arguments.curve = settings.newEventType === 'ramp' ? { type: 'ramp' } : null;
  }
  visit(next); return next;
}
