export function patchWorkspaceMenu(source) {
  if (source.includes('id: "project-folders.manage"')) return source;
  const anchor = 'const workspaceMenuItems = [{';
  const replacement = 'const workspaceMenuItems = [...(globalThis.__DSH_PROJECT_FOLDERS__ && row.workspaceId !== void 0 ? [{ id: "project-folders.manage", label: "管理文件夹", icon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconEditOutlineRegular, {}) }] : []), {';
  const action = 'if (id !== "rename" && id !== "delete") return;';
  const newAction = 'if (id === "project-folders.manage") { window.dispatchEvent(new CustomEvent("dsh:manage-project-folders", { detail: { id: row.workspaceId } })); return; }\n\t\t\t\t\t\t\t\t' + action;
  if (source.split(anchor).length !== 2 || source.split(action).length !== 2) throw new Error('原生项目菜单版本不匹配，拒绝修改');
  return source.replace(anchor, replacement).replace(action, newAction);
}
