'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ArrowUp, Check, ChevronDown, Copy, Download, Plus, Radio, ScrollText, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { EmptyState, ErrorState } from '@/components/states'
import { AdminPageHeader, FilterSelect, RefreshControls, SearchInput, Toolbar, useDebounced } from './admin-ui'
import { LevelBadge } from './labels'
import { rangeOptions, rangeStart, type RangeKey } from './shared'
import { api } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import { useMessages } from '@/lib/i18n/client'
import type { LogEntry, LogLevel } from '@/lib/types'
import { cn, qs } from '@/lib/utils'

const PAGE = 100
const EXPORT_MAX = 5000
const levels: LogLevel[] = ['debug', 'info', 'warn', 'error']

interface Cond {
  id: number
  key: string
  value: string
}

function attrHref(key: string, value: string) {
  if (key === 'asset_id' || key === 'meme') return `/m/${value}`
  if (key === 'task' || (key === 'id' && /^[0-9a-f-]{36}$/.test(value))) return `/admin/tasks/${value}`
  return null
}

type LogQuery = { level: LogLevel; q: string; from?: number; attr: string[] }

/** Newest first: older pages on demand (loadOlder), newer entries as they arrive (poll). */
function useLogs(query: LogQuery, live: boolean) {
  const key = JSON.stringify(query)
  const [data, setData] = useState<{ key: string; logs: LogEntry[]; hasMore: boolean; error?: string }>()
  const current = data?.key === key ? data : undefined
  const latest = useRef(current)
  const busy = useRef(false)
  useEffect(() => {
    latest.current = current
  })

  const fetchLogs = useCallback((extra: Record<string, number>) => api<LogEntry[]>(`/admin/logs${qs({ ...JSON.parse(key), ...extra })}`), [key])

  useEffect(() => {
    let stale = false
    fetchLogs({ limit: PAGE }).then(
      (logs) => !stale && setData({ key, logs, hasMore: logs.length === PAGE }),
      (e) => !stale && setData({ key, logs: [], hasMore: false, error: (e as Error).message }),
    )
    return () => {
      stale = true
    }
  }, [fetchLogs, key])

  const update = useCallback(
    (fn: (d: NonNullable<typeof data>) => NonNullable<typeof data>) => setData((d) => (d?.key === key ? fn(d) : d)),
    [key],
  )

  const loadOlder = useCallback(async () => {
    const cur = latest.current
    if (!cur?.hasMore || busy.current) return
    busy.current = true
    try {
      const older = await fetchLogs({ before: cur.logs[cur.logs.length - 1].id, limit: PAGE })
      update((d) => ({ ...d, logs: [...d.logs, ...older], hasMore: older.length === PAGE }))
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      busy.current = false
    }
  }, [fetchLogs, update])

  const poll = useCallback(async () => {
    const cur = latest.current
    if (!cur) return
    try {
      const newer = await fetchLogs({ after: cur.logs[0]?.id ?? 0, limit: 500 })
      if (newer.length) update((d) => ({ ...d, logs: [...newer.reverse(), ...d.logs] }))
    } catch (e) {
      toast.error((e as Error).message)
    }
  }, [fetchLogs, update])

  useEffect(() => {
    if (!live) return
    const id = setInterval(poll, 2000)
    return () => clearInterval(id)
  }, [live, poll])

  return { logs: current?.logs ?? [], loaded: Boolean(current), error: current?.error, hasMore: Boolean(current?.hasMore), loadOlder, poll, fetchLogs }
}

