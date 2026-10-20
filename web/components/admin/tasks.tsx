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
import { TaskStatusBadge, jobLabel, taskState } from './labels'
import { ConfirmDialog, rangeOptions, rangeStart, useSelection, type RangeKey } from './shared'
import { api, refresh } from '@/lib/api'
import { formatDateTime, formatDuration, formatRelative, toMs } from '@/lib/format'
import type { Messages } from '@/lib/i18n'
import { useMessages } from '@/lib/i18n/client'
import type { Page, Schedule, Task, TaskBatchCounts, TaskState, TaskTypeCounts } from '@/lib/types'
import { cn, qs } from '@/lib/utils'
import { TabSwitch } from '@/components/tab-switch'

const allStates: TaskState[] = ['pending', 'retrying', 'running', 'completed', 'failed']
type SortKey = 'due' | 'created' | 'finished'
type TaskView = 'tasks' | 'schedules'

const canRunNow = (task: Task, now: number) => task.status === 'pending' && toMs(task.run_at) > now
/** One a configured task made is retried by running that again. */
const canRetry = (task: Task) => task.status === 'failed' && !task.name
/** Params on one line, such as retention=720h. */
const formatParams = (params: Record<string, unknown> | null) =>
  Object.entries(params ?? {})
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(' ')

type RetryTarget = { ids: string[] } | { filter: Record<string, unknown> }
type RetryScope = keyof Messages['tasks']['retryScopes']
type Pending = { kind: 'retry'; target: RetryTarget; count: number; scope: RetryScope } | { kind: 'cancel'; task: Task } | { kind: 'cancelBatch'; task: Task } | null

function useTaskActions() {
  const [pending, setPending] = useState<Pending>(null)
  const t = useMessages()

  const runNow = async (task: Task) => {
    try {
      await api(`/admin/tasks/${task.id}/run`, { method: 'POST' })
      await refresh()
      toast.success(t.tasks.movedUp)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const dialogs = (
    <>
      <ConfirmDialog
        open={pending?.kind === 'retry'}
        onOpenChange={(o) => !o && setPending(null)}
        title={t.tasks.retryTitle}
        description={pending?.kind === 'retry' ? t.tasks.retryHint(t.tasks.retryScopes[pending.scope], pending.count) : ''}
        confirmLabel={t.tasks.retry}
        onConfirm={async () => {
          if (pending?.kind !== 'retry') return
          const { count } = await api<{ count: number }>('/admin/tasks/retry', { method: 'POST', json: pending.target })
          await refresh()
          toast.success(t.tasks.requeued(count))
        }}
      />
      <ConfirmDialog
        open={pending?.kind === 'cancel'}
        onOpenChange={(o) => !o && setPending(null)}
        title={t.tasks.cancelTitle}
        destructive
        description={t.tasks.cancelHint}
        confirmLabel={t.tasks.cancelTitle}
        onConfirm={async () => {
          if (pending?.kind !== 'cancel') return
          await api(`/admin/tasks/${pending.task.id}/cancel`, { method: 'POST' })
          await refresh()
          toast.success(t.tasks.canceled)
        }}
      />
      <ConfirmDialog
        open={pending?.kind === 'cancelBatch'}
        onOpenChange={(o) => !o && setPending(null)}
        title={t.tasks.cancelBatchTitle}
        destructive
        description={pending?.kind === 'cancelBatch' ? t.tasks.cancelBatchHint(pending.task.batch?.pending ?? 0, pending.task.job_type === 'analyze_meme') : ''}
        confirmLabel={t.tasks.cancelBatchTitle}
        onConfirm={async () => {
          if (pending?.kind !== 'cancelBatch') return
          const { count } = await api<{ count: number }>(`/admin/tasks/batches/${pending.task.id}/cancel`, { method: 'POST' })
          await refresh()
          toast.success(t.tasks.canceledQueued(count))
        }}
      />
    </>
  )

  return {
    dialogs,
    runNow,
    retry: (tasks: Task[], scope: RetryScope = 'these') => setPending({ kind: 'retry', target: { ids: tasks.map((task) => task.id) }, count: tasks.length, scope }),
    retryAll: (filter: Record<string, unknown>, count: number) => setPending({ kind: 'retry', target: { filter }, count, scope: 'filter' }),
    cancel: (task: Task) => setPending({ kind: 'cancel', task }),
    retryBatch: (batch: Task) => setPending({ kind: 'retry', target: { filter: { batch: batch.id } }, count: batch.batch?.failed ?? 0, scope: 'batch' }),
    cancelBatch: (batch: Task) => setPending({ kind: 'cancelBatch', task: batch }),
  }
}

function BatchProgress({ counts: b }: { counts: TaskBatchCounts }) {
  const done = b.completed + b.failed
  const t = useMessages()
  return (
    <div className="flex w-28 flex-col gap-1">
      <Progress value={(done / b.total) * 100} aria-label={t.tasks.batchProgress} />
      <span className="text-xs text-muted-foreground tabular-nums">
        {done} / {b.total}
      </span>
    </div>
  )
}

function StateChips({ states, selected, onToggle }: { states: TaskState[]; selected: TaskState[]; onToggle: (st: TaskState) => void }) {
  const t = useMessages()
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
        {t.admin.taskStates[st]}
      </button>
    )
  })
}

