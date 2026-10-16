window.__ModuleLoader__.load({ id: 'dsh-project-folders', factory: require => {
  const React = require('react');
  const { createElement: h, useState, useEffect, useRef, useSyncExternalStore } = React;
  const css = '.dpf{color:var(--dsw-alias-label-primary,#1f2329);font-size:14px;padding:16px;box-sizing:border-box}.dpf *{box-sizing:border-box}.dpf button,.dpf input,.dpf select{font:inherit;color:inherit;border:1px solid var(--dsw-alias-border-l2,#8886);border-radius:6px;background:var(--dsw-alias-bg-base,#fff);padding:7px 10px}.dpf button{cursor:pointer}.dpf button:disabled{opacity:.5;cursor:default}.dpf input,.dpf select{width:100%;min-width:0}.dpf-row{display:flex;align-items:center;gap:8px;margin:10px 0}.dpf-row>input,.dpf-path{flex:1;min-width:0}.dpf-path{overflow-wrap:anywhere}.dpf small{display:block;opacity:.75;line-height:1.5}.dpf-error{color:var(--dsw-alias-status-error,#e45);margin:10px 0;overflow-wrap:anywhere}.dpf-folders{list-style:none;margin:12px 0;padding:0}.dpf-folders>li{padding:10px 0;border-bottom:1px solid #8883}.dpf-backdrop{position:fixed;inset:0;z-index:10000;background:#0007;display:flex;align-items:center;justify-content:center;padding:24px}.dpf-dialog{background:var(--dsw-alias-bg-layer-1,#fff);width:660px;max-width:100%;max-height:85vh;overflow:hidden;display:flex;flex-direction:column;padding:0;border:1px solid #8885;border-radius:12px;box-shadow:0 12px 40px #0005}.dpf-dialog-header{padding:16px;margin:0;flex-shrink:0;border-bottom:1px solid var(--dsw-alias-border-l2,#8886)}.dpf-dialog-body{overflow:auto;min-height:0}.dpf h2{font-size:18px;margin:0;flex:1}.dpf-browser{border:1px solid #8884;border-radius:6px;padding:8px;margin-top:14px;max-height:330px;overflow:auto}.dpf-entry{display:block;width:100%;text-align:left;margin:3px 0;overflow-wrap:anywhere}';
  async function api(method, input = {}) {
    const base = new URL(document.baseURI); base.search = ''; base.hash = '';
    if (!base.pathname.endsWith('/')) base.pathname += '/';
    const response = await fetch(new URL('project-folders/api/' + method, base), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    });
    let result;
    try { result = await response.json(); } catch { throw new Error('项目文件夹服务不可用，请重启应用后重试'); }
    if (!response.ok) throw new Error(result.error || '操作失败');
    return result;
  }
  function FolderManager({ id, service, scope }) {
    const [view, setView] = useState();
    const [input, setInput] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [browser, setBrowser] = useState();
    const [notice, setNotice] = useState('');
    const alive = useRef(true);
    useEffect(() => { alive.current = true; api('list', { id }).then(v => { if (alive.current) setView(v); }, e => { if (alive.current) setError(e.message); }); return () => { alive.current = false; }; }, [id]);
    async function perform(action) {
      if (busy) return;
      setBusy(true); setError(''); setNotice('');
      try { await action(); } catch (e) { if (alive.current) setError(e.message); }
      finally { if (alive.current) setBusy(false); }
    }
    async function add(value) {
      const next = await api('add', { id, path: value });
      if (alive.current) { setView(next); setInput(''); }
    }
    async function pick() {
      if (!globalThis.__DSH_DIRECTORY_PICKER__) throw new Error('当前环境不支持系统选择器，请在输入框中填写绝对路径');
      const selected = await globalThis.__DSH_DIRECTORY_PICKER__.pick();
      if (selected && alive.current) await add(selected);
    }
    async function browse(root, directory = root) {
      const result = await api('browse', { id, root, path: directory });
      if (alive.current) setBrowser({ ...result, root });
    }
    function openFile(file) {
      const current = service.getSnapshot().sessionId;
      const sessionId = view.sessionIds.includes(scope?.sessionId) ? scope.sessionId
        : view.sessionIds.includes(current) ? current : view.sessionIds[0];
      if (!sessionId) { setError('请先为此项目新建会话，再打开文件；文件夹仍可浏览和管理'); return; }
      service.openFile({ sessionId, cwd: view.cwd }, file);
      setNotice('已在此项目会话的文件侧栏打开文件。');
    }
    return h('section', { 'aria-label': '项目文件夹管理' },
      !view && !error && h('p', { role: 'status' }, '正在加载文件夹…'),
      error && h('div', { role: 'alert', className: 'dpf-error' }, error),
      view && h(React.Fragment, null,
        h('strong', null, view.title),
        h('small', null, '添加或移除项目关联文件夹，不会删除磁盘文件。已有会话的工作目录保持不变：' + view.cwd),
        h('div', { className: 'dpf-row' },
          h('input', { 'aria-label': '文件夹绝对路径', placeholder: '填写文件夹绝对路径', value: input, disabled: busy, onChange: e => setInput(e.target.value), onKeyDown: e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing && input.trim()) { e.preventDefault(); void perform(() => add(input.trim())); } } }),
          h('button', { type: 'button', disabled: busy || !input.trim(), onClick: () => perform(() => add(input.trim())) }, '添加'),
          globalThis.__DSH_DIRECTORY_PICKER__ && h('button', { type: 'button', disabled: busy, onClick: () => perform(pick) }, '选择文件夹')),
        h('ul', { className: 'dpf-folders' }, ...view.folders.map(folder => h('li', { key: folder },
          h('div', { className: 'dpf-path', title: folder }, folder),
          h('div', { className: 'dpf-row' },
            h('button', { type: 'button', disabled: busy, onClick: () => perform(() => browse(folder)) }, '浏览'),
            h('button', { type: 'button', disabled: busy, 'aria-label': '移除文件夹 ' + folder, onClick: () => perform(async () => {
              const next = await api('remove', { id, path: folder });
              if (alive.current) { setView(next); if (browser?.root === folder) setBrowser(undefined); }
            }) }, '移除关联'))))),
        view.folders.length === 0 && h('p', null, '尚未关联文件夹，可随时添加。'),
        browser && h('div', { className: 'dpf-browser', 'aria-label': '关联文件夹内容' },
          h('div', { className: 'dpf-path' }, browser.path),
          h('div', { className: 'dpf-row' },
            browser.parent && h('button', { type: 'button', disabled: busy, onClick: () => perform(() => browse(browser.root, browser.parent)) }, '上级目录'),
            h('button', { type: 'button', disabled: busy, onClick: () => perform(() => browse(browser.root, browser.path)) }, '刷新'),
            h('button', { type: 'button', onClick: () => setBrowser(undefined) }, '收起')),
          browser.entries.length === 0 && h('small', null, '空文件夹'),
          ...browser.entries.map(entry => h('button', {
            type: 'button', key: entry.path, className: 'dpf-entry', disabled: busy || entry.isSymlink,
            title: entry.isSymlink ? '链接项请在原文件侧栏中打开' : entry.path,
            onClick: () => entry.isDir ? perform(() => browse(browser.root, entry.path)) : openFile(entry.path),
          }, (entry.isDir ? '▸ ' : '· ') + entry.name + (entry.isSymlink ? '（链接）' : '')))),
        notice && h('p', { role: 'status' }, notice)));
  }
  function ProjectPanel({ service, scope, selectedId }) {
    const [projects, setProjects] = useState([]);
    const [id, setId] = useState(selectedId || '');
    const [error, setError] = useState('');
    useEffect(() => { let live = true; api('projects').then(items => {
      if (!live) return; setProjects(items);
      setId(previous => items.some(w => w.id === previous) ? previous : items.find(w => w.sessionIds.includes(scope?.sessionId))?.id || items[0]?.id || '');
    }, e => { if (live) setError(e.message); }); return () => { live = false; }; }, [scope?.sessionId]);
    return h('div', { className: 'dpf' },
      error && h('p', { role: 'alert', className: 'dpf-error' }, error),
      h('label', null, '项目', h('select', { 'aria-label': '选择要管理的项目', value: id, onChange: e => setId(e.target.value) },
        !projects.length && h('option', { value: '' }, '暂无项目'), ...projects.map(w => h('option', { key: w.id, value: w.id }, w.title)))),
      id && h('div', { style: { marginTop: 14 } }, h(FolderManager, { key: id, id, service, scope })));
  }
  function apply(ctx) {
    const service = ctx.betterSidebar;
    const style = document.createElement('style'); style.dataset.projectFolders = 'true'; style.textContent = css;
    ctx.effect(() => { document.head.appendChild(style); return () => style.remove(); });
    let selected = null; const listeners = new Set();
    function change(value) { selected = value; for (const listener of listeners) listener(); }
    const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener); };
    const snapshot = () => selected;
    function Dialog() {
      const current = useSyncExternalStore(subscribe, snapshot, snapshot);
      const dialog = useRef();
      useEffect(() => {
        if (!current) return;
        const previous = document.activeElement;
        dialog.current?.focus();
        const containFocus = event => { if (dialog.current && !dialog.current.contains(event.target)) dialog.current.focus(); };
        document.addEventListener('keydown', keyboard, true);
        document.addEventListener('focusin', containFocus);
        return () => {
          document.removeEventListener('keydown', keyboard, true);
          document.removeEventListener('focusin', containFocus);
          if (previous?.isConnected) previous.focus();
        };
      }, [current]);
      if (!current) return null;
      function keyboard(e) {
        if (e.isComposing) return;
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); change(null); }
        if (e.key === 'Tab') {
          const nodes = [...dialog.current.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]')];
          const first = nodes[0], last = nodes[nodes.length - 1];
          if (!first) { e.preventDefault(); return; }
          if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { e.preventDefault(); first.focus(); }
        }
      }
      return h('div', { className: 'dpf-backdrop', onClick: e => { if (e.target === e.currentTarget) change(null); } },
        h('div', { className: 'dpf dpf-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dpf-title', tabIndex: -1, ref: dialog },
          h('div', { className: 'dpf-row dpf-dialog-header' }, h('h2', { id: 'dpf-title' }, '管理项目文件夹'), h('button', { type: 'button', onClick: () => change(null), 'aria-label': '关闭项目文件夹管理' }, '关闭')),
          h('div', { className: 'dpf-dialog-body' }, h(ProjectPanel, { key: current.id, selectedId: current.id, service }))));
    }
    ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'project-folders.manager' }, Dialog));
    ctx.effect(() => service.registerTab({ id: 'project-folders', title: '项目文件夹', description: '添加、移除和浏览项目关联的文件夹', order: 75, single: true,
      component: props => h(ProjectPanel, { service, scope: props.scope }) }));
    ctx.effect(() => {
      const listener = event => { if (typeof event.detail?.id === 'string') change(event.detail); };
      window.addEventListener('dsh:manage-project-folders', listener);
      globalThis.__DSH_PROJECT_FOLDERS__ = true;
      return () => { window.removeEventListener('dsh:manage-project-folders', listener); delete globalThis.__DSH_PROJECT_FOLDERS__; };
    });
  }
  return { inject: ['slots', 'betterSidebar'], apply };
} });
