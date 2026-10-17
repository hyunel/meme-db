import { mutate } from 'swr'
import { errorMessage } from './errors'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly field?: string,
    /** The API's stable error code. */
    readonly code?: string,
  ) {
    super(message)
  }
}

let onUnauthorized: (code?: string) => void = () => {}

export function setUnauthorizedHandler(handler: (code?: string) => void) {
  onUnauthorized = handler
}

interface Options {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  json?: unknown
  form?: FormData
}

export async function api<T = void>(path: string, { method = 'GET', json, form }: Options = {}): Promise<T> {
  const headers: Record<string, string> = {}
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
    if (res.status === 401) onUnauthorized(data?.code)
    throw new ApiError(res.status, errorMessage(data) ?? data?.error ?? `请求失败（${res.status}）`, data?.field, data?.code)
  }
  return res.status === 204 ? (undefined as T) : res.json()
}

export const fetcher = <T>(path: string) => api<T>(path)

/** Revalidates cached GET data after a change; feeds are left alone, as fetching every page they loaded again is costly. */
export function refresh() {
  return mutate((key) => typeof key === 'string')
}
