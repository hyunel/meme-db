import { mutate } from 'swr'
import { messages } from './i18n'
import { documentLocale } from './i18n/client'

type Wording = string | ((params: Record<string, string | number>, field?: string) => string)

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

  const t = messages[documentLocale()]
  let res: Response
  try {
    res = await fetch(`/api${path}`, { method, headers, body })
  } catch {
    throw new ApiError(0, t.network.offline)
  }
  if (!res.ok) {
    const data = await res.json().catch(() => null)
    if (res.status === 401) onUnauthorized(data?.code)
    // Worded by its code; a code without wording shows the API's English message.
    const wording = data?.code ? (t.errors as Record<string, Wording>)[data.code] : undefined
    const message = typeof wording === 'function' ? wording(data.params ?? {}, data.field) : wording
    throw new ApiError(res.status, message ?? data?.error ?? t.network.failed(res.status), data?.field, data?.code)
  }
  return res.status === 204 ? (undefined as T) : res.json()
}

export const fetcher = <T>(path: string) => api<T>(path)

/** Revalidates cached GET data after a change; feeds are left alone, as fetching every page they loaded again is costly. */
export function refresh() {
  return mutate((key) => typeof key === 'string')
}
