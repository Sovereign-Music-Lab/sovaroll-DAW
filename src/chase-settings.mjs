import {defaultChaseOptions,resolveChaseOptions} from './media/midi-chase.mjs';
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
export const defaultChaseSettings = () => ({schemaVersion:1,revision:0,options:defaultChaseOptions()});
function validate(s) {
  if (!exact(s,['schemaVersion','revision','options']) || s.schemaVersion!==1 || !integer(s.revision) || !exact(s.options,Object.keys(defaultChaseOptions()))) fail('INVALID_CHASE_SETTINGS','Invalid Chase profile. Existing file preserved.');
  try { resolveChaseOptions(s.options); } catch { fail('INVALID_CHASE_SETTINGS','Chase profile options must be booleans. Existing file preserved.'); }
  return s;
}
async function filenameOf(input, create = false) {
  if (typeof input !== 'string' || !input.trim() || input.includes('\0') || input.length > 4096) fail('INVALID_CHASE_PROFILE', 'Provide a chase profile filename.');
  const filename = path.resolve(input), parent = await validateProjectFolderPath(path.dirname(filename), { create, allowMissing: !create });
  return path.join(parent, path.basename(filename));
}
async function read(filename) {
  for (let attempt = 0; ; attempt++) try {
    const bytes = await readSidecar(filename, MAX_BYTES);
    let s; try { s = JSON.parse(bytes.toString('utf8')); } catch { fail('INVALID_CHASE_SETTINGS', 'Corrupt chase profile. Existing file preserved.'); }
    return { status: 'ready', settings: validate(s), fingerprint: hash(bytes), warnings: [] };
  } catch (e) {
    if (e.code === 'FILE_CHANGED' && attempt < 3) { await delay(1); continue; }
    if (e.code === 'ENOENT') return { status: 'new', settings: defaultChaseSettings(), fingerprint: null, warnings: [] };
    e.status ??= e.code === 'FILE_CHANGED' ? 409 : 422; throw e;
  }
}
export async function getChaseSettings(input) { return read(await filenameOf(input)); }

// Cooperating processes serialize using the same owner-token lock protocol as
// project locations. A dead owner is reclaimed; malformed/unknown locks survive.
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; } };
async function regularDirectory(filename) { const stat = await fs.lstat(filename); if (!stat.isDirectory() || stat.isSymbolicLink()) fail('UNSAFE_CHASE_LOCK', 'Chase settings lock must be a regular directory.'); }
async function lockOwner(lock) {
  await regularDirectory(lock);
  let owner; try { owner = JSON.parse((await readSidecar(path.join(lock, 'owner.json'), 4096)).toString('utf8')); }
  catch (error) { if (error instanceof SyntaxError) fail('INVALID_CHASE_LOCK', 'Chase lock owner is invalid and was preserved.'); throw error; }
  if (!exact(owner, ['pid', 'token', 'createdAt']) || !Number.isSafeInteger(owner.pid) || owner.pid <= 0 || !uuid.test(owner.token) || typeof owner.createdAt !== 'string' || !Number.isFinite(Date.parse(owner.createdAt))) fail('INVALID_CHASE_LOCK', 'Chase lock owner cannot be verified.');
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
        return async () => { if ((await lockOwner(lock)).token !== mine.token) fail('CHASE_LOCK_CHANGED', 'A replacement chase lock was preserved.', 409); await fs.unlink(path.join(lock, 'owner.json')); await fs.rmdir(lock); };
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        let owner; try { owner = await lockOwner(lock); } catch (error) { if (!changedRead(error)) throw error; }
        if (owner && !alive(owner.pid)) {
          let held = false;
          try {
            await fs.mkdir(reclaim, { mode: 0o700 }); held = true; const fresh = await lockOwner(lock);
            if (fresh.token === owner.token && !alive(fresh.pid)) {
              if ((await fs.readdir(lock)).sort().join(',') !== 'owner.json') fail('INVALID_CHASE_LOCK', 'Unknown files in a stale chase lock were preserved.');
              await fs.unlink(path.join(lock, 'owner.json')); await fs.rmdir(lock);
            }
          } catch (error) { if (error.code !== 'EEXIST' && !changedRead(error)) throw error; }
          finally { if (held) await fs.rmdir(reclaim); }
        }
      }
    }
    if (performance.now() >= deadline) fail('CHASE_SETTINGS_LOCKED', 'Another process is updating project chase settings. Retry after it finishes.', 409);
    await delay(15);
  }
}


