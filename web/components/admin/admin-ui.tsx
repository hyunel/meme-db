'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Loader2, MoreHorizontal, RefreshCw, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { CopyButton } from '@/components/code-block'
import { cn } from '@/lib/utils'

export function AdminPageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  )
}

export function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

export function useNow(enabled: boolean, ms = 1000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!enabled) return
    const id = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(id)
  }, [enabled, ms])
  return now
}

export function SearchInput({ value, onChange, placeholder, className }: { value: string; onChange: (v: string) => void; placeholder: string; className?: string }) {
  return (
    <div className={cn('relative min-w-0 flex-1 sm:max-w-xs', className)}>
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} className="h-10 pl-9 text-base md:h-9 md:text-sm" />
    </div>
  )
}

export function FilterSelect<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: T
  onChange: (v: T) => void
  options: readonly (readonly [T, string])[]
  label: string
  className?: string
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as T)}>
      <SelectTrigger aria-label={label} className={cn('h-10 min-w-28 md:h-9', className)}>
        <SelectValue>{(v: T) => options.find((o) => o[0] === v)?.[1] ?? label}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map(([v, l]) => (
          <SelectItem key={v} value={v}>
            {l}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function Toolbar({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>
}

export function RefreshControls({ auto, onAutoChange, onRefresh }: { auto?: boolean; onAutoChange?: (v: boolean) => void; onRefresh: () => void }) {
  const [spin, setSpin] = useState(false)
  return (
    <div className="flex items-center gap-3">
      {onAutoChange && (
        <div className="flex items-center gap-2">
          <Switch id="auto-refresh" checked={auto} onCheckedChange={onAutoChange} />
          <Label htmlFor="auto-refresh" className="text-sm font-normal whitespace-nowrap">
            自动刷新
          </Label>
        </div>
      )}
      <Button
        variant="outline"
        size="icon"
        aria-label="刷新"
        onClick={() => {
          setSpin(true)
          onRefresh()
          setTimeout(() => setSpin(false), 500)
        }}
        className="size-10 md:size-9"
      >
        <RefreshCw className={cn(spin && 'animate-spin')} />
      </Button>
    </div>
  )
}

export function CopyId({ value, className }: { value: string; className?: string }) {
  return (
    <span className={cn('inline-flex max-w-full items-center gap-1 font-mono text-xs', className)}>
      <span className="truncate">{value}</span>
      <CopyButton value={value} />
    </span>
  )
}

export function ExpandableText({ text, max = 40 }: { text: string; max?: number }) {
  const [open, setOpen] = useState(false)
  if (text.length <= max) return <span>{text}</span>
  return (
    // Table cells don't wrap, and errors hold long unbroken paths: the full text wraps anywhere, at about the width it
    // had folded, so it neither widens its table nor gets squeezed by a table already wider than the page
    <span className={cn(open && 'block min-w-56 whitespace-normal wrap-anywhere')}>
      {open ? text : `${text.slice(0, max)}…`}{' '}
      <button type="button" className="text-xs font-medium underline underline-offset-2" onClick={() => setOpen(!open)}>
        {open ? '收起' : '展开'}
      </button>
    </span>
  )
}

/* ------------------------------- pagination ------------------------------- */

/** Returns to page 1 whenever resetKey changes. */
export function usePaging(resetKey: string, initialSize = 20) {
  const [state, setState] = useState({ key: resetKey, page: 1 })
  const [pageSize, setPageSize] = useState(initialSize)
  const page = state.key === resetKey ? state.page : 1
  return {
    page,
    pageSize,
    query: { page, page_size: pageSize },
    /** Changes whenever the visible rows may change; selections reset with it. */
    pageKey: `${resetKey}|${page}|${pageSize}`,
    setPage: (p: number) => setState({ key: resetKey, page: Math.max(1, p) }),
    setPageSize: (n: number) => {
      setPageSize(n)
      setState({ key: resetKey, page: 1 })
    },
  }
}

export type Paging = ReturnType<typeof usePaging>

export function Pagination({ paging, total }: { paging: Paging; total: number }) {
  const [jump, setJump] = useState('')
  const { page, pageSize } = paging
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  return (
    <nav aria-label="分页" className="flex flex-col gap-3 text-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-2 text-muted-foreground">
        <span className="tabular-nums">共 {total} 条</span>
        <Select value={String(pageSize)} onValueChange={(v) => paging.setPageSize(Number(v))}>
          <SelectTrigger aria-label="每页条数" className="h-9 w-24">
            <SelectValue>{(v: string) => `${v} 条/页`}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {[10, 20, 50, 100].map((n) => (
              <SelectItem key={n} value={String(n)}>
                {n} 条/页
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon" className="size-10 md:size-9" aria-label="上一页" disabled={page <= 1} onClick={() => paging.setPage(Math.min(page, pageCount) - 1)}>
          <ChevronLeft />
        </Button>
        <span className="min-w-16 text-center tabular-nums" aria-live="polite">
          {page} / {pageCount}
        </span>
        <Button variant="outline" size="icon" className="size-10 md:size-9" aria-label="下一页" disabled={page >= pageCount} onClick={() => paging.setPage(page + 1)}>
          <ChevronRight />
        </Button>
        <form
          className="ml-auto flex items-center gap-1 sm:ml-2"
          onSubmit={(e) => {
            e.preventDefault()
            const n = Number(jump)
            if (Number.isInteger(n) && n >= 1) paging.setPage(Math.min(n, pageCount))
            setJump('')
          }}
        >
          <Input inputMode="numeric" value={jump} onChange={(e) => setJump(e.target.value.replace(/\D/g, ''))} aria-label="跳转到页码" placeholder="页码" className="h-10 w-16 text-base md:h-9 md:text-sm" />
          <Button type="submit" variant="ghost" className="h-10 md:h-9" disabled={!jump}>
            跳转
          </Button>
        </form>
      </div>
    </nav>
  )
}

/* -------------------------------- data list -------------------------------- */

export interface Column<T> {
  key: string
  header: string
  cell: (row: T) => React.ReactNode
  /** title: card heading on mobile; hidden: desktop only */
  mobile?: 'title' | 'field' | 'hidden'
  className?: string
  /** Makes the header sortable; null values sort last */
  sortValue?: (row: T) => number | string | null
}

export interface SortState {
  key: string
  dir: 'asc' | 'desc'
}

export function sortRows<T>(rows: T[], columns: Column<T>[], sort: SortState | undefined) {
  const get = sort && columns.find((c) => c.key === sort.key)?.sortValue
  if (!get) return rows
  const dir = sort.dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const x = get(a)
    const y = get(b)
    if (x === y) return 0
    if (x === null) return 1
    if (y === null) return -1
    return (x < y ? -1 : 1) * dir
  })
}

/** Table on desktop, stacked cards on mobile. */
export function DataList<T>({
  rows,
  columns,
  getId,
  selected,
  onSelectedChange,
  actions,
  empty,
  rowLabel,
  loading = false,
  sort,
  onSortChange,
  rowClassName,
  onRowClick,
}: {
  rows: T[]
  columns: Column<T>[]
  getId: (row: T) => string
  selected?: Set<string>
  onSelectedChange?: (s: Set<string>) => void
  actions?: (row: T) => React.ReactNode
  empty: React.ReactNode
  rowLabel: (row: T) => string
  loading?: boolean
  sort?: SortState
  onSortChange?: (s: SortState) => void
  rowClassName?: (row: T) => string | undefined
  onRowClick?: (row: T) => void
}) {
  const selectable = Boolean(selected && onSelectedChange)
  const ids = rows.map(getId)
  const all = selectable && ids.length > 0 && ids.every((id) => selected!.has(id))
  const some = selectable && ids.some((id) => selected!.has(id))
  const toggle = (id: string) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onSelectedChange!(next)
  }
  const title = columns.find((c) => c.mobile === 'title')
  const fields = columns.filter((c) => c.mobile !== 'title' && c.mobile !== 'hidden')

  if (loading)
    return (
      <div className="flex h-40 items-center justify-center rounded-xl border bg-card text-muted-foreground" aria-busy="true">
        <Loader2 className="size-5 animate-spin" aria-label="加载中" />
      </div>
    )
  if (!rows.length) return <div className="rounded-xl border bg-card">{empty}</div>

  const RowMenu = ({ row }: { row: T }) =>
    actions ? (
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label={`${rowLabel(row)} 的操作`} className="size-10 md:size-8" />}>
          <MoreHorizontal />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          {actions(row)}
        </DropdownMenuContent>
      </DropdownMenu>
    ) : null

  return (
    <>
      <div className="hidden overflow-hidden rounded-xl border bg-card md:block">
        <Table>
          <TableHeader>
            <TableRow>
              {selectable && (
                <TableHead className="w-10">
                  <Checkbox
                    aria-label="全选本页"
                    checked={all}
                    indeterminate={!all && some}
                    onCheckedChange={() => onSelectedChange!(all ? new Set() : new Set(ids))}
                  />
                </TableHead>
              )}
              {columns.map((c) => {
                const active = sort?.key === c.key
                const SortIcon = !active ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown
                return (
                  <TableHead key={c.key} className={c.className} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                    {c.sortValue && onSortChange ? (
                      <button
                        type="button"
                        onClick={() => onSortChange({ key: c.key, dir: active && sort.dir === 'desc' ? 'asc' : 'desc' })}
                        className={cn('-ml-1.5 inline-flex h-8 items-center gap-1 rounded px-1.5 hover:bg-muted hover:text-foreground', active && 'text-foreground')}
                      >
                        {c.header}
                        <SortIcon className={cn('size-3.5', !active && 'opacity-40')} aria-hidden />
                      </button>
                    ) : (
                      c.header
                    )}
                  </TableHead>
                )
              })}
              {actions && (
                <TableHead className="w-12">
                  <span className="sr-only">操作</span>
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const id = getId(r)
              return (
                <TableRow
                  key={id}
                  data-state={selected?.has(id) ? 'selected' : undefined}
                  className={cn(onRowClick && 'cursor-pointer', rowClassName?.(r))}
                  onClick={onRowClick ? () => onRowClick(r) : undefined}
                >
                  {selectable && (
                    <TableCell>
                      <Checkbox aria-label={`选择 ${rowLabel(r)}`} checked={selected!.has(id)} onCheckedChange={() => toggle(id)} />
                    </TableCell>
                  )}
                  {columns.map((c) => (
                    <TableCell key={c.key} className={c.className}>
                      {c.cell(r)}
                    </TableCell>
                  ))}
                  {actions && (
                    <TableCell>
                      <RowMenu row={r} />
                    </TableCell>
                  )}
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-col gap-2 md:hidden">
        {selectable && (
          <label className="flex h-10 items-center gap-2 px-1 text-sm text-muted-foreground">
            <Checkbox checked={all} indeterminate={!all && some} onCheckedChange={() => onSelectedChange!(all ? new Set() : new Set(ids))} />
            全选本页
          </label>
        )}
        <ul className="flex flex-col gap-2">
          {rows.map((r) => {
            const id = getId(r)
            return (
              <li
                key={id}
                onClick={onRowClick ? () => onRowClick(r) : undefined}
                className={cn('flex flex-col gap-3 rounded-xl border bg-card p-3', onRowClick && 'cursor-pointer active:bg-muted/50', selected?.has(id) && 'border-foreground/40 bg-muted/40', rowClassName?.(r))}
              >
                <div className="flex items-start gap-3">
                  {selectable && <Checkbox aria-label={`选择 ${rowLabel(r)}`} className="mt-1 size-5" checked={selected!.has(id)} onCheckedChange={() => toggle(id)} />}
                  <div className="min-w-0 flex-1">{title?.cell(r)}</div>
                  <div className="-mt-1 -mr-1">
                    <RowMenu row={r} />
                  </div>
                </div>
                {fields.length > 0 && (
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                    {fields.map((c) => (
                      <div key={c.key} className="flex min-w-0 flex-col gap-0.5">
                        <dt className="text-xs text-muted-foreground">{c.header}</dt>
                        <dd className="min-w-0">{c.cell(r)}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </li>
            )
          })}
        </ul>
      </div>
    </>
  )
}

/* ------------------------------- bulk actions ------------------------------ */

export function BulkBar({ count, onClear, children }: { count: number; onClear: () => void; children: React.ReactNode }) {
  if (!count) return null
  return (
    <div
      role="toolbar"
      aria-label="批量操作"
      className="sticky bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-30 flex flex-wrap items-center gap-2 rounded-xl border bg-foreground px-3 py-2 text-background shadow-lg"
    >
      <span className="text-sm tabular-nums">已选 {count} 项</span>
      <div className="flex flex-1 flex-wrap justify-end gap-2 [&_button]:h-9">{children}</div>
      <Button size="sm" variant="ghost" className="h-9 text-background hover:bg-background/15 hover:text-background" onClick={onClear}>
        取消
      </Button>
    </div>
  )
}

export const toneText = { warn: 'text-warning-strong', danger: 'text-destructive' } as const
export const toneLabel = { warn: '预警', danger: '严重' } as const

export function StatCard({
  label,
  value,
  hint,
  href,
  tone,
  children,
}: {
  label: string
  value: React.ReactNode
  hint?: React.ReactNode
  href?: string
  tone?: 'danger' | 'warn'
  children?: React.ReactNode
}) {
  const body = (
    <>
      <span className="truncate text-xs text-muted-foreground">{label}</span>
      <span className={cn('truncate text-xl font-semibold tabular-nums sm:text-2xl', tone && toneText[tone])}>
        {value}
        {tone && <span className="sr-only">（{toneLabel[tone]}）</span>}
      </span>
      {hint && <span className="truncate text-xs text-muted-foreground">{hint}</span>}
      {children}
    </>
  )
  const cls = cn('flex min-w-0 flex-col gap-1 rounded-xl border bg-card p-3 sm:p-4', tone === 'warn' && 'border-warning/50', tone === 'danger' && 'border-destructive/40')
  return href ? (
    <Link href={href} className={cn(cls, 'transition hover:border-foreground/30 hover:shadow-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none')}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  )
}
