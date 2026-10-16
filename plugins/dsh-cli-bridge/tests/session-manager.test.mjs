import test from 'node:test'
import assert from 'node:assert/strict'

const { SessionManager } = await import('../lib/session-manager.js')

function fakeBackend() {
  const sessions = new Map()
  let next = 1
  return {
    starts: [], writes: [], interrupts: [], closes: [], sizes: [],
    async start({ provider, onData, onExit }) {
      const handle = { id: next++, provider, alive: true, onData, onExit }
      sessions.set(handle, handle)
      this.starts.push(handle)
      return { pid: 1000 + handle.id, handle }
    },
    write(handle, data) { this.writes.push([handle.id, data]) },
    interrupt(handle) { this.interrupts.push(handle.id); handle.onExit({ exitCode: 130 }) },
    async close(handle) { this.closes.push(handle.id); handle.alive = false; handle.onExit({ exitCode: 130 }) },
    isAlive(handle) { return handle.alive },
    resize(handle, cols, rows) { this.sizes.push([handle.id, cols, rows]) },
    emit(handle, data) { handle.onData(data) },
    exit(handle, event = { exitCode: 0 }) { handle.alive = false; handle.onExit(event) },
  }
}

function config(overrides = {}) {
  return { maxSessions: 4, maxBufferChars: 10, defaultTimeoutMs: 0, ...overrides }
}

async function eventually(check) {
  for (let i = 0; i < 30; i++) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  assert.fail('condition was not reached')
}

test('keeps concurrent sessions and output streams isolated', async () => {
  const backend = fakeBackend()
  let id = 0
  const manager = new SessionManager({ config: config(), backend, idFactory: () => `term_test${++id}` })
  const first = manager.start({ provider: 'claude', prompt: '', cwd: 'D:/work', taskId: 'a', timeoutMs: 0 }, { parentSessionId: 'parent-a' })
  const second = manager.start({ provider: 'codex', prompt: '', cwd: 'D:/work', taskId: 'b', timeoutMs: 0 }, { parentSessionId: 'parent-b' })
  await eventually(() => backend.starts.length === 2)
  backend.emit(backend.starts[0], 'first')
  backend.emit(backend.starts[1], 'second')
  assert.equal(manager.list().find((item) => item.terminalId === first.terminalId).recentOutput, 'first')
  assert.equal(manager.list().find((item) => item.terminalId === second.terminalId).recentOutput, 'second')
  assert.equal(manager.list().find((item) => item.terminalId === first.terminalId).parentSessionId, 'parent-a')
})

test('persists asynchronous startup failures in session summaries and events', async () => {
  const events = []
  const backend = { start: async () => { throw new Error('codex executable failed to start') } }
  const manager = new SessionManager({ config: config(), backend, idFactory: () => 'term_failed' })
  manager.subscribe((event) => events.push(event))
  const started = manager.start({ provider: 'codex', prompt: '', cwd: 'D:/work', timeoutMs: 0 })
  await eventually(() => manager.get(started.terminalId).status === 'failed')
  assert.equal(manager.get(started.terminalId).error, 'codex executable failed to start')
  assert.equal(events.at(-1).error, 'codex executable failed to start')
})

test('preserves an exit that arrives before the backend promise resolves', async () => {
  const backend = {
    async start({ onExit }) {
      onExit({ exitCode: 0 })
      return { pid: 1001, handle: { alive: false } }
    },
    close() {},
    isAlive() { return false },
  }
  const manager = new SessionManager({ config: config(), backend, idFactory: () => 'term_fast_exit' })
  const started = manager.start({ provider: 'claude', prompt: '', cwd: 'D:/work', timeoutMs: 0 })
  await new Promise((resolve) => setTimeout(resolve, 10))
  assert.equal(manager.get(started.terminalId).status, 'exited')
  assert.equal(manager.get(started.terminalId).exitCode, 0)
})

test('keeps a bounded output ring and publishes ordered events', async () => {
  const backend = fakeBackend()
  const manager = new SessionManager({ config: config({ maxBufferChars: 5 }), backend, idFactory: () => 'term_ring' })
  const events = []
  manager.subscribe((event) => events.push(event))
  const started = manager.start({ provider: 'claude', prompt: '', cwd: 'D:/work', timeoutMs: 0 })
  await eventually(() => backend.starts.length === 1)
  backend.emit(backend.starts[0], '1234')
  backend.emit(backend.starts[0], '56789')
  assert.equal(manager.get(started.terminalId).outputBuffer, '56789')
  assert.deepEqual(events.filter((event) => event.type === 'output').map((event) => event.data), ['1234', '56789'])
})

