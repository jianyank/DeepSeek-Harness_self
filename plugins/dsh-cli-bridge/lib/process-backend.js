import { spawn as spawnProcess } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { validateProvider } from './validation.js'
import { loadPty } from './pty-loader.js'

function invalid(code, message) {
  return Object.assign(new Error(message), { code, status: 400 })
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function commandLineFor(provider, prompt, interactive) {
  validateProvider(provider)
  return { args: interactive ? (prompt ? [prompt] : []) : [provider === 'codex' ? 'exec' : '-p', prompt] }
}

export function resolveWindowsCommand(command, provider, { exists = existsSync, env = process.env, arch = process.arch } = {}) {
  const win = path.win32
  const directories = win.isAbsolute(command) ? [win.dirname(command)] : (env.PATH ?? env.Path ?? '').split(';').filter(Boolean)
  const name = win.basename(command)
  for (const directory of directories) {
    const direct = win.join(directory, /\.exe$/i.test(name) ? name : `${name}.exe`)
    if (exists(direct)) return direct
    if (!exists(win.join(directory, name)) && !exists(win.join(directory, `${name}.cmd`))) continue
    const npm = win.join(directory, 'node_modules')
    const triple = arch === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc'
    const candidates = provider === 'claude'
      ? [win.join(npm, '@anthropic-ai', 'claude-code', 'bin', 'claude.exe')]
      : [win.join(npm, '@openai', 'codex', 'node_modules', '@openai', `codex-win32-${arch}`, 'vendor', triple, 'bin', 'codex.exe'),
        win.join(npm, '@openai', 'codex', 'vendor', triple, 'bin', 'codex.exe')]
    for (const candidate of candidates) if (exists(candidate)) return candidate
  }
  throw invalid('cli-not-found', `Cannot resolve ${provider} to a native executable: ${command}. Install/login to the CLI or configure its absolute .exe path. Do not retry other workspaces or scan the harness installation.`)
}

async function defaultProcessKiller(pid) {
  await new Promise((resolve, reject) => {
    const child = spawnProcess('taskkill', ['/PID', String(pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
      shell: false,
    })
    child.once('error', reject)
    child.once('exit', () => resolve())
  })
}

export function createPtyBackend({ config, ptyModule, processKiller = defaultProcessKiller, graceMs = 250 }) {
  const records = new WeakMap()

  async function start({ provider, prompt, cwd, interactive, onData, onExit }) {
    validateProvider(provider)
    const pty = ptyModule ?? await loadPty()
    let command = provider === 'claude' ? config.claudeCommand : config.codexCommand
    if (!ptyModule && process.platform === 'win32') command = resolveWindowsCommand(command, provider)
    if (!ptyModule && !statSync(cwd).isDirectory()) throw invalid('invalid-cwd', `Workspace is not a directory: ${cwd}`)
    const { args } = commandLineFor(provider, prompt, interactive)
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    const handle = pty.spawn(command, args, {
      name: 'xterm-256color', cols: 120, rows: 30, cwd,
      env, useConpty: true,
    })
    const record = { pid: handle.pid, alive: true, owned: true }
    records.set(handle, record)
    handle.onData?.((data) => onData?.(data))
    handle.onExit?.((event) => {
      record.alive = false
      onExit?.(event)
    })
    return { pid: record.pid, handle }
  }

  function recordOf(handle) {
    const record = records.get(handle)
    if (!record?.owned || !record.pid) throw invalid('unknown-process', 'process is not owned by this plugin')
    return record
  }

  function write(handle, data) {
    recordOf(handle)
    handle.write(data)
  }

  function interrupt(handle) {
    recordOf(handle)
    if (records.get(handle).alive) handle.write('\u0003')
  }

  async function close(handle) {
    const record = recordOf(handle)
    if (!record.alive) return
    handle.write('\u0003')
    if (graceMs > 0) await wait(graceMs)
    if (record.alive) {
      await processKiller(record.pid)
      record.alive = false
    }
  }

  function isAlive(handle) {
    return recordOf(handle).alive
  }

  function resize(handle, cols, rows) {
    recordOf(handle)
    handle.resize(cols, rows)
  }

  return { start, write, interrupt, close, isAlive, resize }
}
