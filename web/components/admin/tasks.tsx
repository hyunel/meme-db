'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import useSWR from 'swr'
import { ArrowLeft, Ban, CalendarClock, Eye, History, ListChecks, Play, RotateCw } from 'lucide-react'
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
import type { Page, Schedule, Task, TaskBatchCounts, TaskState, TaskTypeCounts } from '@/lib/types'
import { cn, qs } from '@/lib/utils'
import { TabSwitch } from '@/components/tab-switch'

const allStates: TaskState[] = ['pending', 'retrying', 'running', 'completed', 'failed']
type SortKey = 'due' | 'created' | 'finished'
type TaskView = 'tasks' | 'schedules'
const sortOptions = [
  ['due', '进行中在前'],
  ['created', '按创建时间'],
  ['finished', '按结束时间'],
] as const

const canRunNow = (t: Task, now: number) => t.status === 'pending' && toMs(t.run_at) > now
/** One a configured task made is retried by running that again. */
const canRetry = (t: Task) => t.status === 'failed' && !t.name
/** Params on one line, such as retention=720h. */
const formatParams = (params: Record<string, unknown> | null) =>
  Object.entries(params ?? {})
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(' ')

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
      key: 'schedule',
      header: '计划',
      cell: (t) => (t.name ? <span className="font-mono text-xs">{t.name}</span> : <span className="text-muted-foreground">—</span>),
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
      {canRetry(task) && (
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
    </>
  )
}

/* --------------------------------- list ---------------------------------- */

