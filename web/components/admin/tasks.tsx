'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import useSWR from 'swr'
import { ArrowLeft, Ban, Eye, ListChecks, Play, RotateCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { EmptyState } from '@/components/states'
import { Loadable } from '@/components/loadable'
import {
  AdminPageHeader,
  BulkBar,
  CopyId,
  DataList,
  ExpandableText,
  FilterSelect,
  Pagination,
  RefreshControls,
  SearchInput,
  StatCard,
  Toolbar,
  useDebounced,
  useNow,
  usePaging,
  type Column,
} from './admin-ui'
import { TaskStatusBadge, jobLabel, taskState, taskStateLabel } from './labels'
import { ConfirmDialog, rangeOptions, rangeStart, useSelection, type RangeKey } from './shared'
import { api, refresh } from '@/lib/api'
import { formatDateTime, formatDuration, formatRelative, toMs } from '@/lib/format'
import type { Page, Task, TaskBatchCounts, TaskDetail, TaskState, TaskTypeCounts } from '@/lib/types'
import { cn, qs } from '@/lib/utils'
import { TabSwitch } from '@/components/tab-switch'

const activeStates: TaskState[] = ['pending', 'retrying', 'running']
const historyStates: TaskState[] = ['completed', 'failed']
const allStates = [...activeStates, ...historyStates]
type SortKey = 'due' | 'created' | 'finished'
const sortOptions = [
  ['due', '按计划执行时间'],
  ['created', '按创建时间'],
  ['finished', '按结束时间'],
] as const

const canRunNow = (t: Task, now: number) => t.status === 'pending' && toMs(t.run_at) > now

type RetryTarget = { ids: string[] } | { filter: Record<string, unknown> }
type Pending = { kind: 'retry'; target: RetryTarget; count: number; scope: string } | { kind: 'cancel'; task: Task } | { kind: 'cancelBatch'; task: Task } | null

function useTaskActions() {
  const [pending, setPending] = useState<Pending>(null)

  const runNow = async (t: Task) => {
    try {
      await api(`/admin/tasks/${t.id}/run`, { method: 'POST' })
      await refresh()
      toast.success('任务已提前到现在执行')
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const dialogs = (
    <>
      <ConfirmDialog
        open={pending?.kind === 'retry'}
        onOpenChange={(o) => !o && setPending(null)}
        title="重试任务"
        description={pending?.kind === 'retry' ? `将重试${pending.scope}共 ${pending.count} 个失败任务。任务会重新排队，已尝试次数清零。` : ''}
        confirmLabel="重试"
        onConfirm={async () => {
          if (pending?.kind !== 'retry') return
          const { count } = await api<{ count: number }>('/admin/tasks/retry', { method: 'POST', json: pending.target })
          await refresh()
          toast.success(`已重新排队 ${count} 个任务`)
        }}
      />
      <ConfirmDialog
        open={pending?.kind === 'cancel'}
        onOpenChange={(o) => !o && setPending(null)}
        title="取消任务"
        destructive
        description="任务会被标记为失败；如有关联的表情包，它会显示为处理失败。"
        confirmLabel="取消任务"
        onConfirm={async () => {
          if (pending?.kind !== 'cancel') return
          await api(`/admin/tasks/${pending.task.id}/cancel`, { method: 'POST' })
          await refresh()
          toast.success('任务已取消')
        }}
      />
      <ConfirmDialog
        open={pending?.kind === 'cancelBatch'}
        onOpenChange={(o) => !o && setPending(null)}
        title="取消批次"
        destructive
        description={
          pending?.kind === 'cancelBatch'
            ? `批次中排队的 ${pending.task.batch?.pending} 个任务会被标记为失败，执行中的任务会继续完成。${pending.task.job_type === 'analyze_meme' ? '对应的表情包会显示为处理失败。' : ''}`
            : ''
        }
        confirmLabel="取消批次"
        onConfirm={async () => {
          if (pending?.kind !== 'cancelBatch') return
          const { count } = await api<{ count: number }>(`/admin/tasks/batches/${pending.task.id}/cancel`, { method: 'POST' })
          await refresh()
          toast.success(`已取消 ${count} 个排队中的任务`)
        }}
      />
    </>
  )

  return {
    dialogs,
    runNow,
    retry: (tasks: Task[], scope = '') => setPending({ kind: 'retry', target: { ids: tasks.map((t) => t.id) }, count: tasks.length, scope }),
    retryAll: (filter: Record<string, unknown>, count: number) => setPending({ kind: 'retry', target: { filter }, count, scope: '当前筛选下的全部' }),
    cancel: (task: Task) => setPending({ kind: 'cancel', task }),
    retryBatch: (batch: Task) => setPending({ kind: 'retry', target: { filter: { batch: batch.id } }, count: batch.batch?.failed ?? 0, scope: '该批次的' }),
    cancelBatch: (batch: Task) => setPending({ kind: 'cancelBatch', task: batch }),
  }
}

function BatchProgress({ counts: b }: { counts: TaskBatchCounts }) {
  const done = b.completed + b.failed
  return (
    <div className="flex w-28 flex-col gap-1">
      <Progress value={(done / b.total) * 100} aria-label="批次进度" />
      <span className="text-xs text-muted-foreground tabular-nums">
        {done} / {b.total}
      </span>
    </div>
  )
}

function StateChips({ states, selected, onToggle }: { states: TaskState[]; selected: TaskState[]; onToggle: (st: TaskState) => void }) {
  return states.map((st) => {
    const on = selected.includes(st)
    return (
      <button
        key={st}
        type="button"
        aria-pressed={on}
        onClick={() => onToggle(st)}
        className={cn('h-9 rounded-full border px-3.5 text-sm transition-colors', on ? 'border-foreground bg-foreground text-background' : 'bg-background text-muted-foreground hover:text-foreground')}
      >
        {taskStateLabel[st]}
      </button>
    )
  })
}

/** The columns of a task table; a batch's row shows its progress beneath its status and links to its page. */
function taskColumns(now: number): Column<Task>[] {
  return [
    {
      key: 'id',
      header: '任务',
      mobile: 'title',
      cell: (t) => (
        <div className="flex min-w-0 flex-col gap-0.5">
          <Link href={t.batch ? `/admin/tasks/batches/${t.id}` : `/admin/tasks/${t.id}`} className="truncate font-medium hover:underline">
            {jobLabel(t.job_type)}
            {t.batch && ' · 批次'}
          </Link>
          <CopyId value={t.id} className="text-muted-foreground" />
        </div>
      ),
    },
    {
      key: 'status',
      header: '状态',
      cell: (t) => (
        <div className="flex flex-col items-start gap-1.5">
          <TaskStatusBadge status={taskState(t)} />
          {t.batch && <BatchProgress counts={t.batch} />}
        </div>
      ),
    },
    {
      key: 'attempts',
      header: '尝试',
      className: 'w-20',
      cell: (t) => (t.batch ? <span className="text-muted-foreground">—</span> : <span className="tabular-nums">{t.attempts}/{t.max_attempts} 次</span>),
    },
    { key: 'scheduled', header: '计划执行', cell: (t) => <span className="tabular-nums whitespace-nowrap">{formatDateTime(t.run_at)}</span> },
    { key: 'started', header: '开始', mobile: 'hidden', cell: (t) => <span className="tabular-nums whitespace-nowrap">{t.started_at ? formatDateTime(t.started_at) : '—'}</span> },
    { key: 'finished', header: '结束', cell: (t) => <span className="tabular-nums whitespace-nowrap">{t.finished_at ? formatDateTime(t.finished_at) : '—'}</span> },
    { key: 'time', header: '耗时', cell: (t) => <TimeCell task={t} now={now} /> },
    {
      key: 'error',
      header: '错误',
      className: 'max-w-56',
      cell: (t) =>
        t.batch?.failed ? (
          <span className="text-destructive tabular-nums">失败 {t.batch.failed} 个</span>
        ) : t.error_message ? (
          <span className="text-destructive">
            <ExpandableText text={t.error_message} max={24} />
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: 'recurring',
      header: '周期',
      cell: (t) => (t.cron ? <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{t.cron}</span> : <span className="text-muted-foreground">—</span>),
    },
  ]
}

function TimeCell({ task, now }: { task: Task; now: number }) {
  const state = taskState(task)
  if (state === 'running' && task.started_at) return <span className="tabular-nums text-info">已运行 {formatDuration(Math.max(0, now - toMs(task.started_at)))}</span>
  if (task.started_at && task.finished_at) return <span className="tabular-nums">{formatDuration(toMs(task.finished_at) - toMs(task.started_at))}</span>
  return <span className="text-muted-foreground">—</span>
}

function TaskActionItems({ task, now, actions }: { task: Task; now: number; actions: ReturnType<typeof useTaskActions> }) {
  if (task.batch)
    return (
      <>
        <DropdownMenuItem render={<Link href={`/admin/tasks/batches/${task.id}`} />}>
          <Eye />
          查看详情
        </DropdownMenuItem>
        {task.batch.failed > 0 && (
          <DropdownMenuItem onClick={() => actions.retryBatch(task)}>
            <RotateCw />
            重试失败
          </DropdownMenuItem>
        )}
        {task.batch.pending > 0 && (
          <DropdownMenuItem variant="destructive" onClick={() => actions.cancelBatch(task)}>
            <Ban />
            取消排队
          </DropdownMenuItem>
        )}
      </>
    )
  return (
    <>
      <DropdownMenuItem render={<Link href={`/admin/tasks/${task.id}`} />}>
        <Eye />
        查看详情
      </DropdownMenuItem>
      {task.status === 'failed' && !task.parent_task_id && (
        <DropdownMenuItem onClick={() => actions.retry([task])}>
          <RotateCw />
          重试
        </DropdownMenuItem>
      )}
      {canRunNow(task, now) && (
        <DropdownMenuItem onClick={() => actions.runNow(task)}>
          <Play />
          立即执行
        </DropdownMenuItem>
      )}
      {task.status === 'pending' && (
        <DropdownMenuItem variant="destructive" onClick={() => actions.cancel(task)}>
          <Ban />
          取消
        </DropdownMenuItem>
      )}
      {(task.status === 'running' || task.status === 'completed') && <p className="px-2 py-1.5 text-xs text-muted-foreground">执行中和已完成的任务不提供操作</p>}
    </>
  )
}

/* --------------------------------- list ---------------------------------- */

export function AdminTasks() {
  const params = useSearchParams()
  const [view, setView] = useState<'active' | 'history'>(params.get('view') === 'history' ? 'history' : 'active')
  const [states, setStates] = useState<TaskState[]>(() => {
    const st = params.get('status') as TaskState | null
    return st && allStates.includes(st) ? [st] : []
  })
  const [type, setType] = useState('all')
  const [range, setRange] = useState<RangeKey>('all')
  const from = useMemo(() => rangeStart(range), [range])
  const [recurringOnly, setRecurringOnly] = useState(false)
  const [q, setQ] = useState(params.get('meme') ?? '')
  const dq = useDebounced(q.trim())
  const [sort, setSort] = useState<SortKey>(view === 'history' ? 'finished' : 'due')
  const [autoByView, setAutoByView] = useState({ active: true, history: false })
  const auto = autoByView[view]
  const now = useNow(auto, 1000)
  const actions = useTaskActions()

  const viewStates = view === 'active' ? activeStates : historyStates
  const effectiveStates = states.filter((st) => viewStates.includes(st))
  const refreshInterval = auto ? 3000 : 0

  const switchView = (v: 'active' | 'history') => {
    setView(v)
    setStates([])
    setSort(v === 'history' ? 'finished' : 'due')
  }

  const filter = {
    state: effectiveStates.length ? effectiveStates : viewStates,
    type: type === 'all' ? '' : type,
    q: dq,
    from,
    recurring: recurringOnly,
    sort,
  }
  const paging = usePaging(JSON.stringify(filter))
  // Each batch shows as one row.
  const tasks = useSWR<Page<Task>>(`/admin/tasks${qs({ ...filter, group: true, ...paging.query })}`, { refreshInterval, keepPreviousData: true })
  const { data: summary = [] } = useSWR<TaskTypeCounts[]>('/admin/tasks/summary', { refreshInterval })

  const rows = tasks.data?.items ?? []
  const sel = useSelection(paging.pageKey)
  const selectedFailed = rows.filter((t) => sel.ids.has(t.id) && t.status === 'failed' && !t.batch)
  // Failed tasks anywhere in the current filter, for retrying them all at once.
  const failedFilter = { ...filter, state: ['failed'] }
  const canRetryAll = view === 'history' && filter.state.includes('failed')
  const { data: failedInFilter } = useSWR<Page<Task>>(canRetryAll ? `/admin/tasks${qs({ ...failedFilter, page_size: 1 })}` : null, { refreshInterval })

  const count = (st: TaskState) => summary.reduce((n, r) => n + r[st], 0)
  const backlog = count('pending') + count('retrying')
  const typeOptions = [['all', '全部类型'] as const, ...summary.map((r) => [r.job_type, jobLabel(r.job_type)] as const)]

  const toggleState = (st: TaskState) => setStates((cur) => (cur.includes(st) ? cur.filter((x) => x !== st) : [...cur, st]))

  const columns = taskColumns(now)

  return (
    <>
      <AdminPageHeader
        title="任务管理"
        description="后台处理任务的执行情况与积压"
        actions={
          <RefreshControls
            auto={auto}
            onAutoChange={(v) => setAutoByView((cur) => ({ ...cur, [view]: v }))}
            onRefresh={() => {
              void tasks.mutate()
              toast.success('已刷新')
            }}
          />
        }
      />

      <section aria-label="任务概况" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {(['running', 'pending', 'retrying', 'completed', 'failed'] as TaskState[]).map((st) => (
          <StatCard key={st} label={taskStateLabel[st]} value={count(st)} tone={st === 'failed' && count(st) ? 'danger' : undefined} />
        ))}
        <StatCard label="积压" value={backlog} hint="排队中 + 等待重试" tone={backlog > 5 ? 'warn' : undefined} />
      </section>
      <section aria-label="按类型" className="flex flex-wrap gap-2 text-xs text-muted-foreground">
        {summary.map((r) => (
          <span key={r.job_type} className="rounded-full border bg-background px-3 py-1.5">
            {jobLabel(r.job_type)} <span className="font-medium text-foreground tabular-nums">{allStates.reduce((n, st) => n + r[st], 0)}</span>
            {' · '}活跃 {r.pending + r.retrying + r.running}
          </span>
        ))}
      </section>

      <div className="flex flex-col gap-3">
        <TabSwitch
          fill
          label="任务视图"
          value={view}
          onChange={switchView}
          tabs={[
            ['active', '活跃'],
            ['history', '历史'],
          ]}
        />

        <Toolbar>
          <SearchInput value={q} onChange={setQ} placeholder="任务标识或表情包标识" className="basis-full sm:basis-auto" />
          <FilterSelect value={type} onChange={setType} options={typeOptions} label="任务类型" />
          <FilterSelect value={range} onChange={setRange} options={rangeOptions} label="创建时间" />
          <FilterSelect value={sort} onChange={setSort} options={sortOptions} label="排序" />
          <div className="flex h-10 items-center gap-2 md:h-9">
            <Switch id="recurring-only" checked={recurringOnly} onCheckedChange={setRecurringOnly} />
            <Label htmlFor="recurring-only" className="font-normal whitespace-nowrap">
              只看周期任务
            </Label>
          </div>
        </Toolbar>

        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="按状态筛选（可多选）">
          <StateChips states={viewStates} selected={effectiveStates} onToggle={toggleState} />
          {canRetryAll && !!failedInFilter?.total && (
            <Button variant="outline" className="ml-auto h-9" onClick={() => actions.retryAll(failedFilter, failedInFilter.total)}>
              <RotateCw aria-hidden />
              重试全部失败（{failedInFilter.total}）
            </Button>
          )}
        </div>
      </div>

      <DataList
        rows={rows}
        loading={!tasks.data}
        columns={columns}
        getId={(t) => t.id}
        rowLabel={(t) => t.id}
        selected={sel.ids}
        onSelectedChange={sel.set}
        empty={<EmptyState icon={ListChecks} title="没有符合条件的任务" description="试试调整筛选条件或切换视图。" className="border-0" />}
        actions={(t) => <TaskActionItems task={t} now={now} actions={actions} />}
      />
      <Pagination paging={paging} total={tasks.data?.total ?? 0} />

      <BulkBar count={sel.ids.size} onClear={sel.clear}>
        <Button
          size="sm"
          variant="secondary"
          disabled={!selectedFailed.length}
          title={selectedFailed.length ? undefined : '所选任务中没有失败的任务'}
          onClick={() => actions.retry(selectedFailed, '所选的')}
        >
          <RotateCw aria-hidden />
          重试失败（{selectedFailed.length}）
        </Button>
      </BulkBar>
      {actions.dialogs}
    </>
  )
}

/* -------------------------------- detail --------------------------------- */

export function AdminTaskDetail({ id }: { id: string }) {
  const detail = useSWR<TaskDetail>(`/admin/tasks/${id}`, {
    refreshInterval: (t) => (t && (t.status === 'running' || t.status === 'pending') ? 3000 : 0),
  })
  const now = useNow(detail.data?.status === 'running', 1000)
  const actions = useTaskActions()

  return (
    <>
      <Link href="/admin/tasks" className="-mb-2 flex h-10 w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden />
        任务列表
      </Link>
      <Loadable result={detail} notFound={{ title: '任务不存在', description: '该任务可能已被清理。' }}>
        {(task) => {
          const asset = typeof task.payload.asset_id === 'string' ? task.payload.asset_id : null
          const timeline: TimelineEvent[] = [
            { at: task.created_at, label: '创建', tone: 'muted' },
            ...task.history.map((h, i): TimelineEvent => ({
              at: h.at,
              label: `第 ${i + 1} 次尝试${h.ok ? '成功' : '失败'}`,
              tone: h.ok ? 'ok' : 'fail',
              message: h.error ?? undefined,
            })),
            ...(task.status === 'running' && task.started_at ? [{ at: task.started_at, label: `第 ${task.history.length + 1} 次尝试执行中`, tone: 'muted' as const }] : []),
            ...(task.finished_at
              ? [{ at: task.finished_at, label: task.status === 'completed' ? '结束：成功' : '结束：失败', tone: task.status === 'completed' ? ('ok' as const) : ('fail' as const), message: task.error_message ?? undefined }]
              : []),
          ]
          timeline.sort((a, b) => toMs(a.at) - toMs(b.at))
          const info: [string, React.ReactNode][] = [
            ['任务标识', <CopyId key="id" value={task.id} />],
            ['类型', jobLabel(task.job_type)],
            ['状态', <TaskStatusBadge key="st" status={taskState(task)} />],
            ['已尝试次数', `${task.attempts} / ${task.max_attempts} 次`],
            ['单次超时', task.timeout_secs % 60 ? `${task.timeout_secs} 秒` : `${task.timeout_secs / 60} 分钟`],
            ['创建时间', formatDateTime(task.created_at)],
            ['计划执行时间', formatDateTime(task.run_at)],
            ['开始时间', task.started_at ? formatDateTime(task.started_at) : '—'],
            ['结束时间', task.finished_at ? formatDateTime(task.finished_at) : '—'],
            ['耗时 / 进度', <TimeCell key="t" task={task} now={now} />],
            ['周期任务', task.cron ? <span className="font-mono">{task.cron}</span> : '否'],
          ]

          return (
            <>
              <AdminPageHeader
                title={jobLabel(task.job_type)}
                description={task.id}
                actions={
                  <>
                    {task.status === 'failed' && !task.parent_task_id && (
                      <Button className="h-10 md:h-9" onClick={() => actions.retry([task])}>
                        <RotateCw aria-hidden />
                        重试
                      </Button>
                    )}
                    {canRunNow(task, now) && (
                      <Button variant="outline" className="h-10 md:h-9" onClick={() => actions.runNow(task)}>
                        <Play aria-hidden />
                        立即执行
                      </Button>
                    )}
                    {task.status === 'pending' && (
                      <Button variant="outline" className="h-10 text-destructive md:h-9" onClick={() => actions.cancel(task)}>
                        <Ban aria-hidden />
                        取消
                      </Button>
                    )}
                  </>
                }
              />

              <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
                <div className="flex min-w-0 flex-col gap-4">
                  <section className="rounded-xl border bg-card p-4 sm:p-5">
                    <h2 className="mb-3 text-sm font-medium">基本信息</h2>
                    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                      {info.map(([k, v]) => (
                        <div key={k} className="flex min-w-0 flex-col gap-0.5">
                          <dt className="text-xs text-muted-foreground">{k}</dt>
                          <dd className="min-w-0">{v}</dd>
                        </div>
                      ))}
                    </dl>
                  </section>

                  {task.error_message && (
                    <section className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 sm:p-5">
                      <h2 className="mb-2 text-sm font-medium text-destructive">错误信息</h2>
                      <pre className="overflow-x-auto font-mono text-xs leading-relaxed break-all whitespace-pre-wrap">{task.error_message}</pre>
                    </section>
                  )}

                  <section className="rounded-xl border bg-card p-4 sm:p-5">
                    <h2 className="mb-4 text-sm font-medium">执行过程</h2>
                    <Timeline events={timeline} />
                  </section>

                  {task.runs.length > 0 && (
                    <section className="rounded-xl border bg-card p-4 sm:p-5">
                      <h2 className="mb-4 text-sm font-medium">历次执行记录</h2>
                      <Timeline
                        events={task.runs.map((r) => ({
                          at: r.finished_at ?? r.created_at,
                          label: r.status === 'completed' ? '执行成功' : '执行失败',
                          tone: r.status === 'completed' ? ('ok' as const) : ('fail' as const),
                          message: r.error_message ?? undefined,
                        }))}
                      />
                    </section>
                  )}
                </div>

                <aside className="flex flex-col gap-4">
                  {task.cron && (
                    <section className="rounded-xl border bg-card p-4 sm:p-5">
                      <h2 className="mb-3 text-sm font-medium">执行计划</h2>
                      <dl className="flex flex-col gap-3 text-sm">
                        <div className="flex justify-between gap-3">
                          <dt className="text-muted-foreground">计划</dt>
                          <dd className="font-mono">{task.cron}</dd>
                        </div>
                        <div className="flex justify-between gap-3">
                          <dt className="text-muted-foreground">下一次执行</dt>
                          <dd className="text-right tabular-nums">
                            {formatDateTime(task.run_at)}
                            <span className="block text-xs text-muted-foreground">{formatRelative(task.run_at)}</span>
                          </dd>
                        </div>
                      </dl>
                    </section>
                  )}
                  {asset && (
                    <section className="rounded-xl border bg-card p-4 sm:p-5">
                      <h2 className="mb-3 text-sm font-medium">关联对象</h2>
                      <div className="flex flex-col gap-2">
                        <Link href={`/m/${asset}`} className="text-sm font-medium break-all underline-offset-2 hover:underline">
                          查看表情包 {asset}
                        </Link>
                        <Link href={`/admin/content?q=${asset}`} className="text-sm text-muted-foreground underline-offset-2 hover:underline">
                          在内容管理中查看
                        </Link>
                      </div>
                    </section>
                  )}
                </aside>
              </div>
            </>
          )
        }}
      </Loadable>
      {actions.dialogs}
    </>
  )
}

/* --------------------------------- batch ---------------------------------- */

export function AdminBatchDetail({ id }: { id: string }) {
  const batch = useSWR<Task>(`/admin/tasks/batches/${id}`, { refreshInterval: (b) => (b?.batch && b.batch.pending + b.batch.running ? 3000 : 0) })
  const active = Boolean(batch.data?.batch && batch.data.batch.pending + batch.data.batch.running)
  const now = useNow(active, 1000)
  const actions = useTaskActions()
  const [states, setStates] = useState<TaskState[]>([])
  const paging = usePaging(states.join())
  const tasks = useSWR<Page<Task>>(`/admin/tasks${qs({ batch: id, state: states, sort: 'created', ...paging.query })}`, {
    refreshInterval: active ? 3000 : 0,
    keepPreviousData: true,
  })
  const toggleState = (st: TaskState) => setStates((cur) => (cur.includes(st) ? cur.filter((x) => x !== st) : [...cur, st]))

  return (
    <>
      <Link href="/admin/tasks" className="-mb-2 flex h-10 w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden />
        任务列表
      </Link>
      <Loadable result={batch} notFound={{ title: '批次不存在', description: '该批次的任务可能已被清理。' }}>
        {(b) => {
          const c = b.batch ?? { total: 0, pending: 0, running: 0, completed: 0, failed: 0 }
          const done = c.completed + c.failed
          const info: [string, React.ReactNode][] = [
            ['批次标识', <CopyId key="id" value={b.id} />],
            ['状态', <TaskStatusBadge key="st" status={taskState(b)} />],
            ['创建时间', formatDateTime(b.created_at)],
            ['开始时间', b.started_at ? formatDateTime(b.started_at) : '—'],
            ['结束时间', b.finished_at ? formatDateTime(b.finished_at) : '—'],
            ['耗时', <TimeCell key="t" task={b} now={now} />],
          ]
          return (
            <>
              <AdminPageHeader
                title={`${jobLabel(b.job_type)} · 批次`}
                description={`共 ${c.total} 个任务`}
                actions={
                  <>
                    {c.failed > 0 && (
                      <Button className="h-10 md:h-9" onClick={() => actions.retryBatch(b)}>
                        <RotateCw aria-hidden />
                        重试失败（{c.failed}）
                      </Button>
                    )}
                    {c.pending > 0 && (
                      <Button variant="outline" className="h-10 text-destructive md:h-9" onClick={() => actions.cancelBatch(b)}>
                        <Ban aria-hidden />
                        取消排队（{c.pending}）
                      </Button>
                    )}
                  </>
                }
              />

              <section aria-label="批次概况" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <StatCard label="已完成" value={c.completed} />
                <StatCard label="失败" value={c.failed} tone={c.failed ? 'danger' : undefined} />
                <StatCard label="执行中" value={c.running} />
                <StatCard label="排队中" value={c.pending} hint="含等待重试" />
              </section>

              <section className="rounded-xl border bg-card p-4 sm:p-5">
                <div className="mb-3 flex items-baseline justify-between gap-3">
                  <h2 className="text-sm font-medium">进度</h2>
                  <span className="text-sm tabular-nums">
                    {done} / {c.total}
                  </span>
                </div>
                <Progress value={c.total ? (done / c.total) * 100 : 0} aria-label="批次进度" />
                <dl className="mt-5 grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
                  {info.map(([k, v]) => (
                    <div key={k} className="flex min-w-0 flex-col gap-0.5">
                      <dt className="text-xs text-muted-foreground">{k}</dt>
                      <dd className="min-w-0">{v}</dd>
                    </div>
                  ))}
                </dl>
              </section>

              <section aria-label="批次中的任务" className="flex flex-col gap-3">
                <h2 className="text-sm font-medium">批次中的任务</h2>
                <div className="flex flex-wrap items-center gap-2" role="group" aria-label="按状态筛选（可多选）">
                  <StateChips states={allStates} selected={states} onToggle={toggleState} />
                </div>
                <DataList
                  rows={tasks.data?.items ?? []}
                  loading={!tasks.data}
                  columns={taskColumns(now)}
                  getId={(t) => t.id}
                  rowLabel={(t) => t.id}
                  empty={<EmptyState icon={ListChecks} title="没有符合条件的任务" description="试试调整状态筛选。" className="border-0" />}
                  actions={(t) => <TaskActionItems task={t} now={now} actions={actions} />}
                />
                <Pagination paging={paging} total={tasks.data?.total ?? 0} />
              </section>
            </>
          )
        }}
      </Loadable>
      {actions.dialogs}
    </>
  )
}

type TimelineEvent = { at: string; label: string; tone: 'muted' | 'ok' | 'fail'; message?: string }

function Timeline({ events }: { events: TimelineEvent[] }) {
  return (
    <ol className="relative flex flex-col gap-4 border-l pl-5">
      {events.map((e, i) => (
        <li key={i} className="relative">
          <span
            className={cn('absolute top-1 -left-[25px] size-2.5 rounded-full ring-4 ring-card', e.tone === 'ok' ? 'bg-success' : e.tone === 'fail' ? 'bg-destructive' : 'bg-muted-foreground')}
            aria-hidden
          />
          {e.message ? (
            <details className="group">
              <summary className="flex cursor-pointer list-none flex-col gap-0.5">
                <span className="text-sm font-medium">{e.label}</span>
                <span className="text-xs text-muted-foreground tabular-nums">{formatDateTime(e.at)} · 点击查看</span>
              </summary>
              <p className="mt-2 rounded-md bg-muted px-3 py-2 font-mono text-xs break-all">{e.message}</p>
            </details>
          ) : (
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">{e.label}</span>
              <span className="text-xs text-muted-foreground tabular-nums">{formatDateTime(e.at)}</span>
            </div>
          )}
        </li>
      ))}
    </ol>
  )
}
