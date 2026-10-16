import fs from 'node:fs/promises'
import path from 'node:path'

// pnpm's POSIX shims record absolute build paths in a non-executable comment.
export async function sanitizeShims(root) {
  let cleaned = 0
  async function walk(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name)
      if (entry.isDirectory()) await walk(file)
      else if (path.basename(dir) === '.bin' && !path.extname(entry.name)) {
        const before = await fs.readFile(file, 'utf8')
        const after = before.replace(/^# cmd-shim-target=.*(?:\r?\n|$)/gm, '')
        if (before !== after) { await fs.writeFile(file, after); cleaned++ }
      }
    }
  }
  await walk(root)
  return cleaned
}
