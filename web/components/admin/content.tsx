'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import useSWR from 'swr'
import { Eye, Images, ListChecks, RotateCw, ScanSearch, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { EmptyState } from '@/components/states'
import { MemeMedia } from '@/components/meme/meme-media'
import { ProcessBadge } from '@/components/status-badges'
import { AdminPageHeader, BulkBar, CopyId, DataList, ExpandableText, FilterSelect, Pagination, SearchInput, Toolbar, useDebounced, usePaging, type Column } from './admin-ui'
import { ConfirmDialog, rangeOptions, rangeStart, useSelection, type RangeKey } from './shared'
import { api, refresh } from '@/lib/api'
import { qs } from '@/lib/utils'
import { formatBytes, formatDateTime } from '@/lib/format'
import { kindOf } from '@/lib/media'
import type { MediaKind, Meme, Page, ProcessStatus } from '@/lib/types'
import { useMessages } from '@/lib/i18n/client'

const jobs = ['analyze_meme', 'embed_clip', 'embed_text', 'embed_meme'] as const
type Job = (typeof jobs)[number]

type Pending = { kind: 'retry'; ids: string[] } | { kind: 'retryFilter' } | { kind: 'retryAll' } | { kind: 'delete'; memes: Meme[] } | null

export function AdminContent() {
  const params = useSearchParams()
  const [q, setQ] = useState(params.get('q') ?? '')
  const dq = useDebounced(q.trim())
  const [status, setStatus] = useState<'all' | ProcessStatus>((params.get('status') as ProcessStatus) ?? 'all')
  const [vis, setVis] = useState<'all' | 'public' | 'private'>((params.get('visibility') as 'public') ?? 'all')
  const [kind, setKind] = useState<'all' | MediaKind>('all')
  const [range, setRange] = useState<RangeKey>('all')
  const from = useMemo(() => rangeStart(range), [range])
  const [pending, setPending] = useState<Pending>(null)
  const [job, setJob] = useState<Job>('analyze_meme')
  const router = useRouter()
  const t = useMessages()
  const c = t.content

  const filter = { q: dq, status: status === 'all' ? '' : status, visibility: vis === 'all' ? '' : vis, kind: kind === 'all' ? '' : kind, from }
  const paging = usePaging(JSON.stringify(filter))
  const memes = useSWR<Page<Meme>>(`/admin/memes${qs({ ...filter, ...paging.query })}`, { keepPreviousData: true })
  const rows = memes.data?.items ?? []
  const total = memes.data?.total ?? 0
  const sel = useSelection(paging.pageKey)
  const selected = rows.filter((m) => sel.ids.has(m.id))

  const reprocess = async (body: object) => {
    const { count, batch_id } = await api<{ count: number; batch_id: string }>('/admin/memes/reprocess', { method: 'POST', json: { ...body, job } })
    await refresh()
    toast.success(c.queued(count), {
      description: count ? undefined : job === 'analyze_meme' ? c.skippedBusy : job === 'embed_meme' ? c.noneMissing : c.onlyProcessed,
      action: count ? { label: c.progress, onClick: () => router.push(`/admin/tasks/batches/${batch_id}`) } : undefined,
    })
    sel.clear()
  }
  const retryScope = pending?.kind === 'retry' ? c.scopeSome(pending.ids.length) : pending?.kind === 'retryFilter' ? c.scopeFilter(total) : c.scopeAll

  const columns: Column<Meme>[] = [
    {
      key: 'meme',
      header: c.meme,
      mobile: 'title',
      cell: (m) => (
        <div className="flex min-w-0 items-center gap-3">
          <Link href={`/m/${m.id}`} className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted/50" aria-label={c.view(m.id)}>
            <MemeMedia meme={m} />
          </Link>
          <CopyId value={m.id} className="min-w-0" />
        </div>
      ),
    },
    { key: 'kind', header: c.kind, cell: (m) => c.kinds[kindOf(m.mime_type)] },
    { key: 'size', header: t.meme.size, cell: (m) => <span className="tabular-nums">{formatBytes(m.file_size)}</span> },
    { key: 'uploaded', header: t.meme.uploaded, cell: (m) => <span className="tabular-nums whitespace-nowrap">{formatDateTime(m.created_at)}</span> },
    { key: 'status', header: c.status, cell: (m) => <ProcessBadge status={m.status} /> },
    { key: 'processed', header: c.processed, mobile: 'hidden', cell: (m) => <span className="tabular-nums whitespace-nowrap">{m.analyzed_at ? formatDateTime(m.analyzed_at) : '—'}</span> },
    { key: 'collect', header: c.collected, cell: (m) => <span className="tabular-nums">{c.times(m.library_count)}</span> },
    { key: 'public', header: t.status.public, cell: (m) => (m.is_public ? c.yes : <span className="text-muted-foreground">{c.no}</span>) },
    {
      key: 'fail',
      header: c.failReason,
      className: 'max-w-48',
      cell: (m) =>
        m.fail_reason ? (
          <span className="text-destructive">
            <ExpandableText text={m.fail_reason} max={16} />
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
  ]

  return (
    <>
      <AdminPageHeader
        title={t.titles.content}
        description={c.description}
        actions={
          <>
            <Button variant="outline" className="h-10 md:h-9" disabled={!total} onClick={() => setPending({ kind: 'retryFilter' })}>
              <RotateCw aria-hidden />
              {c.reprocessFiltered}
            </Button>
            <Button variant="outline" className="h-10 md:h-9" onClick={() => setPending({ kind: 'retryAll' })}>
              {c.reprocessAll}
            </Button>
          </>
        }
      />

      <Toolbar>
        <SearchInput value={q} onChange={setQ} placeholder={c.searchId} className="basis-full sm:basis-auto" />
        <FilterSelect
          value={status}
          onChange={setStatus}
          options={[['all', c.allStatuses], ...(['pending', 'processing', 'success', 'failed'] as const).map((s) => [s, t.status[s]] as const)]}
          label={c.status}
        />
        <FilterSelect
          value={vis}
          onChange={setVis}
          options={[
            ['all', c.allVisibility],
            ['public', t.status.public],
            ['private', t.status.private],
          ]}
          label={c.visibility}
        />
        <FilterSelect value={kind} onChange={setKind} options={[['all', c.allKinds], ...(['image', 'gif', 'video', 'lottie'] as const).map((k) => [k, c.kinds[k]] as const)]} label={c.kind} />
        <FilterSelect value={range} onChange={setRange} options={rangeOptions(t)} label={t.meme.uploaded} />
      </Toolbar>

      <DataList
        rows={rows}
        loading={!memes.data}
        columns={columns}
        getId={(m) => m.id}
        rowLabel={(m) => m.id}
        selected={sel.ids}
        onSelectedChange={sel.set}
        empty={<EmptyState icon={Images} title={c.none} description={c.noneHint} className="border-0" />}
        actions={(m) => (
          <>
            <DropdownMenuItem render={<Link href={`/m/${m.id}`} />}>
              <Eye />
              {t.meme.details}
            </DropdownMenuItem>
            <DropdownMenuItem render={<Link href={`/admin/tasks?meme=${m.id}`} />}>
              <ListChecks />
              {c.tasks}
            </DropdownMenuItem>
            <DropdownMenuItem render={<Link href={`/admin/search?track=${m.id}`} />}>
              <ScanSearch />
              {t.titles.searchDebug}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setPending({ kind: 'retry', ids: [m.id] })}>
              <RotateCw />
              {c.reprocess}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => setPending({ kind: 'delete', memes: [m] })}>
              <Trash2 />
              {t.library.delete}
            </DropdownMenuItem>
          </>
        )}
      />
      <Pagination paging={paging} total={total} />

      <BulkBar count={selected.length} onClear={sel.clear}>
        <Button size="sm" variant="secondary" onClick={() => setPending({ kind: 'retry', ids: selected.map((m) => m.id) })}>
          <RotateCw aria-hidden />
          {c.reprocess}
        </Button>
        <Button size="sm" variant="destructive" onClick={() => setPending({ kind: 'delete', memes: selected })}>
          <Trash2 aria-hidden />
          {t.library.delete}
        </Button>
      </BulkBar>

      <ConfirmDialog
        open={pending?.kind === 'retry' || pending?.kind === 'retryFilter' || pending?.kind === 'retryAll'}
        onOpenChange={(o) => !o && setPending(null)}
        title={pending?.kind === 'retryAll' ? c.reprocessAll : c.reprocess}
        description={c.reprocessHint(retryScope)}
        confirmLabel={c.jobs[job].label}
        onConfirm={() => (pending?.kind === 'retry' ? reprocess({ ids: pending.ids }) : reprocess({ filter: pending?.kind === 'retryAll' ? {} : filter }))}
      >
        <div className="flex flex-col gap-2">
          <FilterSelect value={job} onChange={setJob} options={jobs.map((j) => [j, c.jobs[j].label] as const)} label={c.job} className="w-full" />
          <p className="text-sm text-pretty text-muted-foreground">{c.jobs[job].hint}</p>
        </div>
      </ConfirmDialog>
      <ConfirmDialog
        open={pending?.kind === 'delete'}
        onOpenChange={(o) => !o && setPending(null)}
        title={pending?.kind === 'delete' && pending.memes.length > 1 ? c.deleteSome(pending.memes.length) : c.deleteOne}
        destructive
        description={c.deleteHint}
        requireText={pending?.kind === 'delete' ? (pending.memes.length === 1 ? pending.memes[0].id : c.deleteWord) : undefined}
        confirmLabel={c.deleteForever}
        onConfirm={async () => {
          if (pending?.kind !== 'delete') return
          const { count } = await api<{ count: number }>('/admin/memes', { method: 'DELETE', json: { ids: pending.memes.map((m) => m.id) } })
          await refresh()
          toast.success(c.deleted(count))
          sel.clear()
        }}
      />
    </>
  )
}
