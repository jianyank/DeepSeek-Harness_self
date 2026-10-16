# DSH CLI Bridge

`dsh-cli-bridge` adds independent interactive PTY sessions for the local
Claude CLI and Codex CLI to DeepSeek Harness (DSH).

这是一个面向 DeepSeek Harness 的本地终端桥接插件：DSH 的多进程任务可以
并行启动 Claude CLI 和 Codex CLI，并在 DSH 界面中实时查看每个任务的输出。
终端面板支持收起和展开；收起只隐藏界面，不会暂停或终止后台 CLI 进程。

## Project Summary

The plugin provides a small, process-owned terminal layer for DSH rather than
wrapping commands in a shell. Each terminal has an independent PTY, bounded
output history, live SSE events, and explicit input and lifecycle controls.
It is intended for local development workflows where Claude and Codex are
already installed and authenticated on the same Windows account as DSH.

## Features

- Starts only the configured `claude` or `codex` executable.
- Gives every task its own `node-pty` session and terminal id.
- Streams output through SSE into a collapsible panel above the conversation input.
- Supports text input, Enter, Ctrl+C, close, and process-tree cleanup.
- Shows multiple sessions at the same time.
- Collapsing a terminal only hides its view; it does not stop the process.
- Keeps a bounded in-memory output buffer and provides bounded task results to the agent.

The plugin does not modify `resources/app.asar` or the DSH Electron core.

## Repository Layout

- `index.js`: DSH plugin entry point and lifecycle tools.
- `lib/`: configuration, validation, PTY loading, process ownership, sessions,
  and HTTP/SSE routes.
- `client/` and `dist/`: collapsible terminal dock and its browser bundle.
- `cordis.patch.yml`: DSH bundle configuration defaults.
- `tests/`: backend, route, client, runtime, and native-loader coverage.

## Requirements

The local executables must already be installed and authenticated by the user.
The plugin does not store or manage Claude/Codex API keys.

The executable names must be available in the environment inherited by DSH:

```cmd
where claude
where codex
claude --version
codex --version
```

If a CLI is installed outside `PATH`, set `claudeCommand` or `codexCommand` to
the executable path in the profile configuration. Do not put a shell command,
pipe, or command chain in these fields.

## Configuration

The bundle patch installs this conservative default:

```yaml
workspaceRoot: '.'
allowedCwds: []
maxSessions: 8
maxBufferChars: 200000
defaultTimeoutMs: 0
```

The default workspaceRoot of '.' follows the current DSH session's project
directory, not the profile installation directory. Omit cwd to use that project;
relative cwd values resolve beneath it. An explicit workspaceRoot restricts tasks
to that root or allowedCwds. Traversal outside permitted roots is rejected.

Optional command settings are:

```yaml
claudeCommand: 'claude'
codexCommand: 'codex'
```

`defaultTimeoutMs: 0` disables the timeout. A non-zero timeout first sends
Ctrl+C and then force-closes the owned process tree if it remains alive.

## DSH tools

- `cli_start`: start a Claude or Codex PTY session.
- `cli_write`: write text to one session and optionally press Enter.
- `cli_interrupt`: send Ctrl+C to one session.
- `cli_close`: stop one session and its Windows child process tree.
- `cli_list`: list session status without returning a full transcript.
- `cli_read`: collect bounded output and status, optionally waiting up to 30 seconds.

Automated tasks default to non-interactive mode: Claude uses -p and Codex uses
exec. Set interactive=true only for a continuing terminal conversation. CLI
startup failures are returned directly and remain visible in the panel. On a
failure, report the error instead of repeatedly scanning the DSH installation.
Windows npm shims are resolved to their native executable without a shell.

For running tasks, use cli_read with waitMs=30000 instead of frequent polling.
Its default output limit is 4000 characters (maximum 16000); the live terminal
continues to display output independently. The panel starts collapsed and stays
above the composer in normal layout; collapsing does not dispose a terminal.

## Token Usage

DSH's cumulative token count sums usage across model turns, including cached
input reads. It is not the size of a single request or the number of newly
generated tokens. Repeated failures, filesystem scans and transcript polling
increase that cumulative count. The bridge returns startup errors and bounded
results to avoid those loops. Claude/Codex use their existing account settings;
their own skills, hooks, MCP servers and token usage remain separate from DSH.

The tool context records the parent DSH session id and optional task id so
parallel work can associate its terminal with the originating task.

## Native PTY dependency

`node-pty` is a native dependency. It must be installed and loadable by the
same Node/Electron runtime that loads the plugin. A normal pipe is not used as
a fallback because it cannot provide equivalent interactive terminal behavior.

After changing Node or Electron versions, reinstall the plugin dependencies and
verify the native module before starting DSH:

```cmd
cd /d "D:\path\to\dsh-cli-bridge"
npm install
node --input-type=module -e "import('node-pty').then(() => console.log('node-pty ok'))"
```

If the runtime cannot load `node-pty`, sessions fail with `pty-unavailable`.

## Security and data handling

- Only `claude` and `codex` are accepted as providers.
- The process backend passes an argv array and never enables `shell: true`.
- Input is written to an owned PTY; it is never interpolated into a shell.
- HTTP routes accept loopback or DSH-trusted requests and reject cross-site
  requests.
- API keys and complete terminal transcripts are not persisted.
- Output is retained only in a bounded in-memory ring until the plugin exits.

## Troubleshooting

### The terminal is empty

Check that the session status is `running` and that the CLI executable works in
the same Windows account and `PATH` used to launch DSH. Then check the DSH
runtime log for `pty-unavailable` or an executable startup error.

### `cwd` is rejected

Use an absolute `workspaceRoot`, or add the requested directory to
`allowedCwds`. The requested directory must exist within one of those roots;
parent-directory traversal is not accepted.

### The CLI asks for login

Authenticate the local Claude or Codex CLI outside DSH first. This plugin only
provides the terminal transport and does not implement provider authentication.

### DSH was restarted

PTY sessions are process-owned by the current plugin instance and are not
restored after a restart. The plugin closes its owned sessions during disposal.
