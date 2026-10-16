import { posix, win32 } from 'node:path'

const hasControl = (value) => [...value].some((char) => char.charCodeAt(0) < 32)
const forward = (value) => value.replaceAll(String.fromCharCode(92), '/')

export function resolvePaths({ vaultPath, memoryRoot }) {
  if (typeof vaultPath !== 'string' || typeof memoryRoot !== 'string') throw new Error('目录必须是文本路径')
  const root = forward(vaultPath.trim())
  const child = forward(memoryRoot.trim())
  const windows = /^[a-z]:[/]/i.test(root) || /^[/]{2}[^/]+[/][^/]+/.test(root)
  const path = windows ? win32 : posix
  if (!path.isAbsolute(root) || (!windows && !root.startsWith('/'))) throw new Error('Obsidian 库必须使用绝对路径')
  if (!child || win32.isAbsolute(child) || posix.isAbsolute(child)) throw new Error('记忆目录必须是库内的相对子目录')
  if (hasControl(child) || /[:*?"<>|]/.test(child) || child.split('/').includes('..')) throw new Error('记忆目录包含非法字符或父级越界')
  if (hasControl(root) || /[*?"<>|]/.test(root) || root.slice(windows && /^[a-z]:/i.test(root) ? 2 : 0).includes(':')) throw new Error('库路径包含非法字符')
  if (windows && [...root.replace(/^[a-z]:[/]/i, '').split('/'), ...child.split('/')]
    .some((part) => part && (/[ .]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(part.split('.')[0])))) {
    throw new Error('目录包含 Windows 不支持的名称')
  }
  const absoluteRoot = path.normalize(root)
  const absoluteMemory = path.resolve(absoluteRoot, child)
  const relative = path.relative(absoluteRoot, absoluteMemory)
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('记忆目录必须位于库根目录之内')
  return { vaultPath: forward(absoluteRoot), memoryPath: forward(absoluteMemory) }
}

async function directoryStatus(fs, path) {
  let exists = false
  let isDirectory = false
  try {
    const target = await fs.resolve(path)
    const info = await fs.stat(target)
    if (!info) return { path, exists: false, isDirectory: false, readable: false, code: 'ENOENT', error: '目录不存在' }
    exists = true
    isDirectory = info.type === 'directory'
    if (!isDirectory) return { path, exists, isDirectory, readable: false, code: 'ENOTDIR', error: '该路径不是目录' }
    await fs.listDir(target)
    return { path, exists, isDirectory, readable: true, code: null, error: null }
  } catch (error) {
    return { path, exists, isDirectory, readable: false, code: error?.code ?? 'FS_ERROR', error: String(error?.message ?? error) }
  }
}

export async function checkStatus(fs, config) {
  const { vaultPath, memoryPath } = resolvePaths(config)
  const vault = await directoryStatus(fs, vaultPath)
  const memory = await directoryStatus(fs, memoryPath)
  return { vault, memory, canSave: vault.readable && (memory.readable || memory.code === 'ENOENT') }
}
