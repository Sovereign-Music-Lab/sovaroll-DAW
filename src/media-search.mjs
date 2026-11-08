import {MAX_WAV_FILE_BYTES} from './media/asset-limits.mjs';
import { promises as fs, constants } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import { validateProject } from './core/engine.mjs';
import { decodeWav } from './media/wav.mjs';

export const MEDIA_SEARCH_LIMITS = Object.freeze({ maxEntries: 10000, maxFiles: 2000, maxCandidates: 200, maxFileBytes: MAX_WAV_FILE_BYTES, maxTotalBytes: 512 * 1024 * 1024, maxDepth: 32, maxDiagnostics: 200 });
const candidateBindings = new WeakMap();
const fail = (code, message) => Object.assign(new Error(message), { code, status: code === 'CANDIDATE_CHANGED' ? 409 : 422 });
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const identity = stat => ({ dev: stat.dev, ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs });
const same = (a, b) => ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'].every(key => a[key] === b[key]);
const stopError = () => fail('SEARCH_STOPPED', 'Media search was stopped.');

function checkedLimits(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('INVALID_SEARCH', 'Search limits must be an object.');
  const limits = { ...MEDIA_SEARCH_LIMITS };
  for (const [key, value] of Object.entries(input)) {
    if (!Object.hasOwn(limits, key) || !Number.isSafeInteger(value) || value < 1 || value > limits[key]) throw fail('INVALID_SEARCH', `Invalid search limit: ${key}.`);
    limits[key] = value;
  }
  return limits;
}

// macOS /var and /tmp are system aliases into /private. Resolve only these
// known aliases; user-created symlinks in selected paths remain disallowed.
async function canonicalLocation(input) {
  let filename = path.resolve(input);
  for (const alias of ['/var', '/tmp', '/etc']) {
    if (filename !== alias && !filename.startsWith(`${alias}/`)) continue;
    let stat;
    try { stat = await fs.lstat(alias); } catch { continue; }
    if (stat.isSymbolicLink() && await fs.realpath(alias) === `/private${alias}`) filename = `/private${filename}`;
    break;
  }
  await safeAncestors(filename);
  return filename;
}

async function safeAncestors(filename) {
  const absolute = path.resolve(filename), parsed = path.parse(absolute), parts = absolute.slice(parsed.root.length).split(path.sep).filter(Boolean);
  let cursor = parsed.root;
  for (const [index, part] of parts.entries()) {
    cursor = path.join(cursor, part);
    const stat = await fs.lstat(cursor);
    if (stat.isSymbolicLink()) throw fail('UNSAFE_SEARCH_PATH', 'Symbolic links are not followed during media search.');
    if (index < parts.length - 1 && !stat.isDirectory()) throw fail('UNSAFE_SEARCH_PATH', 'Search path ancestors must be regular directories.');
  }
}

async function readRegular(filename, { maxBytes, expected, checkStopped = () => {}, onBytes = () => {} }) {
  checkStopped(); await safeAncestors(filename);
  const before = await fs.lstat(filename);
  if (!before.isFile() || before.isSymbolicLink()) throw fail('UNSAFE_SEARCH_PATH', 'The candidate must be a regular file.');
  if (expected && !same(identity(before), expected)) throw fail('CANDIDATE_CHANGED', 'The candidate changed after it was scanned. Search again before applying it.');
  if (before.size > maxBytes) throw fail('CANDIDATE_TOO_LARGE', `The candidate exceeds the ${maxBytes}-byte read limit.`);
  let handle;
  try {
    handle = await fs.open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = await handle.stat();
    if (!opened.isFile() || !same(identity(before), identity(opened))) throw fail('CANDIDATE_CHANGED', 'The candidate changed while opening.');
    const chunks = []; let length = 0;
    while (true) {
      checkStopped();
      const chunk = Buffer.allocUnsafe(Math.min(65536, maxBytes + 1 - length));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
      if (!bytesRead) break;
      onBytes(bytesRead); length += bytesRead;
      if (length > maxBytes) throw fail('CANDIDATE_TOO_LARGE', `The candidate exceeds the ${maxBytes}-byte read limit.`);
      chunks.push(chunk.subarray(0, bytesRead));
      await yieldTurn();
    }
    const after = await handle.stat();
    await safeAncestors(filename);
    const named = await fs.lstat(filename);
    if (!same(identity(opened), identity(after)) || !same(identity(after), identity(named)) || length !== after.size) throw fail('CANDIDATE_CHANGED', 'The candidate changed during its read.');
    checkStopped();
    return { bytes: Buffer.concat(chunks, length), identity: identity(after) };
  } finally { await handle?.close(); }
}

