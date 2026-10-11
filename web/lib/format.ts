export function formatBytes(n: number) {
  if (n < 1024) return `${Math.round(n)} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(1)} GB`
}

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

export function formatRelative(t: Time) {
  const diff = Date.now() - toMs(t)
  const abs = Math.abs(diff)
  const future = diff < 0
  const units: [number, string][] = [
    [86_400_000, '天'],
    [3_600_000, '小时'],
    [60_000, '分钟'],
  ]
  for (const [ms, label] of units) {
    if (abs >= ms) return `${Math.floor(abs / ms)} ${label}${future ? '后' : '前'}`
  }
  return future ? '即将' : '刚刚'
}

export function formatDuration(ms: number) {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}
