import type { Messages } from './i18n'

export function formatBytes(n: number) {
  if (n < 1024) return `${Math.round(n)} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(1)} GB`
}

// Numeric dates read alike in either language.
const dateFmt = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
const dateTimeFmt = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})

/** API timestamps are ISO strings; local ones are epoch milliseconds. */
export type Time = string | number

export const toMs = (t: Time) => (typeof t === 'number' ? t : Date.parse(t))

export const formatDate = (t: Time) => dateFmt.format(toMs(t))
export const formatDateTime = (t: Time) => dateTimeFmt.format(toMs(t))

export function formatRelative(at: Time, { time }: Messages) {
  const diff = Date.now() - toMs(at)
  const abs = Math.abs(diff)
  const future = diff < 0
  const units = [
    [86_400_000, 'day'],
    [3_600_000, 'hour'],
    [60_000, 'minute'],
  ] as const
  for (const [ms, unit] of units) {
    if (abs >= ms) return time.relative(Math.floor(abs / ms), unit, future)
  }
  return future ? time.soon : time.justNow
}

export function formatDuration(ms: number) {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}
