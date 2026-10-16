function failure(code, message, status = 400) {
  return Object.assign(new Error(message), { code, status })
}

function defaultId() {
  return `term_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function active(session) {
  return ['starting', 'running', 'waiting-input'].includes(session.status)
    || (session.status === 'interrupted' && session.exitCode === null)
}

export class SessionManager {
  constructor({ config, backend, now = () => Date.now(), idFactory = defaultId, timeoutGraceMs = 50 }) {
    this.config = config
    this.backend = backend
    this.now = now
    this.idFactory = idFactory
    this.timeoutGraceMs = timeoutGraceMs
    this.sessions = new Map()
    this.listeners = new Set()
    this.disposed = false
  }

  start(input, context = {}) {
    if (this.disposed) throw failure('manager-disposed', 'session manager is disposed', 503)
    if ([...this.sessions.values()].filter(active).length >= this.config.maxSessions) {
      throw failure('max-sessions', 'maximum active sessions reached', 429)
    }
    let terminalId = this.idFactory()
    while (this.sessions.has(terminalId)) terminalId = this.idFactory()
    const session = {
      terminalId,
      provider: input.provider,
      taskId: input.taskId ?? null,
      parentSessionId: context.parentSessionId ?? null,
      cwd: input.cwd,
      status: 'starting',
      pid: null,
      startedAt: this.now(),
      lastOutputAt: null,
      exitCode: null,
      error: null,
      outputBuffer: '',
      handle: null,
      timeoutTimer: null,
      forceTimer: null,
      closing: false,
      timedOut: false,
      pendingExit: null,
      pendingWrites: [],
      pendingInterrupt: false,
      pendingClose: false,
    }
    this.sessions.set(terminalId, session)
    this.emit({ type: 'status', ...this.statusEvent(session) })
    session.launchPromise = this.launch(session, input)
    return this.summary(session)
  }

  async launch(session, input) {
    try {
      const result = await this.backend.start({
        ...input,
        onData: (data) => this.onData(session, data),
        onExit: (event) => this.onExit(session, event),
      })
      if (this.disposed || !this.sessions.has(session.terminalId) || session.closing) {
        await this.backend.close(result.handle).catch(() => {})
        return
      }
      session.handle = result.handle
      session.pid = result.pid ?? null
      if (session.pendingExit) {
        const event = session.pendingExit
        session.pendingExit = null
        this.onExit(session, event)
        return
      }
      session.status = 'running'
      this.emit({ type: 'status', ...this.statusEvent(session) })
      if (input.timeoutMs > 0) {
        session.timeoutTimer = setTimeout(() => void this.timeout(session), input.timeoutMs)
      }
      for (const [data, enter] of session.pendingWrites.splice(0)) {
        if (!active(session)) break
        this.backend.write(session.handle, data)
        if (enter) this.backend.write(session.handle, '\r')
      }
      if (session.pendingInterrupt && active(session)) {
        session.pendingInterrupt = false
        session.status = 'interrupted'
        this.emit({ type: 'status', ...this.statusEvent(session) })
        this.backend.interrupt(session.handle)
      }
      if (session.pendingClose && active(session)) {
        session.pendingClose = false
        await this.close(session.terminalId)
      }
    } catch (error) {
      session.status = 'failed'
      session.exitCode = null
      session.error = String(error?.message ?? error).slice(0, 2000)
      this.emit({ type: 'status', ...this.statusEvent(session) })
    }
  }

  onData(session, data) {
    if (!this.sessions.has(session.terminalId)) return
    const text = String(data)
    session.outputBuffer = (session.outputBuffer + text).slice(-this.config.maxBufferChars)
    session.lastOutputAt = this.now()
    this.emit({ type: 'output', terminalId: session.terminalId, stream: 'stdout', data: text, time: new Date(this.now()).toISOString() })
  }

  onExit(session, event = {}) {
    if (!this.sessions.has(session.terminalId) || session.closing) return
    if (!session.handle) {
      session.pendingExit = event
      return
    }
    if (session.timeoutTimer) clearTimeout(session.timeoutTimer)
    session.timeoutTimer = null
    session.exitCode = Number.isSafeInteger(event.exitCode) ? event.exitCode : null
    session.status = session.timedOut ? 'interrupted' : 'exited'
    this.emit({ type: 'status', ...this.statusEvent(session) })
  }

  statusEvent(session) {
    return {
      ...this.summary(session),
      time: new Date(this.now()).toISOString(),
    }
  }

  summary(session) {
    return {
      terminalId: session.terminalId,
      provider: session.provider,
      taskId: session.taskId,
      parentSessionId: session.parentSessionId,
      pid: session.pid,
      cwd: session.cwd,
      status: session.status,
      startedAt: new Date(session.startedAt).toISOString(),
      lastOutputAt: session.lastOutputAt == null ? null : new Date(session.lastOutputAt).toISOString(),
      exitCode: session.exitCode,
      error: session.error,
      recentOutput: session.outputBuffer.slice(-240),
    }
  }

  get(terminalId) {
    const session = this.require(terminalId)
    return { ...this.summary(session), outputBuffer: session.outputBuffer }
  }

  async started(terminalId) {
    const session = this.require(terminalId)
    await session.launchPromise
    return this.summary(session)
  }

  async read(terminalId, { maxChars = 4000, waitMs = 0 } = {}) {
    if (!Number.isSafeInteger(maxChars) || maxChars < 1 || maxChars > 16000) throw failure('invalid-limit', 'maxChars must be between 1 and 16000')
    if (!Number.isSafeInteger(waitMs) || waitMs < 0 || waitMs > 30000) throw failure('invalid-wait', 'waitMs must be between 0 and 30000')
    const session = this.require(terminalId)
    if (waitMs && active(session) && session.handle && this.backend.isAlive(session.handle)) {
      await new Promise((resolve) => {
        const done = () => { clearTimeout(timer); unsubscribe(); resolve() }
        const unsubscribe = this.subscribe((event) => {
          if (event.terminalId === terminalId && event.type === 'status'
            && (['failed', 'exited'].includes(event.status) || !this.backend.isAlive(session.handle))) done()
        })
        const timer = setTimeout(done, waitMs)
      })
    }
    const text = session.outputBuffer.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
    return { ...this.summary(session), output: text.slice(-maxChars), truncated: text.length > maxChars }
  }

  resize(terminalId, cols, rows) {
    if (!Number.isSafeInteger(cols) || cols < 20 || cols > 500 || !Number.isSafeInteger(rows) || rows < 5 || rows > 200) throw failure('invalid-size', 'terminal size is out of range')
    const session = this.require(terminalId)
    if (session.handle && active(session) && this.backend.isAlive(session.handle)) this.backend.resize(session.handle, cols, rows)
    return this.summary(session)
  }

  list() {
    return [...this.sessions.values()].map((session) => this.summary(session))
  }

  subscribe(listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(event) {
    for (const listener of this.listeners) {
      try { listener(event) } catch { /* subscriber errors must not break sessions */ }
    }
  }

  require(terminalId) {
    const session = this.sessions.get(terminalId)
    if (!session) throw failure('unknown-terminal', 'terminal does not exist', 404)
    return session
  }

  write(terminalId, data, enter = false) {
    const session = this.require(terminalId)
    if (!session.handle || !active(session)) throw failure('terminal-not-running', 'terminal is not running', 409)
    if (session.status === 'starting') {
      session.pendingWrites.push([data, enter])
      return this.summary(session)
    }
    this.backend.write(session.handle, data)
    if (enter) this.backend.write(session.handle, '\r')
    if (session.status === 'waiting-input') {
      session.status = 'running'
      this.emit({ type: 'status', ...this.statusEvent(session) })
    }
    return this.summary(session)
  }

  interrupt(terminalId) {
    const session = this.require(terminalId)
    if (!session.handle || !active(session)) throw failure('terminal-not-running', 'terminal is not running', 409)
    if (session.status === 'starting') {
      session.pendingInterrupt = true
      return this.summary(session)
    }
    this.backend.interrupt(session.handle)
    session.status = 'interrupted'
    this.emit({ type: 'status', ...this.statusEvent(session) })
    return this.summary(session)
  }

  setWaitingInput(terminalId) {
    const session = this.require(terminalId)
    if (session.status === 'running') {
      session.status = 'waiting-input'
      this.emit({ type: 'status', ...this.statusEvent(session) })
    }
  }

  async timeout(session) {
    if (!this.sessions.has(session.terminalId) || !active(session) || !session.handle) return
    session.timedOut = true
    session.status = 'interrupted'
    this.emit({ type: 'status', ...this.statusEvent(session), reason: 'timeout' })
    this.backend.interrupt(session.handle)
    session.forceTimer = setTimeout(() => void this.finishTimeout(session), this.timeoutGraceMs)
  }

  async finishTimeout(session) {
    if (!this.sessions.has(session.terminalId) || !session.handle || !this.backend.isAlive(session.handle)) return
    await this.backend.close(session.handle).catch((error) => {
      session.status = 'failed'
      session.error = String(error?.message ?? error).slice(0, 2000)
      this.emit({ type: 'status', ...this.statusEvent(session) })
    })
    if (session.status !== 'failed') {
      session.status = 'interrupted'
      session.exitCode ??= 130
      this.emit({ type: 'status', ...this.statusEvent(session), reason: 'timeout' })
    }
  }

  async close(terminalId) {
    const session = this.require(terminalId)
    if (session.status === 'starting' && !session.handle) {
      session.pendingClose = true
      return this.summary(session)
    }
    if (!session.handle || !active(session)) return this.summary(session)
    if (session.timeoutTimer) clearTimeout(session.timeoutTimer)
    if (session.forceTimer) clearTimeout(session.forceTimer)
    session.closing = true
    await this.backend.close(session.handle)
    session.status = this.backend.isAlive(session.handle) ? 'failed' : 'interrupted'
    session.exitCode = session.status === 'interrupted' ? 130 : null
    this.emit({ type: 'status', ...this.statusEvent(session) })
    return this.summary(session)
  }

  async dispose() {
    if (this.disposed) return
    this.disposed = true
    await Promise.all([...this.sessions.values()].map((session) => session.launchPromise))
    const pending = [...this.sessions.values()].filter((session) => active(session) && session.handle).map((session) => this.close(session.terminalId).catch(() => {}))
    await Promise.all(pending)
    this.listeners.clear()
  }
}
