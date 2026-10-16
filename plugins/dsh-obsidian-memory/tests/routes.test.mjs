import './support/sdk.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'

const { mountSettings, trustedRequest } = await import('../lib/settings.js')
const { SettingsSchema } = await import('../lib/config.js')

function routeHarness({ available = true, missingVault = false } = {}) {
  let value = SettingsSchema({ vaultPath: 'D:/notes' })
  let revision = 0
  let writes = 0
  let route
  const fiber = {}
  const ctx = {
    fiber,
    effect: (fn) => fn(),
    loader: { entries: () => [{ options: { id: 'custom-memory-id', name: 'dsh-obsidian-memory' }, fiber }] },
    inject: (_deps, callback) => { if (available) callback(ctx) },
    webRuntime: { trustedHosts: ['trusted.local:4000'] },
    webServer: { register: (entry) => {
      assert.ok(!entry.path.endsWith('/'), 'Host prefix routes have no trailing slash')
      route = entry
      return () => {}
    } },
    fs: { resolve: async (path) => path, stat: async () => missingVault ? undefined : { type: 'directory' }, listDir: async () => [] },
    settings: {
      configure: () => () => {},
      describe: () => [{ ns: 'custom-memory-id', value, revision }],
      update: async (ns, patch, expected) => {
        assert.equal(ns, 'custom-memory-id')
        if (expected !== revision) throw Object.assign(new Error('conflict'), { code: 'SETTINGS_CONFLICT' })
        writes++
        value = { ...value, ...patch }
        revision++
      },
    },
  }
  mountSettings(ctx, () => value)
  return {
    ctx, get writes() { return writes },
    request: async (method, payload = {}, { headers = {}, verb = 'POST', raw } = {}) => {
      const req = Readable.from([Buffer.from(raw ?? JSON.stringify(payload))])
      req.headers = { host: 'localhost:3000', 'content-type': 'application/json', ...headers }
      req.url = '/obsidian-memory/api/' + method
      assert.ok(req.url.startsWith(route.path + '/'), 'request matches the actual Host prefix rule')
      req.method = verb
      let status
      let body
      await route.handler(req, { writeHead: (code) => { status = code }, end: (text) => { body = JSON.parse(text) } })
      return { status, body }
    },
  }
}

test('route fence rejects foreign hosts, opaque origins and cross-site browser requests', () => {
  for (const headers of [
    { host: 'evil.example' }, { host: 'localhost', origin: 'null' },
    { host: 'localhost', origin: 'https://evil.example' },
    { host: 'localhost', 'sec-fetch-site': 'cross-site' }, {},
  ]) assert.equal(trustedRequest({ headers }, []), false)
  for (const headers of [
    { host: '127.0.0.1:3000' }, { host: '[::1]:3000' },
    { host: 'localhost:3000', origin: 'dsh-app://app' },
    { host: 'localhost:3000', origin: 'http://localhost:3000' },
    { host: 'trusted.local:4000' },
  ]) assert.equal(trustedRequest({ headers }, ['trusted.local:4000']), true)
  assert.equal(trustedRequest({ headers: { host: 'trusted.local:4001' } }, ['trusted.local:4000']), false)
})

test('settings are addressed by the actual loader entry and saving requires its revision', async () => {
  const app = routeHarness()
  const get = await app.request('get')
  assert.equal(get.status, 200)
  assert.equal(get.body.value.revision, 0)
  const config = { ...get.body.value.value, project: 'updated' }
  assert.equal((await app.request('save', { value: config })).status, 400)
  const saved = await app.request('save', { value: config, expectedRevision: 0 })
  assert.equal(saved.status, 200)
  assert.equal(saved.body.value.value.project, 'updated')
  assert.equal(saved.body.value.revision, 1)
  assert.equal((await app.request('save', { value: config, expectedRevision: 0 })).status, 409)
  assert.equal(app.writes, 1)
})

test('invalid paths, missing vault and unknown configuration never save', async () => {
  const app = routeHarness()
  for (const patch of [{ memoryRoot: '../outside' }, { arbitrary: true }, { searchLimit: 0 }]) {
    const reply = await app.request('save', { value: { ...SettingsSchema({ vaultPath: 'D:/notes' }), ...patch }, expectedRevision: 0 })
    assert.equal(reply.status, 400)
  }
  assert.equal(app.writes, 0)
  const missing = routeHarness({ missingVault: true })
  assert.equal((await missing.request('save', { value: SettingsSchema({}), expectedRevision: 0 })).status, 400)
  assert.equal(missing.writes, 0)
})

test('checking draft directories is read-only and malformed requests are refused', async () => {
  const app = routeHarness()
  assert.equal((await app.request('check', { vaultPath: 'D:/draft', memoryRoot: 'Memory' })).body.value.memory.path, 'D:/draft/Memory')
  assert.equal(app.writes, 0)
  assert.equal((await app.request('get', {}, { headers: { origin: 'https://evil.example' } })).status, 403)
  assert.equal((await app.request('get', {}, { verb: 'GET' })).status, 405)
  assert.equal((await app.request('unknown')).status, 404)
  assert.equal((await app.request('constructor')).status, 404)
  assert.equal((await app.request('get', {}, { raw: '{broken' })).status, 400)
  assert.equal((await app.request('get', {}, { raw: 'x'.repeat(17000) })).status, 413)
})
