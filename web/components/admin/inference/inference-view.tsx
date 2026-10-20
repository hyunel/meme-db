'use client'

import { useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { CircleAlert } from 'lucide-react'
import { AdminPageHeader, FilterSelect, RefreshControls, useNow } from '../admin-ui'
import { MetricCards, StatusStrip } from './summary'
import { ResourceCharts } from './resource-charts'
import { TaskTable } from './task-table'
import { TaskSheet } from './task-sheet'
import { useInference } from '@/hooks/use-inference'
import { fmtClockSec, isRange, rangeSpan, type InferenceRange } from '@/lib/inference'
import type { Messages } from '@/lib/i18n'
import { useMessages } from '@/lib/i18n/client'
import { cn } from '@/lib/utils'

function ago(ms: number, t: Messages) {
  const s = Math.max(0, Math.floor(ms / 1000))
  return s < 60 ? t.inference.secondsAgo(s) : t.inference.minutesAgo(Math.floor(s / 60))
}

export function InferenceView() {
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const range: InferenceRange = isRange(params.get('range')) ? (params.get('range') as InferenceRange) : '1h'
  const kind = params.get('task')
  const [auto, setAuto] = useState(true)
  const now = useNow(true, 1000)
  const { data, down, connection, mutate } = useInference(range, { auto })
  const t = useMessages()

  const setParams = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString())
    Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)))
    const qs = next.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }

  return (
    <>
      <AdminPageHeader
        title={t.titles.inference}
        description={t.inference.description}
        actions={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:items-end">
            <div className="flex flex-wrap items-center gap-2">
              <FilterSelect
                label={t.overview.range}
                value={range}
                onChange={(v) => setParams({ range: v === '1h' ? null : v })}
                options={(Object.keys(rangeSpan) as InferenceRange[]).map((k) => [k, t.inference.ranges[k]] as const)}
                className="w-28"
              />
              <RefreshControls auto={auto} onAutoChange={setAuto} onRefresh={() => mutate()} />
            </div>
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {data ? t.overview.updated(ago(now - data.now, t)) : t.inference.fetching}
              {auto && <span className="ml-1">· {t.inference.everyFive}</span>}
            </p>
          </div>
        }
      />

      {down && (
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm sm:p-4">
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="font-medium text-destructive">{t.inference.down}</p>
            <p className="text-muted-foreground">
              {data ? t.inference.lastData(fmtClockSec(data.now), ago(now - data.now, t)) : t.inference.noData}
            </p>
          </div>
        </div>
      )}

      <div className={cn('flex flex-col gap-6 transition', down && 'opacity-60 grayscale')} aria-disabled={down || undefined}>
        <StatusStrip data={data} connection={connection} now={now} />
        <MetricCards data={data} />
        <ResourceCharts data={data} />
        <TaskTable data={data} onOpen={(k) => setParams({ task: k })} />
      </div>

      <TaskSheet data={data} kind={kind} onClose={() => setParams({ task: null })} />
    </>
  )
}