function nextSettings(current,input) {
  if (!object(input) || Object.keys(input).some(k=>!['expectedRevision','expectedFingerprint','options','dryRun'].includes(k)) || !integer(input.expectedRevision) || !(input.expectedFingerprint===null || typeof input.expectedFingerprint==='string' && /^[a-f0-9]{64}$/.test(input.expectedFingerprint)) || (input.dryRun!==undefined && typeof input.dryRun!=='boolean') || !object(input.options) || !Object.keys(input.options).length) fail('INVALID_CHASE_UPDATE','Provide revision, fingerprint and at least one Chase option.');
  try { resolveChaseOptions(input.options); } catch { fail('INVALID_CHASE_UPDATE','Chase options must be known boolean fields.'); }
  if(input.expectedRevision!==current.settings.revision || input.expectedFingerprint!==current.fingerprint) fail('CHASE_SETTINGS_CONFLICT','Chase settings changed. Reload before applying; your draft was not saved.',409);
  return validate({...current.settings,options:{...current.settings.options,...input.options}});
}
export async function updateChaseSettings(inputPath, input, { writeSettings = writeSidecar, lockTimeoutMs = 2000 } = {}) {
  // Preflight before mkdir/lock. CAS is rechecked after locking.
  const before = await getChaseSettings(inputPath); nextSettings(before, input);
  if (typeof writeSettings !== 'function' || !Number.isInteger(lockTimeoutMs) || lockTimeoutMs < 50 || lockTimeoutMs > 10000) fail('INVALID_CHASE_UPDATE', 'Invalid writer or timeout.');
  const filename = await filenameOf(inputPath, !input.dryRun), previous = queues.get(filename) ?? Promise.resolve();
  const operation = previous.catch(() => {}).then(async () => {
    const release = input.dryRun ? null : await acquireLock(filename, lockTimeoutMs); let result;
    try {
      const current = await read(filename), next = nextSettings(current, input);
      if (JSON.stringify(next) === JSON.stringify(current.settings)) return result = { ...current, status: 'unchanged', applied: false };
      if (next.revision >= Number.MAX_SAFE_INTEGER) fail('CHASE_REVISION_OVERFLOW', 'Chase settings revision overflow.');
      next.revision++;
      if (input.dryRun) return result = { status: 'validated', applied: false, settings: next, fingerprint: current.fingerprint, warnings: [] };
      const bytes = encode(next), warnings = [];
      if (bytes.length > MAX_BYTES) fail('CHASE_SETTINGS_TOO_LARGE', 'Chase profile exceeds 1 MiB.');
      try { await writeSettings(filename, bytes, { noClobber: current.status === 'new' }); }
      catch (e) {
        let committed = false; try { committed = (await readSidecar(filename, MAX_BYTES)).equals(bytes); } catch {}
        if (!committed) throw e;
        warnings.push({ code: 'CHASE_SETTINGS_COMMITTED_WITH_WARNING', message: e.message });
      }
      return result = { status: 'saved', applied: true, settings: next, fingerprint: hash(bytes), warnings };
    } finally { if (release) try { await release(); } catch (e) { if (result) result.warnings.push({ code: 'CHASE_LOCK_RELEASE_FAILED', message: e.message }); } }
  });
  queues.set(filename, operation); try { return await operation; } finally { if (queues.get(filename) === operation) queues.delete(filename); }
}

/** Resolve one frozen profile for implicit Merge Chase options in a batch. */
export async function withChaseDefaults(envelope,profilePath) {
  const needs=c=>c?.command==='midi.mergeLoop' && c.arguments?.includeChase===true && !Object.hasOwn(c.arguments,'chaseOptions') || c?.command==='batch' && Array.isArray(c.arguments?.commands) && c.arguments.commands.some(needs);
  if(!needs(envelope))return envelope;
  const {settings}=await getChaseSettings(profilePath),next=structuredClone(envelope);
  const visit=c=>{if(c?.command==='batch'&&Array.isArray(c.arguments?.commands))c.arguments.commands.forEach(visit);else if(needs(c))c.arguments.chaseOptions=structuredClone(settings.options);};
  visit(next);return next;
}
