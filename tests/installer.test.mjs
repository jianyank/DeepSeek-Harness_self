import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { installPackage } from '../installer/install.mjs'
import { manage } from '../installer/manage.mjs'
const fixture = async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-self-test-'))
  t.after(async () => { if (!path.basename(dir).startsWith('dsh-self-test-') || path.dirname(dir) !== os.tmpdir()) throw new Error('Invalid test cleanup'); await fs.rm(dir, { recursive: true, force: true }) })
  const source = path.join(dir, 'payload'), dest = path.join(dir, 'installed')
  for (const name of ['app', 'profile', 'installer', 'skills']) await fs.mkdir(path.join(source, name), { recursive: true })
  await fs.writeFile(path.join(source, 'app/DeepSeek Harness.exe'), 'fake app for installer lifecycle tests')
  await fs.writeFile(path.join(source, 'profile/package.json'), '{}')
  await fs.writeFile(path.join(source, 'profile/cordis.patch.yml'), 'vault: __DSH_DATA__/Obsidian')
  await fs.writeFile(path.join(source, 'installer/manage.mjs'), '')
  await fs.writeFile(path.join(source, 'skills/SKILL.md'), '# Public fixture skill')
  return { dir, source, dest }
}
test('clean install isolates data and relocates profile without touching an existing user profile', async t => {
  const f = await fixture(t)
  const privateFile = path.join(f.dir, 'existing-desktop.json')
  await fs.writeFile(privateFile, 'private sentinel')
  const result = await installPackage(f.source, f.dest)
  assert.equal(await fs.readFile(privateFile, 'utf8'), 'private sentinel')
  assert.equal(result.backups.length, 0)
  assert.ok((await fs.readFile(path.join(result.profile, 'cordis.patch.yml'), 'utf8')).includes(f.dest.replaceAll('\\', '/') + '/data/Obsidian'))
  const launcher = await fs.readFile(path.join(f.dest, 'Start-DSH.cmd'), 'utf8')
  assert.ok(launcher.includes('set "DSH_HOME=%~dp0data"'))
  assert.ok(launcher.includes('--user-data-dir='))
  assert.ok(await fs.stat(path.join(f.dest, 'data/skills/SKILL.md')))
})
test('reinstall makes a recoverable backup; restore and uninstall preserve the old files', async t => {
  const f = await fixture(t)
  await installPackage(f.source, f.dest)
  const profile = path.join(f.dest, 'data/profiles/desktop')
  await fs.writeFile(path.join(profile, 'user.txt'), 'keep')
  const result = await installPackage(f.source, f.dest)
  assert.equal(result.backups.length, 3)
  await manage('restore', f.dest)
  assert.equal(await fs.readFile(path.join(profile, 'user.txt'), 'utf8'), 'keep')
  const removed = await manage('uninstall', f.dest)
  assert.equal(await fs.readFile(path.join(removed, 'user.txt'), 'utf8'), 'keep')
  await assert.rejects(fs.stat(profile), { code: 'ENOENT' })
})
test('rejects incomplete payload, unrelated destination and an active profile before changing it', async t => {
  const f = await fixture(t)
  await fs.mkdir(f.dest)
  await fs.writeFile(path.join(f.dest, 'unrelated.txt'), 'keep')
  await assert.rejects(installPackage(f.source, f.dest), /Destination/)
  assert.equal(await fs.readFile(path.join(f.dest, 'unrelated.txt'), 'utf8'), 'keep')
  const second = path.join(f.dir, 'second')
  await installPackage(f.source, second)
  await fs.writeFile(path.join(second, 'data/profiles/desktop/lock'), 'active')
  await assert.rejects(installPackage(f.source, second), /Close DSH/)
  await assert.rejects(manage('restore', second), /Close DSH/)
  await fs.unlink(path.join(f.source, 'app/DeepSeek Harness.exe'))
  await assert.rejects(installPackage(f.source, path.join(f.dir, 'incomplete')), /Missing package/)
})
