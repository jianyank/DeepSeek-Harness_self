import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const skipNames = new Set(['.git', 'node_modules'])
const skipExt = new Set(['.exe', '.zip', '.cab', '.png', '.jpg', '.jpeg', '.gif', '.ico', '.woff', '.woff2'])
const forbiddenText = JSON.parse(process.env.DSH_PRIVACY_EXTRA_MARKERS || '[]')
const forbiddenPath = ['.credentials.yaml', '.anonymous-user-id', 'sessions', 'storages', 'attachments', 'cache', 'dsh-runtimes']
const hits = []
async function walk(dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (skipNames.has(entry.name)) continue
    const file = path.join(dir, entry.name)
    const relative = path.relative(root, file).split(path.sep).join('/')
    if (forbiddenPath.some((fragment) => relative.toLowerCase().split('/').some(part => part === fragment || part.startsWith(fragment + '.bak')))) hits.push(relative + ' [forbidden path]')
    if (entry.isDirectory()) await walk(file)
    else if (skipExt.has(path.extname(entry.name).toLowerCase())) continue
    else if (relative === 'tools/privacy-scan.js') continue
    else {
      const text = await fs.readFile(file, 'utf8').catch(() => '')
      if (/[A-Za-z]:[\\/]Users[\\/](?!CHANGE_ME(?:[\\/]|$)|Public(?:[\\/]|$)|Default(?:[\\/]|$))[^\\/\s"'<>]+[\\/]/.test(text)) hits.push(relative + ' [personal user path]')
      if (/(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|sk-[A-Za-z0-9]{32,})/.test(text)) hits.push(relative + ' [credential pattern]')
      for (const needle of forbiddenText) if (text.includes(needle)) hits.push(relative + ' [forbidden text: ' + needle + ']')
    }
  }
}
await walk(root)
if (hits.length) {
  console.error('Privacy scan failed:')
  for (const hit of hits) console.error(' - ' + hit)
  process.exit(1)
}
console.log('Privacy scan passed: no private paths, credentials, session stores, or custom provider markers found.')