/** The columns of a task table; a batch's row shows its progress beneath its status and links to its page. */
function taskColumns(now: number, t: Messages): Column<Task>[] {
  return [
    {
      key: 'id',
      header: t.tasks.task,
      mobile: 'title',
      cell: (task) => (
        <div className="flex min-w-0 flex-col gap-0.5">
          <Link href={task.batch ? `/admin/tasks/batches/${task.id}` : `/admin/tasks/${task.id}`} className="truncate font-medium hover:underline">
            {task.batch ? t.tasks.batchTitle(jobLabel(task.job_type, t)) : jobLabel(task.job_type, t)}
          </Link>
          <CopyId value={task.id} className="text-muted-foreground" />
        </div>
      ),
    },
    {
      key: 'status',
      header: t.tasks.status,
      cell: (task) => (
        <div className="flex flex-col items-start gap-1.5">
          <TaskStatusBadge status={taskState(task)} />
          {task.batch && <BatchProgress counts={task.batch} />}
        </div>
      ),
    },
    {
      key: 'attempts',
      header: t.tasks.attempts,
      className: 'w-20',
      cell: (task) => (task.batch ? <span className="text-muted-foreground">—</span> : <span className="tabular-nums">{t.tasks.attemptsOf(task.attempts, task.max_attempts)}</span>),
    },
    { key: 'scheduled', header: t.tasks.scheduled, cell: (task) => <span className="tabular-nums whitespace-nowrap">{formatDateTime(task.run_at)}</span> },
    { key: 'started', header: t.tasks.started, mobile: 'hidden', cell: (task) => <span className="tabular-nums whitespace-nowrap">{task.started_at ? formatDateTime(task.started_at) : '—'}</span> },
    { key: 'finished', header: t.tasks.finished, cell: (task) => <span className="tabular-nums whitespace-nowrap">{task.finished_at ? formatDateTime(task.finished_at) : '—'}</span> },
    { key: 'time', header: t.tasks.duration, cell: (task) => <TimeCell task={task} now={now} /> },
    {
      key: 'error',
      header: t.tasks.error,
      className: 'max-w-56',
      cell: (task) =>
        task.batch?.failed ? (
          <span className="text-destructive tabular-nums">{t.overview.failedCount(task.batch.failed)}</span>
        ) : task.error_message ? (
          <span className="text-destructive">
            <ExpandableText text={task.error_message} max={24} />
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: 'schedule',
      header: t.tasks.schedule,
      cell: (task) => (task.name ? <span className="font-mono text-xs">{task.name}</span> : <span className="text-muted-foreground">—</span>),
    },
  ]
}

function TimeCell({ task, now }: { task: Task; now: number }) {
  const state = taskState(task)
  const t = useMessages()
  if (state === 'running' && task.started_at) return <span className="tabular-nums text-info">{t.tasks.running(formatDuration(Math.max(0, now - toMs(task.started_at))))}</span>
  if (task.started_at && task.finished_at) return <span className="tabular-nums">{formatDuration(toMs(task.finished_at) - toMs(task.started_at))}</span>
  return <span className="text-muted-foreground">—</span>
}

function TaskActionItems({ task, now, actions }: { task: Task; now: number; actions: ReturnType<typeof useTaskActions> }) {
  const t = useMessages()
  if (task.batch)
    return (
      <>
        <DropdownMenuItem render={<Link href={`/admin/tasks/batches/${task.id}`} />}>
          <Eye />
          {t.meme.details}
        </DropdownMenuItem>
        {task.batch.failed > 0 && (
          <DropdownMenuItem onClick={() => actions.retryBatch(task)}>
            <RotateCw />
            {t.tasks.retryFailed}
          </DropdownMenuItem>
        )}
        {task.batch.pending > 0 && (
          <DropdownMenuItem variant="destructive" onClick={() => actions.cancelBatch(task)}>
            <Ban />
            {t.tasks.cancelQueued}
          </DropdownMenuItem>
        )}
      </>
    )
  return (
    <>
      <DropdownMenuItem render={<Link href={`/admin/tasks/${task.id}`} />}>
        <Eye />
        {t.meme.details}
      </DropdownMenuItem>
      {canRetry(task) && (
        <DropdownMenuItem onClick={() => actions.retry([task])}>
          <RotateCw />
          {t.tasks.retry}
        </DropdownMenuItem>
      )}
      {canRunNow(task, now) && (
        <DropdownMenuItem onClick={() => actions.runNow(task)}>
          <Play />
          {t.tasks.runNow}
        </DropdownMenuItem>
      )}
      {task.status === 'pending' && (
        <DropdownMenuItem variant="destructive" onClick={() => actions.cancel(task)}>
          <Ban />
          {t.common.cancel}
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
  const t = useMessages()

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
  const selectedFailed = rows.filter((task) => sel.ids.has(task.id) && canRetry(task) && !task.batch)
  // Failed tasks anywhere in the current filter, for retrying them all at once.
  const failedFilter = { ...filter, state: ['failed'] }
  const canRetryAll = !states.length || states.includes('failed')
  const { data: failedInFilter } = useSWR<Page<Task>>(canRetryAll ? `/admin/tasks${qs({ ...failedFilter, page_size: 1 })}` : null, { refreshInterval })

  const count = (st: TaskState) => summary.reduce((n, r) => n + r[st], 0)
  const backlog = count('pending') + count('retrying')
  const typeOptions = [['all', t.content.allKinds] as const, ...summary.map((r) => [r.job_type, jobLabel(r.job_type, t)] as const)]

  const toggleState = (st: TaskState) => setStates((cur) => (cur.includes(st) ? cur.filter((x) => x !== st) : [...cur, st]))

  const columns = taskColumns(now, t)
  const tabs = (
    <TabSwitch
      fill
      label={t.tasks.view}
      value={view}
      onChange={setView}
      tabs={[
        ['tasks', t.tasks.views.tasks],
        ['schedules', t.tasks.views.schedules],
      ]}
    />
  )

  return (
    <>
      <AdminPageHeader
        title={t.titles.tasks}
        description={t.tasks.description}
        actions={
          <RefreshControls
            auto={auto}
            onAutoChange={setAuto}
            onRefresh={() => {
              void refresh()
              toast.success(t.tasks.refreshed)
            }}
          />
        }
      />

      <section aria-label={t.tasks.summary} className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {(['running', 'pending', 'retrying', 'completed', 'failed'] as TaskState[]).map((st) => (
          <StatCard key={st} label={t.admin.taskStates[st]} value={count(st)} tone={st === 'failed' && count(st) ? 'danger' : undefined} />
        ))}
        <StatCard label={t.overview.backlog} value={backlog} hint={t.overview.backlogHint} tone={backlog > 5 ? 'warn' : undefined} />
      </section>
      <section aria-label={t.tasks.byType} className="flex flex-wrap gap-2 text-xs text-muted-foreground">
        {summary.map((r) => (
          <span key={r.job_type} className="rounded-full border bg-background px-3 py-1.5">
            {jobLabel(r.job_type, t)} <span className="font-medium text-foreground tabular-nums">{allStates.reduce((n, st) => n + r[st], 0)}</span>
            {' · '}
            {t.tasks.active(r.pending + r.retrying + r.running)}
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
              <SearchInput value={q} onChange={setQ} placeholder={t.tasks.search} className="basis-full sm:basis-auto" />
              <FilterSelect value={type} onChange={setType} options={typeOptions} label={t.tasks.type} />
              <FilterSelect value={range} onChange={setRange} options={rangeOptions(t)} label={t.tasks.created} />
              <FilterSelect value={sort} onChange={setSort} options={(['due', 'created', 'finished'] as const).map((k) => [k, t.tasks.sorts[k]] as const)} label={t.adminTags.sort} />
              <div className="flex h-10 items-center gap-2 md:h-9">
                <Switch id="scheduled-only" checked={scheduledOnly} onCheckedChange={setScheduledOnly} />
                <Label htmlFor="scheduled-only" className="font-normal whitespace-nowrap">
                  {t.tasks.scheduledOnly}
                </Label>
              </div>
            </Toolbar>

            <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t.tasks.stateFilter}>
              <StateChips states={allStates} selected={states} onToggle={toggleState} />
              {canRetryAll && !!failedInFilter?.total && (
                <Button variant="outline" className="ml-auto h-9" onClick={() => actions.retryAll(failedFilter, failedInFilter.total)}>
                  <RotateCw aria-hidden />
                  {t.tasks.retryAllFailed(failedInFilter.total)}
                </Button>
              )}
            </div>
          </div>

          <DataList
            rows={rows}
            loading={!tasks.data}
            columns={columns}
            getId={(task) => task.id}
            rowLabel={(task) => task.id}
            selected={sel.ids}
            onSelectedChange={sel.set}
            empty={<EmptyState icon={ListChecks} title={t.tasks.none} description={t.content.noneHint} className="border-0" />}
            actions={(task) => <TaskActionItems task={task} now={now} actions={actions} />}
          />
          <Pagination paging={paging} total={tasks.data?.total ?? 0} />

          <BulkBar count={sel.ids.size} onClear={sel.clear}>
            <Button
              size="sm"
              variant="secondary"
              disabled={!selectedFailed.length}
              title={selectedFailed.length ? undefined : t.tasks.noFailedSelected}
              onClick={() => actions.retry(selectedFailed, 'selected')}
            >
              <RotateCw aria-hidden />
              {t.tasks.retryFailedCount(selectedFailed.length)}
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
  const t = useMessages()

  const columns: Column<Schedule>[] = [
    {
      key: 'name',
      header: t.tasks.task,
      mobile: 'title',
      cell: (s) => (
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="font-medium">{jobLabel(s.type, t)}</span>
          <span className="truncate font-mono text-xs text-muted-foreground">{s.name}</span>
        </div>
      ),
    },
    {
      key: 'cron',
      header: t.tasks.cron,
      cell: (s) => (s.cron ? <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{s.cron}</span> : <span className="text-muted-foreground">{t.tasks.manualOnly}</span>),
    },
    {
      key: 'params',
      header: t.tasks.params,
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
      header: t.tasks.next,
      cell: (s) =>
        s.next_run ? (
          <span className="flex flex-wrap gap-x-1 tabular-nums">
            <span className="whitespace-nowrap">{formatDateTime(s.next_run)}</span>
            <span className="whitespace-nowrap text-muted-foreground">· {formatRelative(s.next_run, t)}</span>
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: 'last',
      header: t.tasks.last,
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
    (s) => (type === 'all' || s.type === type) && (!needle || [s.name, s.type, jobLabel(s.type, t)].some((v) => v.toLowerCase().includes(needle))),
  )
  const typeOptions = [['all', t.content.allKinds] as const, ...[...new Set((data ?? []).map((s) => s.type))].map((x) => [x, jobLabel(x, t)] as const)]

  return (
    <>
      <div className="flex flex-col gap-3">
        {tabs}
        <Toolbar>
          <SearchInput value={q} onChange={setQ} placeholder={t.tasks.searchSchedules} className="basis-full sm:basis-auto" />
          <FilterSelect value={type} onChange={setType} options={typeOptions} label={t.tasks.type} />
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
            <EmptyState icon={CalendarClock} title={t.tasks.noMatchingSchedules} description={t.content.noneHint} className="border-0" />
          ) : (
            <EmptyState icon={CalendarClock} title={t.tasks.noSchedules} description={t.tasks.noSchedulesHint} className="border-0" />
          )
        }
        actions={(s) => (
          <>
            {!unfinished(s) && (
              <DropdownMenuItem onClick={() => setPending(s)}>
                <Play />
                {t.tasks.runNow}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={() => onShowTasks(s.name)}>
              <History />
              {t.tasks.history}
            </DropdownMenuItem>
          </>
        )}
      />
      <Pagination paging={paging} total={matched.length} />
      <ConfirmDialog
        open={!!pending}
        onOpenChange={(o) => !o && setPending(null)}
        title={pending ? t.tasks.runTitle(jobLabel(pending.type, t)) : ''}
        description={pending && formatParams(pending.params) ? t.tasks.runWithParams(formatParams(pending.params)) : t.tasks.runOnce}
        confirmLabel={t.tasks.run}
        onConfirm={async () => {
          if (!pending) return
          await api(`/admin/tasks/schedules/${encodeURIComponent(pending.name)}/run`, { method: 'POST' })
          await refresh()
          toast.success(t.tasks.createdTask)
        }}
      />
    </>
  )
}

/* -------------------------------- detail --------------------------------- */

export function AdminTaskDetail({ id }: { id: string }) {
  const detail = useSWR<Task>(`/admin/tasks/${id}`, {
    refreshInterval: (task) => (task && (task.status === 'running' || task.status === 'pending') ? 3000 : 0),
  })
  // A task's source links to the schedules while the config still has it.
  const schedules = useSWR<Schedule[]>(detail.data?.name ? '/admin/tasks/schedules' : null)
  const now = useNow(detail.data?.status === 'running', 1000)
  const actions = useTaskActions()
  const t = useMessages()

  return (
    <>
      <Link href="/admin/tasks" className="-mb-2 flex h-10 w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden />
        {t.tasks.list}
      </Link>
      <Loadable result={detail} notFound={{ title: t.errors.task_not_found, description: t.tasks.notFoundHint }}>
        {(task) => {
          const asset = typeof task.payload.asset_id === 'string' ? task.payload.asset_id : null
          const timeline: TimelineEvent[] = [
            { at: task.created_at, label: t.tasks.timeline.created, tone: 'muted' },
            ...task.history.map((h, i): TimelineEvent => ({
              at: h.at,
              label: t.tasks.timeline.attempt(i + 1, h.ok),
              tone: h.ok ? 'ok' : 'fail',
              message: h.error ?? undefined,
            })),
            ...(task.status === 'running' && task.started_at ? [{ at: task.started_at, label: t.tasks.timeline.attempting(task.history.length + 1), tone: 'muted' as const }] : []),
            ...(task.finished_at
              ? [{ at: task.finished_at, label: t.tasks.timeline.ended(task.status === 'completed'), tone: task.status === 'completed' ? ('ok' as const) : ('fail' as const), message: task.error_message ?? undefined }]
              : []),
          ]
          timeline.sort((a, b) => toMs(a.at) - toMs(b.at))
          const info: [string, React.ReactNode][] = [
            [t.tasks.id, <CopyId key="id" value={task.id} />],
            [t.overview.type, jobLabel(task.job_type, t)],
            [t.tasks.status, <TaskStatusBadge key="st" status={taskState(task)} />],
            [t.tasks.attemptsMade, t.tasks.attemptsTotal(task.attempts, task.max_attempts)],
            [t.tasks.timeout, task.timeout_secs % 60 ? t.tasks.seconds(task.timeout_secs) : t.tasks.minutes(task.timeout_secs / 60)],
            [t.tasks.created, formatDateTime(task.created_at)],
            [t.tasks.runAt, formatDateTime(task.run_at)],
            [t.tasks.startedAt, task.started_at ? formatDateTime(task.started_at) : '—'],
            [t.tasks.finishedAt, task.finished_at ? formatDateTime(task.finished_at) : '—'],
            [t.tasks.progress, <TimeCell key="t" task={task} now={now} />],
          ]
          if (task.name)
            info.push(
              [
                t.tasks.source,
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
              [t.tasks.params, <span key="params" className="font-mono break-all">{formatParams(task.payload) || '—'}</span>],
            )

          return (
            <>
              <AdminPageHeader
                title={jobLabel(task.job_type, t)}
                description={task.id}
                actions={
                  <>
                    {canRetry(task) && (
                      <Button className="h-10 md:h-9" onClick={() => actions.retry([task])}>
                        <RotateCw aria-hidden />
                        {t.tasks.retry}
                      </Button>
                    )}
                    {canRunNow(task, now) && (
                      <Button variant="outline" className="h-10 md:h-9" onClick={() => actions.runNow(task)}>
                        <Play aria-hidden />
                        {t.tasks.runNow}
                      </Button>
                    )}
                    {task.status === 'pending' && (
                      <Button variant="outline" className="h-10 text-destructive md:h-9" onClick={() => actions.cancel(task)}>
                        <Ban aria-hidden />
                        {t.common.cancel}
                      </Button>
                    )}
                  </>
                }
              />

              <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
                <div className="flex min-w-0 flex-col gap-4">
                  <section className="rounded-xl border bg-card p-4 sm:p-5">
                    <h2 className="mb-3 text-sm font-medium">{t.tasks.basics}</h2>
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
                      <h2 className="mb-2 text-sm font-medium text-destructive">{t.tasks.errorMessage}</h2>
                      <pre className="overflow-x-auto font-mono text-xs leading-relaxed break-all whitespace-pre-wrap">{task.error_message}</pre>
                    </section>
                  )}

                  <section className="rounded-xl border bg-card p-4 sm:p-5">
                    <h2 className="mb-4 text-sm font-medium">{t.tasks.process}</h2>
                    <Timeline events={timeline} />
                  </section>

                </div>

                <aside className="flex flex-col gap-4">
                  {asset && (
                    <section className="rounded-xl border bg-card p-4 sm:p-5">
                      <h2 className="mb-3 text-sm font-medium">{t.tasks.related}</h2>
                      <div className="flex flex-col gap-2">
                        <Link href={`/m/${asset}`} className="text-sm font-medium break-all underline-offset-2 hover:underline">
                          {t.tasks.viewMeme(asset)}
                        </Link>
                        <Link href={`/admin/content?q=${asset}`} className="text-sm text-muted-foreground underline-offset-2 hover:underline">
                          {t.tasks.inContent}
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
  const t = useMessages()

  return (
    <>
      <Link href="/admin/tasks" className="-mb-2 flex h-10 w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden />
        {t.tasks.list}
      </Link>
      <Loadable result={batch} notFound={{ title: t.errors.batch_not_found, description: t.tasks.batchNotFoundHint }}>
        {(b) => {
          const c = b.batch ?? { total: 0, pending: 0, running: 0, completed: 0, failed: 0 }
          const done = c.completed + c.failed
          const info: [string, React.ReactNode][] = [
            [t.tasks.batchId, <CopyId key="id" value={b.id} />],
            [t.tasks.status, <TaskStatusBadge key="st" status={taskState(b)} />],
            [t.tasks.created, formatDateTime(b.created_at)],
            [t.tasks.startedAt, b.started_at ? formatDateTime(b.started_at) : '—'],
            [t.tasks.finishedAt, b.finished_at ? formatDateTime(b.finished_at) : '—'],
            [t.tasks.duration, <TimeCell key="t" task={b} now={now} />],
          ]
          return (
            <>
              <AdminPageHeader
                title={t.tasks.batchTitle(jobLabel(b.job_type, t))}
                description={t.tasks.batchTotal(c.total)}
                actions={
                  <>
                    {c.failed > 0 && (
                      <Button className="h-10 md:h-9" onClick={() => actions.retryBatch(b)}>
                        <RotateCw aria-hidden />
                        {t.tasks.retryFailedCount(c.failed)}
                      </Button>
                    )}
                    {c.pending > 0 && (
                      <Button variant="outline" className="h-10 text-destructive md:h-9" onClick={() => actions.cancelBatch(b)}>
                        <Ban aria-hidden />
                        {t.tasks.cancelQueuedCount(c.pending)}
                      </Button>
                    )}
                  </>
                }
              />

              <section aria-label={t.tasks.batchSummary} className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <StatCard label={t.admin.taskStates.completed} value={c.completed} />
                <StatCard label={t.admin.taskStates.failed} value={c.failed} tone={c.failed ? 'danger' : undefined} />
                <StatCard label={t.admin.taskStates.running} value={c.running} />
                <StatCard label={t.admin.taskStates.pending} value={c.pending} hint={t.tasks.includesRetrying} />
              </section>

              <section className="rounded-xl border bg-card p-4 sm:p-5">
                <div className="mb-3 flex items-baseline justify-between gap-3">
                  <h2 className="text-sm font-medium">{t.tasks.progressTitle}</h2>
                  <span className="text-sm tabular-nums">
                    {done} / {c.total}
                  </span>
                </div>
                <Progress value={c.total ? (done / c.total) * 100 : 0} aria-label={t.tasks.batchProgress} />
                <dl className="mt-5 grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
                  {info.map(([k, v]) => (
                    <div key={k} className="flex min-w-0 flex-col gap-0.5">
                      <dt className="text-xs text-muted-foreground">{k}</dt>
                      <dd className="min-w-0">{v}</dd>
                    </div>
                  ))}
                </dl>
              </section>

              <section aria-label={t.tasks.batchTasks} className="flex flex-col gap-3">
                <h2 className="text-sm font-medium">{t.tasks.batchTasks}</h2>
                <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t.tasks.stateFilter}>
                  <StateChips states={allStates} selected={states} onToggle={toggleState} />
                </div>
                <DataList
                  rows={tasks.data?.items ?? []}
                  loading={!tasks.data}
                  columns={taskColumns(now, t)}
                  getId={(task) => task.id}
                  rowLabel={(task) => task.id}
                  empty={<EmptyState icon={ListChecks} title={t.tasks.none} description={t.tasks.noneStateHint} className="border-0" />}
                  actions={(task) => <TaskActionItems task={task} now={now} actions={actions} />}
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
  const t = useMessages()
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
                <span className="text-xs text-muted-foreground tabular-nums">{t.tasks.showDetails(formatDateTime(e.at))}</span>
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
