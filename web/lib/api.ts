import { mutate } from 'swr'

const TOKEN_KEY = 'memedb:token'

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {}
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly field?: string,
  ) {
    super(message)
  }
}

let onUnauthorized = () => {}

export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler
}

type QueryValue = string | number | boolean | string[] | null | undefined

/** Builds a query string, skipping empty values and repeating array values. */
export function qs(query: Record<string, QueryValue>) {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (Array.isArray(v)) v.forEach((x) => p.append(k, x))
    else if (v !== undefined && v !== null && v !== '' && v !== false) p.set(k, String(v))
  }
  const s = p.toString()
  return s ? `?${s}` : ''
}

interface Options {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  json?: unknown
  form?: FormData
}

export async function api<T = void>(path: string, { method = 'GET', json, form }: Options = {}): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
  let body: BodyInit | undefined = form
  if (json !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(json)
  }

  let res: Response
  try {
    res = await fetch(`/api${path}`, { method, headers, body })
  } catch {
    throw new ApiError(0, '网络连接失败，请检查网络后重试')
  }
  if (!res.ok) {
    const data = await res.json().catch(() => null)
    if (res.status === 401 && token) onUnauthorized()
    throw new ApiError(res.status, data?.error ?? `请求失败（${res.status}）`, data?.field)
  }
  return res.status === 204 ? (undefined as T) : res.json()
}

export const fetcher = <T>(path: string) => api<T>(path)

/** Revalidates cached GET data after a change; feeds are left alone, as fetching every page they loaded again is costly. */
export function refresh() {
  return mutate((key) => typeof key === 'string')
}
