import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'

const { readConfig } = await import('../lib/config.js')
const {
  validateProvider,
  validateStartInput,
  validateTerminalId,
  validateWriteInput,
  validateCwd,
} = await import('../lib/validation.js')

const config = readConfig({ workspaceRoot: 'D:/workspace', allowedCwds: ['D:/shared'] })

function failure(fn, code) {
  assert.throws(fn, (error) => error.code === code && error.status === 400)
}

test('accepts only claude and codex providers', () => {
  assert.equal(validateProvider('claude'), 'claude')
  assert.equal(validateProvider('codex'), 'codex')
  failure(() => validateProvider('powershell'), 'invalid-provider')
})

test('normalizes a start request and defaults cwd and timeout', () => {
  assert.deepEqual(validateStartInput({ provider: 'claude', prompt: 'hello' }, config), {
    provider: 'claude', prompt: 'hello', cwd: path.resolve('D:/workspace'), taskId: null,
    interactive: false, timeoutMs: 0,
  })
  assert.equal(validateStartInput({ provider: 'codex', prompt: '', cwd: 'D:/shared/sub', interactive: false }, config).cwd, path.resolve('D:/shared/sub'))
})

test('resolves relative and omitted cwd against the DSH session workspace', () => {
  const sessionConfig = readConfig({ workspaceRoot: '.', allowedCwds: [] })
  assert.equal(validateStartInput({ provider: 'codex', prompt: '' }, sessionConfig, { baseCwd: 'D:/projects/orion' }).cwd, path.resolve('D:/projects/orion'))
  assert.equal(validateStartInput({ provider: 'codex', prompt: '', cwd: 'src' }, sessionConfig, { baseCwd: 'D:/projects/orion' }).cwd, path.resolve('D:/projects/orion/src'))
  failure(() => validateStartInput({ provider: 'codex', prompt: '', cwd: '../outside' }, sessionConfig, { baseCwd: 'D:/projects/orion' }), 'invalid-cwd')
  failure(() => validateStartInput({ provider: 'codex', prompt: '', cwd: 'D:/outside' }, sessionConfig, { baseCwd: 'D:/projects/orion' }), 'invalid-cwd')
  failure(() => validateStartInput({ provider: 'codex', prompt: '' }, config, { baseCwd: 'D:/outside' }), 'invalid-cwd')
})

test('rejects cwd outside configured roots', () => {
  assert.equal(validateCwd('D:/workspace/project', config), path.resolve('D:/workspace/project'))
  assert.equal(validateCwd('D:/shared', config), path.resolve('D:/shared'))
  failure(() => validateCwd('D:/other', config), 'invalid-cwd')
  failure(() => validateCwd('D:/workspace/../other', config), 'invalid-cwd')
})

test('rejects malformed start values and out of range timeout', () => {
  failure(() => validateStartInput({ provider: 'claude', prompt: 42 }, config), 'invalid-prompt')
  failure(() => validateStartInput({ provider: 'claude', prompt: 'x', timeoutMs: -1 }, config), 'invalid-timeout')
  failure(() => validateStartInput({ provider: 'claude', prompt: 'x', timeoutMs: 2_000_001 }, config), 'invalid-timeout')
})

test('validates terminal ids and bounded input', () => {
  assert.equal(validateTerminalId('term_abc123'), 'term_abc123')
  failure(() => validateTerminalId('bad id'), 'invalid-terminal-id')
  assert.deepEqual(validateWriteInput({ terminalId: 'term_abc123', data: 'hello', enter: true }), {
    terminalId: 'term_abc123', data: 'hello', enter: true,
  })
  failure(() => validateWriteInput({ terminalId: 'term_abc123', data: 'x'.repeat(8193) }), 'input-too-large')
})

test('rejects invalid resource limits', () => {
  assert.equal(readConfig({ workspaceRoot: 'D:/workspace', maxSessions: 8 }).maxSessions, 8)
  assert.throws(() => readConfig({ workspaceRoot: 'D:/workspace', maxSessions: 0 }), (error) => error.code === 'invalid-config')
  assert.throws(() => readConfig({ workspaceRoot: 'D:/workspace', maxBufferChars: 1 }), (error) => error.code === 'invalid-config')
})
