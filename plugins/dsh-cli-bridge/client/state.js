export function isSessionActive(session) {
  return ['starting', 'running', 'waiting-input'].includes(session.status)
    || (session.status === 'interrupted' && session.exitCode === null)
}

export function updateSessions(current, event) {
  const index = current.findIndex((item) => item.terminalId === event.terminalId)
  if (event.type === 'output') return current.map((item) => item.terminalId === event.terminalId
    ? { ...item, recentOutput: ((item.recentOutput ?? '') + String(event.data ?? '')).slice(-240) } : item)
  if (index < 0) return [...current, event]
  return current.map((item, i) => i === index ? { ...item, ...event } : item)
}