function metadata(bytes) {
  const decoded = decodeWav(bytes);
  if (decoded.frames < 1 || decoded.channels.length > 2 || decoded.sampleRate > 96000) throw fail('UNSUPPORTED_CANDIDATE', 'Media recovery supports nonempty mono/stereo WAV at sample rates up to 96 kHz.');
  return { sha256: digest(bytes), size: bytes.length, sampleRate: decoded.sampleRate, channels: decoded.channels.length, frames: decoded.frames };
}

function compatibility(project, asset, candidate) {
  const reasons = [];
  for (const clip of project.clips.filter(clip => clip.type === 'audio' && clip.assetId === asset.id)) {
    const sourceRate = BigInt(asset.sampleRate), targetRate = BigInt(candidate.sampleRate);
    const start = BigInt(clip.offsetFrames) * targetRate;
    const end = (BigInt(clip.offsetFrames) + BigInt(clip.lengthFrames)) * targetRate;
    if (start % sourceRate || end % sourceRate) {
      reasons.push({ code: 'ASSET_RATE_INCOMPATIBLE', message: `Clip ${clip.id} source boundaries cannot be expressed as exact whole frames at the candidate sample rate.` });
    } else if (end / sourceRate > BigInt(candidate.frames)) {
      reasons.push({ code: 'AUDIO_OUT_OF_BOUNDS', message: `The candidate is too short for clip ${clip.id}.` });
    }
  }
  return { compatible: reasons.length === 0, reasons };
}

/** Read-only discovery. The caller explicitly authorizes the one local path.
 * No project, media, registry or journal is modified. Search results are choices,
 * not permission to apply; multiple candidates remain explicitly ambiguous.
 */
