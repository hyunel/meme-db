import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
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
