import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'

test('loads native node-pty and starts a real Windows PTY in an isolated probe', async () => {
  const probe = spawn(process.execPath, ['--input-type=module', '-e', `
    import { spawn } from 'node-pty'
    const terminal = spawn(process.env.ComSpec ?? 'cmd.exe', ['/d', '/c', 'echo dsh-cli-bridge-native'], {
      name: 'xterm-256color', cols: 80, rows: 24, cwd: process.cwd(),
      env: { ...process.env }, useConpty: true,
    })
    let output = ''
    terminal.onData((data) => { output += data })
    terminal.onExit((event) => {
      if (!/dsh-cli-bridge-native/.test(output) || event.exitCode !== 0) process.exit(1)
      process.exit(0)
    })
  `], { cwd: process.cwd(), env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] })
  let stderr = ''
  probe.stderr.on('data', (data) => { stderr += data })
  const code = await new Promise((resolve, reject) => {
    probe.once('error', reject)
    probe.once('exit', (exitCode) => resolve(exitCode))
  })
  assert.equal(code, 0, stderr)
})
