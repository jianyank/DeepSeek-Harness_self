import { FolderStore } from './store.mjs';

export const inject = ['workspaceRegistry', 'webServer', 'webRuntime'];
export function trusted(req, trustedHosts = []) {
  const host = req.headers.host;
  if (typeof host !== 'string') return false;
  let url;
  try { url = new URL('http://' + host); } catch { return false; }
  const hostname = url.hostname;
  const loopback = hostname === 'localhost' || hostname === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(hostname);
  if (!loopback && !trustedHosts.some(value => {
    try { const allowed = new URL('http://' + value); return allowed.port ? allowed.host === url.host : allowed.hostname === hostname; }
    catch { return false; }
  })) return false;
  if (req.headers['sec-fetch-site'] === 'cross-site') return false;
  const origin = req.headers.origin;
  if (origin === undefined || origin === 'dsh-app://app') return true;
  try { return new URL(origin).hostname === hostname; } catch { return false; }
}
function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(data));
}
export function createHandler(store, runtime) {
  return async (req, res) => {
    if (!trusted(req, runtime.trustedHosts)) return json(res, 403, { error: '请求来源不受信任' });
    if (req.method !== 'POST') return json(res, 405, { error: '仅支持 POST' });
    try {
      let body = ''; let size = 0;
      for await (const chunk of req) {
        size += Buffer.byteLength(chunk);
        if (size > 16384) return json(res, 413, { error: '请求内容过大' });
        body += chunk;
      }
      const input = JSON.parse(body || '{}');
      const method = new URL(req.url, 'http://dsh.internal').pathname.slice('/project-folders/api/'.length);
      let result;
      if (method === 'projects') result = store.registry.list().map(w => ({ id: w.id, title: w.title, cwd: w.path, sessionIds: [...w.sessionIds] }));
      else if (method === 'list') result = await store.list(input.id);
      else if (method === 'add') result = await store.add(input.id, input.path);
      else if (method === 'remove') result = await store.remove(input.id, input.path);
      else if (method === 'browse') result = await store.browse(input.id, input.root, input.path);
      else return json(res, 404, { error: '未知项目文件夹操作' });
      json(res, 200, result);
    } catch (error) { json(res, 400, { error: error.message }); }
  };
}
export async function apply(ctx, config) {
  if (typeof config?.storagePath !== 'string') throw new Error('缺少项目文件夹配置路径');
  const store = new FolderStore(config.storagePath, ctx.workspaceRegistry);
  store.snapshot = await store.read();
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/project-folders/api', handler: createHandler(store, ctx.webRuntime) }));
  ctx.inject(['systemPrompt'], child => {
    child.systemPrompt.context({ name: 'project-folders', order: 180, text: context => {
      const sessionId = context.agent?.session?.id;
      if (!sessionId) return '';
      const workspace = ctx.workspaceRegistry.list().find(w => w.sessionIds.includes(sessionId));
      if (!workspace) return '';
      try {
        const view = { cwd: workspace.path, folders: store.paths(store.snapshot, workspace) };
        // An unedited project retains the existing prompt exactly.
        if (view.folders.length === 1 && view.folders[0] === view.cwd) return '';
        return '<project_folders>\n' + JSON.stringify({ folders: view.folders, sessionCwd: view.cwd })
          + '\nThese are the user-selected project folders. Resolve file operations using their absolute paths. The existing session working directory is unchanged. A removed folder must not be treated as a project folder; access outside the list requires the user to explicitly request it.\n</project_folders>';
      } catch { return ''; }
    } });
  });
}
