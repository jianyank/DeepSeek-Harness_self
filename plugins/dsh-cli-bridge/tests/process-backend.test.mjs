import test from 'node:test'
import assert from 'node:assert/strict'

const { createPtyBackend, commandLineFor, resolveWindowsCommand } = await import('../lib/process-backend.js')

function fakePty() {
  const calls = []
  const handles = []
  const ptyModule = {
    spawn(command, args, options) {
      const listeners = {}
      const handle = {
        pid: 4321,
        write(value) { calls.push(['write', value]) },
        kill(signal) { calls.push(['kill', signal]) },
        onData(callback) { listeners.data = callback; return { dispose() {} } },
        onExit(callback) { listeners.exit = callback; return { dispose() {} } },
        emitData(value) { listeners.data?.(value) },
        emitExit(value) { listeners.exit?.(value) },
      }
      calls.push(['spawn', command, args, options])
      handles.push(handle)
      return handle
    },
  }
  return { calls, handles, ptyModule }
}

test('spawns whitelisted providers with argv and no shell', async () => {
  const fake = fakePty()
  const backend = createPtyBackend({
    config: { claudeCommand: 'claude.exe', codexCommand: 'codex.exe' },
    ptyModule: fake.ptyModule,
  })
  const data = []
  const result = await backend.start({ provider: 'claude', prompt: 'hello & whoami', cwd: 'D:/work', interactive: true, onData: (value) => data.push(value) })
  const spawn = fake.calls.find((call) => call[0] === 'spawn')
  assert.equal(spawn[1], 'claude.exe')
  assert.deepEqual(spawn[2], ['hello & whoami'])
  assert.equal(spawn[3].cwd, 'D:/work')
  assert.equal('shell' in spawn[3], false)
  assert.deepEqual(fake.calls.filter((call) => call[0] === 'write'), [])
  fake.handles[0].emitData('ready')
  assert.deepEqual(data, ['ready'])
  assert.equal(result.pid, 4321)
})

test('passes non-interactive prompt as one argument and routes input', async () => {
  const fake = fakePty()
  const backend = createPtyBackend({
    config: { claudeCommand: 'claude', codexCommand: 'codex' },
    ptyModule: fake.ptyModule,
  })
  await backend.start({ provider: 'codex', prompt: 'review this', cwd: 'D:/work', interactive: false })
  const spawn = fake.calls.find((call) => call[0] === 'spawn')
  assert.deepEqual(spawn[2], ['exec', 'review this'])
  backend.write(fake.handles[0], 'answer')
  backend.interrupt(fake.handles[0])
  assert.deepEqual(fake.calls.filter((call) => call[0] === 'write'), [['write', 'answer'], ['write', '\u0003']])
})

test('uses provider-native non-interactive flags', () => {
  assert.deepEqual(commandLineFor('claude', 'inspect', false), { args: ['-p', 'inspect'] })
  assert.deepEqual(commandLineFor('codex', 'inspect', false), { args: ['exec', 'inspect'] })
  assert.deepEqual(commandLineFor('codex', '', true), { args: [] })
})

test('resolves npm Windows shims to native executables without a shell', () => {
  const files = new Set(['C:\\tools\\claude.cmd', 'C:\\tools\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe'])
  const command = resolveWindowsCommand('C:\\tools\\claude.cmd', 'claude', { exists: (file) => files.has(file), env: {} })
  assert.equal(command, 'C:\\tools\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe')
  assert.deepEqual(commandLineFor('claude', 'say "hello" & whoami', false).args, ['-p', 'say "hello" & whoami'])
})

test('close kills only the owned pid after interrupt grace period', async () => {
  const fake = fakePty()
  const killed = []
  const backend = createPtyBackend({
    config: { claudeCommand: 'claude', codexCommand: 'codex' },
    ptyModule: fake.ptyModule,
    graceMs: 0,
    processKiller: async (pid) => { killed.push(pid) },
  })
  const result = await backend.start({ provider: 'claude', prompt: '', cwd: 'D:/work', interactive: true })
  await backend.close(result.handle)
  assert.deepEqual(fake.calls.filter((call) => call[0] === 'write'), [['write', '\u0003']])
  assert.deepEqual(killed, [4321])
})

test('rejects unsupported providers before spawning', async () => {
  const fake = fakePty()
  const backend = createPtyBackend({ config: { claudeCommand: 'claude', codexCommand: 'codex' }, ptyModule: fake.ptyModule })
  await assert.rejects(() => backend.start({ provider: 'powershell', prompt: '', cwd: 'D:/work', interactive: true }), (error) => error.code === 'invalid-provider')
  assert.equal(fake.calls.length, 0)
})
