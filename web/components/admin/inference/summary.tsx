'use client'

import { Cpu } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { StatCard } from '../admin-ui'
import { Sparkline } from './charts'
import {
  errLevel,
  fmtBytes,
  fmtLatency,
  fmtPct,
  fmtRate,
  fmtUptime,
  gpuUtil,
  gpuVram,
  pctLevel,
  pctOf,
  roleLabel,
  type InferenceSnapshot,
  type Level,
  type ResourcePoint,
} from '@/lib/inference'
import { cn } from '@/lib/utils'
import { useMessages } from '@/lib/i18n/client'

export type Connection = 'ok' | 'degraded' | 'down' | null

const connectionDot = { ok: 'bg-success', degraded: 'bg-warning', down: 'bg-destructive' } as const

const tone = (l: Level) => (l === 'ok' ? undefined : l)

export function StatusStrip({ data, connection, now }: { data?: InferenceSnapshot; connection: Connection; now: number }) {
  const t = useMessages()
  // NVIDIA GPUs come with their names; other devices models run on (the CPU, an Intel or Apple GPU) only by id
  const others = data ? [...new Set(data.models.map((m) => m.device))].filter((d) => d !== 'API' && !data.gpus.some((g) => g.id === d)) : []
  const devices = [...(data?.gpus.map((g) => [g.id, g.name]) ?? []), ...others.map((d) => [d === 'cpu' ? 'CPU' : d])]
  return (
    <section aria-label={t.inference.status} className="flex flex-col gap-3 rounded-xl border bg-card p-3 sm:p-4 lg:flex-row lg:items-center lg:gap-6">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:flex sm:flex-wrap sm:gap-x-8">
        <div className="flex flex-col gap-0.5">
          <dt className="text-xs text-muted-foreground">{t.inference.connection}</dt>
          <dd className="flex items-center gap-2 font-medium">
            <span className={cn('size-2.5 rounded-full', connection ? connectionDot[connection] : 'bg-muted-foreground/40')} aria-hidden />
            {connection ? t.inference.health[connection] : t.overview.checking}
          </dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-xs text-muted-foreground">{t.inference.uptimeLabel}</dt>
          <dd className="font-medium tabular-nums">{data ? fmtUptime(now - data.started_at, t) : '—'}</dd>
        </div>
        <div className="col-span-2 flex flex-col gap-0.5 sm:col-span-1">
          <dt className="text-xs text-muted-foreground">{t.inference.devices}</dt>
          <dd className="flex items-start gap-1.5 font-mono text-[13px]">
            <Cpu className="mt-[3px] size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="flex flex-wrap gap-x-3 gap-y-0.5">
              {devices.length
                ? devices.map(([id, detail]) => (
                    <span key={id}>
                      {id}
                      {detail && <span className="font-sans text-xs text-muted-foreground">{t.inference.deviceName(detail)}</span>}
                    </span>
                  ))
                : '—'}
            </span>
          </dd>
        </div>
      </dl>
      <div className="flex min-w-0 flex-col gap-1.5 border-t pt-3 lg:ml-auto lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6">
        <span className="text-xs text-muted-foreground">{t.inference.models}</span>
        <ul className="flex flex-wrap gap-1.5">
          {data?.models.map((m) => (
            <li key={m.role} className="flex max-w-full min-w-0 items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-1 text-xs">
              <span className="shrink-0 font-medium">{roleLabel(m.role, t)}</span>
              <span className="truncate font-mono text-muted-foreground" title={`${m.name} · ${m.device}`}>
                {m.name}
              </span>
              <span className="shrink-0 text-muted-foreground">· {m.device}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

const mean = (values: (number | null)[]) => (values.some((v) => v === null) || !values.length ? null : (values as number[]).reduce((a, b) => a + b, 0) / values.length)
const sum = (values: (number | null)[]) => (values.some((v) => v === null) || !values.length ? null : (values as number[]).reduce((a, b) => a + b, 0))

export function MetricCards({ data }: { data?: InferenceSnapshot }) {
  const t = useMessages()
  const m = t.inference.metrics
  if (!data)
    return (
      <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4" aria-busy="true" aria-label={m.loading}>
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-[118px] rounded-xl sm:h-[130px]" />
        ))}
      </div>
    )

  const { current: c, series: s, gpus, mem_total } = data
  const devices = gpus.map((_, i) => i)
  const gpuAvg = (p: ResourcePoint) => mean(devices.map((i) => gpuUtil(p, i)))
  const vramUsed = (p: ResourcePoint) => sum(devices.map((i) => gpuVram(p, i)))
  const vramTotal = gpus.reduce((a, g) => a + g.vram_total, 0)
  const gpuMax = Math.max(0, ...devices.map((i) => gpuUtil(c, i) ?? 0))
  const vramMaxPct = Math.max(0, ...devices.map((i) => pctOf(gpuVram(c, i), gpus[i].vram_total) ?? 0))
  const memLevel = pctLevel(pctOf(c.mem, mem_total))
  const queueGrowing = data.tasks.some((task) => task.queue_growing)

  const cards = [
    { label: m.cpu, value: fmtPct(c.cpu), level: pctLevel(c.cpu), spark: <Sparkline data={s} dataKey="cpu" level={pctLevel(c.cpu)} domain={[0, 100]} /> },
    { label: m.memory, value: fmtBytes(c.mem), hint: `${m.ofTotal(fmtBytes(mem_total))} · ${fmtPct(pctOf(c.mem, mem_total))}`, level: memLevel, spark: <Sparkline data={s} dataKey="mem" level={memLevel} domain={[0, mem_total]} /> },
    gpus.length
      ? { label: m.gpu, value: fmtPct(gpuAvg(c)), hint: m.gpuHint(gpus.length, fmtPct(gpuMax)), level: pctLevel(gpuMax), spark: <Sparkline data={s.map((p) => ({ v: gpuAvg(p) }))} dataKey="v" level={pctLevel(gpuMax)} domain={[0, 100]} /> }
      : { label: m.procCpu, value: fmtPct(c.proc_cpu), hint: m.procCpuHint, level: pctLevel(c.proc_cpu), spark: <Sparkline data={s} dataKey="proc_cpu" level={pctLevel(c.proc_cpu)} domain={[0, 100]} /> },
    gpus.length
      ? { label: m.vram, value: fmtBytes(vramUsed(c)), hint: m.vramHint(fmtBytes(vramTotal), fmtPct(vramMaxPct)), level: pctLevel(vramMaxPct), spark: <Sparkline data={s.map((p) => ({ v: vramUsed(p) }))} dataKey="v" level={pctLevel(vramMaxPct)} domain={[0, vramTotal]} /> }
      : { label: m.procMem, value: fmtBytes(c.proc_mem), hint: m.procMemHint(fmtPct(pctOf(c.proc_mem, mem_total))), level: 'ok' as Level, spark: <Sparkline data={s} dataKey="proc_mem" domain={[0, mem_total]} /> },
    { label: m.throughput, value: fmtRate(c.throughput, t), hint: m.allKinds, level: 'ok' as Level, spark: <Sparkline data={s} dataKey="throughput" /> },
    { label: m.p95, value: fmtLatency(c.p95), hint: m.noVlm, level: 'ok' as Level, spark: <Sparkline data={s} dataKey="p95" /> },
    { label: m.errorRate, value: fmtPct(c.error_rate), hint: m.errorRateHint, level: errLevel(c.error_rate), spark: <Sparkline data={s} dataKey="error_rate" level={errLevel(c.error_rate)} /> },
    { label: m.queued, value: c.queued ?? '—', hint: queueGrowing ? m.queueGrowing : m.queueSum, level: (queueGrowing ? 'warn' : 'ok') as Level, spark: <Sparkline data={s} dataKey="queued" level={queueGrowing ? 'warn' : 'ok'} /> },
  ]

  return (
    <section aria-label={m.title} className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
      {cards.map((card) => (
        <StatCard key={card.label} label={card.label} value={card.value} hint={card.hint} tone={tone(card.level)}>
          {card.spark}
        </StatCard>
      ))}
    </section>
  )
}
