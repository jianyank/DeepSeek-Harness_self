import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { sanitizeShims } from './sanitize-shims.mjs'
import { iexpressConfig } from './iexpress-config.mjs'

const repo = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const appSource = path.resolve(process.argv[2] || process.env.DSH_APP_SOURCE || '')
if (!process.argv[2] && !process.env.DSH_APP_SOURCE) throw new Error('Pass the installed DSH application directory to build-exe.cmd')
const output = path.join(repo, 'releases', 'DSH-Self-1.0.0-win-x64.exe')
const stage = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-self-build-'))
const payload = path.join(stage, 'payload.zip')
const bundle = path.join(stage, 'payload')
const run = (file, args, cwd = repo) => execFileSync(file, args, { cwd, stdio: 'inherit', windowsHide: true })
const copySource = async (from, to) => fs.cp(from, to, { recursive: true, dereference: true, filter: source => !source.split(path.sep).includes('node_modules') && !source.split(path.sep).includes('.git') })
const hash = async file => createHash('sha256').update(await fs.readFile(file)).digest('hex')
try {
  run(process.execPath, ['tools/privacy-scan.js'])
  run(process.execPath, ['tools/verify-layout.js'])
  console.log('Build staging directory: ' + stage)
  await fs.mkdir(path.join(bundle, 'app'), { recursive: true })
  // Take only application distribution files; never traverse a user data/home directory.
  const appFiles = ['DeepSeek Harness.exe', '7zip-installer-COPYING.txt', '7zip-installer-LICENSE.txt', 'chrome_100_percent.pak', 'chrome_200_percent.pak', 'd3dcompiler_47.dll', 'dxcompiler.dll', 'dxil.dll', 'ffmpeg.dll', 'icudtl.dat', 'LICENSE.electron.txt', 'LICENSES.chromium.html', 'resources.pak', 'snapshot_blob.bin', 'v8_context_snapshot.bin', 'version', 'vk_swiftshader.dll', 'vk_swiftshader_icd.json', 'vulkan-1.dll']
  for (const name of appFiles) await fs.copyFile(path.join(appSource, name), path.join(bundle, 'app', name))
  await fs.cp(path.join(appSource, 'locales'), path.join(bundle, 'app/locales'), { recursive: true, dereference: true })
  for (const name of ['app-update.yml', 'app.asar', 'app.asar.unpacked', 'default_app.asar', 'runtime', 'icon.png', 'tray.ico', 'elevate.exe']) await fs.cp(path.join(appSource, 'resources', name), path.join(bundle, 'app/resources', name), { recursive: true, dereference: true })
  for (const name of ['skills', 'installer', 'licenses']) await copySource(path.join(repo, name), path.join(bundle, name))
  for (const name of ['README.md', 'CHANGELOG.md', 'SECURITY.md', 'LICENSE', 'THIRD-PARTY-NOTICES.md']) await fs.copyFile(path.join(repo, name), path.join(bundle, name))
  const profile = path.join(bundle, 'profile')
  await copySource(path.join(repo, 'config/desktop'), profile)
  for (const name of ['plugins', 'agent-presets']) await copySource(path.join(repo, name), path.join(profile, name))
  run(process.execPath, [path.join(repo, 'installer/relocate-profile.mjs'), profile])
  await fs.writeFile(path.join(profile, 'pnpm-workspace.yaml'), 'packages:\n  - .\nnodeLinker: hoisted\nautoInstallPeers: false\nallowBuilds:\n  node-pty: true\n  esbuild: true\n')
  const node = path.join(bundle, 'app/resources/runtime/primary-runtime/dependencies/node/bin/node.exe')
  const pnpm = path.join(bundle, 'app/resources/runtime/pnpm/bin/pnpm.mjs')
  await fs.copyFile(path.join(repo, 'installer/plugin-dependencies.lock.yaml'), path.join(profile, 'pnpm-lock.yaml'))
  console.log('Installing pinned public plugin dependencies with the bundled runtime...')
  run(node, [pnpm, 'install', '--prod', '--frozen-lockfile', '--registry=https://registry.npmjs.org'], profile)
  // Preserve the installed local optimization, guarded against an unexpected upstream asset.
  const patchTarget = path.join(profile, 'node_modules/dsh-whale-widget/assets/whale-widget.js')
  const expected = '391806b8d4fd7c77a1711e02f58360e641f97b97bfb9085049031365007301b0'
  const patched = path.join(repo, 'patches/dsh-whale-widget/whale-widget.js')
  if (![expected, await hash(patched)].includes(await hash(patchTarget))) throw new Error('Whale widget patch target differs from the verified upstream version')
  await fs.copyFile(patched, patchTarget)
  // Portable modules are materialized so local file packages never point back to build paths.
  const modules = path.join(profile, 'node_modules')
  const expanded = path.join(stage, 'expanded-modules')
  await fs.cp(modules, expanded, { recursive: true, dereference: true, filter: file => !['.modules.yaml', '.pnpm-workspace-state-v1.json', '.pnpm'].includes(path.basename(file)) })
  if (!modules.startsWith(bundle + path.sep)) throw new Error('Unsafe module cleanup')
  await fs.rm(modules, { recursive: true, force: true })
  await fs.rename(expanded, modules)
  console.log('Removed build-path comments from ' + await sanitizeShims(modules) + ' dependency shims.')
  console.log('Creating self-contained application payload...')
  run('tar.exe', ['-a', '--options', 'zip:compression=deflate', '-c', '-f', payload, '-C', bundle, '.'])
  await fs.copyFile(path.join(repo, 'installer/bootstrap.cmd'), path.join(stage, 'bootstrap.cmd'))
  const sed = path.join(stage, 'package.sed')
  await fs.writeFile(sed, iexpressConfig(stage, output), 'ascii')
  await fs.mkdir(path.dirname(output), { recursive: true })
  run('iexpress.exe', ['/N', '/Q', sed])
  if ((await fs.stat(output)).size < 1000000) throw new Error('EXE is unexpectedly small')
  const sha256 = await hash(output)
  await fs.writeFile(path.join(repo, 'releases/SHA256SUMS.txt'), sha256 + '  ' + path.basename(output) + '\n')
  await fs.writeFile(path.join(repo, 'releases/build-info.json'), JSON.stringify({ version: '1.0.0', upstream: '0.2.0-rc.2', builtAt: new Date().toISOString(), appAsarSha256: await hash(path.join(appSource, 'resources/app.asar')), exe: path.basename(output), bytes: (await fs.stat(output)).size, sha256 }, null, 2) + '\n')
  // Kept outside Git for actual EXE extraction/installation smoke checks.
  console.log('Built ' + output)
  console.log('Smoke-test source: ' + bundle)
} catch (error) {
  console.error('Build diagnostics retained at: ' + stage)
  throw error
}
