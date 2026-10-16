import './support/sdk.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
const { isJsonValue } = await import('@deepseek-ai/dsh-util-values')

const { apply } = await import('../index.js')

function harness(rawConfig = { workspaceRoot: 'D:/workspace', allowedCwds: [] }, failing = false) {
  const tools = new Map()
  const calls = { starts: [], writes: [], interrupts: [], closes: [] }
  const backend = {
    async start(input) {
      if (failing) throw new Error('CLI executable missing')
      calls.starts.push(input)
      const handle = { input, alive: true }
      return { pid: 1234, handle }
    },
    write(handle, data) { calls.writes.push([handle, data]) },
    interrupt(handle) { calls.interrupts.push(handle) },
    async close(handle) { calls.closes.push(handle); handle.alive = false },
    isAlive(handle) { return handle.alive },
  }
  const ctx = {
    effect(callback) { return callback() },
    tools: { register(tool) { tools.set(tool.name, tool); return () => tools.delete(tool.name) } },
    inject(_deps, callback) {
      return callback({
        effect: (fn) => fn(),
        webRuntime: { trustedHosts: [] },
        webServer: { register: () => () => {} },
      })
    },
  }
  const manager = apply(ctx, rawConfig, { backend })
  return { tools, calls, manager }
}

test('registers the CLI lifecycle tools and returns JSON values', async () => {
  const app = harness()
  assert.deepEqual([...app.tools.keys()], ['cli_start', 'cli_write', 'cli_interrupt', 'cli_close', 'cli_list', 'cli_read'])
  const started = await app.tools.get('cli_start').execute({
    provider: 'claude', prompt: 'inspect repo', cwd: 'D:/workspace', taskId: 'task-7', interactive: false,
  }, { agent: { session: { id: 'parent-9' } } })
  assert.ok(isJsonValue(started))
  assert.equal(started.provider, 'claude')
  assert.equal(started.taskId, 'task-7')
  assert.equal(started.parentSessionId, 'parent-9')
  assert.equal(started.status, 'running')
  assert.equal(started.pid, 1234)
  assert.equal(app.calls.starts[0].prompt, 'inspect repo')
  assert.equal(app.calls.starts[0].interactive, false)
})

test('routes writes, interrupt, close and list to the selected terminal', async () => {
  const app = harness()
  const started = await app.tools.get('cli_start').execute({ provider: 'codex', prompt: '', cwd: 'D:/workspace' }, {})
  const id = started.terminalId
  const written = await app.tools.get('cli_write').execute({ terminalId: id, data: 'yes', enter: true })
  assert.ok(isJsonValue(written))
  await app.tools.get('cli_interrupt').execute({ terminalId: id })
  await app.tools.get('cli_close').execute({ terminalId: id })
  const listed = await app.tools.get('cli_list').execute({})
  assert.ok(isJsonValue(listed))
  assert.equal(app.calls.writes.length, 2)
  assert.equal(app.calls.writes[1][1], '\r')
  assert.equal(app.calls.interrupts.length, 1)
  assert.equal(app.calls.closes.length, 1)
})

test('reads a bounded terminal result without returning the full transcript', async () => {
  const app = harness()
  const started = await app.tools.get('cli_start').execute({ provider: 'codex', prompt: '', cwd: 'D:/workspace' }, {})
  app.calls.starts[0].onData('x'.repeat(1000))
  const result = await app.tools.get('cli_read').execute({ terminalId: started.terminalId, maxChars: 100 }, {})
  assert.ok(isJsonValue(result))
  assert.equal(result.terminalId, started.terminalId)
  assert.equal(result.output.length, 100)
  assert.equal(result.truncated, true)
  await assert.rejects(() => app.tools.get('cli_read').execute({ terminalId: started.terminalId, maxChars: 100001 }), /maxChars/)
})

test('uses the official exec session header cwd and returns startup failure', async () => {
  const app = harness({ workspaceRoot: '.' })
  const exec = { agent: { session: { id: 'orion', header: { cwd: 'D:/projects/orion' } } } }
  const started = await app.tools.get('cli_start').execute({ provider: 'codex', prompt: 'inspect' }, exec)
  assert.equal(started.cwd, 'D:\\projects\\orion')
  assert.equal(started.status, 'running')
  const failing = harness({ workspaceRoot: '.' }, true)
  const result = await failing.tools.get('cli_start').execute({ provider: 'codex', prompt: '' }, exec)
  assert.equal(result.status, 'failed')
  assert.equal(result.error, 'CLI executable missing')
})
