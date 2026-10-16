import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { createHandler } from '../index.js';
import { FolderStore } from '../store.mjs';

const root = path.resolve(import.meta.dirname, '../../..');
const playwrightPath = process.env.DSH_PLAYWRIGHT;
const reactRoot = process.env.DSH_REACT_ROOT || path.join(root, 'sdk/node_modules');
test('browser: open manager, add/pick/cancel, browse/open, remove, switch projects and reload', { timeout: 60000, skip: !playwrightPath && 'Set DSH_PLAYWRIGHT to enable browser tests' }, async t => {
  const { chromium } = await import(pathToFileURL(playwrightPath));
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-folders-ui-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const primary = path.join(dir, 'original'), extra = path.join(dir, 'added'), picked = path.join(dir, 'picked'), other = path.join(dir, 'other');
  for (const p of [primary, extra, picked, other, path.join(extra, 'child')]) await mkdir(p, { recursive: true });
  await writeFile(path.join(extra, 'safe.txt'), 'test-file'); await writeFile(path.join(primary, 'keep.txt'), 'keep');
  const projects = [{ id: 'a', title: 'Original project', path: primary, sessionIds: ['session-a'] }, { id: 'b', title: 'Other project', path: other, sessionIds: ['session-b'] }];
  const registry = { get: id => projects.find(w => w.id === id), list: () => projects };
  const store = new FolderStore(path.join(dir, 'folders.json'), registry); const handler = createHandler(store, { trustedHosts: [] });
  const html = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>Project folders regression</title></head><body><button id="manage">项目菜单：管理文件夹</button><button id="tab">项目文件夹侧栏</button><div id="root"></div><script src="/react.js"></script><script src="/react-dom.js"></script><script>' +
    'window.opened=[];window.__pick=null;window.__DSH_DIRECTORY_PICKER__={pick:async()=>window.__pick};' +
    'window.__ModuleLoader__={load({factory}){const mod=factory(name=>{if(name==="react")return React;throw new Error(name)});let Dialog;const ctx={betterSidebar:{registerTab(value){window.tabDescriptor=value;return()=>{}},getSnapshot(){return{sessionId:"session-a"}},openFile(scope,file){opened.push({scope,file})}},slots:{inject(name,fn){fn()},register(spec,component){Dialog=component;return()=>{}}},effect(fn){return fn()}};mod.apply(ctx);const root=ReactDOM.createRoot(document.getElementById("root"));window.renderDialog=()=>root.render(React.createElement(Dialog));renderDialog();document.getElementById("tab").onclick=()=>root.render(React.createElement(window.tabDescriptor.component,{scope:{sessionId:"session-a",cwd:' + JSON.stringify(primary) + '}}));}};' +
    'document.getElementById("manage").onclick=()=>{renderDialog();window.dispatchEvent(new CustomEvent("dsh:manage-project-folders",{detail:{id:"a"}}))};' +
    '</script><script src="/client.js"></script></body></html>';
  const assets = { '/react.js': path.join(reactRoot, 'react/umd/react.development.js'), '/react-dom.js': path.join(reactRoot, 'react-dom/umd/react-dom.development.js'), '/client.js': path.resolve(import.meta.dirname, '../client.js') };
  const server = http.createServer(async (req, res) => {
    if (req.url.startsWith('/project-folders/api/')) return handler(req, res);
    if (assets[req.url]) { res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' }); return res.end(await readFile(assets[req.url])); }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const browser = await chromium.launch({ headless: true, executablePath: process.env.DSH_CHROMIUM }); t.after(() => browser.close());
  const page = await browser.newPage(); const errors = []; page.on('pageerror', e => { errors.push(e.message); console.error('Browser exception:', e.message); });
  await page.goto('http://127.0.0.1:' + server.address().port);
  const nativeRoot = process.env.DSH_NATIVE_ROOT || path.join(root, 'sdk/node_modules/@deepseek-ai');
  const theme = await readFile(path.join(nativeRoot, 'dsh-client-ui-theme/lib/client.js'), 'utf8');
  const themeCss = JSON.parse(theme.match(/var design_platform_css_default = (".*");/)[1]);
  await page.addStyleTag({ content: themeCss });
  await page.locator('#manage').click(); await page.getByRole('dialog').waitFor();
  const folders = page.locator('.dpf-folders>li'); await page.waitForFunction(() => document.querySelectorAll('.dpf-folders>li').length === 1);
  await page.getByRole('textbox', { name: '文件夹绝对路径' }).fill(extra); await page.getByRole('button', { name: '添加', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.dpf-folders>li').length === 2);
  await page.getByRole('textbox').fill(extra); await page.getByRole('button', { name: '添加', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '已经' }).waitFor(); assert.equal(await folders.count(), 2);
  await page.getByRole('button', { name: '选择文件夹', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('input').disabled); assert.equal(await folders.count(), 2);
  await page.evaluate(value => { window.__pick = value; }, picked); await page.getByRole('button', { name: '选择文件夹', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.dpf-folders>li').length === 3);
  await folders.filter({ hasText: extra }).getByRole('button', { name: '浏览', exact: true }).click();
  await page.getByRole('button', { name: '· safe.txt', exact: true }).click();
  await page.waitForFunction(() => window.opened.length > 0 || document.querySelector('[role=alert]'));
  assert.deepEqual(await page.evaluate(() => window.opened), [{ scope: { sessionId: 'session-a', cwd: primary }, file: path.join(extra, 'safe.txt') }]);
  await page.getByRole('button', { name: '▸ child', exact: true }).click(); await page.getByText('空文件夹', { exact: true }).waitFor();
  await page.getByRole('button', { name: '上级目录', exact: true }).click(); await page.getByRole('button', { name: '· safe.txt', exact: true }).waitFor();
  const dialog = await page.getByRole('dialog').boundingBox();
  const heading = await page.getByRole('heading', { name: '管理项目文件夹' }).boundingBox();
  assert.ok(heading.y >= dialog.y && heading.y + heading.height <= dialog.y + dialog.height, '标题必须在长内容滚动后仍然可见');
  const colors = () => page.locator('.dpf-dialog').evaluate(el => ({ color: getComputedStyle(el).color, background: getComputedStyle(el).backgroundColor }));
  const light = await colors(); assert.notEqual(light.color, light.background);
  if (process.env.DSH_UI_SCREENSHOT) await page.screenshot({ path: process.env.DSH_UI_SCREENSHOT, fullPage: true });
  await page.evaluate(() => document.body.setAttribute('data-ds-dark-theme', ''));
  const dark = await colors(); assert.notEqual(dark.color, light.color); assert.notEqual(dark.background, light.background);
  if (process.env.DSH_UI_SCREENSHOT) await page.screenshot({ path: process.env.DSH_UI_SCREENSHOT.replace(/\.png$/, '-dark.png'), fullPage: true });
  await page.evaluate(() => document.body.removeAttribute('data-ds-dark-theme'));
  await page.getByRole('button', { name: '移除文件夹 ' + primary, exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.dpf-folders>li').length === 2);
  assert.equal((await stat(path.join(primary, 'keep.txt'))).isFile(), true);
  await page.getByRole('combobox').selectOption('b'); await page.getByText(other, { exact: true }).waitFor(); assert.equal(await folders.count(), 1);
  await page.getByRole('combobox').selectOption('a'); await page.waitForFunction(() => document.querySelectorAll('.dpf-folders>li').length === 2);
  await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'hidden' }); assert.equal(await page.getByRole('dialog').count(), 0);
  assert.equal(await page.locator('#manage').evaluate(el => document.activeElement === el), true);
  await page.reload(); await page.locator('#manage').click(); await page.waitForFunction(() => document.querySelectorAll('.dpf-folders>li').length === 2);
  assert.equal(await folders.filter({ hasText: primary }).count(), 0);
  await page.keyboard.press('Escape'); await page.locator('#tab').click(); await page.getByRole('combobox').waitFor();
  await page.waitForFunction(() => document.querySelectorAll('.dpf-folders>li').length === 2);
  assert.deepEqual((await new FolderStore(store.file, registry).list('a')).folders, [extra, picked]);
  assert.deepEqual(errors, []);
});