export function AdminLogs() {
  const params = useSearchParams()
  const t = useMessages()
  const [live, setLive] = useState(false)
  const [minLevel, setMinLevel] = useState<LogLevel>(() => {
    const l = params.get('level') as LogLevel | null
    return l && levels.includes(l) ? l : 'debug'
  })
  const [q, setQ] = useState(params.get('q') ?? '')
  const dq = useDebounced(q.trim().toLowerCase())
  const [range, setRange] = useState<RangeKey>('all')
  const from = useMemo(() => rangeStart(range), [range])
  // Linked filters: ?c=key:value
  const [conds, setConds] = useState<Cond[]>(() =>
    params.getAll('c').flatMap((raw, i) => {
      const at = raw.indexOf(':')
      return at > 0 ? [{ id: -1 - i, key: raw.slice(0, at), value: raw.slice(at + 1) }] : []
    }),
  )
  const [draft, setDraft] = useState({ key: '', value: '' })
  // While live tailing, scrolling or selecting text pauses the view at this entry.
  const [frozenId, setFrozenId] = useState<number | null>(null)
  const sentinel = useRef<HTMLDivElement>(null)
  const query = useMemo<LogQuery>(() => ({ level: minLevel, q: dq, from, attr: conds.map((c) => `${c.key}=${c.value}`) }), [minLevel, dq, from, conds])
  const { logs, error, loaded, hasMore, loadOlder, poll, fetchLogs } = useLogs(query, live)

  const attrKeys = useMemo(() => Array.from(new Set(logs.flatMap((l) => Object.keys(l.attrs)))).sort(), [logs])

  const visible = frozenId === null ? logs : logs.filter((l) => l.id <= frozenId)
  const newCount = logs.length - visible.length

  const latestId = logs[0]?.id ?? 0
  useEffect(() => {
    if (!live) return
    const check = () => {
      const selecting = (window.getSelection()?.toString() ?? '').length > 0
      if ((selecting || window.scrollY > 240) && frozenId === null) setFrozenId(latestId)
    }
    window.addEventListener('scroll', check, { passive: true })
    document.addEventListener('selectionchange', check)
    return () => {
      window.removeEventListener('scroll', check)
      document.removeEventListener('selectionchange', check)
    }
  }, [live, frozenId, latestId])

  useEffect(() => {
    const el = sentinel.current
    if (!el || !hasMore) return
    const io = new IntersectionObserver((entries) => entries[0].isIntersecting && void loadOlder(), { rootMargin: '200px' })
    io.observe(el)
    return () => io.disconnect()
  }, [hasMore, loadOlder, logs.length])

  const resume = () => {
    window.getSelection()?.removeAllRanges()
    setFrozenId(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const addCond = () => {
    if (!draft.key || !draft.value.trim()) return
    setConds((c) => [...c, { id: Date.now(), key: draft.key, value: draft.value.trim() }])
    setDraft({ key: draft.key, value: '' })
  }

  const exportLogs = async () => {
    try {
      const all = await fetchLogs({ limit: EXPORT_MAX })
      const url = URL.createObjectURL(new Blob([JSON.stringify(all, null, 2)], { type: 'application/json' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `memedb-logs-${Date.now()}.json`
      a.click()
      URL.revokeObjectURL(url)
      toast.success(t.logs.exported(all.length))
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <>
      <AdminPageHeader
        title={t.titles.logs}
        description={t.logs.description}
        actions={
          <>
            <div className="flex h-10 items-center gap-2 rounded-md border bg-background px-3 md:h-9">
              <Switch
                id="live-tail"
                checked={live}
                onCheckedChange={(v) => {
                  setLive(v)
                  setFrozenId(null)
                }}
              />
              <Label htmlFor="live-tail" className="flex items-center gap-1.5 font-normal whitespace-nowrap">
                <Radio className={cn('size-3.5', live && 'animate-pulse text-destructive')} aria-hidden />
                {t.logs.live}
              </Label>
            </div>
            {!live && <RefreshControls onRefresh={() => void poll()} />}
            <Button variant="outline" className="h-10 md:h-9" onClick={exportLogs} disabled={!logs.length}>
              <Download aria-hidden />
              {t.logs.export}
            </Button>
          </>
        }
      />

      <div className="flex flex-col gap-3 rounded-xl border bg-card p-3 sm:p-4">
        <Toolbar>
          <SearchInput value={q} onChange={setQ} placeholder={t.logs.search} className="basis-full sm:basis-auto" />
          <FilterSelect value={minLevel} onChange={setMinLevel} options={levels.map((l) => [l, t.logs.atLeast(l.toUpperCase())] as const)} label={t.logs.minLevel} />
          <FilterSelect value={range} onChange={setRange} options={rangeOptions(t)} label={t.overview.range} />
        </Toolbar>
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            addCond()
          }}
        >
          <span className="text-xs text-muted-foreground">{t.logs.byAttr}</span>
          <FilterSelect
            value={draft.key || '__'}
            onChange={(k) => setDraft((d) => ({ ...d, key: k === '__' ? '' : k }))}
            options={[['__', t.logs.pickField] as const, ...attrKeys.map((k) => [k, k] as const)]}
            label={t.logs.field}
            className="min-w-28"
          />
          <span className="text-muted-foreground">=</span>
          <Input
            value={draft.value}
            onChange={(e) => setDraft((d) => ({ ...d, value: e.target.value }))}
            placeholder={t.logs.value}
            aria-label={t.logs.fieldValue}
            className="h-10 w-36 flex-1 text-base sm:flex-none md:h-9 md:text-sm"
          />
          <Button type="submit" variant="outline" className="h-10 md:h-9" disabled={!draft.key || !draft.value.trim()}>
            <Plus aria-hidden />
            {t.logs.addCondition}
          </Button>
        </form>
        {conds.length > 0 && (
          <ul className="flex flex-wrap gap-2" aria-label={t.logs.conditions}>
            {conds.map((c) => (
              <li key={c.id} className="flex h-8 items-center gap-1 rounded-full bg-muted pr-1 pl-3 font-mono text-xs">
                {c.key}={c.value}
                <button
                  type="button"
                  aria-label={t.logs.removeCondition(`${c.key}=${c.value}`)}
                  onClick={() => setConds((cur) => cur.filter((x) => x.id !== c.id))}
                  className="flex size-6 items-center justify-center rounded-full hover:bg-background"
                >
                  <X className="size-3" />
                </button>
              </li>
            ))}
            <li>
              <button type="button" onClick={() => setConds([])} className="h-8 px-2 text-xs text-muted-foreground underline-offset-2 hover:underline">
                {t.logs.clearAll}
              </button>
            </li>
          </ul>
        )}
      </div>

      {live && frozenId !== null && (
        <button
          type="button"
          onClick={resume}
          className="sticky top-[calc(6.5rem+env(safe-area-inset-top))] z-30 mx-auto flex h-10 items-center gap-2 rounded-full bg-foreground px-4 text-sm text-background shadow-lg md:top-4"
        >
          <ArrowUp className="size-4" aria-hidden />
          {t.logs.paused(newCount)}
        </button>
      )}

      {error && <ErrorState title={t.logs.loadFailed} description={error} />}

      <p className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
        {t.logs.loaded(visible.length)}
        {live && frozenId === null && ` · ${t.logs.tailing}`}
      </p>

      {loaded && visible.length === 0 ? (
        <EmptyState icon={ScrollText} title={t.logs.none} description={t.logs.noneHint} />
      ) : (
        <ol className="flex flex-col divide-y overflow-hidden rounded-xl border bg-card">
          {visible.map((l) => (
            <LogRow key={l.id} log={l} />
          ))}
        </ol>
      )}

      <div ref={sentinel} className="py-2 text-center text-xs text-muted-foreground">
        {visible.length > 0 && (hasMore ? t.logs.loadingOlder : t.logs.noOlder)}
      </div>
    </>
  )
}

function LogRow({ log }: { log: LogEntry }) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const entries = Object.entries(log.attrs)
  const t = useMessages()

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify({ time: log.time, level: log.level, message: log.message, ...log.attrs }, null, 2))
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      toast.error(t.common.copyFailed)
    }
  }

  return (
    <li className={cn(log.level === 'error' && 'bg-destructive/[0.03]')}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-full flex-col gap-1.5 px-3 py-2.5 text-left outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset sm:flex-row sm:items-center sm:gap-3 sm:px-4"
      >
        <div className="flex items-center gap-2 sm:contents">
          <time className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums sm:w-36">{formatDateTime(log.time)}</time>
          <LevelBadge level={log.level} />
          <ChevronDown className={cn('ml-auto size-4 shrink-0 text-muted-foreground transition-transform sm:order-last', open && 'rotate-180')} aria-hidden />
        </div>
        <span className="min-w-0 text-sm font-medium sm:shrink-0">{log.message}</span>
        <span className="flex min-w-0 flex-1 flex-wrap gap-1.5 sm:flex-nowrap sm:overflow-hidden">
          {entries.slice(0, 3).map(([k, v]) => (
            <span key={k} className="max-w-full truncate rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
              {k}={v}
            </span>
          ))}
        </span>
      </button>
      {open && (
        <div className="flex flex-col gap-3 border-t bg-muted/30 px-3 py-3 sm:px-4">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 font-mono text-xs">
            {entries.map(([k, v]) => {
              const href = attrHref(k, v)
              return (
                <div key={k} className="contents">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="break-all">
                    {href ? (
                      <Link href={href} className="text-info underline underline-offset-2">
                        {v}
                      </Link>
                    ) : (
                      v
                    )}
                  </dd>
                </div>
              )
            })}
          </dl>
          <Button size="sm" variant="outline" className="h-9 w-fit" onClick={copy}>
            {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
            {copied ? t.shares.copied : t.share.copy}
          </Button>
        </div>
      )}
    </li>
  )
}
