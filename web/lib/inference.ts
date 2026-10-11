import { api } from './api'
import { formatBytes } from './format'

const MIN = 60 * 1000
const HOUR = 60 * MIN

export type InferenceRange = '15m' | '1h' | '6h' | '24h'
export const rangeConfig: Record<InferenceRange, { label: string; span: number }> = {
  '15m': { label: '15 分钟', span: 15 * MIN },
  '1h': { label: '1 小时', span: HOUR },
  '6h': { label: '6 小时', span: 6 * HOUR },
  '24h': { label: '24 小时', span: 24 * HOUR },
}
export const isRange = (v: string | null): v is InferenceRange => !!v && v in rangeConfig

export const kindLabel: Record<string, string> = {
  text_embedding: '文本向量',
  clip_image: 'CLIP 图像',
  clip_text: 'CLIP 文本',
  reranker: '重排',
  vlm: 'VLM 识图',
}
export const roleLabel: Record<string, string> = { clip: 'CLIP', text_embedding: '文本向量', reranker: '重排', vlm: 'VLM' }

export type Level = 'ok' | 'warn' | 'danger'
export const pctLevel = (pct: number | null): Level => (pct === null ? 'ok' : pct >= 95 ? 'danger' : pct >= 80 ? 'warn' : 'ok')
export const errLevel = (pct: number | null): Level => (pct === null ? 'ok' : pct >= 5 ? 'danger' : pct >= 1 ? 'warn' : 'ok')

/** A sample; GPU readings are flattened to gpu0, vram0, gpu1, … for the charts. */
export interface ResourcePoint {
  t: number
  cpu: number | null
  mem: number | null
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
  models: { role: string; name: string; device: string }[]
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
  return { ...r, start: r.now - rangeConfig[range].span, series, current }
}

export const pctOf = (used: number | null, total: number) => (used === null || !total ? null : (used / total) * 100)
export const gpuUtil = (p: ResourcePoint, i: number) => p[`gpu${i}`] ?? null
export const gpuVram = (p: ResourcePoint, i: number) => p[`vram${i}`] ?? null

export function inferenceAlerts(s: InferenceSnapshot) {
  const c = s.current
  const out: { key: string; level: Exclude<Level, 'ok'>; text: string }[] = []
  const push = (key: string, level: Level, text: string) => level !== 'ok' && out.push({ key, level, text })

  push('cpu', pctLevel(c.cpu), `CPU 使用率 ${fmtPct(c.cpu)}`)
  push('mem', pctLevel(pctOf(c.mem, s.mem_total)), `内存使用 ${fmtPct(pctOf(c.mem, s.mem_total))}`)
  s.gpus.forEach((g, i) => {
    push(`gpu${i}`, pctLevel(gpuUtil(c, i)), `${g.id} GPU 利用率 ${fmtPct(gpuUtil(c, i))}`)
    push(`vram${i}`, pctLevel(pctOf(gpuVram(c, i), g.vram_total)), `${g.id} 显存使用 ${fmtPct(pctOf(gpuVram(c, i), g.vram_total))}`)
  })
  push('err', errLevel(c.error_rate), `推理错误率 ${fmtPct(c.error_rate)}`)
  s.tasks.forEach((t) => t.queue_growing && out.push({ key: `q-${t.kind}`, level: 'warn', text: `${kindLabel[t.kind] ?? t.kind}排队持续增长，当前 ${t.queue} 个` }))

  return out
}

export const fmtPct = (v: number | null) => (v === null ? '—' : `${Math.round(v)}%`)
export const fmtLatency = (ms: number | null) => (ms === null ? '—' : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`)
export const fmtRate = (v: number | null) => (v === null ? '—' : `${v.toFixed(1)} / 秒`)
export const fmtBytes = (n: number | null) => (n === null ? '—' : formatBytes(n))
export function fmtUptime(ms: number) {
  const d = Math.floor(ms / (24 * HOUR))
  const h = Math.floor((ms % (24 * HOUR)) / HOUR)
  const m = Math.floor((ms % HOUR) / MIN)
  return d ? `${d} 天 ${h} 小时` : h ? `${h} 小时 ${m} 分钟` : `${m} 分钟`
}

const clockFmt = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
const clockSecFmt = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
export const fmtClock = (t: number) => clockFmt.format(t)
export const fmtClockSec = (t: number) => clockSecFmt.format(t)
