import { createElement as h, useEffect, useRef, useState } from 'react'
import {
  Button, Input, Switch, Checkbox,
  IconRefreshOutlineRegular, IconCheckOutlineRegular, IconSearchOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { request } from './api.js'

export const inject = ['slots']

const types = [
  ['preference', '偏好'], ['project-state', '项目状态'], ['decision', '决策'],
  ['lesson', '经验'], ['error-fix', '错误修复'],
  ['open-question', '待解问题'], ['glossary', '术语'],
]
const numbers = [
  ['injectBudgetChars', '卡片字符上限', 0], ['cardRecentCount', '最近条目数', 0],
  ['refreshTtlMs', '缓存有效期（毫秒）', 0], ['searchLimit', '默认检索上限', 1],
]

export function SettingsPanel() {
  const [saved, setSaved] = useState(null)
  const [draft, setDraft] = useState(null)
  const [busy, setBusy] = useState('读取')
  const [message, setMessage] = useState('')
  const [error, setError] = useState(false)
  const [status, setStatus] = useState(null)
  const mounted = useRef(true)
  const dirty = !!saved && JSON.stringify(saved.value) !== JSON.stringify(draft)
  const invalidNumber = draft && numbers.some(([key, , min]) => !Number.isSafeInteger(draft[key]) || draft[key] < min)

  async function run(action, operation) {
    setBusy(action)
    setMessage('')
    setError(false)
    try { await operation() }
    catch (failure) {
      if (mounted.current) {
        setError(true)
        setMessage(failure.code === 'settings-conflict'
          ? '配置已被其他操作修改。草稿仍保留；重新读取后再保存。'
          : String(failure.message ?? failure))
      }
    } finally { if (mounted.current) setBusy('') }
  }

  async function load() {
    const value = await request('get')
    if (!mounted.current) return
    setSaved(value)
    setDraft(value.value)
    setStatus(null)
    setMessage('已读取当前配置')
  }
  useEffect(() => {
    mounted.current = true
    void run('读取', load)
    return () => { mounted.current = false }
  }, [])

  function change(key, value) {
    setDraft((current) => ({ ...current, [key]: value }))
    setStatus(null)
    setMessage('')
    setError(false)
  }
  const row = (key, label, control) => h('div', { className: 'om-row', key },
    h('label', { className: 'om-label', htmlFor: 'om-' + key }, label), control)
  const text = (key, label) => row(key, label, h(Input, {
    id: 'om-' + key, value: draft[key], disabled: !!busy,
    onChange: (event) => change(key, event.target.value),
  }))
  const group = (title, ...children) => h('section', { className: 'om-group' }, h('h3', null, title), ...children)
  const directory = (label, item, uninitialized = false) => h('div', { className: 'om-directory', key: label },
    h('strong', null, label), h('span', { className: 'om-path' }, item.path),
    h('span', { className: item.readable ? 'om-success' : 'om-warning' },
      item.readable ? '可读取' : uninitialized && item.code === 'ENOENT' ? '未初始化' : item.error))

  return h('div', { className: 'om-settings' },
    h('header', { className: 'om-header' }, h('h2', null, 'Obsidian 记忆'),
      h('span', { className: 'om-state' }, busy ? busy + '中…' : dirty ? '未保存' : saved ? '已同步' : '未读取')),
    draft && h('fieldset', { disabled: !!busy, className: 'om-fields' },
      group('存储', text('vaultPath', 'Obsidian 库'), text('memoryRoot', '记忆子目录'), text('project', '项目标识'),
        row('sandboxMode', '写入权限', h('select', { id: 'om-sandboxMode', value: draft.sandboxMode,
          onChange: (event) => change('sandboxMode', event.target.value) },
          h('option', { value: 'workspace-write' }, '仅库内写入'),
          h('option', { value: 'danger-full-access' }, '完全访问（高风险）')))),
      group('提示词与检索', ...numbers.map(([key, label, min]) => row(key, label, h(Input, {
        id: 'om-' + key, type: 'number', min, max: Number.MAX_SAFE_INTEGER, step: 1,
        value: draft[key], 'aria-invalid': !Number.isSafeInteger(draft[key]) || draft[key] < min,
        onChange: (event) => change(key, event.target.value === '' ? '' : Number(event.target.value)),
      }))),
        row('alwaysInjectTypes', '优先注入类型', h('div', { className: 'om-types', id: 'om-alwaysInjectTypes' },
          ...types.map(([type, label]) => h(Checkbox, { key: type, label,
            checked: draft.alwaysInjectTypes.includes(type), disabled: !!busy,
            onChange: (checked) => change('alwaysInjectTypes', checked
              ? [...draft.alwaysInjectTypes, type] : draft.alwaysInjectTypes.filter((value) => value !== type)),
          }))))),
      group('索引', row('rebuildIndexOnWrite', '写入后生成索引文件', h(Switch, {
        label: '写入后生成索引文件', checked: draft.rebuildIndexOnWrite, disabled: !!busy,
        onChange: (value) => change('rebuildIndexOnWrite', value),
      })))),
    status && h('section', { className: 'om-group', 'aria-label': '目录状态' },
      h('h3', null, '目录状态'), directory('Obsidian 库', status.vault), directory('记忆子目录', status.memory, true)),
    h('div', { className: 'om-actions' },
      h(Button, { variant: 'outline', icon: h(IconRefreshOutlineRegular), disabled: !!busy,
        onClick: () => {
          if (!dirty || window.confirm('重新读取将丢弃未保存的草稿，继续吗？')) void run('读取', load)
        } }, '重新读取'),
      h(Button, { variant: 'outline', icon: h(IconSearchOutlineRegular), disabled: !!busy || !draft,
        onClick: () => void run('检查', async () => {
          const next = await request('check', { vaultPath: draft.vaultPath, memoryRoot: draft.memoryRoot })
          if (mounted.current) setStatus(next)
        }) }, '检查目录'),
      h(Button, { variant: 'primary', icon: h(IconCheckOutlineRegular), disabled: !!busy || !dirty || invalidNumber,
        onClick: () => void run('保存', async () => {
          const next = await request('save', { value: draft, expectedRevision: saved.revision })
          if (!mounted.current) return
          setSaved(next)
          setDraft(next.value)
          setMessage('已保存')
        }) }, '保存')),
    h('div', { className: 'om-feedback' + (error ? ' om-warning' : ''), role: error ? 'alert' : 'status' },
      invalidNumber ? '数值必须是有效范围内的整数' : message))
}

export function apply(ctx) {
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'obsidian-memory', order: 110,
    label: () => 'Obsidian 记忆', inject: () => ({}),
  }, SettingsPanel))
}
