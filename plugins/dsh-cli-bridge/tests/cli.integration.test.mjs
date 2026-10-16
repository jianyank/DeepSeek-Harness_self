import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { spawn } from 'node:child_process'

import { SessionManager } from '../lib/session-manager.js'

const fixture = fileURLToPath(new URL('./fixtures/fake-cli.mjs', import.meta.url))
const cwd = path.dirname(fixture)
function config(overrides = {}) {
  return {
    maxSessions: 4,
    maxBufferChars: 20_000,
    defaultTimeoutMs: 0,
    ...overrides,
  }
}

function fakeBackend() {
  return {
    async start({ name, mode = 'interactive', onData, onExit }) {
      const child = spawn(process.execPath, [fixture, name, mode], {
        cwd, env: { ...process.env }, stdio: ['pipe', 'pipe', 'pipe'],
      })
      const handle = {
        pid: child.pid,
        __alive: true,
        write(data) { child.stdin.write(data) },
        kill() { child.kill() },
      }
      child.stdout.on('data', onData)
      child.stderr.on('data', onData)
      child.on('exit', (code, signal) => {
        handle.__alive = false
        onExit({ exitCode: Number.isInteger(code) ? code : null, signal })
      })
      return { pid: child.pid, handle }
    },
    write(handle, data) { handle.write(data) },
    interrupt(handle) { handle.write('\u0003') },
    async close(handle) {
      if (!this.isAlive(handle)) return
      handle.write('\u0003')
      await new Promise((resolve) => setTimeout(resolve, 50))
      if (this.isAlive(handle)) {
        try { handle.kill() } catch {}
      }
    },
    isAlive(handle) { return handle.__alive === true },
  }
}

async function eventually(check, timeoutMs = 5000, detail = () => '') {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  assert.fail('condition was not reached before timeout ' + detail())
}

test('runs concurrent fake CLI processes with isolated output and input', async (t) => {
  const backend = fakeBackend()
  const manager = new SessionManager({ config: config(), backend, timeoutGraceMs: 100 })
  t.after(() => manager.dispose())

  const first = manager.start({ provider: 'claude', prompt: '', name: 'first', cwd, interactive: true, timeoutMs: 0 })
  const second = manager.start({ provider: 'codex', prompt: '', name: 'second', cwd, interactive: true, timeoutMs: 0 })
  await eventually(() => manager.get(first.terminalId).recentOutput.includes('READY:first'), 5000, () => JSON.stringify(manager.get(first.terminalId)))
  await eventually(() => manager.get(second.terminalId).recentOutput.includes('READY:second'), 5000, () => JSON.stringify(manager.get(second.terminalId)))

  manager.write(first.terminalId, 'hello', true)
  await eventually(() => manager.get(first.terminalId).recentOutput.includes('INPUT:first:hello'), 5000, () => JSON.stringify(manager.get(first.terminalId)))
  assert.doesNotMatch(manager.get(second.terminalId).outputBuffer, /INPUT:first:hello/)

  manager.write(first.terminalId, 'exit', true)
  await eventually(() => manager.get(first.terminalId).status === 'exited', 5000, () => JSON.stringify(manager.get(first.terminalId)))
  assert.equal(manager.get(first.terminalId).exitCode, 0)
  assert.equal(manager.get(second.terminalId).status, 'running')
  manager.write(second.terminalId, 'exit', true)
  await eventually(() => manager.get(second.terminalId).status === 'exited', 5000, () => JSON.stringify(manager.get(second.terminalId)))
})

test('interrupts only the selected fake CLI and force-cleans a timeout', async (t) => {
  const backend = fakeBackend()
  const manager = new SessionManager({ config: config(), backend, timeoutGraceMs: 100 })
  t.after(() => manager.dispose())

  const selected = manager.start({ provider: 'claude', prompt: '', name: 'selected', cwd, interactive: true, timeoutMs: 0 })
  const timed = manager.start({ provider: 'codex', prompt: '', name: 'timed', mode: 'hang', cwd, interactive: true, timeoutMs: 100 })
  await eventually(() => manager.get(selected.terminalId).recentOutput.includes('READY:selected'), 5000, () => JSON.stringify(manager.get(selected.terminalId)))
  await eventually(() => manager.get(timed.terminalId).recentOutput.includes('HANGING:timed'), 5000, () => JSON.stringify(manager.get(timed.terminalId)))

  manager.interrupt(selected.terminalId)
  await eventually(() => manager.get(selected.terminalId).status === 'interrupted', 5000, () => JSON.stringify(manager.get(selected.terminalId)))
  assert.equal(manager.get(timed.terminalId).status, 'running')
  await eventually(() => manager.get(timed.terminalId).status === 'interrupted', 3000, () => JSON.stringify(manager.get(timed.terminalId)))
})
