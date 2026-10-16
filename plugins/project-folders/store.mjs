import { readFile, writeFile, mkdir, rename, rm, realpath, stat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const key = value => process.platform === 'win32' ? path.normalize(value).toLowerCase() : path.normalize(value);
function absolute(value) {
  return typeof value === 'string' && value.length > 0 && path.isAbsolute(value)
    && (process.platform !== 'win32' || /^(?:[a-z]:[\\/]|[\\/]{2}[^\\/]+[\\/][^\\/]+)/i.test(value));
}
export class FolderStore {
  constructor(file, registry) { this.file = file; this.registry = registry; this.tail = Promise.resolve(); }
  workspace(id) {
    if (typeof id !== 'string') throw new Error('请选择项目');
    const workspace = this.registry.get(id);
    if (!workspace) throw new Error('项目已不存在，请刷新项目列表');
    return workspace;
  }
  async read() {
    let text;
    try { text = await readFile(this.file, 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return { version: 1, folders: {} }; throw error; }
    const data = JSON.parse(text);
    if (data?.version !== 1 || !data.folders || typeof data.folders !== 'object' || Array.isArray(data.folders)
      || Object.values(data.folders).some(items => !Array.isArray(items) || items.some(p => !absolute(p)))) {
      throw new Error('项目文件夹配置格式错误，未进行覆盖');
    }
    return data;
  }
  paths(data, workspace) {
    return Object.hasOwn(data.folders, workspace.id) ? [...data.folders[workspace.id]] : [workspace.path];
  }
  async list(id) {
    await this.tail;
    const workspace = this.workspace(id);
    return { id, title: workspace.title, cwd: workspace.path, sessionIds: [...workspace.sessionIds], folders: this.paths(await this.read(), workspace) };
  }
  mutate(id, callback) {
    const operation = this.tail.then(async () => {
      const workspace = this.workspace(id);
      const data = await this.read();
      const folders = await callback(this.paths(data, workspace));
      this.workspace(id);
      data.folders[id] = folders;
      await mkdir(path.dirname(this.file), { recursive: true });
      const temp = this.file + '.' + randomUUID() + '.tmp';
      try {
        await writeFile(temp, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
        await rename(temp, this.file);
        this.snapshot = data;
      } finally { await rm(temp, { force: true }); }
      return { id, title: workspace.title, cwd: workspace.path, sessionIds: [...workspace.sessionIds], folders };
    });
    this.tail = operation.then(() => {}, () => {});
    return operation;
  }
  add(id, value) {
    return this.mutate(id, async folders => {
      if (!absolute(value)) throw new Error('请输入完整的绝对文件夹路径');
      let canonical;
      try {
        canonical = await realpath(value);
        if (!(await stat(canonical)).isDirectory()) throw new Error('not-directory');
      } catch { throw new Error('文件夹不存在、不可访问，或所选路径不是文件夹'); }
      if (folders.some(p => key(p) === key(canonical))) throw new Error('该文件夹已经在项目中');
      return [...folders, canonical];
    });
  }
  remove(id, value) {
    return this.mutate(id, folders => {
      if (typeof value !== 'string' || !folders.some(p => key(p) === key(value))) throw new Error('该文件夹已不在项目中，请刷新');
      return folders.filter(p => key(p) !== key(value));
    });
  }
  async browse(id, root, directory = root) {
    const workspace = await this.list(id);
    if (typeof root !== 'string' || !workspace.folders.some(p => key(p) === key(root))) throw new Error('文件夹未关联到当前项目');
    if (!absolute(directory)) throw new Error('无效目录');
    const canonicalRoot = await realpath(root);
    const target = await realpath(directory);
    const relative = path.relative(canonicalRoot, target);
    if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('不能访问关联文件夹之外的目录');
    const entries = await readdir(target, { withFileTypes: true });
    const items = entries.map(entry => ({ name: entry.name, path: path.join(target, entry.name), isDir: entry.isDirectory(), isSymlink: entry.isSymbolicLink() }));
    items.sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name));
    return { path: target, parent: relative === '' ? null : path.dirname(target), entries: items };
  }
}
