import fs from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
const root = path.resolve(import.meta.dirname, '..')
if (!process.env.DSH_SDK_ROOT) throw new Error('Set DSH_SDK_ROOT to the DSH SDK node_modules directory before running plugin tests')
process.env.DSH_NATIVE_ROOT ||= path.join(process.env.DSH_SDK_ROOT, '@deepseek-ai')
let failed = false
for (const plugin of ['dsh-cli-bridge', 'dsh-obsidian-memory', 'cache-prefix', 'runtime-tuning', 'project-folders']) {
  const cwd = path.join(root, 'plugins', plugin)
  const files = (await fs.readdir(path.join(cwd, 'tests'))).filter(f => f.endsWith('.test.mjs')).map(f => 'tests/' + f)
  console.log('Testing ' + plugin)
  const result = spawnSync(process.execPath, ['--test', ...files], { cwd, stdio: 'inherit', env: process.env, windowsHide: true })
  if (result.error) console.error(result.error.message)
  if (result.status !== 0) failed = true
}
process.exitCode = failed ? 1 : 0
