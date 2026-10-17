'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowUpRight, Inbox } from 'lucide-react'
import { Area, Bar, BarChart, CartesianGrid, ComposedChart, Line, LineChart, XAxis, YAxis } from 'recharts'
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { EmptyState } from '@/components/states'
import { ChartCard, SYNC_ID, TimeTooltip, timeAxis } from './charts'
import { fmtClockSec, fmtLatency, fmtRate, kindLabel, type InferenceSnapshot } from '@/lib/inference'
import { cn } from '@/lib/utils'

const latencyConfig = {
  p50: { label: 'P50', color: 'var(--chart-2)' },
  p95: { label: 'P95', color: 'var(--chart-1)' },
  p99: { label: 'P99', color: 'var(--chart-4)' },
  queue_ms: { label: '排队耗时', color: 'var(--chart-3)' },
  exec_ms: { label: '执行耗时', color: 'var(--chart-5)' },
} satisfies ChartConfig
const queueConfig = { queue: { label: '队列长度', color: 'var(--chart-1)' } } satisfies ChartConfig
const batchConfig = { count: { label: '批次数', color: 'var(--chart-1)' } } satisfies ChartConfig
const tpConfig = {
  throughput: { label: '吞吐', color: 'var(--chart-1)' },
  errors: { label: '错误', color: 'var(--destructive)' },
} satisfies ChartConfig

const chartCls = 'aspect-auto h-44 w-full sm:h-52'

export function TaskSheet({ data, kind, onClose }: { data?: InferenceSnapshot; kind: string | null; onClose: () => void }) {
  return (
    <Sheet open={Boolean(kind)} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="gap-0 p-0 data-[side=right]:h-dvh data-[side=right]:w-full data-[side=right]:sm:max-w-2xl">
        {kind && data?.tasks.some((t) => t.kind === kind) && <Body data={data} kind={kind} />}
      </SheetContent>
    </Sheet>
  )
}

