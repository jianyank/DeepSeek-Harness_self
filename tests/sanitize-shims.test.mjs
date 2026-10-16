import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { sanitizeShims } from '../tools/sanitize-shims.mjs'

test('removes build-path comments from nested pnpm shims and preserves executable code', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-shim-test-'))
  t.after(async () => {
    if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('dsh-shim-test-')) throw new Error('Invalid cleanup target')
    await fs.rm(root, { recursive: true, force: true })
  })
  const bin = path.join(root, 'nested/node_modules/.bin')
  await fs.mkdir(bin, { recursive: true })
  const code = '#!/bin/sh\nexec node "$basedir/../yaml/bin.mjs" "$@"\n'
  await fs.writeFile(path.join(bin, 'yaml'), code + '# cmd-shim-target=C:/build-machine/profile/node_modules/yaml/bin.mjs\n')
  await fs.writeFile(path.join(bin, 'yaml.cmd'), '@node "%~dp0../yaml/bin.mjs" %*')
  assert.equal(await sanitizeShims(root), 1)
  assert.equal(await fs.readFile(path.join(bin, 'yaml'), 'utf8'), code)
  assert.equal(await fs.readFile(path.join(bin, 'yaml.cmd'), 'utf8'), '@node "%~dp0../yaml/bin.mjs" %*')
  assert.equal(await sanitizeShims(root), 0)
})