export function createMediaSearch({ project, assetIds, location, mode = 'search', caseSensitive = false, recursive, queryName, limits: inputLimits } = {}) {
  validateProject(project);
  if (!Array.isArray(assetIds) || !assetIds.length || assetIds.length > 1000 || new Set(assetIds).size !== assetIds.length || assetIds.some(id => typeof id !== 'string' || !project.assets.some(asset => asset.id === id))) throw fail('INVALID_SEARCH', 'Search requires unique existing target asset IDs.');
  if (typeof location !== 'string' || !location.trim() || location.includes('\0') || !['file', 'folder', 'search'].includes(mode) || typeof caseSensitive !== 'boolean' || (recursive !== undefined && typeof recursive !== 'boolean')) throw fail('INVALID_SEARCH', 'Invalid media search mode, location or options.');
  if (queryName !== undefined && (typeof queryName !== 'string' || !queryName.trim() || queryName.length > 256 || queryName.includes('\0') || queryName.includes('/') || queryName.includes('\\'))) throw fail('INVALID_SEARCH', 'Search name must be a nonempty filename without directory separators.');
  if (recursive === true && mode !== 'search') throw fail('INVALID_SEARCH', 'Recursive lookup is only available in search mode.');
  const limits = checkedLimits(inputLimits), frozen = structuredClone(project), targets = assetIds.map(id => frozen.assets.find(asset => asset.id === id));
  const id = randomUUID(), handles = new Map();
  const state = { id, status: 'running', mode, location: path.resolve(location), assetIds: [...assetIds], queryName: queryName ?? targets[0].name, caseSensitive, recursive: mode === 'search' && recursive !== false,
    progress: { visitedEntries: 0, scannedFiles: 0, decodedFiles: 0, bytesRead: 0 }, candidates: [], errors: [], warnings: [], truncated: false, limits, stopRequested: false };
  let stopped = false, limitReached = false;
  const checkStopped = () => { if (stopped) throw stopError(); };
  const addDiagnostic = (kind, diagnostic) => {
    if (state[kind].length < limits.maxDiagnostics) state[kind].push(diagnostic);
    else state.truncated = true;
  };
  const bound = (code, message) => { limitReached = true; state.truncated = true; addDiagnostic('warnings', { code, message }); };
  const nameEqual = (a, b) => caseSensitive ? a === b : a.toLowerCase() === b.toLowerCase();
  const matchesFor = (name, info) => targets.flatMap((asset, index) => {
    const exactHash = info.sha256 === asset.sha256;
    const selected = mode === 'file' && index === 0;
    const searchName = mode === 'search' && index === 0 ? state.queryName : asset.name;
    const named = nameEqual(name, searchName);
    if (!exactHash && !selected && !named) return [];
    return [{ assetId: asset.id, match: exactHash ? 'hash' : selected ? 'selected' : 'name', exactHash, ...compatibility(frozen, asset, info) }];
  });
  const namedAssetIds = name => targets.filter((asset, index) => nameEqual(name, mode === 'search' && index === 0 ? state.queryName : asset.name)).map(asset => asset.id);

  async function scanFile(filename) {
    checkStopped();
    if (state.progress.scannedFiles >= limits.maxFiles) { bound('SEARCH_FILE_LIMIT', 'The file scan limit was reached; results are incomplete.'); return; }
    state.progress.scannedFiles++;
    const name = path.basename(filename);
    try {
      const stat = await fs.lstat(filename);
      if (!stat.isFile() || stat.isSymbolicLink()) throw fail('UNSAFE_SEARCH_PATH', 'The candidate must be a regular file.');
      if (stat.size > limits.maxFileBytes) throw fail('CANDIDATE_TOO_LARGE', `The candidate exceeds ${limits.maxFileBytes} bytes.`);
      if (state.progress.bytesRead + stat.size > limits.maxTotalBytes) { bound('SEARCH_BYTE_LIMIT', 'The total scan byte limit was reached; results are incomplete.'); return; }
      const read = await readRegular(filename, { maxBytes: limits.maxFileBytes, checkStopped, onBytes: size => {
        state.progress.bytesRead += size;
        if (state.progress.bytesRead > limits.maxTotalBytes) { bound('SEARCH_BYTE_LIMIT', 'The total scan byte limit was reached; results are incomplete.'); throw fail('SEARCH_BYTE_LIMIT', 'Total scan byte limit exceeded.'); }
      } });
      const info = metadata(read.bytes); state.progress.decodedFiles++; checkStopped();
      const matches = matchesFor(name, info);
      if (!matches.length) return;
      if (state.candidates.length >= limits.maxCandidates) { bound('SEARCH_CANDIDATE_LIMIT', 'The candidate limit was reached; results are incomplete.'); return; }
      const candidate = { id: randomUUID(), name, path: filename, ...info, matches };
      const handle = Object.freeze({ id: candidate.id });
      candidateBindings.set(handle, { path: filename, identity: read.identity, ...info, maxBytes: limits.maxFileBytes });
      handles.set(candidate.id, handle); state.candidates.push(candidate);
    } catch (error) {
      if (error.code === 'SEARCH_STOPPED') throw error;
      addDiagnostic('errors', { code: error.code ?? 'CANDIDATE_UNREADABLE', message: error.message, path: filename, name, assetIds: mode === 'file' ? [targets[0].id] : namedAssetIds(name) });
    }
  }

  async function scanDirectory(directory, depth) {
    checkStopped(); await safeAncestors(directory);
    const before = await fs.lstat(directory);
    if (!before.isDirectory() || before.isSymbolicLink()) throw fail('UNSAFE_SEARCH_PATH', 'Search location must be a regular directory.');
    const children = [], stream = await fs.opendir(directory);
    try {
      for await (const entry of stream) {
        await yieldTurn(); checkStopped(); if (limitReached) break;
        if (state.progress.visitedEntries >= limits.maxEntries) { bound('SEARCH_ENTRY_LIMIT', 'The directory entry limit was reached; results are incomplete.'); break; }
        state.progress.visitedEntries++;
        const filename = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) { addDiagnostic('warnings', { code: 'SYMLINK_SKIPPED', message: 'A symbolic link was skipped.', path: filename }); continue; }
        if (entry.isDirectory() && state.recursive) {
          if (depth >= limits.maxDepth) { state.truncated = true; addDiagnostic('warnings', { code: 'SEARCH_DEPTH_LIMIT', message: 'A directory exceeded the search depth limit.', path: filename }); }
          else children.push(filename);
        } else if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.wav') await scanFile(filename);
      }
    } finally { await stream.close().catch(error => { if (error.code !== 'ERR_DIR_CLOSED') throw error; }); }
    const after = await fs.lstat(directory);
    if (before.dev !== after.dev || before.ino !== after.ino || !after.isDirectory() || after.isSymbolicLink()) throw fail('SEARCH_DIRECTORY_CHANGED', 'The search directory changed identity while scanning.');
    for (const child of children) {
      checkStopped(); if (limitReached) break;
      try { await scanDirectory(child, depth + 1); }
      catch (error) {
        if (error.code === 'SEARCH_STOPPED') throw error;
        addDiagnostic('errors', { code: error.code ?? 'DIRECTORY_UNREADABLE', message: error.message, path: child });
      }
    }
  }

  const snapshot = () => {
    const result = structuredClone(state);
    result.byAsset = targets.map(asset => {
      const matches = state.candidates.flatMap(candidate => candidate.matches.filter(match => match.assetId === asset.id).map(match => ({ candidateId: candidate.id, ...match })));
      const exact = matches.filter(match => match.exactHash && match.compatible);
      return { assetId: asset.id, candidateIds: matches.map(match => match.candidateId), exactCandidateIds: exact.map(match => match.candidateId), ambiguous: matches.length > 1, exactAmbiguous: exact.length > 1 };
    });
    return result;
  };
  const done = (async () => {
    await yieldTurn();
    try {
      checkStopped(); state.location = await canonicalLocation(location);
      if (mode === 'file') { state.progress.visitedEntries = 1; await scanFile(state.location); }
      else await scanDirectory(state.location, 0);
      state.status = stopped ? 'stopped' : 'completed';
    } catch (error) {
      if (error.code === 'SEARCH_STOPPED') state.status = 'stopped';
      else { state.status = 'failed'; addDiagnostic('errors', { code: error.code ?? 'SEARCH_FAILED', message: error.message, path: state.location }); }
    }
    return snapshot();
  })();
  return Object.freeze({ id, snapshot, done, stop() { if (state.status === 'running') { stopped = true; state.stopRequested = true; } return snapshot(); }, getCandidate(candidateId) { return handles.get(candidateId) ?? null; } });
}

