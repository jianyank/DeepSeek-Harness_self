import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHandler, apply, trusted } from '../index.js';
import { FolderStore } from '../store.mjs';

test('HTTP validates origins, methods and payloads; errors do not break subsequent requests', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-folders-api-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const extra = path.join(dir, 'extra'); await mkdir(extra);
  const workspace = { id: 'a', title: 'Existing', path: dir, sessionIds: ['s'] };
  const registry = { get: id => id === 'a' ? workspace : undefined, list: () => [workspace] };
  const server = http.createServer(createHandler(new FolderStore(path.join(dir, 'folders.json'), registry), { trustedHosts: [] }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const url = 'http://127.0.0.1:' + server.address().port + '/project-folders/api/';
  const request = (method, input, headers = {}, verb = 'POST') => fetch(url + method, { method: verb, headers: { 'Content-Type': 'application/json', ...headers }, ...(verb === 'POST' ? { body: typeof input === 'string' ? input : JSON.stringify(input ?? {}) } : {}) });
  assert.equal((await request('list', { id: 'a' }, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await request('list', { id: 'a' }, { Origin: 'null' })).status, 403);
  assert.equal((await request('list', { id: 'a' }, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await request('list', {}, {}, 'GET')).status, 405);
  assert.equal((await request('list', '{bad')).status, 400);
  assert.equal((await request('list', 'x'.repeat(17000))).status, 413);
  assert.equal((await request('unknown', {})).status, 404);
  assert.equal((await request('add', { id: 'a', path: extra }, { Origin: 'dsh-app://app' })).status, 200);
  assert.deepEqual((await (await request('list', { id: 'a' })).json()).folders, [dir, extra]);
  assert.equal((await request('list', { id: 'unknown' })).status, 400);
  assert.equal((await (await request('projects')).json())[0].sessionIds[0], 's');
  assert.equal(trusted({ headers: { host: 'evil.example' } }, []), false);
  assert.equal(trusted({ headers: { host: 'my-host:123', origin: 'http://my-host:123' } }, ['my-host']), true);
});

test('prompt preserves unedited projects, updates selected folders, and isolates other sessions', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-folders-prompt-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const extra = path.join(dir, 'extra'); await mkdir(extra);
  const workspace = { id: 'a', title: 'Existing', path: dir, sessionIds: ['s'] };
  const registry = { get: id => id === 'a' ? workspace : undefined, list: () => [workspace] };
  let route, prompt;
  const ctx = { workspaceRegistry: registry, webRuntime: { trustedHosts: [] }, webServer: { register: spec => { route = spec; return () => {}; } },
    effect: callback => callback(), inject: (_deps, callback) => callback({ systemPrompt: { context: contribution => { prompt = contribution; } } }) };
  await apply(ctx, { storagePath: path.join(dir, 'folders.json') });
  const context = { agent: { session: { id: 's' } } };
  assert.equal(prompt.text(context), ''); assert.equal(prompt.text({}), '');
  const server = http.createServer(route.handler); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const post = (method, p) => fetch('http://127.0.0.1:' + server.address().port + '/project-folders/api/' + method, { method: 'POST', body: JSON.stringify(p) });
  await post('add', { id: 'a', path: extra });
  const text = prompt.text(context);
  assert.equal(typeof text, 'string'); assert.ok(text.includes(JSON.stringify(extra))); assert.ok(text.includes(JSON.stringify(dir)));
  assert.equal(prompt.text({ agent: { session: { id: 'other-session' } } }), '');
  await post('remove', { id: 'a', path: dir });
  assert.deepEqual(JSON.parse(prompt.text(context).split('\n')[1]).folders, [extra]);
  await post('remove', { id: 'a', path: extra });
  assert.deepEqual(JSON.parse(prompt.text(context).split('\n')[1]).folders, []);
});
