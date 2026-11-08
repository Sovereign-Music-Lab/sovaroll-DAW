import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { browseProjectFolders } from '../src/folder-browser.mjs';

async function fixture(t) {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'newdaw-folders-')));
  t.after(() => fs.rm(directory, { recursive: true, force: true })); return directory;
}

test('folder picker browses actual directories, includes hidden names and never follows links or reads files', async t => {
  const dir = await fixture(t); await fs.mkdir(path.join(dir, 'Project 2')); await fs.mkdir(path.join(dir, 'Project 10')); await fs.mkdir(path.join(dir, '.private-folder'));
  await fs.writeFile(path.join(dir, 'File.json'), 'untouched source'); await fs.symlink('Project 2', path.join(dir, 'Alias'));
  const before = (await fs.readdir(dir)).sort(), value = await browseProjectFolders({}, { basePath: dir });
  assert.equal(value.readOnly, true); assert.equal(value.path, dir); assert.equal(value.parentPath, path.dirname(dir)); assert.equal(value.total, 3);
  assert.deepEqual(value.entries.map(row => row.name), ['.private-folder', 'Project 2', 'Project 10']); assert.equal(value.nextCursor, null);
  assert.deepEqual((await fs.readdir(dir)).sort(), before); assert.equal(await fs.readFile(path.join(dir, 'File.json'), 'utf8'), 'untouched source');
  const child = await browseProjectFolders({ path: value.entries[1].path }); assert.equal(child.parentPath, dir); assert.deepEqual(child.entries, []);
});

test('folder picker paginates without dropping folders and supports parent navigation', async t => {
  const dir = await fixture(t); await Promise.all(Array.from({ length: 503 }, (_, i) => fs.mkdir(path.join(dir, `Folder ${i}`))));
  const first = await browseProjectFolders({ path: dir }); assert.equal(first.entries.length, 500); assert.equal(first.nextCursor, 500); assert.equal(first.total, 503);
  const last = await browseProjectFolders({ path: dir, cursor: first.nextCursor }); assert.equal(last.entries.length, 3); assert.equal(last.nextCursor, null);
  assert.equal(new Set([...first.entries, ...last.entries].map(row => row.path)).size, 503);
  const child = await browseProjectFolders({ path: first.entries[0].path }); assert.equal(child.parentPath, dir);
  await assert.rejects(browseProjectFolders({ path: dir, cursor: 504 }), { code: 'FOLDER_PAGE_CHANGED' });
});

test('folder picker rejects unsafe, missing, relative and special targets without creating directories', async t => {
  const dir = await fixture(t); await fs.mkdir(path.join(dir, 'real')); await fs.symlink('real', path.join(dir, 'link')); await fs.writeFile(path.join(dir, 'regular'), 'safe');
  for (const filename of [path.join(dir, 'link'), path.join(dir, 'regular')]) await assert.rejects(browseProjectFolders({ path: filename }));
  await assert.rejects(browseProjectFolders({ path: path.join(dir, 'missing') }), { code: 'ENOENT' });
  for (const input of [{ path: '..' }, { path: dir, cursor: -1 }, { path: dir, cursor: 1.2 }, { path: dir, cursor: '1' }, { path: dir, recursive: true }]) await assert.rejects(browseProjectFolders(input), { code: 'INVALID_FOLDER_QUERY' });
  await assert.rejects(fs.lstat(path.join(dir, 'missing')), { code: 'ENOENT' }); assert.equal(await fs.readFile(path.join(dir, 'regular'), 'utf8'), 'safe');
});

test('filesystem root has no invented parent and listing remains read-only', async () => {
  const value = await browseProjectFolders({ path: path.parse(process.cwd()).root }); assert.equal(value.parentPath, null); assert.equal(value.readOnly, true);
});

test('unreadable folders report permission failure without falling back to another directory', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, async t => {
  const dir = await fixture(t), locked = path.join(dir, 'No access'); await fs.mkdir(locked); await fs.mkdir(path.join(locked, 'Hidden child'));
  await fs.chmod(locked, 0);
  try { await assert.rejects(browseProjectFolders({ path: locked }), { code: 'EACCES' }); }
  finally { await fs.chmod(locked, 0o700); }
  assert.deepEqual(await fs.readdir(locked), ['Hidden child']);
});
