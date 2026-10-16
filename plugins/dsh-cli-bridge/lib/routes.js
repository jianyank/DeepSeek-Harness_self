const PREFIX = '/dsh-cli-bridge'
const MAX_BODY_BYTES = 16 * 1024

function failure(code, message, status = 400) {
  return Object.assign(new Error(message), { code, status })
}

function authority(value) {
  if (typeof value !== 'string' || !value) return undefined
  try {
    const url = new URL('http://' + value)
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return undefined
    return url
  } catch { return undefined }
}

export function trustedRequest(req, trustedHosts = []) {
  const host = authority(req.headers?.host)
  if (!host) return false
  const parts = host.hostname.split('.')
  const loopback = host.hostname === 'localhost' || host.hostname === '[::1]'
    || (parts.length === 4 && parts[0] === '127' && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255))
  const trusted = trustedHosts.some((entry) => {
    const url = authority(entry)
    return url && (String(entry).includes(':') ? url.host === host.host : url.hostname === host.hostname)
  })
  if (!loopback && !trusted) return false
  if (req.headers?.['sec-fetch-site'] === 'cross-site') return false
  const origin = req.headers?.origin
  if (origin === undefined || origin === 'dsh-app://app') return true
  if (typeof origin !== 'string' || origin === 'null') return false
  try { return new URL(origin).hostname === host.hostname } catch { return false }
}

async function bodyOf(req) {
  const chunks = []
  let bytes = 0
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk)
    bytes += buffer.length
    if (bytes > MAX_BODY_BYTES) throw failure('too-large', 'request body is too large', 413)
    chunks.push(buffer)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') }
  catch { throw failure('bad-json', 'request body must be valid JSON') }
}

function writeJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

function sendEvent(res, event, value) {
  res.write('event: ' + event + '\ndata: ' + JSON.stringify(value) + '\n\n')
}

function requestPath(req) {
  return new URL(req.url, 'http://localhost').pathname.slice(PREFIX.length) || '/'
}

function closeSubscription(req, unsubscribe) {
  req.once?.('close', unsubscribe)
  req.once?.('aborted', unsubscribe)
}

async function handle(manager, req, res, trustedHosts) {
  if (!trustedRequest(req, trustedHosts)) throw failure('forbidden', 'request is not trusted', 403)
  const path = requestPath(req)
  if (path === '/events') {
    if (req.method !== 'GET') throw failure('method-error', 'only GET is allowed', 405)
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-store',
      connection: 'keep-alive',
    })
    sendEvent(res, 'snapshot', manager.list())
    const unsubscribe = manager.subscribe((event) => sendEvent(res, event.type, event))
    closeSubscription(req, unsubscribe)
    return
  }
  if (path === '/sessions') {
    if (req.method !== 'GET') throw failure('method-error', 'only GET is allowed', 405)
    writeJson(res, 200, { ok: true, value: manager.list() })
    return
  }
  const operation = { '/input': 'input', '/interrupt': 'interrupt', '/close': 'close', '/resize': 'resize' }[path]
  if (!operation) throw failure('not-found', 'route not found', 404)
  if (req.method !== 'POST') throw failure('method-error', 'only POST is allowed', 405)
  if (!(req.headers?.['content-type'] ?? '').startsWith('application/json')) {
    throw failure('content-type', 'request must use application/json', 415)
  }
  const payload = await bodyOf(req)
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw failure('bad-request', 'request body must be an object')
  let value
  if (operation === 'input') value = manager.write(payload.terminalId, payload.data, payload.enter)
  if (operation === 'interrupt') value = manager.interrupt(payload.terminalId)
  if (operation === 'close') value = await manager.close(payload.terminalId)
  if (operation === 'resize') value = manager.resize(payload.terminalId, payload.cols, payload.rows)
  writeJson(res, 200, { ok: true, value })
}

export function mountRoutes(ctx, manager) {
  const mount = (scope) => scope.effect(() => scope.webServer.register({
    kind: 'prefix',
    path: PREFIX,
    handler: async (req, res) => {
      try {
        await handle(manager, req, res, scope.webRuntime?.trustedHosts ?? [])
      } catch (error) {
        writeJson(res, error.status ?? 400, {
          ok: false,
          error: { code: error.code ?? 'bad-request', message: String(error.message ?? error) },
        })
      }
    },
  }))
  if (typeof ctx.inject === 'function') return ctx.inject(['webServer', 'webRuntime'], mount)
  return mount(ctx)
}
