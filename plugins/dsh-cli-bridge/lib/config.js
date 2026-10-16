import path from 'node:path'

const DEFAULTS = {
  workspaceRoot: '.',
  allowedCwds: [],
  claudeCommand: 'claude',
  codexCommand: 'codex',
  maxSessions: 8,
  maxBufferChars: 200_000,
  defaultTimeoutMs: 0,
}

function invalid(message) {
  return Object.assign(new Error(message), { code: 'invalid-config', status: 400 })
}

function positiveInteger(value, name, minimum) {
  if (!Number.isSafeInteger(value) || value < minimum) throw invalid(`${name} must be an integer >= ${minimum}`)
  return value
}

export function readConfig(rawConfig = {}) {
  const value = { ...DEFAULTS, ...(rawConfig && typeof rawConfig === 'object' ? rawConfig : {}) }
  if (typeof value.workspaceRoot !== 'string' || !value.workspaceRoot.trim()) throw invalid('workspaceRoot is required')
  if (!Array.isArray(value.allowedCwds) || value.allowedCwds.some((cwd) => typeof cwd !== 'string' || !cwd.trim())) {
    throw invalid('allowedCwds must be an array of paths')
  }
  if (typeof value.claudeCommand !== 'string' || !value.claudeCommand.trim()) throw invalid('claudeCommand is required')
  if (typeof value.codexCommand !== 'string' || !value.codexCommand.trim()) throw invalid('codexCommand is required')
  return {
    workspaceRoot: path.resolve(value.workspaceRoot),
    useSessionWorkspace: value.workspaceRoot === '.',
    allowedCwds: value.allowedCwds.map((cwd) => path.resolve(cwd)),
    claudeCommand: value.claudeCommand.trim(),
    codexCommand: value.codexCommand.trim(),
    maxSessions: positiveInteger(value.maxSessions, 'maxSessions', 1),
    maxBufferChars: positiveInteger(value.maxBufferChars, 'maxBufferChars', 1024),
    defaultTimeoutMs: (() => {
      if (!Number.isSafeInteger(value.defaultTimeoutMs) || value.defaultTimeoutMs < 0 || value.defaultTimeoutMs > 2_000_000) {
        throw invalid('defaultTimeoutMs must be between 0 and 2000000')
      }
      return value.defaultTimeoutMs
    })(),
  }
}