export function AdminTasks() {
  const params = useSearchParams()
  const [view, setView] = useState<TaskView>(params.get('view') === 'schedules' ? 'schedules' : 'tasks')
  const [states, setStates] = useState<TaskState[]>(() => allStates.filter((st) => params.getAll('status').includes(st)))
  const [type, setType] = useState('all')
  const [range, setRange] = useState<RangeKey>('all')
  const from = useMemo(() => rangeStart(range), [range])
  const [scheduledOnly, setScheduledOnly] = useState(false)
  const [q, setQ] = useState(params.get('meme') ?? '')
  const dq = useDebounced(q.trim())
  const [sort, setSort] = useState<SortKey>('due')
  const [auto, setAuto] = useState(true)
  const now = useNow(auto, 1000)
  const actions = useTaskActions()
  const refreshInterval = auto ? 3000 : 0

  const filter = {
    state: states,
    type: type === 'all' ? '' : type,
    q: dq,
    from,
    scheduled: scheduledOnly,
    sort,
  }
  const paging = usePaging(JSON.stringify(filter))
  // Each batch shows as one row.
  const tasks = useSWR<Page<Task>>(view === 'schedules' ? null : `/admin/tasks${qs({ ...filter, group: true, ...paging.query })}`, {
    refreshInterval,
    keepPreviousData: true,
  })
  const { data: summary = [] } = useSWR<TaskTypeCounts[]>('/admin/tasks/summary', { refreshInterval })

  const rows = tasks.data?.items ?? []
  const sel = useSelection(paging.pageKey)
  const selectedFailed = rows.filter((t) => sel.ids.has(t.id) && canRetry(t) && !t.batch)
  // Failed tasks anywhere in the current filter, for retrying them all at once.
  const failedFilter = { ...filter, state: ['failed'] }
  const canRetryAll = !states.length || states.includes('failed')
  const { data: failedInFilter } = useSWR<Page<Task>>(canRetryAll ? `/admin/tasks${qs({ ...failedFilter, page_size: 1 })}` : null, { refreshInterval })

  const count = (st: TaskState) => summary.reduce((n, r) => n + r[st], 0)
  const backlog = count('pending') + count('retrying')
  const typeOptions = [['all', '全部类型'] as const, ...summary.map((r) => [r.job_type, jobLabel(r.job_type)] as const)]

  const toggleState = (st: TaskState) => setStates((cur) => (cur.includes(st) ? cur.filter((x) => x !== st) : [...cur, st]))

  const columns = taskColumns(now)
  const tabs = (
    <TabSwitch
      fill
      label="任务视图"
      value={view}
      onChange={setView}
      tabs={[
        ['tasks', '任务'],
        ['schedules', '计划'],
      ]}
    />
  )

  return (
    <>
      <AdminPageHeader
        title="任务管理"
        description="后台处理任务的执行情况与积压"
        actions={
          <RefreshControls
            auto={auto}
            onAutoChange={setAuto}
            onRefresh={() => {
              void refresh()
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

      {view === 'schedules' ? (
        <ScheduleList
          tabs={tabs}
          refreshInterval={refreshInterval}
          onShowTasks={(name) => {
            setView('tasks')
            setQ(name)
          }}
        />
      ) : (
        <>
          <div className="flex flex-col gap-3">
            {tabs}
            <Toolbar>
              <SearchInput value={q} onChange={setQ} placeholder="任务标识、表情包标识或计划名称" className="basis-full sm:basis-auto" />
              <FilterSelect value={type} onChange={setType} options={typeOptions} label="任务类型" />
              <FilterSelect value={range} onChange={setRange} options={rangeOptions} label="创建时间" />
              <FilterSelect value={sort} onChange={setSort} options={sortOptions} label="排序" />
              <div className="flex h-10 items-center gap-2 md:h-9">
                <Switch id="scheduled-only" checked={scheduledOnly} onCheckedChange={setScheduledOnly} />
                <Label htmlFor="scheduled-only" className="font-normal whitespace-nowrap">
                  只看计划任务
                </Label>
              </div>
            </Toolbar>

            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="按状态筛选（可多选）">
              <StateChips states={allStates} selected={states} onToggle={toggleState} />
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
            empty={<EmptyState icon={ListChecks} title="没有符合条件的任务" description="试试调整筛选条件。" className="border-0" />}
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
        </>
      )}
      {actions.dialogs}
    </>
  )
}

function ScheduleList({ tabs, refreshInterval, onShowTasks }: { tabs: React.ReactNode; refreshInterval: number; onShowTasks: (name: string) => void }) {
  const { data } = useSWR<Schedule[]>('/admin/tasks/schedules', { refreshInterval })
  const [q, setQ] = useState('')
  const [type, setType] = useState('all')
  const paging = usePaging(`${q}|${type}`)
  const [pending, setPending] = useState<Schedule | null>(null)
  const unfinished = (s: Schedule) => s.last?.status === 'pending' || s.last?.status === 'running'

  const columns: Column<Schedule>[] = [
    {
      key: 'name',
      header: '任务',
      mobile: 'title',
      cell: (s) => (
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="font-medium">{jobLabel(s.type)}</span>
          <span className="truncate font-mono text-xs text-muted-foreground">{s.name}</span>
        </div>
      ),
    },
    {
      key: 'cron',
      header: '周期',
      cell: (s) => (s.cron ? <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{s.cron}</span> : <span className="text-muted-foreground">仅手动</span>),
    },
    {
      key: 'params',
      header: '参数',
      className: 'max-w-56',
      cell: (s) => {
        const p = formatParams(s.params)
        return p ? (
          <span className="block truncate font-mono text-xs" title={p}>
            {p}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )
      },
    },
    {
      key: 'next',
      header: '下次执行',
      cell: (s) =>
        s.next_run ? (
          <span className="flex flex-wrap gap-x-1 tabular-nums">
            <span className="whitespace-nowrap">{formatDateTime(s.next_run)}</span>
            <span className="whitespace-nowrap text-muted-foreground">· {formatRelative(s.next_run)}</span>
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: 'last',
      header: '最近一次',
      cell: (s) =>
        s.last ? (
          <Link href={`/admin/tasks/${s.last.id}`} className="flex flex-wrap items-center gap-x-2 gap-y-1 hover:underline">
            <TaskStatusBadge status={taskState(s.last)} />
            <span className="tabular-nums whitespace-nowrap text-muted-foreground">{formatDateTime(s.last.finished_at ?? s.last.started_at ?? s.last.created_at)}</span>
          </Link>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
  ]

  const needle = q.trim().toLowerCase()
  const matched = (data ?? []).filter(
    (s) => (type === 'all' || s.type === type) && (!needle || [s.name, s.type, jobLabel(s.type)].some((v) => v.toLowerCase().includes(needle))),
  )
  const typeOptions = [['all', '全部类型'] as const, ...[...new Set((data ?? []).map((s) => s.type))].map((t) => [t, jobLabel(t)] as const)]

  return (
    <>
      <div className="flex flex-col gap-3">
        {tabs}
        <Toolbar>
          <SearchInput value={q} onChange={setQ} placeholder="计划名称或类型" className="basis-full sm:basis-auto" />
          <FilterSelect value={type} onChange={setType} options={typeOptions} label="任务类型" />
        </Toolbar>
      </div>

      <DataList
        rows={matched.slice((paging.page - 1) * paging.pageSize, paging.page * paging.pageSize)}
        loading={!data}
        columns={columns}
        getId={(s) => s.name}
        rowLabel={(s) => s.name}
        empty={
          data?.length ? (
            <EmptyState icon={CalendarClock} title="没有符合条件的计划" description="试试调整筛选条件。" className="border-0" />
          ) : (
            <EmptyState icon={CalendarClock} title="没有计划任务" description="在服务端配置文件的 tasks 中添加。" className="border-0" />
          )
        }
        actions={(s) => (
          <>
            {!unfinished(s) && (
              <DropdownMenuItem onClick={() => setPending(s)}>
                <Play />
                立即执行
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={() => onShowTasks(s.name)}>
              <History />
              查看执行记录
            </DropdownMenuItem>
          </>
        )}
      />
      <Pagination paging={paging} total={matched.length} />
      <ConfirmDialog
        open={!!pending}
        onOpenChange={(o) => !o && setPending(null)}
        title={pending ? `立即执行「${jobLabel(pending.type)}」` : ''}
        description={pending && formatParams(pending.params) ? `按配置的参数运行一次：${formatParams(pending.params)}` : '按配置运行一次。'}
        confirmLabel="执行"
        onConfirm={async () => {
          if (!pending) return
          await api(`/admin/tasks/schedules/${encodeURIComponent(pending.name)}/run`, { method: 'POST' })
          await refresh()
          toast.success('已创建任务')
        }}
      />
    </>
  )
}

/* -------------------------------- detail --------------------------------- */

export function AdminTaskDetail({ id }: { id: string }) {
  const detail = useSWR<Task>(`/admin/tasks/${id}`, {
    refreshInterval: (t) => (t && (t.status === 'running' || t.status === 'pending') ? 3000 : 0),
  })
  // A task's source links to the schedules while the config still has it.
  const schedules = useSWR<Schedule[]>(detail.data?.name ? '/admin/tasks/schedules' : null)
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
          ]
          if (task.name)
            info.push(
              [
                '来源',
                schedules.data?.some((s) => s.name === task.name) ? (
                  <Link key="src" href="/admin/tasks?view=schedules" className="font-mono underline-offset-2 hover:underline">
                    {task.name}
                  </Link>
                ) : (
                  <span key="src" className="font-mono">
                    {task.name}
                  </span>
                ),
              ],
              ['参数', <span key="params" className="font-mono break-all">{formatParams(task.payload) || '—'}</span>],
            )

          return (
            <>
              <AdminPageHeader
                title={jobLabel(task.job_type)}
                description={task.id}
                actions={
                  <>
                    {canRetry(task) && (
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

                </div>

                <aside className="flex flex-col gap-4">
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
