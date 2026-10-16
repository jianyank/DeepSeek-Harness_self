import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { patchWorkspaceMenu } from '../menu-patch.mjs';
const sourcePath = process.env.DSH_WORKSPACE_CLIENT || path.join(process.env.DSH_NATIVE_ROOT || path.resolve(import.meta.dirname, '../../../sdk/node_modules/@deepseek-ai'), 'dsh-client-ui-workspace/lib/client.js');
const source = await readFile(sourcePath, 'utf8');
function menu(source, installed) {
  const start = source.indexOf('function ProjectRowItem('), end = source.indexOf('\n\t\t}', start) + 4;
  const events = [], actions = [];
  const render = Function('react', 'react_jsx_runtime', 'clsx', 'Rows_module_css_default', '_deepseek_ai_dsh_client_ui_primitives', 'window', 'CustomEvent', 'globalThis', 'return (' + source.slice(start, end) + ')');
  const jsx = (type, props) => ({ type, props });
  const component = render({ useState: () => [false, () => {}] }, { jsx, jsxs: jsx }, () => '', {}, new Proxy({}, { get: (_, name) => name }), { dispatchEvent: event => events.push(event) }, class { constructor(type, init) { this.type = type; this.detail = init.detail; } }, { __DSH_PROJECT_FOLDERS__: installed });
  const tree = component({ group: { workspaceId: 'project-a', key: 'a', label: 'Existing', expanded: false }, actions: { rename: () => actions.push('rename'), delete: () => actions.push('delete') }, t: value => value });
  function find(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'Menu') return node;
    for (const child of [node.props?.anchor, ...[node.props?.children].flat()]) { const result = find(child); if (result) return result; }
  }
  return { menu: find(tree), events, actions };
}
test('original bug is reproduced: existing native project menu has no folder edit action', () => {
  assert.deepEqual(menu(source, true).menu.props.items.map(i => i.id), ['rename', 'delete']);
});
test('patched menu adds folder management while preserving rename/delete and invalid-action no-op', () => {
  const updated = patchWorkspaceMenu(source); const result = menu(updated, true);
  assert.deepEqual(result.menu.props.items.map(i => i.id), ['project-folders.manage', 'rename', 'delete']);
  result.menu.props.onSelect('project-folders.manage');
  assert.deepEqual(result.events[0].detail, { id: 'project-a' });
  assert.equal(result.events[0].type, 'dsh:manage-project-folders');
  result.menu.props.onSelect('rename'); result.menu.props.onSelect('delete'); result.menu.props.onSelect('unknown');
  assert.deepEqual(result.actions, ['rename', 'delete']);
  assert.equal(patchWorkspaceMenu(updated), updated);
});
test('unloading the optional plugin restores the exact original project menu', () => {
  assert.deepEqual(menu(patchWorkspaceMenu(source), false).menu.props.items.map(i => i.id), ['rename', 'delete']);
  assert.throws(() => patchWorkspaceMenu('different version'), /拒绝修改/);
});
