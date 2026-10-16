import path from 'node:path'

const MAX_INPUT_CHARS = 8192
const MAX_PROMPT_CHARS = 100_000
const MAX_TIMEOUT_MS = 2_000_000

function failure(code, message) {
  return Object.assign(new Error(message), { code, status: 400 })
}

export function validateProvider(value) {
  if (value !== 'claude' && value !== 'codex') throw failure('invalid-provider', 'provider must be claude or codex')
  return value
}

export function validateCwd(value, config, { baseCwd } = {}) {
  if (value !== undefined && typeof value !== 'string') throw failure('invalid-cwd', 'cwd must be a path')
  const root = config.useSessionWorkspace && baseCwd ? path.resolve(baseCwd) : config.workspaceRoot
  const candidate = path.resolve(baseCwd ?? root, value ?? '.')
  const roots = [root, ...config.allowedCwds]
  const inside = roots.some((root) => {
    const relative = path.relative(root, candidate)
    return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  })
  if (!inside) throw failure('invalid-cwd', `cwd must be inside an allowed directory: ${roots.join(', ')}. Stop and report this configuration error; do not retry another path or scan the harness installation.`)
  return candidate
}

export function validateStartInput(input, config, context) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw failure('invalid-request', 'start input must be an object')
  const provider = validateProvider(input.provider)
  if (typeof input.prompt !== 'string') throw failure('invalid-prompt', 'prompt must be a string')
  if (input.prompt.length > MAX_PROMPT_CHARS) throw failure('invalid-prompt', 'prompt is too large')
  const timeoutMs = input.timeoutMs ?? config.defaultTimeoutMs
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > MAX_TIMEOUT_MS) throw failure('invalid-timeout', 'timeoutMs is out of range')
  if (input.interactive !== undefined && typeof input.interactive !== 'boolean') throw failure('invalid-interactive', 'interactive must be boolean')
  if (input.taskId !== undefined && input.taskId !== null && (typeof input.taskId !== 'string' || input.taskId.length > 200)) {
    throw failure('invalid-task-id', 'taskId must be a short string')
  }
  return {
    provider,
    prompt: input.prompt,
    cwd: validateCwd(input.cwd, config, context),
    taskId: input.taskId ?? null,
    interactive: input.interactive ?? false,
    timeoutMs,
  }
}

export function validateTerminalId(value) {
  if (typeof value !== 'string' || !/^term_[A-Za-z0-9_-]{3,80}$/.test(value)) {
    throw failure('invalid-terminal-id', 'terminalId is invalid')
  }
  return value
}

export function validateWriteInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw failure('invalid-request', 'input must be an object')
  const terminalId = validateTerminalId(input.terminalId)
  if (typeof input.data !== 'string') throw failure('invalid-input', 'data must be a string')
  if (input.data.length > MAX_INPUT_CHARS) throw failure('input-too-large', 'input is too large')
  if (input.enter !== undefined && typeof input.enter !== 'boolean') throw failure('invalid-enter', 'enter must be boolean')
  return { terminalId, data: input.data, enter: input.enter ?? false }
}
