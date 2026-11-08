import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createProject } from '../src/core/engine.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHUTDOWN_DEADLINE_MS = 5000;
function bounded(promise, milliseconds, message) {
  let timeout;
  return Promise.race([promise, new Promise((resolve, reject) => { timeout = setTimeout(() => reject(new Error(message)), milliseconds); })]).finally(() => clearTimeout(timeout));
}

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'newdaw-shutdown-'));
  const projectPath = path.join(directory, 'Shutdown.newdaw.json'), children = [], sockets = [];
  await fs.writeFile(projectPath, JSON.stringify(createProject({ name: 'Initial checkpoint' })));
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    for (const server of children) if (server.child.exitCode === null && server.child.signalCode === null) { server.child.kill('SIGKILL'); await server.exited; }
    await fs.rm(directory, { recursive: true, force: true });
  });
  async function launch() {
    const child = spawn(process.execPath, ['src/cli.mjs', 'serve', '--project', projectPath, '--port', '0'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
    const server = { child, exited, url: null, diagnostics: () => stdout + stderr }; children.push(server);
    child.stderr.on('data', bytes => { stderr += bytes; });
    server.url = await bounded(new Promise((resolve, reject) => {
      child.stdout.on('data', bytes => { stdout += bytes; const match = stdout.match(/http:\/\/127\.0\.0\.1:\d+/); if (match) resolve(match[0]); });
      child.once('error', reject); child.once('exit', () => reject(new Error(`Serve exited before listening: ${stdout}${stderr}`)));
    }), 10000, 'Serve did not start within 10 seconds.');
    return server;
  }
  async function connect(server) {
    const address = new URL(server.url), socket = net.createConnection({ host: '127.0.0.1', port: Number(address.port) });
    sockets.push(socket);
    // A forced server-side shutdown may reset a deliberately incomplete request.
    socket.on('error', () => {});
    await bounded(new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject); }), 2000, 'TCP connection was not accepted.');
    return socket;
  }
  return { directory, projectPath, launch, connect };
}

async function readState(server) {
  const response = await fetch(`${server.url}/api/state`); assert.equal(response.status, 200); return response.json();
}
async function commitEdit(server) {
  const before = await readState(server);
  const response = await fetch(`${server.url}/api/command`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command: 'project.rename', arguments: { name: 'Acknowledged before SIGTERM' }, expectedRevision: before.project.revision }) });
  assert.equal(response.status, 200); const result = await response.json(); assert.equal(result.applied, true);
  return readState(server);
}
function received(socket, pattern) {
  return bounded(new Promise((resolve, reject) => {
    let text = '';
    const onData = bytes => { text += bytes; if (pattern.test(text)) { cleanup(); resolve(text); } };
    const onClose = () => { cleanup(); reject(new Error(`Connection closed before expected response: ${text}`)); };
    const cleanup = () => { socket.off('data', onData); socket.off('close', onClose); };
    socket.on('data', onData); socket.once('close', onClose);
  }), 3000, 'Expected HTTP response was not received.');
}
async function terminate(server) {
  const started = performance.now(); assert.equal(server.child.kill('SIGTERM'), true);
  const exit = await bounded(server.exited, SHUTDOWN_DEADLINE_MS, `SIGTERM left the serve process alive with open client connections. ${server.diagnostics()}`);
  assert.deepEqual(exit, { code: 0, signal: null }, server.diagnostics());
  assert.ok(performance.now() - started < SHUTDOWN_DEADLINE_MS);
}
async function durableBytes(projectPath) {
  return Promise.all(['', '.history.json', '.saved.json'].map(suffix => fs.readFile(projectPath + suffix)));
}
async function assertClosedAndPreserved(f, before, bytes) {
  await assert.rejects(fs.lstat(`${f.projectPath}.lock`), { code: 'ENOENT' });
  await assert.rejects(fs.lstat(`${f.projectPath}.lock.guard`), { code: 'ENOENT' });
  assert.deepEqual(await durableBytes(f.projectPath), bytes);
  const reopened = await f.launch(), state = await readState(reopened);
  assert.deepEqual(state.project, before.project); assert.deepEqual(state.historyView, before.historyView);
  assert.equal(state.session.document.saveId, before.session.document.saveId);
  await terminate(reopened); await assert.rejects(fs.lstat(`${f.projectPath}.lock`), { code: 'ENOENT' });
}

test('real serve exits on SIGTERM with an established incomplete request body and releases its project lock', { timeout: 20000 }, async t => {
  const f = await fixture(t), server = await f.launch(), before = await commitEdit(server), bytes = await durableBytes(f.projectPath);
  const socket = await f.connect(server), response = received(socket, /HTTP\/1\.1 100 Continue/);
  socket.write(`POST /api/command HTTP/1.1\r\nHost: ${new URL(server.url).host}\r\nContent-Type: application/json\r\nContent-Length: 4096\r\nExpect: 100-continue\r\nConnection: keep-alive\r\n\r\n`);
  await response;
  socket.write('{"command":"project.rename","arguments":{"name":"Unfinished request');
  assert.equal(socket.destroyed, false);
  // Keep the client alive; server shutdown must close it instead of waiting for
  // a body the client will never finish. The incomplete edit must not commit.
  await terminate(server);
  await assertClosedAndPreserved(f, before, bytes);
});

test('real serve exits with SSE plus a pending request-header connection without changing durable state', { timeout: 20000 }, async t => {
  const f = await fixture(t), server = await f.launch(), before = await commitEdit(server), bytes = await durableBytes(f.projectPath);
  const events = await f.connect(server), snapshot = received(events, /event: snapshot/);
  events.write(`GET /api/events HTTP/1.1\r\nHost: ${new URL(server.url).host}\r\nConnection: keep-alive\r\n\r\n`);
  await snapshot;
  const late = await f.connect(server);
  // This accepted connection has not yet reached the request listener, so it
  // cannot appear in the SSE response registry when shutdown begins.
  late.write(`GET /api/events HTTP/1.1\r\nHost: ${new URL(server.url).host}\r\n`);
  assert.equal(events.destroyed, false); assert.equal(late.destroyed, false);
  await terminate(server);
  await assertClosedAndPreserved(f, before, bytes);
});
