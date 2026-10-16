import { createElement as h, useEffect, useRef, useState } from 'react'
import { IconChevronDownOutlineRegular, IconChevronUpOutlineRegular, IconCloseOutlineRegular, IconStopFillRegular, IconSendOutlineRegular, IconCodeOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { Terminal } from '@xterm/xterm'
import { command, eventSource, listSessions } from './api.js'
import { isSessionActive, updateSessions } from './state.js'

export const inject = ['slots']

function safe(value) {
  return value == null ? '' : String(value)
}

function TerminalCard({ session, collapsed, onToggle, onClose, onInterrupt, onInput, onReady }) {
  const terminalNode = useRef(null)
  const [draft, setDraft] = useState('')
  const alive = useRef(false)
  alive.current = session.status !== 'starting' && isSessionActive(session)

  useEffect(() => {
    if (!terminalNode.current) return undefined
    const instance = new Terminal({
      convertEol: true,
      scrollback: 2500,
      cursorBlink: true,
      fontSize: 12,
      cols: 80,
      rows: 14,
      theme: { background: '#151719', foreground: '#e8eaed', cursor: '#78a9ff' },
    })
    instance.open(terminalNode.current)
    const keyboard = instance.onData((data) => {
      if (alive.current) void onInput(session.terminalId, data, false)
    })
    const fit = () => {
      const node = terminalNode.current
      if (!node || !node.clientWidth || !node.clientHeight) return
      const screen = node.querySelector('.xterm-screen')
      const charWidth = screen?.clientWidth / instance.cols || 8
      const charHeight = screen?.clientHeight / instance.rows || 16
      const cols = Math.max(20, Math.min(500, Math.floor((node.clientWidth - 16) / charWidth)))
      const rows = Math.max(5, Math.min(200, Math.floor(node.clientHeight / charHeight)))
      instance.resize(cols, rows)
      if (alive.current) void command('resize', { terminalId: session.terminalId, cols, rows }).catch(() => {})
    }
    const observer = new ResizeObserver(fit)
    observer.observe(terminalNode.current)
    fit()
    if (session.recentOutput) instance.write(session.recentOutput)
    onReady(session.terminalId, instance)
    return () => {
      onReady(session.terminalId, null)
      observer.disconnect()
      keyboard.dispose()
      instance.dispose()
    }
  }, [session.terminalId])

  async function submit(enter = false) {
    if (!draft && !enter) return
    await onInput(session.terminalId, draft, enter)
    setDraft('')
  }

  return h('section', { className: 'dcb-card' },
    h('header', { className: 'dcb-card-head' },
      h('div', { className: 'dcb-card-title' },
        h('strong', null, safe(session.provider)),
        h('span', { className: 'dcb-status' }, safe(session.status)),
        session.taskId && h('span', { className: 'dcb-task' }, safe(session.taskId)),
      ),
      h('div', { className: 'dcb-card-actions' },
        h('button', { type: 'button', className: 'dcb-icon', onClick: onToggle, title: collapsed ? '展开终端' : '收起终端', 'aria-label': collapsed ? '展开终端' : '收起终端', 'aria-expanded': !collapsed }, h(collapsed ? IconChevronDownOutlineRegular : IconChevronUpOutlineRegular)),
        h('button', { type: 'button', className: 'dcb-icon', onClick: () => onInterrupt(session.terminalId), title: '中断 (Ctrl+C)', 'aria-label': '中断终端', disabled: !alive.current }, h(IconStopFillRegular)),
        h('button', { type: 'button', className: 'dcb-icon', onClick: () => onClose(session.terminalId), title: '关闭进程', 'aria-label': '关闭进程', disabled: !isSessionActive(session) }, h(IconCloseOutlineRegular)),
      ),
    ),
    session.error && h('div', { className: 'dcb-error', role: 'alert' }, safe(session.error)),
    h('div', { className: 'dcb-terminal-wrap', hidden: collapsed }, h('div', { className: 'dcb-terminal', ref: terminalNode })),
    !collapsed && h('form', { className: 'dcb-input', onSubmit: (event) => { event.preventDefault(); void submit(true) } },
      h('input', { value: draft, onChange: (event) => setDraft(event.target.value), placeholder: '输入到终端', 'aria-label': '终端输入', disabled: !alive.current }),
      h('button', { type: 'submit', className: 'dcb-icon', title: '发送', 'aria-label': '发送', disabled: !alive.current }, h(IconSendOutlineRegular)),
    ),
  )
}

export function CliBridgePanel() {
  const [sessions, setSessions] = useState([])
  const [collapsed, setCollapsed] = useState(() => new Set())
  const [panelCollapsed, setPanelCollapsed] = useState(true)
  const [error, setError] = useState('')
  const terminals = useRef(new Map())
  const pending = useRef(new Map())
  const mounted = useRef(true)

  function ready(id, instance) {
    if (instance) {
      terminals.current.set(id, instance)
      const queued = pending.current.get(id)
      if (queued) { instance.write(queued); pending.current.delete(id) }
    } else terminals.current.delete(id)
  }

  useEffect(() => {
    mounted.current = true
    let source
    void listSessions().then((value) => {
      if (mounted.current) setSessions(value)
    }).catch((error) => setError(error.message))
    try {
      source = eventSource()
      source.addEventListener('snapshot', (event) => {
        const value = JSON.parse(event.data)
        if (mounted.current) setSessions(value)
      })
      source.addEventListener('output', (event) => {
        const value = JSON.parse(event.data)
        const text = safe(value.data)
        const card = terminals.current.get(value.terminalId)
        if (card) card.write(text)
        else pending.current.set(value.terminalId, ((pending.current.get(value.terminalId) ?? '') + text).slice(-200000))
        setSessions((current) => updateSessions(current, { ...value, type: 'output' }))
      })
      source.addEventListener('status', (event) => {
        const value = JSON.parse(event.data)
        setSessions((current) => updateSessions(current, { ...value, type: 'status' }))
      })
    } catch {}
    return () => {
      mounted.current = false
      source?.close()
      terminals.current.clear()
    }
  }, [])

  function toggle(id) {
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  async function perform(operation, args) {
    try { setError(''); return await command(operation, args) }
    catch (error) { setError(error.message); return null }
  }
  async function input(id, data, enter) { await perform('input', { terminalId: id, data, enter }) }
  async function interrupt(id) { await perform('interrupt', { terminalId: id }) }
  async function close(id) {
    const result = await perform('close', { terminalId: id })
    if (result) setSessions((current) => updateSessions(current, result))
  }

  return h('div', { className: 'dcb-panel', 'aria-label': 'CLI 终端' },
    h('button', { type: 'button', className: 'dcb-panel-head', onClick: () => setPanelCollapsed((value) => !value), 'aria-expanded': !panelCollapsed, title: panelCollapsed ? '展开 CLI 终端' : '收起 CLI 终端' },
      h(IconCodeOutlineRegular), h('strong', null, 'CLI 终端'), h('span', { className: 'dcb-count' }, String(sessions.length) + ' 个会话'), h(panelCollapsed ? IconChevronDownOutlineRegular : IconChevronUpOutlineRegular)),
    h('div', { className: 'dcb-panel-body', hidden: panelCollapsed },
    error && h('div', { className: 'dcb-error', role: 'alert' }, error),
    sessions.length === 0 ? h('div', { className: 'dcb-empty' }, '暂无运行中的 Claude 或 Codex 任务') : sessions.map((session) => h('div', { key: session.terminalId, 'data-terminal-id': session.terminalId }, h(TerminalCard, {
      session,
      collapsed: collapsed.has(session.terminalId),
      onToggle: () => toggle(session.terminalId),
      onClose: close,
      onInterrupt: interrupt,
      onInput: input,
      onReady: ready,
    })))),
  )
}

export function apply(ctx) {
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock', id: 'dsh-cli-bridge', order: 40,
    label: () => 'CLI 终端', inject: () => ({}),
  }, CliBridgePanel))
}
