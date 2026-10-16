import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const required = [
  'README.md', 'CHANGELOG.md', 'SECURITY.md', 'LICENSE',
  'config/desktop/package.json', 'config/desktop/cordis.yml', 'config/desktop/cordis.patch.yml',
  'plugins/manifest.json', 'skills/manifest.json',
  'agent-presets/financial-timeseries-analyst/PRESET.md',
  'installer/install.cmd', 'installer/restore.cmd', 'installer/uninstall.cmd',
  'installer/bootstrap.cmd', 'installer/build-exe.cmd', 'installer/relocate-profile.mjs',
  'tools/privacy-scan.js', 'tools/test-plugins.mjs', 'tools/build-exe.js',
  'installer/install.mjs', 'installer/manage.mjs', 'tests/installer.test.mjs',
  'THIRD-PARTY-NOTICES.md', 'licenses/DeepSeek-MIT.txt',
  'plugins/cache-prefix/index.js', 'plugins/project-folders/index.js',
  'plugins/runtime-tuning/index.js', 'plugins/windows-shell-fix/sandbox.mjs',
  'patches/dsh-whale-widget/whale-widget.js',
]
const missing = []
for (const item of required) try { await fs.access(path.join(root, item)) } catch { missing.push(item) }
const packageJson = JSON.parse(await fs.readFile(path.join(root, 'config/desktop/package.json'), 'utf8'))
const localValues = Object.values(packageJson.dependencies ?? {}).filter((value) => typeof value === 'string' && value.startsWith('file:'))
const badLocal = localValues.filter((value) => !value.startsWith('file:../../'))
const patch = await fs.readFile(path.join(root, 'config/desktop/cordis.patch.yml'), 'utf8')
const badPatch = /(?:apiKey|accessToken|refreshToken):\s*[^\s#]/i.test(patch) ? ['credential field'] : []
if (missing.length || badLocal.length || badPatch.length) {
  if (missing.length) console.error('Missing files:\n - ' + missing.join('\n - '))
  if (badLocal.length) console.error('Unexpected local dependency paths: ' + badLocal.join(', '))
  if (badPatch.length) console.error('Forbidden markers in public patch: ' + badPatch.join(', '))
  process.exit(1)
}
console.log('Layout verification passed: required files and relative source dependencies are present.')
