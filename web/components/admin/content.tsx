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
const jobOptions = [
  ['analyze_meme', '重新识别'],
  ['embed_clip', '重建 CLIP 向量'],
  ['embed_text', '重建文本向量'],
] as const
type Job = (typeof jobOptions)[number][0]
const jobHint: Record<Job, string> = {
  analyze_meme: '调用识别服务（VLM）重新生成描述、标签与全部向量，每个表情包调用一次；处理期间显示为排队中或处理中。',
  embed_clip: '只重算图像的 CLIP 向量，不调用 VLM，不影响搜索；跳过尚未处理完成的表情包。',
  embed_text: '用已有识别结果重算文本向量，不调用 VLM，不影响搜索；跳过尚未处理完成的表情包。',
}

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
    toast.success(`已将 ${count} 个表情包加入处理队列`, {
      description: count ? undefined : job === 'analyze_meme' ? '排队中或处理中的表情包会被跳过' : '只处理已处理完成的表情包',
      action: count ? { label: '查看进度', onClick: () => router.push(`/admin/tasks/batches/${batch_id}`) } : undefined,
    })
    sel.clear()
  }
  const retryScope = pending?.kind === 'retry' ? ` ${pending.ids.length} 个` : pending?.kind === 'retryFilter' ? `当前筛选下的全部 ${total} 个` : '全站所有'

  const columns: Column<Meme>[] = [
    {
      key: 'meme',
      header: '表情包',
      mobile: 'title',
      cell: (m) => (
        <div className="flex min-w-0 items-center gap-3">
          <Link href={`/m/${m.id}`} className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted/50" aria-label={`查看 ${m.id}`}>
            <MemeMedia meme={m} />
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
            <DropdownMenuItem render={<Link href={`/admin/search?track=${m.id}`} />}>
              <ScanSearch />
              检索调试
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
        open={pending?.kind === 'retry' || pending?.kind === 'retryFilter' || pending?.kind === 'retryAll'}
        onOpenChange={(o) => !o && setPending(null)}
        title={pending?.kind === 'retryAll' ? '全量重新处理' : '重新处理'}
        description={`将处理${retryScope}表情包，作为一个批次在任务管理中显示进度；新上传的表情包会优先处理。`}
        confirmLabel={jobOptions.find(([v]) => v === job)?.[1]}
        onConfirm={() => (pending?.kind === 'retry' ? reprocess({ ids: pending.ids }) : reprocess({ filter: pending?.kind === 'retryAll' ? {} : filter }))}
      >
        <div className="flex flex-col gap-2">
          <FilterSelect value={job} onChange={setJob} options={jobOptions} label="处理内容" className="w-full" />
          <p className="text-sm text-pretty text-muted-foreground">{jobHint[job]}</p>
        </div>
      </ConfirmDialog>
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