function Body({ data, kind }: { data: InferenceSnapshot; kind: string }) {
  const [split, setSplit] = useState(false)
  const stats = data.tasks.find((t) => t.kind === kind)!
  const series = data.task_series[kind]
  const errors = stats.recent_errors
  const has = stats.requests > 0
  const axis = timeAxis(data.start, data.now)
  // The server logs its failed inference calls as gRPC errors.
  const logsHref = `/admin/logs?level=warn&q=${encodeURIComponent('rpc error')}`

  return (
    <>
      <SheetHeader className="gap-1 border-b p-4 pt-[calc(1rem+env(safe-area-inset-top))] pr-12">
        <SheetTitle>{kindLabel[kind] ?? kind}</SheetTitle>
        <SheetDescription>
          {stats.schedule === 'batch' ? `GPU 批处理 · 批上限 ${stats.limit}` : `并发执行 · 并发上限 ${stats.limit}`} · 所选时间内 {stats.requests.toLocaleString('zh-CN')} 次请求
        </SheetDescription>
      </SheetHeader>
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto overscroll-contain p-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
        {!has ? (
          <EmptyState icon={Inbox} title="所选时间内没有请求" description="切换到更长的时间范围，或稍后再查看。" />
        ) : (
          <>
            <dl className="grid grid-cols-3 gap-2 text-sm">
              {[
                ['P50', fmtLatency(stats.p50)],
                ['P95', fmtLatency(stats.p95)],
                ['P99', fmtLatency(stats.p99)],
              ].map(([k, v]) => (
                <div key={k} className="flex flex-col gap-0.5 rounded-lg border bg-muted/30 p-2.5">
                  <dt className="text-xs text-muted-foreground">{k}</dt>
                  <dd className="font-semibold tabular-nums">{v}</dd>
                </div>
              ))}
            </dl>

            <ChartCard
              title="延迟趋势"
              description={split ? '叠加排队与执行耗时（P50 拆分）' : 'P50 / P95 / P99'}
              actions={
                <div className="flex items-center gap-2">
                  <Switch id="split-latency" checked={split} onCheckedChange={setSplit} />
                  <Label htmlFor="split-latency" className="text-xs font-normal whitespace-nowrap">
                    拆分耗时
                  </Label>
                </div>
              }
            >
              <ChartContainer config={latencyConfig} className={chartCls}>
                <ComposedChart data={series} syncId={SYNC_ID} syncMethod="value" margin={{ left: 0, right: 8, top: 4 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis {...axis} />
                  <YAxis tickLine={false} axisLine={false} width={60} tickFormatter={(v) => fmtLatency(v)} />
                  <TimeTooltip config={latencyConfig} format={(v) => fmtLatency(v)} />
                  <ChartLegend content={<ChartLegendContent className="flex-wrap" />} />
                  {split && <Area dataKey="queue_ms" stackId="split" stroke="var(--color-queue_ms)" fill="var(--color-queue_ms)" fillOpacity={0.35} isAnimationActive={false} />}
                  {split && <Area dataKey="exec_ms" stackId="split" stroke="var(--color-exec_ms)" fill="var(--color-exec_ms)" fillOpacity={0.35} isAnimationActive={false} />}
                  <Line dataKey="p50" stroke="var(--color-p50)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                  <Line dataKey="p95" stroke="var(--color-p95)" strokeWidth={1.75} dot={false} isAnimationActive={false} />
                  <Line dataKey="p99" stroke="var(--color-p99)" strokeWidth={1.5} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
                </ComposedChart>
              </ChartContainer>
            </ChartCard>

            <div className={cn('grid gap-4', stats.schedule === 'batch' && 'sm:grid-cols-2')}>
              <ChartCard title="队列长度">
                <ChartContainer config={queueConfig} className={chartCls}>
                  <LineChart data={series} syncId={SYNC_ID} syncMethod="value" margin={{ left: 0, right: 8, top: 4 }}>
                    <CartesianGrid vertical={false} />
                    <XAxis {...axis} />
                    <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={40} />
                    <TimeTooltip config={queueConfig} format={(v) => String(v)} />
                    <Line dataKey="queue" type="stepAfter" stroke="var(--color-queue)" strokeWidth={1.75} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ChartContainer>
              </ChartCard>

              {stats.schedule === 'batch' && (
                <ChartCard title="批大小分布" description="横轴为批大小">
                  <ChartContainer config={batchConfig} className={chartCls}>
                    <BarChart data={stats.batch_dist} margin={{ left: 0, right: 8, top: 4 }}>
                      <CartesianGrid vertical={false} />
                      <XAxis dataKey="size" tickLine={false} axisLine={false} tickMargin={8} interval={0} fontSize={10} />
                      <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={40} />
                      <ChartTooltip content={<ChartTooltipContent labelFormatter={(l) => `批大小 ${l}`} />} />
                      <Bar dataKey="count" fill="var(--color-count)" radius={3} isAnimationActive={false} />
                    </BarChart>
                  </ChartContainer>
                </ChartCard>
              )}
            </div>

            <ChartCard title="吞吐与错误" description="折线为吞吐（次 / 秒），柱为错误数">
              <ChartContainer config={tpConfig} className={chartCls}>
                <ComposedChart data={series} syncId={SYNC_ID} syncMethod="value" margin={{ left: 0, right: 0, top: 4 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis {...axis} />
                  <YAxis yAxisId="tp" tickLine={false} axisLine={false} width={40} tickFormatter={(v) => Number(v).toFixed(1)} />
                  <YAxis yAxisId="err" orientation="right" allowDecimals={false} tickLine={false} axisLine={false} width={32} />
                  <TimeTooltip config={tpConfig} format={(v, k) => (k === 'throughput' ? fmtRate(v) : `${v} 次`)} />
                  <ChartLegend content={<ChartLegendContent />} />
                  <Bar yAxisId="err" dataKey="errors" fill="var(--color-errors)" radius={2} maxBarSize={6} isAnimationActive={false} />
                  <Line yAxisId="tp" dataKey="throughput" stroke="var(--color-throughput)" strokeWidth={1.75} dot={false} isAnimationActive={false} />
                </ComposedChart>
              </ChartContainer>
            </ChartCard>
          </>
        )}

        <section aria-labelledby="recent-errors" className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <h3 id="recent-errors" className="text-sm font-medium">
              最近的错误
              <span className="ml-1.5 font-normal text-muted-foreground">{errors.length ? `${errors.length} 条` : ''}</span>
            </h3>
            <Link href={logsHref} className="inline-flex h-9 items-center gap-1 rounded-md px-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
              在日志中查看调用错误
              <ArrowUpRight className="size-4" aria-hidden />
            </Link>
          </div>
          {errors.length === 0 ? (
            <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">所选时间内没有错误</p>
          ) : (
            <ol className="divide-y rounded-lg border">
              {errors.map((e, i) => (
                <li key={`${e.at}-${i}`} className="flex flex-col gap-0.5 p-3 text-sm sm:flex-row sm:gap-3">
                  <time dateTime={new Date(e.at).toISOString()} className="shrink-0 font-mono text-xs text-muted-foreground sm:pt-0.5">
                    {fmtClockSec(e.at)}
                  </time>
                  <span className="min-w-0 break-words">{e.message}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </>
  )
}
