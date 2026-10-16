import { validateSettings } from './config.js'
import { checkStatus } from './status.js'

function authority(value) {
  if (typeof value !== 'string' || !value) return undefined
  try {
    const url = new URL('http://' + value)
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return undefined
    return url
  } catch { return undefined }
}

export function trustedRequest(req, trustedHosts) {
  const host = authority(req.headers.host)
  if (!host) return false
  const parts = host.hostname.split('.')
  const loopback = host.hostname === 'localhost' || host.hostname === '[::1]'
    || (parts.length === 4 && parts[0] === '127' && parts.every((part) => /^[0-9]{1,3}$/.test(part) && Number(part) <= 255))
  const trusted = trustedHosts.some((entry) => {
    const url = authority(entry)
    return url && (entry.includes(':') ? url.host === host.host : url.hostname === host.hostname)
  })
  if (!loopback && !trusted) return false
  if (req.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = req.headers.origin
  if (origin === undefined || origin === 'dsh-app://app') return true
  if (typeof origin !== 'string' || origin === 'null') return false
  try { return new URL(origin).hostname === host.hostname } catch { return false }
}

const failure = (message, status = 400, code = 'bad-request') => Object.assign(new Error(message), { status, code })

async function bodyOf(req) {
  const chunks = []
  let bytes = 0
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk)
    bytes += buffer.length
    if (bytes > 16384) throw failure('请求内容过大', 413, 'too-large')
    chunks.push(buffer)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') }
  catch { throw failure('请求不是有效 JSON') }
}

function writeJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

export function mountSettings(ctx, readCurrent) {
  ctx.inject(['settings', 'webServer', 'webRuntime'], (scope) => {
    const entries = [...ctx.loader.entries()].filter((entry) => entry.options.name === 'dsh-obsidian-memory')
    const entry = entries.find((entry) => entry.fiber === ctx.fiber) ?? entries.find((entry) => !entry.disabled)
    const ns = entry?.options.id
    if (!ns) return
    scope.effect(() => scope.settings.configure({ auto: false }, ctx.fiber))
    const snapshot = () => {
      const row = scope.settings.describe({ redactSecrets: true }).find((row) => row.ns === ns)
      if (!row) throw failure('插件设置尚未就绪，请稍后重新读取', 503, 'unavailable')
      return { value: row.value, revision: row.revision }
    }
    scope.effect(() => scope.webServer.register({
      kind: 'prefix', path: '/obsidian-memory/api',
      handler: async (req, res) => {
        try {
          if (!trustedRequest(req, scope.webRuntime.trustedHosts)) throw failure('拒绝非受信请求', 403, 'forbidden')
          if (req.method !== 'POST') throw failure('只接受 POST 请求', 405, 'method-error')
          if (!(req.headers['content-type'] ?? '').startsWith('application/json')) throw failure('请求必须使用 application/json', 415)
          const method = new URL(req.url, 'http://localhost').pathname.slice('/obsidian-memory/api/'.length)
          if (!['get', 'check', 'save'].includes(method)) throw failure('未知设置操作', 404, 'not-found')
          const payload = await bodyOf(req)
          if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw failure('请求参数必须是对象')
          let value
          if (method === 'get') value = snapshot()
          if (method === 'check') value = await checkStatus(scope.fs, payload)
          if (method === 'save') {
            if (!Number.isSafeInteger(payload.expectedRevision) || payload.expectedRevision < 0) throw failure('保存必须携带有效的配置版本号')
            const next = validateSettings(payload.value)
            const status = await checkStatus(scope.fs, next)
            if (!status.canSave) throw failure(status.vault.error ?? status.memory.error ?? '目录不可用')
            await scope.settings.update(ns, next, payload.expectedRevision)
            readCurrent()
            value = snapshot()
          }
          writeJson(res, 200, { ok: true, value })
        } catch (error) {
          const conflict = error?.code === 'SETTINGS_CONFLICT'
          writeJson(res, conflict ? 409 : error.status ?? 400, {
            ok: false,
            error: { code: conflict ? 'settings-conflict' : error.code ?? 'bad-request',
              message: conflict ? '配置已被其他操作修改，请重新读取后再保存' : String(error?.message ?? error) },
          })
        }
      },
    }))
  })
}
