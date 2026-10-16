import { build } from 'esbuild'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const result = await build({
  absWorkingDir: root, entryPoints: ['client/index.js'],
  bundle: true, write: false, platform: 'browser', format: 'cjs',
  external: ['react', '@deepseek-ai/dsh-client-ui-primitives'],
})
const css = await readFile(new URL('../node_modules/@xterm/xterm/css/xterm.css', import.meta.url), 'utf8')
  + '\n' + await readFile(new URL('../client/terminal.css', import.meta.url), 'utf8')
const source = [
  'window.__ModuleLoader__.load({ id: "dsh-cli-bridge", factory: (require) => {',
  'const module = { exports: {} }; const exports = module.exports;',
  'const style = document.createElement("style"); style.dataset.dshCliBridge = "true";',
  'style.textContent = ' + JSON.stringify(css) + '; document.head.append(style);',
  result.outputFiles[0].text, 'return module.exports;', '} });', '',
].join(String.fromCharCode(10))
await mkdir(new URL('../dist/', import.meta.url), { recursive: true })
await writeFile(new URL('../dist/client.js', import.meta.url), source)
