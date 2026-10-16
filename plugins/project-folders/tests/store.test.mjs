import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FolderStore } from '../store.mjs';

async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-project-folders-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const primary = path.join(dir, 'original'); const extra = path.join(dir, 'extra');
  await mkdir(primary); await mkdir(extra);
  const records = new Map([['a', { id: 'a', title: 'Old project', path: primary, sessionIds: ['session-a'] }], ['b', { id: 'b', title: 'Other', path: extra, sessionIds: ['session-b'] }]]);
  const registry = { get: id => records.get(id), list: () => [...records.values()] };
  const file = path.join(dir, 'storage', 'project-folders.json');
  return { dir, primary, extra, records, registry, file, store: new FolderStore(file, registry) };
}
test('old project defaults to its original directory without writing or changing session data', async t => {
  const f = await fixture(t); const before = JSON.stringify([...f.records]);
  assert.deepEqual((await f.store.list('a')).folders, [f.primary]);
  await assert.rejects(readFile(f.file), { code: 'ENOENT' });
  assert.equal(JSON.stringify([...f.records]), before);
});
test('add, remove the original folder, persist and re-add while retaining cwd and sessions', async t => {
  const f = await fixture(t); const before = JSON.stringify([...f.records]);
  const added = await f.store.add('a', f.extra);
  assert.deepEqual(added.sessionIds, ['session-a']);
  assert.deepEqual(added.folders, [f.primary, f.extra]);
  assert.deepEqual((await f.store.remove('a', f.primary)).folders, [f.extra]);
  const restart = new FolderStore(f.file, f.registry);
  assert.deepEqual((await restart.list('a')).folders, [f.extra]);
  assert.deepEqual((await restart.remove('a', f.extra)).folders, []);
  assert.deepEqual((await new FolderStore(f.file, f.registry).list('a')).folders, []);
  await restart.add('a', f.primary);
  assert.deepEqual((await restart.list('a')).folders, [f.primary]);
  assert.equal(JSON.stringify([...f.records]), before);
  assert.equal((await restart.list('a')).cwd, f.primary);
  assert.deepEqual((await restart.list('a')).sessionIds, ['session-a']);
  await mkdir(path.join(f.extra, 'still-exists'));
});
test('invalid paths, files, missing folders, duplicate and case variants cannot change saved data', async t => {
  const f = await fixture(t);
  await f.store.add('a', f.extra);
  const before = await readFile(f.file, 'utf8');
  await writeFile(path.join(f.dir, 'file.txt'), 'keep');
  for (const p of ['relative/path', '', null, path.join(f.dir, 'missing'), path.join(f.dir, 'file.txt'), f.extra]) await assert.rejects(f.store.add('a', p));
  if (process.platform === 'win32') {
    await assert.rejects(f.store.add('a', f.extra.toUpperCase()));
    await assert.rejects(f.store.add('a', '\\root-relative'));
    await assert.rejects(f.store.add('a', 'D:drive-relative'));
  }
  assert.equal(await readFile(f.file, 'utf8'), before);
});
test('symlink/junction aliases are deduplicated and cannot escape browsing roots', async t => {
  const f = await fixture(t);
  const alias = path.join(f.dir, 'alias');
  await symlink(f.extra, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await f.store.add('a', alias);
  await assert.rejects(f.store.add('a', f.extra), /已经/);
  const escape = path.join(f.primary, 'escape');
  await symlink(f.extra, escape, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(f.store.browse('a', f.primary, escape), /之外/);
});
test('missing directories can be removed without touching files', async t => {
  const f = await fixture(t); await f.store.add('a', f.extra);
  await rm(f.extra, { recursive: true });
  assert.deepEqual((await f.store.remove('a', f.extra)).folders, [f.primary]);
});
test('concurrent writes serialize without losing folders or leaking between projects', async t => {
  const f = await fixture(t); const paths = [];
  for (let i = 0; i < 12; i++) { const p = path.join(f.dir, String(i)); await mkdir(p); paths.push(p); }
  await Promise.all(paths.map(p => f.store.add('a', p)).concat(f.store.remove('b', f.extra)));
  assert.deepEqual((await f.store.list('a')).folders, [f.primary, ...paths]);
  assert.deepEqual((await f.store.list('b')).folders, []);
  await assert.rejects(f.store.add('a', f.primary));
  await f.store.remove('a', paths[0]);
  assert.equal((await f.store.list('a')).folders.length, 12);
});
test('unknown and deleted projects cannot mutate storage', async t => {
  const f = await fixture(t);
  await assert.rejects(f.store.add('missing', f.extra), /不存在/);
  await f.store.add('a', f.extra); const before = await readFile(f.file, 'utf8');
  f.records.delete('a');
  await assert.rejects(f.store.remove('a', f.extra), /不存在/);
  assert.equal(await readFile(f.file, 'utf8'), before);
});
test('malformed persisted configuration is not silently overwritten', async t => {
  const f = await fixture(t); await mkdir(path.dirname(f.file));
  for (const contents of ['{bad json', '{"version":2,"folders":{}}', '{"version":1,"folders":{"a":[4]}}']) {
    await writeFile(f.file, contents);
    await assert.rejects(f.store.add('a', f.extra));
    assert.equal(await readFile(f.file, 'utf8'), contents);
  }
});
test('browse is limited to associated roots and does not edit file contents', async t => {
  const f = await fixture(t); const sub = path.join(f.primary, 'child');
  await mkdir(sub); await writeFile(path.join(f.primary, 'file.txt'), 'unchanged');
  const root = await f.store.browse('a', f.primary);
  assert.equal(root.parent, null); assert.equal(root.entries[0].isDir, true);
  assert.equal((await f.store.browse('a', f.primary, sub)).parent, f.primary);
  await assert.rejects(f.store.browse('a', f.extra), /未关联/);
  await assert.rejects(f.store.browse('a', f.primary, f.dir), /之外/);
  await f.store.remove('a', f.primary);
  await assert.rejects(f.store.browse('a', f.primary), /未关联/);
  assert.equal(await readFile(path.join(f.primary, 'file.txt'), 'utf8'), 'unchanged');
});
