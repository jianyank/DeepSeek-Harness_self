import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'

const exists = async file => !!(await fs.stat(file).catch(() => null))
export async function installPackage(source, destination) {
  source = path.resolve(source)
  const root = path.resolve(destination)
  if (root === path.parse(root).root || root === os.homedir() || root === source || root.startsWith(source + path.sep)) throw new Error('Unsafe installation destination')
  if (await exists(root) && !(await exists(path.join(root, 'installation.json'))) && (await fs.readdir(root)).length) throw new Error('Destination is not an existing DSH Self installation or empty directory')
  const profile = path.join(root, 'data/profiles/desktop')
  if (await exists(path.join(profile, 'lock'))) throw new Error('Close DSH Self before installing or updating')
  for (const file of ['app/DeepSeek Harness.exe', 'profile/package.json', 'installer/manage.mjs']) if (!(await exists(path.join(source, file)))) throw new Error('Missing package file: ' + file)
  await fs.mkdir(root, { recursive: true })
  const incoming = path.join(root, '.incoming-' + randomUUID())
  const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8)
  const moved = []
  const published = []
  try {
    await fs.mkdir(incoming)
    for (const dir of ['app', 'profile', 'installer']) await fs.cp(path.join(source, dir), path.join(incoming, dir), { recursive: true, dereference: true })
    const patchFile = path.join(incoming, 'profile/cordis.patch.yml')
    const dataPath = path.join(root, 'data').split(path.sep).join('/')
    await fs.writeFile(patchFile, (await fs.readFile(patchFile, 'utf8')).replaceAll('__DSH_DATA__', dataPath))
    await fs.mkdir(path.dirname(profile), { recursive: true })
    for (const [from, to] of [[path.join(incoming, 'app'), path.join(root, 'app')], [path.join(incoming, 'profile'), profile], [path.join(incoming, 'installer'), path.join(root, 'installer')]]) {
      if (await exists(to)) { const backup = to + '.backup-' + stamp; await fs.rename(to, backup); moved.push([to, backup]) }
      await fs.rename(from, to)
      published.push(to)
    }
    for (const file of ['README.md', 'CHANGELOG.md', 'SECURITY.md', 'LICENSE', 'THIRD-PARTY-NOTICES.md']) if (await exists(path.join(source, file))) await fs.copyFile(path.join(source, file), path.join(root, file))
    if (await exists(path.join(source, 'licenses'))) await fs.cp(path.join(source, 'licenses'), path.join(root, 'licenses'), { recursive: true })
    await fs.mkdir(path.join(root, 'data/Obsidian/Memory'), { recursive: true })
    // Skills under DSH_HOME/skills are discovered by the installed skill-filesystem service.
    await fs.cp(path.join(source, 'skills'), path.join(root, 'data/skills'), { recursive: true, dereference: true })
    const launcher = ['@echo off', 'setlocal', 'set "DSH_HOME=%~dp0data"', 'set "DSH_AGENTS_HOME=%~dp0agents"', 'set "APPDATA=%~dp0electron-roaming"', 'start "" "%~dp0app\\DeepSeek Harness.exe" --user-data-dir="%~dp0electron-data"', ''].join('\r\n')
    await fs.writeFile(path.join(root, 'Start-DSH.cmd'), launcher, 'utf8')
    await fs.writeFile(path.join(root, 'installation.json'), JSON.stringify({ version: '1.0.0', upstream: '0.2.0-rc.2', installedAt: new Date().toISOString() }, null, 2) + '\n')
    console.log('Installed DSH Self: ' + root + '\nDouble-click Start-DSH.cmd. Sign in with your own model account.')
    return { root, profile, backups: moved.map(([, backup]) => backup) }
  } catch (error) {
    // All generated destinations are below the checked installation root.
    for (const to of published.reverse()) { if (!to.startsWith(root + path.sep)) throw new Error('Invalid rollback target'); await fs.rm(to, { recursive: true, force: true }) }
    for (const [to, backup] of moved.reverse()) await fs.rename(backup, to)
    throw error
  } finally {
    if (!incoming.startsWith(root + path.sep + '.incoming-')) throw new Error('Invalid staging cleanup target')
    await fs.rm(incoming, { recursive: true, force: true })
  }
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const destination = process.env.DSH_INSTALL_ROOT || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData/Local'), 'Programs/DSH-Self')
  await installPackage(process.argv[2] || path.resolve(import.meta.dirname, '..'), destination)
}
