export function endpoint(method, base = document.baseURI) {
  const url = new URL(base)
  url.search = ''
  url.hash = ''
  if (!url.pathname.endsWith('/')) url.pathname += '/'
  return new URL('obsidian-memory/api/' + method, url)
}

export async function request(method, payload = {}, fetcher = fetch, base) {
  const response = await fetcher(endpoint(method, base), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await response.json()
  if (!response.ok || !data.ok) {
    throw Object.assign(new Error(data.error?.message ?? '设置请求失败'), { code: data.error?.code })
  }
  return data.value
}
