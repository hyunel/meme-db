'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import useSWR from 'swr'
import { Eye, Images, ListChecks, RotateCw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { EmptyState } from '@/components/states'
import { MemeMedia } from '@/components/meme/meme-media'
import { ProcessBadge } from '@/components/status-badges'
import { AdminPageHeader, BulkBar, CopyId, DataList, ExpandableText, FilterSelect, Pagination, SearchInput, Toolbar, useDebounced, usePaging, type Column } from './admin-ui'
import { ConfirmDialog, rangeOptions, rangeStart, useSelection, type RangeKey } from './shared'
import { api, qs, refresh } from '@/lib/api'
import { formatBytes, formatDateTime } from '@/lib/format'
import { kindOf } from '@/lib/media'
import type { MediaKind, Meme, Page, ProcessStatus } from '@/lib/types'

const statusOptions = [
  ['all', '全部状态'],
  ['pending', '排队中'],
  ['processing', '处理中'],
  ['success', '已完成'],
  ['failed', '处理失败'],
] as const
const visOptions = [
  ['all', '公开与私有'],
  ['public', '公开'],
  ['private', '私有'],
] as const
const kindOptions = [
  ['all', '全部类型'],
  ['image', '静态图'],
  ['gif', 'GIF'],
  ['video', '视频'],
  ['lottie', 'Lottie'],
] as const
const kindLabel: Record<MediaKind, string> = { image: '静态图', gif: 'GIF', video: '视频', lottie: 'Lottie' }

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

  const filter = { q: dq, status: status === 'all' ? '' : status, visibility: vis === 'all' ? '' : vis, kind: kind === 'all' ? '' : kind, from }
  const paging = usePaging(JSON.stringify(filter))
  const memes = useSWR<Page<Meme>>(`/admin/memes${qs({ ...filter, ...paging.query })}`, { keepPreviousData: true })
  const rows = memes.data?.items ?? []
  const total = memes.data?.total ?? 0
  const sel = useSelection(paging.pageKey)
  const selected = rows.filter((m) => sel.ids.has(m.id))

  const reprocess = async (body: object) => {
    const { count } = await api<{ count: number }>('/admin/memes/reprocess', { method: 'POST', json: body })
    await refresh()
    toast.success(`已将 ${count} 个表情包加入处理队列`, { description: count ? undefined : '排队中或处理中的表情包会被跳过' })
    sel.clear()
  }

  const columns: Column<Meme>[] = [
    {
      key: 'meme',
      header: '表情包',
      mobile: 'title',
      cell: (m) => (
        <div className="flex min-w-0 items-center gap-3">
          <Link href={`/m/${m.id}`} className="size-12 shrink-0 overflow-hidden rounded-lg border bg-muted" aria-label={`查看 ${m.id}`}>
            <MemeMedia meme={m} className="size-full object-cover" />
          </Link>
          <CopyId value={m.id} className="min-w-0" />
        </div>
      ),
    },
    { key: 'kind', header: '类型', cell: (m) => kindLabel[kindOf(m.mime_type)] },
    { key: 'size', header: '大小', cell: (m) => <span className="tabular-nums">{formatBytes(m.file_size)}</span> },
    { key: 'uploaded', header: '上传时间', cell: (m) => <span className="tabular-nums whitespace-nowrap">{formatDateTime(m.created_at)}</span> },
    { key: 'status', header: '处理状态', cell: (m) => <ProcessBadge status={m.status} /> },
    { key: 'processed', header: '处理完成', mobile: 'hidden', cell: (m) => <span className="tabular-nums whitespace-nowrap">{m.analyzed_at ? formatDateTime(m.analyzed_at) : '—'}</span> },
    { key: 'collect', header: '收录', cell: (m) => <span className="tabular-nums">{m.library_count} 次</span> },
    { key: 'public', header: '公开', cell: (m) => (m.is_public ? '是' : <span className="text-muted-foreground">否</span>) },
    {
      key: 'fail',
      header: '失败原因',
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
        title="内容管理"
        description="全站表情包及其处理状态"
        actions={
          <>
            <Button variant="outline" className="h-10 md:h-9" disabled={!total} onClick={() => setPending({ kind: 'retryFilter' })}>
              <RotateCw aria-hidden />
              重新处理筛选结果
            </Button>
            <Button variant="outline" className="h-10 md:h-9" onClick={() => setPending({ kind: 'retryAll' })}>
              全量重新处理
            </Button>
          </>
        }
      />

      <Toolbar>
        <SearchInput value={q} onChange={setQ} placeholder="搜索表情包标识" className="basis-full sm:basis-auto" />
        <FilterSelect value={status} onChange={setStatus} options={statusOptions} label="处理状态" />
        <FilterSelect value={vis} onChange={setVis} options={visOptions} label="是否公开" />
        <FilterSelect value={kind} onChange={setKind} options={kindOptions} label="类型" />
        <FilterSelect value={range} onChange={setRange} options={rangeOptions} label="上传时间" />
      </Toolbar>

      <DataList
        rows={rows}
        loading={!memes.data}
        columns={columns}
        getId={(m) => m.id}
        rowLabel={(m) => m.id}
        selected={sel.ids}
        onSelectedChange={sel.set}
        empty={<EmptyState icon={Images} title="没有符合条件的表情包" description="试试调整筛选条件。" className="border-0" />}
        actions={(m) => (
          <>
            <DropdownMenuItem render={<Link href={`/m/${m.id}`} />}>
              <Eye />
              查看详情
            </DropdownMenuItem>
            <DropdownMenuItem render={<Link href={`/admin/tasks?view=history&meme=${m.id}`} />}>
              <ListChecks />
              查看相关任务
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setPending({ kind: 'retry', ids: [m.id] })}>
              <RotateCw />
              重新处理
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => setPending({ kind: 'delete', memes: [m] })}>
              <Trash2 />
              删除
            </DropdownMenuItem>
          </>
        )}
      />
      <Pagination paging={paging} total={total} />

      <BulkBar count={selected.length} onClear={sel.clear}>
        <Button size="sm" variant="secondary" onClick={() => setPending({ kind: 'retry', ids: selected.map((m) => m.id) })}>
          <RotateCw aria-hidden />
          重新处理
        </Button>
        <Button size="sm" variant="destructive" onClick={() => setPending({ kind: 'delete', memes: selected })}>
          <Trash2 aria-hidden />
          删除
        </Button>
      </BulkBar>

      <ConfirmDialog
        open={pending?.kind === 'retry' || pending?.kind === 'retryFilter'}
        onOpenChange={(o) => !o && setPending(null)}
        title="重新处理"
        description={`将重新处理${pending?.kind === 'retry' ? ` ${pending.ids.length} 个` : `当前筛选下的全部 ${total} 个`}表情包，处理期间它们会显示为排队中或处理中。`}
        confirmLabel="重新处理"
        onConfirm={() => (pending?.kind === 'retry' ? reprocess({ ids: pending.ids }) : reprocess({ filter }))}
      />
      <ConfirmDialog
        open={pending?.kind === 'retryAll'}
        onOpenChange={(o) => !o && setPending(null)}
        title="全量重新处理"
        description="将重新处理全站所有表情包，可能耗时较长，并会为每个表情包调用一次识别服务。期间新上传的表情包会优先处理。"
        confirmLabel="开始全量处理"
        onConfirm={() => reprocess({ filter: {} })}
      />
      <ConfirmDialog
        open={pending?.kind === 'delete'}
        onOpenChange={(o) => !o && setPending(null)}
        title={pending?.kind === 'delete' && pending.memes.length > 1 ? `删除 ${pending.memes.length} 个表情包` : '删除表情包'}
        destructive
        description="会永久删除表情包，并从所有用户的库中移除，无法恢复。"
        requireText={pending?.kind === 'delete' ? (pending.memes.length === 1 ? pending.memes[0].id : '删除') : undefined}
        confirmLabel="永久删除"
        onConfirm={async () => {
          if (pending?.kind !== 'delete') return
          const { count } = await api<{ count: number }>('/admin/memes', { method: 'DELETE', json: { ids: pending.memes.map((m) => m.id) } })
          await refresh()
          toast.success(`已删除 ${count} 个表情包`)
          sel.clear()
        }}
      />
    </>
  )
}
