import { build } from 'esbuild'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const result = await build({
  absWorkingDir: root, entryPoints: ['client/index.js'],
  bundle: true, write: false, platform: 'browser', format: 'cjs',
  external: ['react', '@deepseek-ai/dsh-client-ui-primitives'],
})
const css = await readFile(new URL('../client/settings.css', import.meta.url), 'utf8')
const source = [
  'window.__ModuleLoader__.load({ id: "dsh-obsidian-memory", factory: (require) => {',
  'const module = { exports: {} }; const exports = module.exports;',
  'const style = document.createElement("style"); style.dataset.obsidianMemory = "true";',
  'style.textContent = ' + JSON.stringify(css) + '; document.head.append(style);',
  result.outputFiles[0].text, 'return module.exports;', '} });', '',
].join(String.fromCharCode(10))
await mkdir(new URL('../dist/', import.meta.url), { recursive: true })
await writeFile(new URL('../dist/client.js', import.meta.url), source)
