import { api } from './api'
import { formatBytes } from './format'
import type { Messages } from './i18n'

const MIN = 60 * 1000
const HOUR = 60 * MIN

export type InferenceRange = '15m' | '1h' | '6h' | '24h'
export const rangeSpan: Record<InferenceRange, number> = { '15m': 15 * MIN, '1h': HOUR, '6h': 6 * HOUR, '24h': 24 * HOUR }
export const isRange = (v: string | null): v is InferenceRange => !!v && v in rangeSpan

export const kindLabel = (kind: string, t: Messages) => (t.inference.kinds as Record<string, string>)[kind] ?? kind
export const roleLabel = (role: string, t: Messages) => (t.inference.roles as Record<string, string>)[role] ?? role

export type Level = 'ok' | 'warn' | 'danger'
export const pctLevel = (pct: number | null): Level => (pct === null ? 'ok' : pct >= 95 ? 'danger' : pct >= 80 ? 'warn' : 'ok')
export const errLevel = (pct: number | null): Level => (pct === null ? 'ok' : pct >= 5 ? 'danger' : pct >= 1 ? 'warn' : 'ok')

/** A sample; GPU readings are flattened to gpu0, vram0, gpu1, … for the charts. */
export interface ResourcePoint {
  t: number
  cpu: number | null
  mem: number | null
  /** The inference process's share of all cores, and its resident memory */
  proc_cpu: number | null
  proc_mem: number | null
  throughput: number | null
  p95: number | null
  error_rate: number | null
  queued: number | null
  [gpu: `gpu${number}` | `vram${number}`]: number | null
}

export interface TaskPoint {
  t: number
  p50: number | null
  p95: number | null
  p99: number | null
  queue_ms: number | null
  exec_ms: number | null
  queue: number | null
  throughput: number | null
  errors: number | null
}

export interface TaskStats {
  kind: string
  schedule: 'batch' | 'concurrent'
  limit: number
  requests: number
  queue: number
  queue_growing: boolean
  running: number
  avg_batch: number | null
  throughput: number | null
  p50: number | null
  p95: number | null
  p99: number | null
  errors: number
  error_rate: number | null
  batch_dist: { size: string; count: number }[]
  recent_errors: { at: number; message: string }[]
}

export interface InferenceSnapshot {
  now: number
  start: number
  started_at: number
  mem_total: number
  gpus: { id: string; name: string; vram_total: number }[]
  /** dims: of an embedding model's embeddings */
  models: { role: string; name: string; device: string; dims: number | null }[]
  series: ResourcePoint[]
  /** The latest sample */
  current: ResourcePoint
  tasks: TaskStats[]
  task_series: Record<string, TaskPoint[]>
}

type RawPoint = Omit<ResourcePoint, `gpu${number}` | `vram${number}`> & { gpus: { util: number | null; vram: number | null }[] }

export async function fetchInference(range: InferenceRange): Promise<InferenceSnapshot> {
  const r = await api<Omit<InferenceSnapshot, 'series' | 'current' | 'start'> & { series: RawPoint[] }>(`/admin/inference?range=${range}`)

  const series = r.series.map(({ gpus, ...p }) => ({ ...p, ...Object.fromEntries(gpus.flatMap((g, i) => [[`gpu${i}`, g.util], [`vram${i}`, g.vram]])) }) as ResourcePoint)
  const current = series.findLast((p) => p.cpu !== null) ?? series[series.length - 1]
  return { ...r, start: r.now - rangeSpan[range], series, current }
}

export const pctOf = (used: number | null, total: number) => (used === null || !total ? null : (used / total) * 100)
export const gpuUtil = (p: ResourcePoint, i: number) => p[`gpu${i}`] ?? null
export const gpuVram = (p: ResourcePoint, i: number) => p[`vram${i}`] ?? null

export function inferenceAlerts(s: InferenceSnapshot, t: Messages) {
  const c = s.current
  const { alerts } = t.inference
  const out: { key: string; level: Exclude<Level, 'ok'>; text: string }[] = []
  const push = (key: string, level: Level, text: string) => level !== 'ok' && out.push({ key, level, text })

  push('cpu', pctLevel(c.cpu), alerts.cpu(fmtPct(c.cpu)))
  push('mem', pctLevel(pctOf(c.mem, s.mem_total)), alerts.mem(fmtPct(pctOf(c.mem, s.mem_total))))
  s.gpus.forEach((g, i) => {
    push(`gpu${i}`, pctLevel(gpuUtil(c, i)), alerts.gpu(g.id, fmtPct(gpuUtil(c, i))))
    push(`vram${i}`, pctLevel(pctOf(gpuVram(c, i), g.vram_total)), alerts.vram(g.id, fmtPct(pctOf(gpuVram(c, i), g.vram_total))))
  })
  push('err', errLevel(c.error_rate), alerts.errors(fmtPct(c.error_rate)))
  s.tasks.forEach((task) => task.queue_growing && out.push({ key: `q-${task.kind}`, level: 'warn', text: alerts.queue(kindLabel(task.kind, t), task.queue) }))

  return out
}

export const fmtPct = (v: number | null) => (v === null ? '—' : `${Math.round(v)}%`)
export const fmtLatency = (ms: number | null) => (ms === null ? '—' : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`)
export const fmtRate = (v: number | null, t: Messages) => (v === null ? '—' : t.inference.rate(v.toFixed(1)))
export const fmtBytes = (n: number | null) => (n === null ? '—' : formatBytes(n))
export function fmtUptime(ms: number, t: Messages) {
  const d = Math.floor(ms / (24 * HOUR))
  const h = Math.floor((ms % (24 * HOUR)) / HOUR)
  const m = Math.floor((ms % HOUR) / MIN)
  return t.inference.uptime(d, h, m)
}

// 24-hour clock times read alike in either language.
const clockFmt = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
const clockSecFmt = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
export const fmtClock = (t: number) => clockFmt.format(t)
export const fmtClockSec = (t: number) => clockSecFmt.format(t)
