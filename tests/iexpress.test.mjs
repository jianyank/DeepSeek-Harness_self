import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { setTimeout } from 'node:timers/promises'
import { iexpressConfig } from '../tools/iexpress-config.mjs'
const exec = promisify(execFile)

test('IExpress quiet installation runs bootstrap and exits successfully', { skip: process.platform !== 'win32' }, async t => {
  const stage = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-self-sfx-test-'))
  t.after(async () => {
    if (path.dirname(stage) !== os.tmpdir() || !path.basename(stage).startsWith('dsh-self-sfx-test-')) throw new Error('Unsafe test cleanup')
    await fs.rm(stage, { recursive: true, force: true })
  })
  const output = path.join(stage, 'setup.exe')
  const sentinel = path.join(stage, 'bootstrap-ran.txt')
  await fs.writeFile(path.join(stage, 'bootstrap.cmd'), ['@echo off', 'echo installed>"' + sentinel + '"', 'exit /b 0', ''].join('\r\n'))
  await fs.writeFile(path.join(stage, 'payload.zip'), 'small packaging fixture')
  const config = path.join(stage, 'package.sed')
  await fs.writeFile(config, iexpressConfig(stage, output), 'ascii')
  await exec('iexpress.exe', ['/N', '/Q', config], { windowsHide: true, timeout: 15000 })
  await exec(output, ['/Q'], { windowsHide: true, timeout: 5000 })
  // IExpress may return before its bootstrap child finishes.
  const deadline = Date.now() + 10000
  while (!(await fs.stat(sentinel).catch(error => { if (error.code === 'ENOENT') return null; throw error }))) {
    if (Date.now() >= deadline) assert.fail('IExpress bootstrap did not create the installation marker')
    await setTimeout(100)
  }
  assert.equal((await fs.readFile(sentinel, 'utf8')).trim(), 'installed')
})
