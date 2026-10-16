import test from 'node:test'
import assert from 'node:assert/strict'
import { harness, note, deferred } from './support/harness.mjs'

test('changing vault immediately hides old cards and rebuilds search in the new vault', async () => {
  const app = harness({ initial: [note('preference', 'old', 'Old vault preference')] })
  await app.call('memory_list', {})
  assert.ok(app.card().includes('old'))
  const [path, text] = note('preference', 'new', 'New vault preference')
  app.files.set('D:/new-vault/Memory/' + path, text)
  app.settings.vaultPath = 'D:/new-vault'
  assert.ok(!app.card().includes('old'))
  assert.deepEqual((await app.call('memory_list', {})).entries.map((entry) => entry.id), ['preference/new'])
})

test('volatile config updates apply to prompt budget and project writes', async () => {
  const { Config } = await import('../lib/config.js')
  const { updateVolatile } = await import('@deepseek-ai/cosmokit')
  const values = Config({ vaultPath: 'D:/test-vault' })
  const app = harness({ config: values, initial: [note('preference', 'old', 'Preference')] })
  await app.call('memory_list', {})
  assert.ok(app.card())
  const next = Config({ vaultPath: 'D:/test-vault', injectBudgetChars: 0, project: 'changed' })
  for (const key of Object.keys(values)) updateVolatile(values[key], next[key])
  assert.equal(app.card(), '')
  await app.call('memory_write', { type: 'lesson', title: 'new', body: 'Body' })
  assert.equal((await app.call('memory_read', { id: 'lesson/new' })).project, 'changed')
})

test('an in-flight write keeps its vault and write policy when configuration switches', async () => {
  const gate = deferred()
  const started = deferred()
  const app = harness({ beforeWrite: async (path) => {
    if (path.endsWith('/snapshot.md')) { started.resolve(); await gate.promise }
  } })
  const writing = app.call('memory_write', { type: 'lesson', title: 'snapshot', body: 'Body' })
  await started.promise
  app.settings.vaultPath = 'D:/new-vault'
  app.settings.project = 'new-project'
  gate.resolve()
  await writing
  assert.ok(app.files.has('D:/test-vault/Memory/lessons/snapshot.md'))
  assert.ok(app.files.has('D:/test-vault/Memory/_index.md'))
  assert.ok(!app.files.has('D:/new-vault/Memory/_index.md'))
  assert.ok(app.policies.every((policy) => policy.workspaceRoot.replaceAll(String.fromCharCode(92), '/') === 'D:/test-vault'))
  assert.equal((await app.call('memory_list', {})).entries.length, 0)
})
