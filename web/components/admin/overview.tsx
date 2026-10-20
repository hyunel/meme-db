'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { ChevronRight, TriangleAlert } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loadable } from '@/components/loadable'
import { AdminPageHeader, FilterSelect, RefreshControls, StatCard, toneText, useNow } from './admin-ui'
import { jobLabel } from './labels'
import { useInference } from '@/hooks/use-inference'
import { fmtLatency, fmtPct, gpuUtil, inferenceAlerts } from '@/lib/inference'
import { formatBytes, formatDateTime } from '@/lib/format'
import type { Overview, TaskState, TaskTypeCounts } from '@/lib/types'
import { cn, qs } from '@/lib/utils'
import { useMessages } from '@/lib/i18n/client'

const DAY = 86_400_000
type Range = '1d' | '7d' | '30d' | 'custom'
const toInput = (t: number) => new Date(t - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone

const chartColors = {
  uploads: 'var(--chart-1)',
  users: 'var(--chart-2)',
  completed: 'var(--chart-3)',
  failed: 'var(--destructive)',
}

const states: TaskState[] = ['pending', 'retrying', 'running', 'completed', 'failed']
const sum = (rows: TaskTypeCounts[], key: keyof Omit<TaskTypeCounts, 'job_type'>) => rows.reduce((n, r) => n + r[key], 0)
const failRate = (failed: number, completed: number) => (failed + completed ? Math.round((failed / (failed + completed)) * 100) : null)

type Health = 'ok' | 'degraded' | 'down' | null
const healthDot = { ok: 'bg-success', degraded: 'bg-warning', down: 'bg-destructive' } as const

function HealthCard({ name, status, detail, href }: { name: string; status: Health; detail: React.ReactNode; href?: string }) {
  const t = useMessages()
  const body = (
    <>
      <span className={cn('size-2.5 shrink-0 rounded-full', status ? healthDot[status] : 'bg-muted-foreground/40')} aria-hidden />
      <span className="text-sm font-medium">{name}</span>
      <span className="sr-only">{t.overview.healthStatus(status ? t.overview.health[status] : t.overview.checking)}</span>
      <span className="ml-auto truncate text-xs text-muted-foreground tabular-nums">{detail}</span>
      {href && <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
    </>
  )
  const cls = 'flex min-h-11 min-w-0 items-center gap-2.5 rounded-xl border bg-card px-3.5 py-2.5'
  return (
    <li className="min-w-0">
      {href ? (
        <Link href={href} className={cn(cls, 'transition-colors hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none')}>
          {body}
        </Link>
      ) : (
        <div className={cls}>{body}</div>
      )}
    </li>
  )
}

export function AdminOverview() {
  const [auto, setAuto] = useState(true)
  const now = useNow(auto, 10_000)
  const [range, setRange] = useState<Range>('7d')
  const [from, setFrom] = useState(() => toInput(Date.now() - 7 * DAY))
  const [to, setTo] = useState(() => toInput(Date.now()))

  const customInvalid = range === 'custom' && from > to
  const [start, end] = useMemo(() => {
    if (range === 'custom' && !customInvalid) {
      return [new Date(from).setHours(0, 0, 0, 0), new Date(to).setHours(23, 59, 59, 999)]
    }
    return [now - { '1d': 1, '7d': 7, '30d': 30, custom: 7 }[range] * DAY, now]
  }, [range, from, to, now, customInvalid])

  const stats = useSWR<Overview>(`/admin/stats${qs({ from: start, to: end, tz: timeZone })}`, { keepPreviousData: true })
  const inf = useInference('15m', { auto })
  const rangeQ = `from=${start}&to=${end}`
  const t = useMessages()
  const chartConfig = Object.fromEntries(Object.entries(chartColors).map(([k, color]) => [k, { label: t.overview.chart[k as keyof typeof chartColors], color }])) satisfies ChartConfig

  const tasks = stats.data?.tasks ?? []
  const backlog = sum(tasks, 'pending') + sum(tasks, 'retrying')
  const doneN = sum(tasks, 'completed_in_range')
  const failN = sum(tasks, 'failed_in_range')
  const rate = failRate(failN, doneN) ?? 0

  const service = (name: string) => stats.data?.services.find((sv) => sv.name === name)
  const db = service('database')
  const storage = service('storage')
  const ic = inf.data?.current
  const gpuAvg = inf.data?.gpus.length && ic ? inf.data.gpus.reduce((a, _, i) => a + (gpuUtil(ic, i) ?? 0), 0) / inf.data.gpus.length : null

  const failedMemes = stats.data?.memes.failed ?? 0
  const alerts = inf.data ? inferenceAlerts(inf.data, t) : []
  const attention = [
    failedMemes > 0 && { text: t.overview.failedMemes, count: String(failedMemes), href: '/admin/content?status=failed', level: 'danger' as const },
    backlog > 5 && { text: t.overview.backlogAlert, count: String(backlog), href: '/admin/tasks?status=pending&status=retrying', level: 'warn' as const },
    rate > 20 && { text: t.overview.failRateAlert, count: `${rate}%`, href: '/admin/tasks?status=failed', level: 'danger' as const },
    alerts.length > 0 && {
      text: t.overview.inferenceAlert(alerts.map((a) => a.text)),
      count: String(alerts.length),
      href: '/admin/inference',
      level: alerts.some((a) => a.level === 'danger') ? ('danger' as const) : ('warn' as const),
    },
  ].filter((a) => a !== false)

  return (
    <>
      <AdminPageHeader
        title={t.titles.overview}
        description={t.overview.updated(formatDateTime(now))}
        actions={
          <RefreshControls
            auto={auto}
            onAutoChange={setAuto}
            onRefresh={() => {
              void stats.mutate()
              void inf.mutate()
            }}
          />
        }
      />

      <section aria-label={t.overview.healthSummary}>
        <ul className="grid gap-2 sm:grid-cols-3 sm:gap-3">
          <HealthCard name={t.overview.database} status={db ? (db.ok ? 'ok' : 'down') : null} detail={db ? (db.ok ? t.overview.responds(db.detail) : db.detail) : '—'} />
          <HealthCard
            name={t.titles.inference}
            status={inf.connection}
            detail={ic ? `${gpuAvg === null ? `CPU ${fmtPct(ic.cpu)}` : `GPU ${fmtPct(gpuAvg)}`} · P95 ${fmtLatency(ic.p95)}` : inf.down ? t.overview.unreachable : '—'}
            href="/admin/inference"
          />
          <HealthCard
            name={t.overview.storage}
            status={storage ? (storage.ok ? 'ok' : 'down') : null}
            detail={storage?.ok && stats.data ? `${t.overview.writable} · ${formatBytes(stats.data.memes.storage_bytes)}` : (storage?.detail ?? '—')}
          />
        </ul>
      </section>

      {attention.length > 0 && (
        <section aria-labelledby="attention" className="flex flex-col gap-3">
          <h2 id="attention" className="text-sm font-medium text-muted-foreground">
            {t.overview.attention}
          </h2>
          <ul className="divide-y overflow-hidden rounded-xl border bg-card">
            {attention.map((a) => (
              <li key={a.href}>
                <Link href={a.href} className="flex min-h-12 items-center gap-3 px-3.5 py-3 text-sm transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none">
                  <TriangleAlert className={cn('size-4 shrink-0', toneText[a.level])} aria-label={t.overview.levels[a.level]} />
                  <span className="min-w-0 flex-1 break-words">{a.text}</span>
                  <span className={cn('shrink-0 font-medium tabular-nums', toneText[a.level])}>{a.count}</span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-label={t.overview.range} className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
        <FilterSelect
          label={t.overview.range}
          value={range}
          onChange={setRange}
          options={[
            ['1d', t.admin.ranges['1d']],
            ['7d', t.admin.ranges['7d']],
            ['30d', t.admin.ranges['30d']],
            ['custom', t.overview.custom],
          ]}
          className="sm:w-36"
        />
        {range === 'custom' && (
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <div className="flex flex-col gap-1">
              <Label htmlFor="from" className="text-xs text-muted-foreground">
                {t.overview.from}
              </Label>
              <Input id="from" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="h-10 text-base md:h-9 md:text-sm" />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="to" className="text-xs text-muted-foreground">
                {t.overview.to}
              </Label>
              <Input id="to" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} aria-invalid={customInvalid} className="h-10 text-base md:h-9 md:text-sm" />
            </div>
          </div>
        )}
        {customInvalid && <p className="text-sm text-destructive">{t.overview.invalidRange}</p>}
      </section>

      <Loadable result={stats}>
        {(s) => {
          const trend = s.trend.map((p) => ({ ...p, day: `${Number(p.day.slice(5, 7))}/${Number(p.day.slice(8))}` }))
          return (
            <>
              <Section title={t.overview.users}>
                <StatCard label={t.overview.totalUsers} value={s.users.total} href="/admin/users" />
                <StatCard label={t.overview.admins} value={s.users.admins} href="/admin/users?role=admin" />
                <StatCard label={t.overview.newUsers} value={s.users.new} hint={t.overview.inRange} href={`/admin/users?${rangeQ}`} />
              </Section>

              <Section title={t.overview.content}>
                <StatCard label={t.overview.totalMemes} value={s.memes.total} href="/admin/content" />
                <StatCard label={t.overview.storageUsed} value={formatBytes(s.memes.storage_bytes)} />
                <StatCard label={t.overview.publicMemes} value={s.memes.public} href="/admin/content?visibility=public" />
                <StatCard label={t.overview.analyzed} value={s.memes.analyzed} href="/admin/content?status=success" />
                <StatCard label={t.overview.pending} value={s.memes.pending} href="/admin/content?status=pending" />
                <StatCard label={t.status.failed} value={s.memes.failed} tone={s.memes.failed ? 'danger' : undefined} href="/admin/content?status=failed" />
                <StatCard label={t.overview.folders} value={s.library.folders} />
                <StatCard label={t.overview.files} value={s.library.files} />
                <StatCard label={t.overview.publicNodes} value={s.library.public_nodes} />
                <StatCard label={t.overview.tags} value={s.library.tags} href="/admin/tags" />
              </Section>

              <Section title={t.overview.tasks}>
                {states.map((st) => (
                  <StatCard
                    key={st}
                    label={t.admin.taskStates[st]}
                    value={sum(tasks, st)}
                    tone={st === 'failed' && sum(tasks, st) ? 'danger' : undefined}
                    href={`/admin/tasks?status=${st}`}
                  />
                ))}
                <StatCard label={t.overview.backlog} value={backlog} tone={backlog > 5 ? 'warn' : undefined} hint={t.overview.backlogHint} href="/admin/tasks?status=pending&status=retrying" />
                <StatCard label={t.overview.completedInRange} value={doneN} href="/admin/tasks?status=completed" />
                <StatCard label={t.overview.failRate} value={`${rate}%`} hint={t.overview.failedCount(failN)} tone={rate > 20 ? 'danger' : undefined} href="/admin/tasks?status=failed" />
              </Section>

              <section aria-labelledby="by-type" className="flex flex-col gap-3">
                <h2 id="by-type" className="text-sm font-medium text-muted-foreground">
                  {t.overview.byType}
                </h2>
                <div className="overflow-x-auto rounded-xl border bg-card">
                  <table className="w-full min-w-[520px] text-sm">
                    <thead className="text-left text-xs text-muted-foreground">
                      <tr className="border-b">
                        <th className="p-3 font-medium">{t.overview.type}</th>
                        {(['pending', 'running', 'completed', 'failed'] as const).map((st) => (
                          <th key={st} className="p-3 text-right font-medium">
                            {t.admin.taskStates[st]}
                          </th>
                        ))}
                        <th className="p-3 text-right font-medium">{t.overview.failRate}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tasks.map((row) => {
                        const r = failRate(row.failed_in_range, row.completed_in_range)
                        return (
                          <tr key={row.job_type} className="border-b last:border-0">
                            <td className="p-3">{jobLabel(row.job_type, t)}</td>
                            {[row.pending + row.retrying, row.running, row.completed, row.failed].map((n, i) => (
                              <td key={i} className="p-3 text-right tabular-nums">
                                {n}
                              </td>
                            ))}
                            <td className="p-3 text-right tabular-nums">{r === null ? '—' : `${r}%`}</td>
                          </tr>
                        )
                      })}
                      {tasks.length === 0 && (
                        <tr>
                          <td colSpan={6} className="p-6 text-center text-muted-foreground">
                            {t.overview.noTasks}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              <section aria-labelledby="trend" className="flex flex-col gap-3">
                <h2 id="trend" className="text-sm font-medium text-muted-foreground">
                  {t.overview.trend}
                </h2>
                <div className="rounded-xl border bg-card p-3 sm:p-4">
                  <ChartContainer config={chartConfig} className="aspect-auto h-64 w-full sm:h-72">
                    <BarChart data={trend} margin={{ left: -20, right: 4 }}>
                      <CartesianGrid vertical={false} />
                      <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} minTickGap={16} />
                      <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={40} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <ChartLegend content={<ChartLegendContent className="flex-wrap" />} />
                      <Bar dataKey="uploads" fill="var(--color-uploads)" radius={3} />
                      <Bar dataKey="users" fill="var(--color-users)" radius={3} />
                      <Bar dataKey="completed" fill="var(--color-completed)" radius={3} />
                      <Bar dataKey="failed" fill="var(--color-failed)" radius={3} />
                    </BarChart>
                  </ChartContainer>
                </div>
              </section>
            </>
          )
        }}
      </Loadable>
    </>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-3">
      <h2 className="text-sm font-medium text-muted-foreground">{title}</h2>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4 xl:grid-cols-6">{children}</div>
    </section>
  )
}
