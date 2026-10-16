'use client'

import { useState } from 'react'
import { ChevronRight, TrendingUp } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { DataList, sortRows, toneLabel, toneText, type Column, type SortState } from '../admin-ui'
import { errLevel, fmtLatency, fmtRate, kindLabel, type InferenceSnapshot, type Level, type TaskStats } from '@/lib/inference'
import { cn } from '@/lib/utils'

function Flag({ level, children }: { level: Level; children: React.ReactNode }) {
  if (level === 'ok') return <span className="tabular-nums">{children}</span>
  return (
    <span className={cn('inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium tabular-nums', toneText[level], level === 'warn' ? 'bg-warning/15' : 'bg-destructive/10')}>
      {children}
      <span className="sr-only">（{toneLabel[level]}）</span>
    </span>
  )
}

const dash = (has: boolean, v: React.ReactNode) => (has ? v : <span className="text-muted-foreground">—</span>)

export function TaskTable({ data, onOpen }: { data?: InferenceSnapshot; onOpen: (kind: string) => void }) {
  const [sort, setSort] = useState<SortState | undefined>()

  if (!data) return <Skeleton className="h-72 w-full rounded-xl" />

  const has = (r: TaskStats) => r.requests > 0
  const columns: Column<TaskStats>[] = [
    {
      key: 'kind',
      header: '任务类型',
      mobile: 'title',
      sortValue: (r) => kindLabel[r.kind] ?? r.kind,
      cell: (r) => (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onOpen(r.kind)
          }}
          className="flex w-full min-w-0 items-center gap-2 rounded text-left font-medium hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <span className="truncate">{kindLabel[r.kind] ?? r.kind}</span>
          <span className="shrink-0 text-xs font-normal text-muted-foreground md:hidden">{r.schedule === 'batch' ? 'GPU 批处理' : '并发执行'}</span>
          <ChevronRight className="ml-auto size-4 shrink-0 text-muted-foreground md:hidden" aria-hidden />
        </button>
      ),
    },
    { key: 'sched', header: '调度方式', mobile: 'hidden', sortValue: (r) => r.schedule, cell: (r) => <span className="text-muted-foreground">{r.schedule === 'batch' ? 'GPU 批处理' : '并发执行'}</span> },
    {
      key: 'queue',
      header: '排队数',
      sortValue: (r) => r.queue,
      className: 'text-right',
      cell: (r) => (
        <Flag level={r.queue_growing ? 'warn' : 'ok'}>
          {r.queue}
          {r.queue_growing && <TrendingUp className="size-3.5" aria-label="持续增长" />}
        </Flag>
      ),
    },
    { key: 'running', header: '执行中', mobile: 'hidden', sortValue: (r) => r.running, className: 'text-right tabular-nums', cell: (r) => r.running },
    {
      key: 'batch',
      header: '平均批大小 / 上限',
      mobile: 'hidden',
      sortValue: (r) => r.avg_batch,
      className: 'text-right tabular-nums',
      cell: (r) => (r.schedule === 'batch' ? dash(r.avg_batch !== null, `${r.avg_batch?.toFixed(1)} / ${r.limit}`) : <span className="text-muted-foreground">并发上限 {r.limit}</span>),
    },
    { key: 'tp', header: '吞吐', sortValue: (r) => r.throughput, className: 'text-right tabular-nums', cell: (r) => dash(has(r), fmtRate(r.throughput)) },
    { key: 'p50', header: 'P50', mobile: 'hidden', sortValue: (r) => r.p50, className: 'text-right tabular-nums', cell: (r) => dash(has(r), fmtLatency(r.p50)) },
    { key: 'p95', header: 'P95', sortValue: (r) => r.p95, className: 'text-right tabular-nums', cell: (r) => dash(has(r), fmtLatency(r.p95)) },
    { key: 'p99', header: 'P99', mobile: 'hidden', sortValue: (r) => r.p99, className: 'text-right tabular-nums', cell: (r) => dash(has(r), fmtLatency(r.p99)) },
    {
      key: 'err',
      header: '错误数',
      sortValue: (r) => (has(r) ? r.errors : null),
      className: 'text-right',
      cell: (r) => dash(has(r), <Flag level={errLevel(r.error_rate)}>{r.errors}</Flag>),
    },
  ]

  return (
    <section aria-labelledby="task-types" className="flex flex-col gap-3">
      <h2 id="task-types" className="text-sm font-medium text-muted-foreground">
        任务类型
      </h2>
      <DataList
        rows={sortRows(data.tasks, columns, sort)}
        columns={columns}
        getId={(r) => r.kind}
        rowLabel={(r) => kindLabel[r.kind] ?? r.kind}
        sort={sort}
        onSortChange={setSort}
        onRowClick={(r) => onOpen(r.kind)}
        empty={<p className="p-6 text-center text-sm text-muted-foreground">暂无任务类型</p>}
      />
    </section>
  )
}