test('writes selected terminal, sends enter, and interrupts only it', async () => {
  const backend = fakeBackend()
  const manager = new SessionManager({ config: config(), backend, idFactory: (() => { let n = 0; return () => `term_write${++n}` })() })
  const first = manager.start({ provider: 'claude', prompt: '', cwd: 'D:/work', timeoutMs: 0 })
  const second = manager.start({ provider: 'codex', prompt: '', cwd: 'D:/work', timeoutMs: 0 })
  await eventually(() => backend.starts.length === 2)
  manager.write(first.terminalId, 'hello', true)
  manager.interrupt(second.terminalId)
  assert.deepEqual(backend.writes, [[1, 'hello'], [1, '\r']])
  assert.deepEqual(backend.interrupts, [2])
})

test('marks nonzero exit, rejects unknown ids, and disposes all sessions', async () => {
  const backend = fakeBackend()
  const manager = new SessionManager({ config: config(), backend, idFactory: (() => { let n = 0; return () => `term_exit${++n}` })() })
  const first = manager.start({ provider: 'claude', prompt: '', cwd: 'D:/work', timeoutMs: 0 })
  const second = manager.start({ provider: 'codex', prompt: '', cwd: 'D:/work', timeoutMs: 0 })
  await eventually(() => backend.starts.length === 2)
  backend.exit(backend.starts[0], { exitCode: 7 })
  assert.equal(manager.get(first.terminalId).status, 'exited')
  assert.equal(manager.get(first.terminalId).exitCode, 7)
  assert.throws(() => manager.write('term_missing', 'x', false), (error) => error.code === 'unknown-terminal')
  await manager.dispose()
  assert.deepEqual(backend.closes, [2])
  assert.throws(() => manager.start({ provider: 'claude', prompt: '', cwd: 'D:/work', timeoutMs: 0 }), (error) => error.code === 'manager-disposed')
})

test('interrupts and force closes a timed out session', async () => {
  const backend = fakeBackend()
  const manager = new SessionManager({ config: config({ defaultTimeoutMs: 5 }), backend, idFactory: () => 'term_timeout' })
  const started = manager.start({ provider: 'claude', prompt: '', cwd: 'D:/work', timeoutMs: 5 })
  await eventually(() => backend.starts.length === 1)
  await new Promise((resolve) => setTimeout(resolve, 80))
  assert.deepEqual(backend.interrupts, [1])
  assert.deepEqual(backend.closes, [1])
  assert.equal(manager.get(started.terminalId).status, 'interrupted')
})

test('closed processes release the concurrent session limit', async () => {
  const backend = fakeBackend()
  let id = 0
  const manager = new SessionManager({ config: config({ maxSessions: 1 }), backend, idFactory: () => 'term_limit' + (++id) })
  const first = manager.start({ provider: 'codex', prompt: '', cwd: 'D:/work', timeoutMs: 0 })
  await manager.started(first.terminalId)
  await manager.close(first.terminalId)
  assert.doesNotThrow(() => manager.start({ provider: 'claude', prompt: '', cwd: 'D:/work', timeoutMs: 0 }))
  await manager.dispose()
})

test('disposal waits for a pending startup and cleans its process', async () => {
  const backend = fakeBackend()
  const start = backend.start.bind(backend)
  let resume
  backend.start = async (input) => { await new Promise((resolve) => { resume = resolve }); return start(input) }
  const manager = new SessionManager({ config: config(), backend })
  manager.start({ provider: 'codex', prompt: '', cwd: 'D:/work', timeoutMs: 0 })
  const disposing = manager.dispose()
  resume()
  await disposing
  assert.deepEqual(backend.closes, [1])
})

test('bounded read wakes at exit, validates limits and resizes only a live terminal', async () => {
  const backend = fakeBackend()
  const manager = new SessionManager({ config: config({ maxBufferChars: 1024 }), backend })
  const started = manager.start({ provider: 'codex', prompt: '', cwd: 'D:/work', timeoutMs: 0 })
  await manager.started(started.terminalId)
  const reading = manager.read(started.terminalId, { maxChars: 4, waitMs: 30000 })
  backend.emit(backend.starts[0], String.fromCharCode(27) + '[31m012345' + String.fromCharCode(27) + '[0m')
  manager.resize(started.terminalId, 80, 14)
  backend.exit(backend.starts[0])
  const result = await reading
  assert.equal(result.output, '2345')
  assert.equal(result.truncated, true)
  assert.equal(result.status, 'exited')
  assert.deepEqual(backend.sizes, [[1, 80, 14]])
  manager.resize(started.terminalId, 80, 14)
  assert.equal(backend.sizes.length, 1)
  assert.throws(() => manager.resize(started.terminalId, 1, 14), { code: 'invalid-size' })
  await assert.rejects(manager.read(started.terminalId, { maxChars: 16001 }), { code: 'invalid-limit' })
  await assert.rejects(manager.read(started.terminalId, { waitMs: 30001 }), { code: 'invalid-wait' })
})
