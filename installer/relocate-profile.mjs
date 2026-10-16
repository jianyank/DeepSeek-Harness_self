import fs from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve(process.argv[2] ?? process.cwd())
const packageFile = path.join(root, 'package.json')
const workspaceFile = path.join(root, 'pnpm-workspace.yaml')
const packageJson = JSON.parse(await fs.readFile(packageFile, 'utf8'))
for (const [name, value] of Object.entries(packageJson.dependencies ?? {})) {
  if (typeof value !== 'string') continue
  packageJson.dependencies[name] = value
    .replaceAll('file:../../plugins/', 'file:./plugins/')
    .replaceAll('file:../../agent-presets/', 'file:./agent-presets/')
}
await fs.writeFile(packageFile, JSON.stringify(packageJson, null, 2) + '\n')
try {
  const workspace = await fs.readFile(workspaceFile, 'utf8')
  await fs.writeFile(workspaceFile, workspace.replaceAll('../../agent-presets/*', './agent-presets/*').replaceAll('../../plugins/*', './plugins/*'))
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}
console.log('Relocated local package references for the installed profile.')
