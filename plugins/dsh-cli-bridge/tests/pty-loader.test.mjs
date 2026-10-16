import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'

const { getBundledPtyCandidates, loadPty } = await import('../lib/pty-loader.js')

const bundledModule = { spawn() {} }

test('prefers the plugin dependency before bundled DSH paths', async () => {
  const calls = []
  const pluginModule = { spawn() {}, source: 'plugin' }
  const loaded = await loadPty({
    importModule: async (specifier) => {
      calls.push(['import', specifier])
      return pluginModule
    },
    requireModule: (specifier) => {
      calls.push(['require', specifier])
      return bundledModule
    },
    isElectron: true,
    resourcesPath: 'D:/DSH/resources',
  })

  assert.equal(loaded, pluginModule)
  assert.deepEqual(calls, [['import', 'node-pty']])
})

test('loads DSH bundled node-pty when the plugin dependency is unavailable', async () => {
  const calls = []
  const loaded = await loadPty({
    importModule: async (specifier) => {
      calls.push(['import', specifier])
      throw new Error('module not found')
    },
    requireModule: (specifier) => {
      calls.push(['require', specifier])
      if (specifier.endsWith(path.join('app.asar', 'dsh', 'node_modules', 'node-pty'))) return bundledModule
      throw new Error('missing candidate')
    },
    isElectron: true,
    resourcesPath: 'D:/DSH/resources',
  })

  assert.equal(loaded, bundledModule)
  assert.deepEqual(calls, [
    ['import', 'node-pty'],
    ['require', path.join('D:/DSH/resources', 'app.asar', 'dsh', 'node_modules', 'node-pty')],
  ])
})

test('does not probe bundled paths outside Electron', async () => {
  const calls = []
  await assert.rejects(
    () => loadPty({
      importModule: async () => { throw new Error('module not found') },
      requireModule: (specifier) => {
        calls.push(specifier)
        throw new Error('should not be called')
      },
      isElectron: false,
      resourcesPath: 'D:/user-controlled/resources',
      execPath: 'D:/user-controlled/app.exe',
    }),
    (error) => error.code === 'pty-unavailable' && error.status === 503,
  )
  assert.deepEqual(calls, [])
})

test('bundled candidates are fixed runtime paths and ignore prompt-like input', () => {
  const candidates = getBundledPtyCandidates({
    isElectron: true,
    resourcesPath: 'D:/DSH/resources',
    execPath: 'D:/DSH/DeepSeek Harness.exe',
    prompt: 'D:/attacker/node_modules/node-pty',
  })

  assert.deepEqual(candidates, [
    path.join('D:/DSH/resources', 'app.asar', 'dsh', 'node_modules', 'node-pty'),
    path.join('D:/DSH/resources', 'app.asar.unpacked', 'dsh', 'node_modules', 'node-pty'),
  ])
})
