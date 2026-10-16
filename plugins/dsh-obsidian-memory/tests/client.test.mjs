import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'

test('client requests stay on the page origin and retain deployment prefixes', async () => {
  const { endpoint } = await import('../client/api.js')
  assert.equal(endpoint('get', 'dsh-app://app/').href, 'dsh-app://app/obsidian-memory/api/get')
  assert.equal(endpoint('save', 'https://host/dsh/?x=1#settings').href, 'https://host/dsh/obsidian-memory/api/save')
})

test('save carries the host revision and reports conflicts without hiding the draft', async () => {
  const { request } = await import('../client/api.js')
  const payload = { value: { project: 'draft' }, expectedRevision: 7 }
  let sent
  const fetch = async (url, options) => {
    sent = options
    return { ok: false, json: async () => ({ ok: false, error: { code: 'settings-conflict', message: 'conflict' } }) }
  }
  await assert.rejects(request('save', payload, fetch, 'http://localhost/'), { code: 'settings-conflict' })
  assert.deepEqual(JSON.parse(sent.body), payload)
  assert.equal(sent.method, 'POST')
  assert.equal(payload.value.project, 'draft')
})

test('manifest publishes a web client and its stylesheet', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url)))
  assert.equal(manifest.exports['./client'], './dist/client.js')
  assert.equal(manifest.dsh.client.platform, 'web')
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-slots'))
  assert.ok(manifest.files.includes('dist'))
})

test('published client executes the Host ModuleLoader protocol and registers the settings slot', async () => {
  const source = await readFile(new URL('../dist/client.js', import.meta.url), 'utf8')
  let loaded
  let registration
  const style = {}
  runInNewContext(source, {
    window: { __ModuleLoader__: { load: (entry) => { loaded = entry } } },
    document: { createElement: () => ({ dataset: {} }), head: { append: (value) => Object.assign(style, value) } },
  })
  assert.equal(loaded.id, 'dsh-obsidian-memory')
  const plugin = loaded.factory((name) => {
    assert.ok(['react', '@deepseek-ai/dsh-client-ui-primitives'].includes(name))
    return {}
  })
  assert.equal(JSON.stringify(plugin.inject), JSON.stringify(['slots']))
  plugin.apply({ slots: {
    inject: (name, callback) => { assert.equal(name, 'settings.section'); callback() },
    register: (entry, component) => { registration = entry; assert.equal(typeof component, 'function') },
  } })
  assert.equal(registration.id, 'obsidian-memory')
  assert.equal(registration.label(), 'Obsidian 记忆')
  assert.ok(style.textContent.includes('.om-settings'))
})
