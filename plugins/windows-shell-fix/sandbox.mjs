import { fileURLToPath } from 'node:url';
export default class WindowsShellFix {
  static inject = ['sandbox'];

  constructor(ctx) {
    const sandbox = ctx.sandbox;
    if (process.platform === 'win32' && sandbox.runnerCommand === undefined) {
      const internals = sandbox.internals;
      const hadOverride = Object.hasOwn(internals, 'windowsAclRunnerArgs');
      const previous = internals.windowsAclRunnerArgs;
      const fixed = [
        process.execPath,
        fileURLToPath(new URL('./runner.cjs', import.meta.url)),
        fileURLToPath(import.meta.resolve('@deepseek-ai/dsh-sandbox-windows-acl/runner'))
      ];
      ctx.effect(() => {
        internals.windowsAclRunnerArgs = fixed;
        return () => {
          if (internals.windowsAclRunnerArgs !== fixed) return;
          if (hadOverride) internals.windowsAclRunnerArgs = previous;
          else delete internals.windowsAclRunnerArgs;
        };
      });
    }
  }
}
