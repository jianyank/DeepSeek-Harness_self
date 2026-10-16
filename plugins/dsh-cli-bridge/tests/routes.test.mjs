import './support/sdk.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'

const { mountRoutes, trustedRequest } = await import('../lib/routes.js')

function managerStub() {
  const listeners = new Set()
  return {
    sessions: [{ terminalId: 'term_one', provider: 'claude', status: 'running' }],
    writes: [], interrupts: [], closes: [], resizes: [],
    list() { return this.sessions },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    emit(event) { for (const listener of listeners) listener(event) },
    write(...args) { this.writes.push(args); return { ok: true } },
    interrupt(id) { this.interrupts.push(id); return { ok: true } },
    close(id) { this.closes.push(id); return Promise.resolve({ terminalId: id, status: 'interrupted' }) },
    resize(...args) { this.resizes.push(args); return { ok: true } },
  }
}

function harness() {
  const manager = managerStub()
  let route
  const ctx = {
    webRuntime: { trustedHosts: ['trusted.local:4000'] },
    webServer: { register(entry) { route = entry; return () => {} } },
    effect(callback) { return callback() },
  }
  mountRoutes(ctx, manager)
  return {
    manager,
    request: async (path, payload = {}, { headers = {}, method = 'POST', response = {}, raw } = {}) => {
      const req = Readable.from([Buffer.from(raw ?? JSON.stringify(payload))])
      req.headers = { host: 'localhost:3000', 'content-type': 'application/json', ...headers }
      req.url = '/dsh-cli-bridge' + path
      req.method = method
      if (path === '/events') req.once = () => req
      let status
      const chunks = []
      const res = {
        writes: chunks,
        writeHead(code, nextHeaders) { status = code; response.headers = nextHeaders },
        write(chunk) { chunks.push(String(chunk)) },
        end(body) { if (body !== undefined) chunks.push(String(body)) },
        ...response,
      }
      await route.handler(req, res)
      return { status, body: chunks.join(''), response, req, res }
    },
  }
}

test('trusted route fence accepts loopback and rejects cross-site requests', () => {
  assert.equal(trustedRequest({ headers: { host: 'localhost:3000', origin: 'dsh-app://app' } }, []), true)
  assert.equal(trustedRequest({ headers: { host: 'evil.example' } }, []), false)
  assert.equal(trustedRequest({ headers: { host: 'localhost:3000', 'sec-fetch-site': 'cross-site' } }, []), false)
  assert.equal(trustedRequest({ headers: { host: 'localhost:3000', origin: 'https://evil.example' } }, []), false)
})

test('lists sessions and protects methods and JSON body size', async () => {
  const app = harness()
  const listed = await app.request('/sessions', {}, { method: 'GET' })
  assert.equal(listed.status, 200)
  assert.deepEqual(JSON.parse(listed.body).value, app.manager.sessions)
  assert.equal((await app.request('/sessions')).status, 405)
  assert.equal((await app.request('/sessions', {}, { headers: { origin: 'https://evil.example' }, method: 'GET' })).status, 403)
  assert.equal((await app.request('/input', {}, { raw: 'x'.repeat(20000) })).status, 413)
})

test('routes input, interrupt, close and emits SSE snapshots and events', async () => {
  const app = harness()
  const input = await app.request('/input', { terminalId: 'term_one', data: 'hi', enter: true })
  assert.equal(input.status, 200)
  assert.deepEqual(app.manager.writes, [['term_one', 'hi', true]])
  await app.request('/interrupt', { terminalId: 'term_one' })
  await app.request('/close', { terminalId: 'term_one' })
  assert.deepEqual(app.manager.interrupts, ['term_one'])
  assert.deepEqual(app.manager.closes, ['term_one'])
  const events = await app.request('/events', {}, { method: 'GET' })
  assert.equal(events.status, 200)
  assert.match(events.response.headers['content-type'], /text\/event-stream/)
  assert.match(events.body, /event: snapshot/)
  app.manager.emit({ type: 'output', terminalId: 'term_one', data: 'live' })
  assert.match(events.res.writes?.join?.('') ?? events.body, /live/)
})

test('routes terminal resize and preserves manager validation failures', async () => {
  const app = harness()
  const resized = await app.request('/resize', { terminalId: 'term_one', cols: 100, rows: 12 })
  assert.equal(resized.status, 200)
  assert.deepEqual(app.manager.resizes, [['term_one', 100, 12]])
  app.manager.resize = () => { throw Object.assign(new Error('invalid terminal dimensions'), { code: 'invalid-size' }) }
  const invalid = await app.request('/resize', { terminalId: 'term_one', cols: -1, rows: 12 })
  assert.equal(invalid.status, 400)
  assert.equal(JSON.parse(invalid.body).error.code, 'invalid-size')
})
