import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

export function getBundledPtyCandidates({ isElectron, resourcesPath, execPath }) {
  if (!isElectron) return []

  const resourceDirs = []
  if (resourcesPath) resourceDirs.push(resourcesPath)
  if (execPath) resourceDirs.push(path.join(path.dirname(execPath), 'resources'))

  return [...new Set(resourceDirs.map((resources) => path.resolve(resources)))].flatMap((resources) => [
    path.join(resources, 'app.asar', 'dsh', 'node_modules', 'node-pty'),
    path.join(resources, 'app.asar.unpacked', 'dsh', 'node_modules', 'node-pty'),
  ])
}

function unavailable(errors) {
  const attempts = errors.map(({ path: candidate }) => candidate ? ` ${candidate}` : ' node-pty').join(';')
  const cause = errors.at(-1)?.error
  return Object.assign(
    new Error(`node-pty is unavailable; tried:${attempts}${cause ? ` (${cause.message})` : ''}`),
    { code: 'pty-unavailable', status: 503, cause },
  )
}

export async function loadPty(runtime = {}) {
  const importModule = runtime.importModule ?? ((specifier) => import(specifier))
  const requireModule = runtime.requireModule ?? require
  const isElectron = runtime.isElectron ?? Boolean(process.versions.electron)
  const resourcesPath = runtime.resourcesPath ?? process.resourcesPath
  const execPath = runtime.execPath ?? process.execPath
  const errors = []

  try {
    return await importModule('node-pty')
  } catch (error) {
    errors.push({ error })
  }

  for (const candidate of getBundledPtyCandidates({ isElectron, resourcesPath, execPath })) {
    try {
      return requireModule(candidate)
    } catch (error) {
      errors.push({ path: candidate, error })
    }
  }

  throw unavailable(errors)
}
