import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { FolderStore } from '../store.mjs';

// Run the installed native methods with an isolated in-memory storage adapter.
const nativeRoot = process.env.DSH_NATIVE_ROOT || path.resolve(import.meta.dirname, '../../../sdk/node_modules/@deepseek-ai');
test('native create, reuse, rename, attach/detach, order and delete still work after folder edits', { skip: !nativeRoot }, async t => {
  const { WorkspaceRegistry } = await import(pathToFileURL(path.join(nativeRoot, 'dsh-workspace/lib/index.js')));
  const { WorkspaceCommands } = await import(pathToFileURL(path.join(nativeRoot, 'dsh-api-workspace-controller/lib/types/commands.js')));
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-native-regression-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const primary = path.join(dir, 'primary'), extra = path.join(dir, 'extra'); await mkdir(primary); await mkdir(extra);
  const table = new Map(); table.put = async (id, value) => { table.set(id, value); }; table.update = async (id, fn) => { const next = fn(table.get(id)); table.set(id, next); return next; };
  const registry = Object.create(WorkspaceRegistry.prototype);
  const sessions = new Map([['existing-session', { id: 'existing-session', header: { id: 'existing-session', cwd: primary } }], ['extra-session', { id: 'extra-session', header: { id: 'extra-session', cwd: extra } }]]);
  const ctx = { workspaceRegistry: registry, get: name => name === 'sessions' ? { get: id => sessions.get(id), list: () => [...sessions.values()] } : undefined,
    waterfall: async (_event, _payload, callback) => callback(), logger: { warn() {} } };
  Object.defineProperty(registry, 'ctx', { value: ctx });
  Object.assign(registry, { table, global: { set: async () => {} }, state: { initialized: true, workspaceIds: [], archivedSessionIds: [], pinnedSessionIds: [] }, entities: new Map(), headers: new Map(), sessionPaths: new Map(), invalidSessionPaths: new Map(), operationTail: Promise.resolve() });
  registry.host = { table: () => table, sessionPath: id => registry.sessionPaths.get(id), readSessionHeader: id => registry.readSessionHeader(id), rememberSessionPath: (id, cwd) => registry.sessionPaths.set(id, cwd) };
  const commands = new WorkspaceCommands(ctx);
  const created = await commands.create({ path: primary }); assert.equal(created.created, true);
  const id = created.workspace.workspaceId, original = registry.get(id);
  await original.attachSession('existing-session');
  const before = JSON.stringify([...table]);
  const folders = new FolderStore(path.join(dir, 'folders.json'), registry);
  await folders.add(id, extra); await folders.remove(id, primary);
  assert.equal(JSON.stringify([...table]), before);
  assert.equal((await commands.create({ path: primary })).created, false);
  await commands.rename({ workspaceId: id, title: 'Renamed project' });
  assert.equal(original.title, 'Renamed project');
  assert.deepEqual(original.sessionIds, ['existing-session']);
  assert.equal(original.path, primary); assert.equal(sessions.get('existing-session').header.cwd, primary);
  await assert.rejects(original.attachSession('extra-session'), /cwd resolves/);
  await original.detachSession('existing-session'); await original.attachSession('existing-session');
  const other = await commands.create({ path: extra });
  await assert.rejects(commands.rename({ workspaceId: other.workspace.workspaceId, title: 'Renamed project' }));
  await commands.insertBefore({ workspaceId: id, beforeWorkspaceId: other.workspace.workspaceId }); assert.equal(registry.list()[0].id, id);
  await commands.delete({ workspaceId: id }); assert.equal(registry.get(id), undefined);
  assert.ok(sessions.has('existing-session')); assert.equal((await stat(primary)).isDirectory(), true);
  await assert.rejects(folders.list(id), /不存在/);
});
