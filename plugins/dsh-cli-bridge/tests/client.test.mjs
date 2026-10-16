import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'

test('client endpoints retain the DSH deployment prefix', async () => {
  const { endpoint } = await import('../client/api.js')
  assert.equal(endpoint('sessions', 'dsh-app://app/').href, 'dsh-app://app/dsh-cli-bridge/sessions')
  assert.equal(endpoint('/events', 'https://host/dsh/?x=1#cli').href, 'https://host/dsh/dsh-cli-bridge/events')
})

test('client commands use JSON and surface bridge errors', async () => {
  const { command } = await import('../client/api.js')
  let sent
  const fetcher = async (_url, options) => {
    sent = options
    return { ok: true, json: async () => ({ ok: true, value: { status: 'running' } }) }
  }
  const value = await command('input', { terminalId: 'term_test', data: 'hi', enter: true }, fetcher, 'http://localhost/')
  assert.deepEqual(value, { status: 'running' })
  assert.equal(sent.method, 'POST')
  assert.deepEqual(JSON.parse(sent.body), { terminalId: 'term_test', data: 'hi', enter: true })
})

test('manifest publishes the xterm client and conversation dock', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url)))
  assert.equal(manifest.exports['./client'], './dist/client.js')
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-slots'))
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-conversation'))
  assert.equal(manifest.dsh.client.immediately, true)
  assert.ok(manifest.files.includes('dist'))
})

test('published client registers the collapsible CLI input dock outside the context meter', async () => {
  const source = await readFile(new URL('../dist/client.js', import.meta.url), 'utf8')
  assert.equal(source.includes('require("@xterm/xterm")'), false)
  let loaded
  let registration
  const style = {}
  runInNewContext(source, {
    navigator: { userAgent: 'node', platform: 'Win32' },
    window: { __ModuleLoader__: { load: (entry) => { loaded = entry } } },
    document: { createElement: () => ({ dataset: {} }), head: { append: (value) => Object.assign(style, value) } },
  })
  assert.equal(loaded.id, 'dsh-cli-bridge')
  const plugin = loaded.factory((name) => {
    assert.ok(['react', '@deepseek-ai/dsh-client-ui-primitives'].includes(name))
    return {}
  })
  assert.equal(JSON.stringify(plugin.inject), JSON.stringify(['slots']))
  plugin.apply({ slots: {
    inject: (name, callback) => { assert.equal(name, 'conversation.input.dock'); callback() },
    register: (entry, component) => { registration = entry; assert.equal(typeof component, 'function') },
  } })
  assert.equal(registration.id, 'dsh-cli-bridge')
  assert.equal(registration.label(), 'CLI 终端')
  assert.ok(style.textContent.includes('.dcb-panel'))
  assert.ok(style.textContent.includes('.xterm'))
})

test('new status events insert a terminal and output stays bounded', async () => {
  const { updateSessions } = await import('../client/state.js')
  let sessions = updateSessions([], { type: 'status', terminalId: 'term_new', provider: 'codex', status: 'starting' })
  assert.equal(sessions.length, 1)
  sessions = updateSessions(sessions, { type: 'status', terminalId: 'term_new', status: 'running' })
  assert.equal(sessions.length, 1)
  sessions = updateSessions(sessions, { type: 'output', terminalId: 'term_new', data: 'x'.repeat(300000) })
  assert.equal(sessions[0].recentOutput.length, 240)
})

test('terminal controls stop accepting input after an interrupted process exits', async () => {
  const { isSessionActive } = await import('../client/state.js')
  assert.equal(isSessionActive({ status: 'starting', exitCode: null }), true)
  assert.equal(isSessionActive({ status: 'running', exitCode: null }), true)
  assert.equal(isSessionActive({ status: 'interrupted', exitCode: null }), true)
  assert.equal(isSessionActive({ status: 'interrupted', exitCode: 130 }), false)
  assert.equal(isSessionActive({ status: 'exited', exitCode: 0 }), false)
  assert.equal(isSessionActive({ status: 'failed', exitCode: null }), false)
})

test('terminal height reserves space for controls within the panel scroll viewport', async () => {
  const css = await readFile(new URL('../client/terminal.css', import.meta.url), 'utf8')
  assert.match(css, /--dcb-body-height:\s*min\(40vh, 360px\)/)
  assert.match(css, /max-height:\s*var\(--dcb-body-height\)/)
  assert.match(css, /height:\s*min\(180px, max\(60px, calc\(var\(--dcb-body-height\) - 104px\)\)\)/)
  assert.match(css, /height:\s*min\(150px, max\(48px, calc\(var\(--dcb-body-height\) - 144px\)\)\)/)
})
