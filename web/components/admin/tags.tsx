'use client'

import { useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { Merge, Pencil, Tags, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { EmptyState } from '@/components/states'
import { AdminPageHeader, BulkBar, DataList, FilterSelect, Pagination, SearchInput, Toolbar, useDebounced, usePaging, type Column } from './admin-ui'
import { ConfirmDialog, useSelection } from './shared'
import { api, qs, refresh } from '@/lib/api'
import { formatDate } from '@/lib/format'
import type { Page, TagUsage } from '@/lib/types'
import { cn } from '@/lib/utils'

type SortKey = 'usage' | 'name' | 'created'
const sortOptions = [
  ['usage', '按使用次数'],
  ['name', '按名称'],
  ['created', '按创建时间'],
] as const

type Pending = { kind: 'rename'; tag: TagUsage } | { kind: 'merge'; sources: TagUsage[] } | { kind: 'delete'; tags: TagUsage[] } | null

export function AdminTags() {
  const [q, setQ] = useState('')
  const dq = useDebounced(q.trim())
  const [sort, setSort] = useState<SortKey>('usage')
  const [pending, setPending] = useState<Pending>(null)

  const paging = usePaging(`${dq}|${sort}`)
  const tags = useSWR<Page<TagUsage>>(`/admin/tags${qs({ q: dq, sort, ...paging.query })}`, { keepPreviousData: true })
  const rows = tags.data?.items ?? []
  const sel = useSelection(paging.pageKey)
  const selected = rows.filter((t) => sel.ids.has(t.id))
  const close = () => setPending(null)

  const columns: Column<TagUsage>[] = [
    {
      key: 'name',
      header: '名称',
      mobile: 'title',
      cell: (t) => (
        <Link href={`/tags/${encodeURIComponent(t.name)}`} className="font-medium hover:underline">
          #{t.name}
        </Link>
      ),
    },
    { key: 'usage', header: '使用次数', cell: (t) => <span className="tabular-nums">{t.usage}</span> },
    { key: 'created', header: '创建时间', cell: (t) => <span className="tabular-nums">{formatDate(t.created_at)}</span> },
  ]

  return (
    <>
      <AdminPageHeader title="标签管理" description={tags.data ? `共 ${tags.data.total} 个标签` : undefined} />
      <Toolbar>
        <SearchInput value={q} onChange={setQ} placeholder="搜索标签名称" className="basis-full sm:basis-auto" />
        <FilterSelect value={sort} onChange={setSort} options={sortOptions} label="排序" />
      </Toolbar>

      <DataList
        rows={rows}
        loading={!tags.data}
        columns={columns}
        getId={(t) => t.id}
        rowLabel={(t) => t.name}
        selected={sel.ids}
        onSelectedChange={sel.set}
        empty={<EmptyState icon={Tags} title="没有找到标签" className="border-0" />}
        actions={(t) => (
          <>
            <DropdownMenuItem onClick={() => setPending({ kind: 'rename', tag: t })}>
              <Pencil />
              重命名
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setPending({ kind: 'merge', sources: [t] })}>
              <Merge />
              合并到…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => setPending({ kind: 'delete', tags: [t] })}>
              <Trash2 />
              删除
            </DropdownMenuItem>
          </>
        )}
      />
      <Pagination paging={paging} total={tags.data?.total ?? 0} />

      <BulkBar count={selected.length} onClear={sel.clear}>
        <Button size="sm" variant="secondary" onClick={() => setPending({ kind: 'merge', sources: selected })}>
          <Merge aria-hidden />
          合并
        </Button>
        <Button size="sm" variant="destructive" onClick={() => setPending({ kind: 'delete', tags: selected })}>
          <Trash2 aria-hidden />
          删除
        </Button>
      </BulkBar>

      {pending?.kind === 'rename' && <RenameDialog tag={pending.tag} onClose={close} />}
      {pending?.kind === 'merge' && (
        <MergeDialog
          sources={pending.sources}
          onClose={close}
          onDone={() => {
            close()
            sel.clear()
          }}
        />
      )}
      <ConfirmDialog
        open={pending?.kind === 'delete'}
        onOpenChange={(o) => !o && close()}
        title={pending?.kind === 'delete' && pending.tags.length > 1 ? `删除 ${pending.tags.length} 个标签` : '删除标签'}
        destructive
        description={
          pending?.kind === 'delete'
            ? `会从所有表情包上移除${pending.tags.map((t) => `「${t.name}」`).join('')}，共被使用 ${pending.tags.reduce((n, t) => n + t.usage, 0)} 次，且无法恢复。`
            : ''
        }
        confirmLabel="删除"
        onConfirm={async () => {
          if (pending?.kind !== 'delete') return
          await api('/admin/tags', { method: 'DELETE', json: { ids: pending.tags.map((t) => t.id) } })
          await refresh()
          toast.success(`已删除 ${pending.tags.length} 个标签`)
          sel.clear()
        }}
      />
    </>
  )
}

