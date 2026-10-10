'use client'

import { useMemo, useState } from 'react'
import useSWR from 'swr'
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loadable } from '@/components/loadable'
import { AdminPageHeader, FilterSelect, RefreshControls, StatCard, useNow } from './admin-ui'
import { jobLabel, taskStateLabel } from './labels'
import { qs } from '@/lib/api'
import { formatBytes, formatDateTime } from '@/lib/format'
import type { Overview, TaskState, TaskTypeCounts } from '@/lib/types'
import { cn } from '@/lib/utils'

const DAY = 86_400_000
type Range = '1d' | '7d' | '30d' | 'custom'
const toInput = (t: number) => new Date(t - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone

const chartConfig = {
  uploads: { label: '上传', color: 'var(--chart-1)' },
  users: { label: '新增用户', color: 'var(--chart-2)' },
  completed: { label: '任务完成', color: 'var(--chart-3)' },
  failed: { label: '任务失败', color: 'var(--destructive)' },
} satisfies ChartConfig

const states: TaskState[] = ['pending', 'retrying', 'running', 'completed', 'failed']
const sum = (rows: TaskTypeCounts[], key: keyof Omit<TaskTypeCounts, 'job_type'>) => rows.reduce((n, r) => n + r[key], 0)
const failRate = (failed: number, completed: number) => (failed + completed ? Math.round((failed / (failed + completed)) * 100) : null)

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
  const rangeQ = `from=${start}&to=${end}`

  return (
    <>
      <AdminPageHeader
        title="概览"
        description={`更新于 ${formatDateTime(now)}`}
        actions={<RefreshControls auto={auto} onAutoChange={setAuto} onRefresh={() => stats.mutate()} />}
      />

      <section aria-label="时间范围" className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
        <FilterSelect
          label="时间范围"
          value={range}
          onChange={setRange}
          options={[
            ['1d', '最近一天'],
            ['7d', '最近一周'],
            ['30d', '最近一个月'],
            ['custom', '自定义'],
          ]}
          className="sm:w-36"
        />
        {range === 'custom' && (
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <div className="flex flex-col gap-1">
              <Label htmlFor="from" className="text-xs text-muted-foreground">
                开始
              </Label>
              <Input id="from" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="h-10 text-base md:h-9 md:text-sm" />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="to" className="text-xs text-muted-foreground">
                结束
              </Label>
              <Input id="to" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} aria-invalid={customInvalid} className="h-10 text-base md:h-9 md:text-sm" />
            </div>
          </div>
        )}
        {customInvalid && <p className="text-sm text-destructive">结束时间不能早于开始时间</p>}
      </section>

      <Loadable result={stats}>
        {(s) => {
          const t = s.tasks
          const backlog = sum(t, 'pending') + sum(t, 'retrying')
          const doneN = sum(t, 'completed_in_range')
          const failN = sum(t, 'failed_in_range')
          const rate = failRate(failN, doneN) ?? 0
          const trend = s.trend.map((p) => ({ ...p, day: `${Number(p.day.slice(5, 7))}/${Number(p.day.slice(8))}` }))
          return (
            <>
              <Section title="用户">
                <StatCard label="用户总数" value={s.users.total} href="/admin/users" />
                <StatCard label="管理员" value={s.users.admins} href="/admin/users?role=admin" />
                <StatCard label="新增用户" value={s.users.new} hint="所选时间范围" href={`/admin/users?${rangeQ}`} />
              </Section>

              <Section title="内容">
                <StatCard label="表情包总数" value={s.memes.total} href="/admin/content" />
                <StatCard label="存储占用" value={formatBytes(s.memes.storage_bytes)} />
                <StatCard label="公开表情包" value={s.memes.public} href="/admin/content?visibility=public" />
                <StatCard label="处理完成" value={s.memes.analyzed} href="/admin/content?status=success" />
                <StatCard label="排队 / 处理中" value={s.memes.pending} href="/admin/content?status=pending" />
                <StatCard label="处理失败" value={s.memes.failed} tone={s.memes.failed ? 'danger' : undefined} href="/admin/content?status=failed" />
              </Section>

              <Section title="库与标签">
                <StatCard label="文件夹" value={s.library.folders} />
                <StatCard label="库中文件" value={s.library.files} />
                <StatCard label="公开条目" value={s.library.public_nodes} />
                <StatCard label="标签总数" value={s.library.tags} href="/admin/tags" />
              </Section>

              <Section title="任务">
                {states.map((st) => (
                  <StatCard
                    key={st}
                    label={taskStateLabel[st]}
                    value={sum(t, st)}
                    tone={st === 'failed' && sum(t, st) ? 'danger' : undefined}
                    href={`/admin/tasks?view=${st === 'completed' || st === 'failed' ? 'history' : 'active'}&status=${st}`}
                  />
                ))}
                <StatCard label="积压" value={backlog} tone={backlog > 5 ? 'warn' : undefined} hint="排队中 + 等待重试" href="/admin/tasks?view=active" />
                <StatCard label="区间完成" value={doneN} href="/admin/tasks?view=history&status=completed" />
                <StatCard label="区间失败率" value={`${rate}%`} hint={`失败 ${failN} 个`} tone={rate > 20 ? 'danger' : undefined} href="/admin/tasks?view=history&status=failed" />
              </Section>

              <section aria-labelledby="by-type" className="flex flex-col gap-3">
                <h2 id="by-type" className="text-sm font-medium text-muted-foreground">
                  按任务类型
                </h2>
                <div className="overflow-x-auto rounded-xl border bg-card">
                  <table className="w-full min-w-[520px] text-sm">
                    <thead className="text-left text-xs text-muted-foreground">
                      <tr className="border-b">
                        <th className="p-3 font-medium">类型</th>
                        {(['pending', 'running', 'completed', 'failed'] as const).map((st) => (
                          <th key={st} className="p-3 text-right font-medium">
                            {taskStateLabel[st]}
                          </th>
                        ))}
                        <th className="p-3 text-right font-medium">区间失败率</th>
                      </tr>
                    </thead>
                    <tbody>
                      {t.map((row) => {
                        const r = failRate(row.failed_in_range, row.completed_in_range)
                        return (
                          <tr key={row.job_type} className="border-b last:border-0">
                            <td className="p-3">{jobLabel(row.job_type)}</td>
                            {[row.pending + row.retrying, row.running, row.completed, row.failed].map((n, i) => (
                              <td key={i} className="p-3 text-right tabular-nums">
                                {n}
                              </td>
                            ))}
                            <td className="p-3 text-right tabular-nums">{r === null ? '—' : `${r}%`}</td>
                          </tr>
                        )
                      })}
                      {t.length === 0 && (
                        <tr>
                          <td colSpan={6} className="p-6 text-center text-muted-foreground">
                            暂无任务
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              <section aria-labelledby="trend" className="flex flex-col gap-3">
                <h2 id="trend" className="text-sm font-medium text-muted-foreground">
                  每日趋势
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

              <section aria-labelledby="system" className="flex flex-col gap-3">
                <h2 id="system" className="text-sm font-medium text-muted-foreground">
                  系统状态
                </h2>
                <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {s.services.map((sv) => (
                    <li key={sv.name} className="flex items-center gap-3 rounded-xl border bg-card p-3.5">
                      <span className={cn('size-2.5 shrink-0 rounded-full', sv.ok ? 'bg-success' : 'bg-warning')} aria-hidden />
                      <div className="flex min-w-0 flex-col">
                        <span className="text-sm font-medium">{sv.name}</span>
                        <span className="truncate text-xs text-muted-foreground">
                          <span className="sr-only">{sv.ok ? '正常：' : '异常：'}</span>
                          {sv.detail}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
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
