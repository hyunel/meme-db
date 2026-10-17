import { cookies } from 'next/headers'
import { backendBase } from './site'

/** Reads the API on the server as the visitor, by their session cookie; null when the link leads nowhere, such as a malformed id or share. */
export async function serverApi<T>(path: string): Promise<T | null> {
  const res = await fetch(`${backendBase}/api${path}`, { headers: { cookie: (await cookies()).toString() } })
  if (res.status >= 400 && res.status < 500) return null
  if (!res.ok) throw new Error(`GET ${path}: ${res.status}`)
  return res.json()
}

/** A search param given once; repeated ones are ignored. */
export const param = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined)