function RenameDialog({ tag, onClose }: { tag: TagUsage; onClose: () => void }) {
  const [name, setName] = useState(tag.name)
  const trimmed = name.trim()
  const error = !trimmed ? '名称不能为空' : trimmed.length > 50 ? '名称最多 50 个字符' : null

  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="重命名标签"
      description={`当前名称：${tag.name}`}
      confirmLabel="保存"
      onConfirm={async () => {
        if (error || trimmed === tag.name) throw new Error(error ?? '名称未修改')
        await api(`/admin/tags/${tag.id}`, { method: 'PATCH', json: { name: trimmed } })
        await refresh()
        toast.success(`已重命名为「${trimmed}」`)
      }}
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="tag-name">新名称</Label>
        <Input
          id="tag-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-invalid={!!error}
          aria-describedby="tag-name-hint"
          className="h-10 text-base md:text-sm"
          autoFocus
        />
        <p id="tag-name-hint" className={cn('text-xs', error ? 'text-destructive' : 'text-muted-foreground')}>
          {error ?? `${trimmed.length} / 50；与已有标签同名时请改用“合并”`}
        </p>
      </div>
    </ConfirmDialog>
  )
}

function MergeDialog({ sources, onClose, onDone }: { sources: TagUsage[]; onClose: () => void; onDone: () => void }) {
  const [q, setQ] = useState('')
  const dq = useDebounced(q.trim())
  const [target, setTarget] = useState<TagUsage | null>(null)
  const { data } = useSWR<Page<TagUsage>>(`/admin/tags${qs({ q: dq, page_size: 30 })}`)
  const options = (data?.items ?? []).filter((c) => !sources.some((s) => s.id === c.id))

  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="合并标签"
      description={`${sources.map((s) => `「${s.name}」`).join('')}会并入目标标签，原标签会被删除。`}
      confirmLabel={target ? `合并到「${target.name}」` : '请选择目标'}
      onConfirm={async () => {
        if (!target) throw new Error('请选择目标标签')
        await api('/admin/tags/merge', { method: 'POST', json: { source_ids: sources.map((s) => s.id), target_id: target.id } })
        await refresh()
        toast.success(`已合并到「${target.name}」`)
        onDone()
      }}
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="merge-search">目标标签</Label>
        <Input id="merge-search" type="search" placeholder="搜索标签" value={q} onChange={(e) => setQ(e.target.value)} className="h-10 text-base md:text-sm" />
        <ul role="listbox" aria-label="目标标签" className="flex max-h-56 flex-col gap-0.5 overflow-y-auto rounded-lg border p-1">
          {options.length === 0 && <li className="px-3 py-4 text-center text-sm text-muted-foreground">{data ? '没有可选的标签' : '加载中…'}</li>}
          {options.map((o) => (
            <li key={o.id}>
              <button
                type="button"
                role="option"
                aria-selected={target?.id === o.id}
                onClick={() => setTarget(o)}
                className={cn('flex h-10 w-full items-center justify-between rounded-md px-3 text-sm', target?.id === o.id ? 'bg-foreground text-background' : 'hover:bg-muted')}
              >
                <span>#{o.name}</span>
                <span className={cn('text-xs tabular-nums', target?.id === o.id ? 'text-background/70' : 'text-muted-foreground')}>{o.usage} 次</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </ConfirmDialog>
  )
}
