function origin(base = document.baseURI) {
  const url = new URL(base)
  url.search = ''
  url.hash = ''
  if (!url.pathname.endsWith('/')) url.pathname += '/'
  return url
}

export function endpoint(path, base = document.baseURI) {
  return new URL('dsh-cli-bridge/' + path.replace(/^\//, ''), origin(base))
}

async function json(response) {
  const data = await response.json()
  if (!response.ok || !data.ok) {
    throw Object.assign(new Error(data.error?.message ?? 'CLI bridge request failed'), { code: data.error?.code })
  }
  return data.value
}

export async function listSessions(fetcher = fetch, base) {
  return json(await fetcher(endpoint('sessions', base), { headers: { accept: 'application/json' } }))
}

export async function command(path, payload = {}, fetcher = fetch, base) {
  return json(await fetcher(endpoint(path, base), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  }))
}

export function eventSource(base = document.baseURI, factory = (url) => new EventSource(url)) {
  return factory(endpoint('events', base))
}