import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
const exists = async file => !!(await fs.stat(file).catch(() => null))
export async function manage(action, directory) {
  if (!['restore', 'uninstall'].includes(action)) throw new Error('Use restore or uninstall')
  const root = path.resolve(directory)
  if (!(await exists(path.join(root, 'installation.json')))) throw new Error('Not a DSH Self installation')
  const parent = path.join(root, 'data/profiles')
  const target = path.join(parent, 'desktop')
  if (await exists(path.join(target, 'lock'))) throw new Error('Close DSH Self before changing its profile')
  const backups = (await fs.readdir(parent, { withFileTypes: true })).filter(e => e.isDirectory() && e.name.startsWith('desktop.backup-')).map(e => e.name).sort().reverse()
  if (action === 'restore' && !backups.length) throw new Error('No profile backup exists')
  let displaced
  if (await exists(target)) {
    displaced = target + '.removed-' + Date.now()
    await fs.rename(target, displaced)
  }
  if (action === 'restore') {
    try { await fs.rename(path.join(parent, backups[0]), target) }
    catch (error) { if (displaced) await fs.rename(displaced, target); throw error }
  }
  console.log(action === 'restore' ? 'Restored profile; the displaced profile remains recoverable.' : 'Disabled profile; data remains recoverable. Close DSH, then remove the installation folder to remove the portable application.')
  return displaced
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await manage(process.argv[2], process.argv[3] || path.resolve(import.meta.dirname, '..'))
