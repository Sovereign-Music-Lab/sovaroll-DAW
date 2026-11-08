import { promises as fs } from 'node:fs';
import path from 'node:path';
import { inspectProjectFolder } from './project-locations.mjs';

const PAGE_SIZE = 500, MAX_ENTRIES = 100000;
const fail = (code, message, status = 422) => { throw Object.assign(new Error(message), { code, status }); };

/** Read-only folder picker. No recursion, file contents, mkdir, or symlink
 * traversal; selecting an entry still requires normal creation-plan validation. */
export async function browseProjectFolders(input = {}, { basePath } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['path', 'cursor'].includes(key))) fail('INVALID_FOLDER_QUERY', 'Use a folder path and optional page cursor.');
  const requested = input.path ?? basePath, cursor = input.cursor ?? 0;
  if (typeof requested !== 'string' || !requested.trim() || !path.isAbsolute(requested) || requested.includes('\0')) fail('INVALID_FOLDER_QUERY', 'Choose an absolute folder path.');
  if (!Number.isSafeInteger(cursor) || cursor < 0) fail('INVALID_FOLDER_QUERY', 'Folder page cursor must be a nonnegative integer.');
  const filename = await inspectProjectFolder(requested), before = await fs.lstat(filename), entries = [];
  let scanned = 0;
  const directory = await fs.opendir(filename);
  for await (const entry of directory) {
    if (++scanned > MAX_ENTRIES) fail('FOLDER_LIST_LIMIT', 'This folder contains more than 100,000 entries. Enter the desired subfolder path directly.');
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const child = path.join(filename, entry.name);
    try { const stat = await fs.lstat(child); if (stat.isDirectory() && !stat.isSymbolicLink()) entries.push({ name: entry.name, path: child }); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  await inspectProjectFolder(filename);
  const after = await fs.lstat(filename);
  if (before.dev !== after.dev || before.ino !== after.ino) fail('FOLDER_CHANGED', 'The folder changed during inspection. Browse it again.', 409);
  entries.sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }) || a.name.localeCompare(b.name));
  if (cursor > entries.length) fail('FOLDER_PAGE_CHANGED', 'Folder contents changed. Refresh the first page.', 409);
  return { path: filename, parentPath: path.dirname(filename) === filename ? null : path.dirname(filename), entries: entries.slice(cursor, cursor + PAGE_SIZE),
    nextCursor: cursor + PAGE_SIZE < entries.length ? cursor + PAGE_SIZE : null, total: entries.length, readOnly: true };
}