/** Only an opaque handle from a live search can be read. Recheck ancestor/file
 * identity, bytes and decoded metadata; HTTP request bodies cannot supply paths.
 * This catches changes since scanning, but is not an OS-wide writer lock.
 */
export async function readMediaCandidate(candidate) {
  const bound = candidateBindings.get(candidate);
  if (!bound) throw fail('INVALID_CANDIDATE', 'The candidate must come from this session’s media search.');
  try {
    // Report permission loss as unreadable even when chmod also changes ctime.
    // This is diagnostic only: readRegular still verifies the opened file.
    await safeAncestors(bound.path);
    await fs.access(bound.path, constants.R_OK);
    const read = await readRegular(bound.path, { maxBytes: bound.maxBytes, expected: bound.identity });
    const info = metadata(read.bytes);
    if (['sha256', 'size', 'sampleRate', 'channels', 'frames'].some(key => info[key] !== bound[key])) throw fail('CANDIDATE_CHANGED', 'Candidate content or audio metadata changed after scanning. Search again.');
    return { bytes: read.bytes, path: bound.path, ...info };
  } catch (error) {
    if (['ENOENT', 'ENOTDIR', 'ESTALE', 'ELOOP', 'UNSAFE_SEARCH_PATH'].includes(error.code)) throw fail('CANDIDATE_CHANGED', 'The candidate or its directory was removed, replaced or became unsafe after scanning. Search again.');
    if (['EACCES', 'EPERM'].includes(error.code)) throw fail('CANDIDATE_UNREADABLE', 'Permission to read the candidate or its directory was denied. Restore read access and search again.');
    throw error;
  }
}
