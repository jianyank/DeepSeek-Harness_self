import { defineTool } from '@deepseek-ai/dsh-tools'
import { readConfig } from './lib/config.js'
import { validateStartInput, validateTerminalId, validateWriteInput } from './lib/validation.js'
import { createPtyBackend } from './lib/process-backend.js'
import { SessionManager } from './lib/session-manager.js'
import { mountRoutes } from './lib/routes.js'

export const name = 'cli-bridge'
export const inject = ['tools']

const OUTPUT = {
  schema: { type: 'json' },
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
}

function sessionId(exec) {
  return exec?.agent?.session?.id ?? exec?.session?.id ?? null
}

export function apply(ctx, rawConfig, testDeps = {}) {
  const config = readConfig(rawConfig)
  const backend = testDeps.backend ?? createPtyBackend({ config, ptyModule: testDeps.ptyModule })
  const manager = new SessionManager({ config, backend })

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'cli_start',
    description: 'Delegate a task to Claude/Codex CLI in the current session workspace (omit cwd). Defaults to non-interactive; set interactive=true for a live conversation. Returns real startup status; failed means stop and report the error, never retry different paths or inspect harness/runtime. Collect results using cli_read, not filesystem scans.',
    parameters: {
      provider: { type: 'string', enum: ['claude', 'codex'], required: true },
      prompt: { type: 'string', required: true },
      cwd: { type: 'string' },
      taskId: { type: 'string' },
      interactive: { type: 'boolean' },
      timeoutMs: { type: 'integer' },
    },
    output: OUTPUT,
    execute: async (args, exec) => {
      const started = manager.start(validateStartInput(args, config, { baseCwd: exec?.agent?.session?.header?.cwd }), { parentSessionId: sessionId(exec) })
      return manager.started(started.terminalId)
    },
  })))

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'cli_write',
    description: 'Write text to one owned CLI terminal, optionally followed by Enter.',
    parameters: {
      terminalId: { type: 'string', required: true },
      data: { type: 'string', required: true },
      enter: { type: 'boolean' },
    },
    output: OUTPUT,
    execute: (args) => {
      const input = validateWriteInput(args)
      return manager.write(input.terminalId, input.data, input.enter)
    },
  })))

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'cli_interrupt',
    description: 'Send Ctrl+C to one owned CLI terminal.',
    parameters: { terminalId: { type: 'string', required: true } },
    output: OUTPUT,
    execute: (args) => manager.interrupt(validateTerminalId(args?.terminalId)),
  })))

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'cli_close',
    description: 'Close one owned CLI terminal and its child process tree.',
    parameters: { terminalId: { type: 'string', required: true } },
    output: OUTPUT,
    execute: (args) => manager.close(validateTerminalId(args?.terminalId)),
  })))

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'cli_list',
    description: 'List all CLI terminals owned by this plugin.',
    parameters: {},
    output: OUTPUT,
    execute: () => ({ sessions: manager.list() }),
  })))

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'cli_read',
    description: 'Collect one CLI task result/status with bounded output. Use waitMs=30000 for running non-interactive tasks instead of busy polling. Default 4000 characters, maximum 16000. Failed/nonzero exit: report error, do not retry or scan harness files.',
    parameters: {
      terminalId: { type: 'string', required: true },
      maxChars: { type: 'integer' },
      waitMs: { type: 'integer' },
    },
    output: OUTPUT,
    execute: (args) => manager.read(validateTerminalId(args?.terminalId), { maxChars: args.maxChars, waitMs: args.waitMs }),
  })))

  mountRoutes(ctx, manager)
  ctx.effect(() => () => { void manager.dispose() })
  return manager
}
