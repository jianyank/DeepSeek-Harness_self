import './support/sdk.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { checkStatus, resolvePaths } from '../lib/status.js'

const { Config, SettingsSchema, readConfig, validateSettings } = await import('../lib/config.js')

test('all fields are live and parsed volatile values unwrap to the defaults', () => {
  const parsed = Config({})
  assert.equal(parsed.vaultPath.get(), 'C:/Users/CHANGE_ME/Documents/Obsidian')
  assert.deepEqual(readConfig(parsed), SettingsSchema({}))
  assert.ok(Object.values(Config.dict).every((field) => field.meta.volatile))
})

test('settings reject unknown keys, enum values and noninteger or negative numbers', () => {
  for (const patch of [
    { sandboxMode: 'read-write' }, { searchLimit: 0 }, { searchLimit: 1.5 },
    { refreshTtlMs: -1 }, { injectBudgetChars: NaN }, { cardRecentCount: Infinity },
    { alwaysInjectTypes: ['unknown'] }, { project: 42 }, { unexpected: true },
  ]) assert.throws(() => validateSettings({ ...SettingsSchema({}), ...patch }))
  assert.equal(validateSettings({ ...SettingsSchema({}), injectBudgetChars: 0 }).injectBudgetChars, 0)
})

test('paths normalize Windows and UNC paths but reject relative vaults and escaping roots', () => {
  assert.deepEqual(resolvePaths({ vaultPath: 'D:/notes', memoryRoot: 'Memory/nested' }),
    { vaultPath: 'D:/notes', memoryPath: 'D:/notes/Memory/nested' })
  assert.equal(resolvePaths({ vaultPath: '//server/share/notes', memoryRoot: 'Memory' }).memoryPath,
    '//server/share/notes/Memory')
  for (const memoryRoot of ['', '../outside', 'Memory/../../outside', '/outside', 'C:/outside', 'foo:bar', 'foo*', '.']) {
    assert.throws(() => resolvePaths({ vaultPath: 'D:/notes', memoryRoot }))
  }
  assert.throws(() => resolvePaths({ vaultPath: 'relative/notes', memoryRoot: 'Memory' }))
})

function fakeFs({ missing = [], file = [], denied = [] } = {}) {
  const calls = []
  return {
    calls,
    resolve: async (path) => { calls.push(['resolve', path]); return path },
    stat: async (path) => {
      calls.push(['stat', path])
      if (missing.includes(path)) return undefined
      return { type: file.includes(path) ? 'file' : 'directory' }
    },
    listDir: async (path) => {
      calls.push(['listDir', path])
      if (denied.includes(path)) throw Object.assign(new Error('access denied'), { code: 'EACCES' })
      return []
    },
    writeText: () => { throw new Error('status must not write') },
  }
}

const paths = { vaultPath: 'D:/notes', memoryRoot: 'Memory' }

test('status checks both directories without writing or reading note bodies', async () => {
  const fs = fakeFs()
  const result = await checkStatus(fs, paths)
  assert.equal(result.vault.readable, true)
  assert.equal(result.memory.readable, true)
  assert.equal(result.memory.path, 'D:/notes/Memory')
  assert.equal(result.canSave, true)
  assert.ok(fs.calls.every(([method]) => ['resolve', 'stat', 'listDir'].includes(method)))
})

test('a missing memory directory is uninitialized and never created', async () => {
  const result = await checkStatus(fakeFs({ missing: ['D:/notes/Memory'] }), paths)
  assert.equal(result.memory.exists, false)
  assert.equal(result.memory.code, 'ENOENT')
  assert.equal(result.canSave, true)
})

test('missing vault, file as directory and permission failures are distinct', async () => {
  for (const [options, expected] of [
    [{ missing: ['D:/notes'] }, 'ENOENT'],
    [{ file: ['D:/notes'] }, 'ENOTDIR'],
    [{ denied: ['D:/notes'] }, 'EACCES'],
  ]) {
    const result = await checkStatus(fakeFs(options), paths)
    assert.equal(result.vault.code, expected)
    assert.equal(result.canSave, false)
    assert.ok(result.vault.error)
  }
  assert.equal((await checkStatus(fakeFs({ file: ['D:/notes/Memory'] }), paths)).canSave, false)
})

test('invalid paths are rejected before filesystem access', async () => {
  const fs = fakeFs()
  await assert.rejects(checkStatus(fs, { ...paths, memoryRoot: '../outside' }))
  assert.equal(fs.calls.length, 0)
})
