'use client'

import { useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { Eye, EyeOff, Merge, Pencil, Tags, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { EmptyState } from '@/components/states'
import { TabSwitch } from '@/components/tab-switch'
import { AdminPageHeader, BulkBar, DataList, FilterSelect, Pagination, SearchInput, Toolbar, useDebounced, usePaging, type Column } from './admin-ui'
import { ConfirmDialog, useSelection } from './shared'
import { api, refresh } from '@/lib/api'
import { formatDate } from '@/lib/format'
import { useMessages } from '@/lib/i18n/client'
import type { Page, TagUsage } from '@/lib/types'
import { cn, qs } from '@/lib/utils'

type SortKey = 'usage' | 'name' | 'created'

type Pending = { kind: 'rename'; tag: TagUsage } | { kind: 'merge'; sources: TagUsage[] } | { kind: 'delete'; tags: TagUsage[] } | null

const badge = 'inline-flex h-5 items-center rounded-full px-2 text-xs font-medium whitespace-nowrap'

export function AdminTags() {
  const [view, setView] = useState<'all' | 'duplicates'>('all')
  const duplicates = useSWR<TagUsage[][]>('/admin/tags/duplicates')
  const t = useMessages()
  const tabs = (
    <TabSwitch
      fill
      label={t.adminTags.view}
      value={view}
      onChange={setView}
      tabs={[
        ['all', t.adminTags.all],
        ['duplicates', t.adminTags.duplicates, duplicates.data?.length],
      ]}
    />
  )

  return (
    <>
      <AdminPageHeader title={t.titles.tags} description={t.adminTags.description} />
      {view === 'all' ? <TagList tabs={tabs} /> : <TagDuplicates tabs={tabs} groups={duplicates.data} />}
    </>
  )
}

function TagList({ tabs }: { tabs: React.ReactNode }) {
  const [q, setQ] = useState('')
  const dq = useDebounced(q.trim())
  const [sort, setSort] = useState<SortKey>('usage')
  const [pending, setPending] = useState<Pending>(null)
  const t = useMessages()
  const a = t.adminTags

  const paging = usePaging(`${dq}|${sort}`)
  const tags = useSWR<Page<TagUsage>>(`/admin/tags${qs({ q: dq, sort, ...paging.query })}`, { keepPreviousData: true })
  const rows = tags.data?.items ?? []
  const sel = useSelection(paging.pageKey)
  const selected = rows.filter((tag) => sel.ids.has(tag.id))
  const close = () => setPending(null)

  const columns: Column<TagUsage>[] = [
    {
      key: 'name',
      header: a.name,
      mobile: 'title',
      cell: (tag) => (
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <Link href={`/tags/${encodeURIComponent(tag.name)}`} className="font-medium hover:underline">
              #{tag.name}
            </Link>
            {tag.hidden ? (
              <span className={cn(badge, 'bg-muted text-muted-foreground')}>{a.hidden}</span>
            ) : (
              tag.common && (
                <span className={cn(badge, 'bg-warning/15 text-warning-strong')} title={a.commonHint}>
                  {a.common}
                </span>
              )
            )}
          </div>
          {tag.aliases.length > 0 && (
            <span className="truncate text-xs text-muted-foreground" title={a.list(tag.aliases)}>
              {a.aliases(tag.aliases)}
            </span>
          )}
        </div>
      ),
    },
    { key: 'usage', header: a.usage, cell: (tag) => <span className="tabular-nums">{tag.usage}</span> },
    { key: 'created', header: a.created, cell: (tag) => <span className="tabular-nums">{formatDate(tag.created_at)}</span> },
  ]

  const setHidden = async (tag: TagUsage, hidden: boolean) => {
    await api(`/admin/tags/${tag.id}`, { method: 'PATCH', json: { hidden } })
    await refresh()
    toast.success(hidden ? a.hid(tag.name) : a.unhid(tag.name))
  }

  return (
    <>
      <div className="flex flex-col gap-3">
        {tabs}
        <Toolbar>
          <SearchInput value={q} onChange={setQ} placeholder={a.search} className="basis-full sm:basis-auto" />
          <FilterSelect value={sort} onChange={setSort} options={(['usage', 'name', 'created'] as const).map((k) => [k, a.sorts[k]] as const)} label={a.sort} />
        </Toolbar>
      </div>

      <DataList
        rows={rows}
        loading={!tags.data}
        columns={columns}
        getId={(tag) => tag.id}
        rowLabel={(tag) => tag.name}
        selected={sel.ids}
        onSelectedChange={sel.set}
        empty={<EmptyState icon={Tags} title={a.none} className="border-0" />}
        actions={(tag) => (
          <>
            <DropdownMenuItem onClick={() => setPending({ kind: 'rename', tag })}>
              <Pencil />
              {t.library.rename}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setPending({ kind: 'merge', sources: [tag] })}>
              <Merge />
              {a.mergeInto}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setHidden(tag, !tag.hidden)}>
              {tag.hidden ? <Eye /> : <EyeOff />}
              {tag.hidden ? a.unhide : a.hide}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => setPending({ kind: 'delete', tags: [tag] })}>
              <Trash2 />
              {t.library.delete}
            </DropdownMenuItem>
          </>
        )}
      />
      <Pagination paging={paging} total={tags.data?.total ?? 0} />

      <BulkBar count={selected.length} onClear={sel.clear}>
        <Button size="sm" variant="secondary" onClick={() => setPending({ kind: 'merge', sources: selected })}>
          <Merge aria-hidden />
          {a.merge}
        </Button>
        <Button size="sm" variant="destructive" onClick={() => setPending({ kind: 'delete', tags: selected })}>
          <Trash2 aria-hidden />
          {t.library.delete}
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
        title={pending?.kind === 'delete' && pending.tags.length > 1 ? a.deleteSome(pending.tags.length) : a.deleteOne}
        destructive
        description={
          pending?.kind === 'delete'
            ? a.deleteHint(
                pending.tags.map((tag) => tag.name),
                pending.tags.reduce((n, tag) => n + tag.usage, 0),
              )
            : ''
        }
        confirmLabel={t.library.delete}
        onConfirm={async () => {
          if (pending?.kind !== 'delete') return
          await api('/admin/tags', { method: 'DELETE', json: { ids: pending.tags.map((tag) => tag.id) } })
          await refresh()
          toast.success(a.deleted(pending.tags.length))
          sel.clear()
        }}
      />
    </>
  )
}

function RenameDialog({ tag, onClose }: { tag: TagUsage; onClose: () => void }) {
  const [name, setName] = useState(tag.name)
  const t = useMessages()
  const a = t.adminTags
  const trimmed = name.trim()
  const error = !trimmed ? a.nameRequired : trimmed.length > 50 ? a.nameTooLong : null

  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={a.renameTitle}
      description={a.currentName(tag.name)}
      confirmLabel={t.library.save}
      onConfirm={async () => {
        if (error || trimmed === tag.name) throw new Error(error ?? a.unchanged)
        await api(`/admin/tags/${tag.id}`, { method: 'PATCH', json: { name: trimmed } })
        await refresh()
        toast.success(a.renamed(trimmed))
      }}
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="tag-name">{t.library.newName}</Label>
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
          {error ?? a.nameHint(trimmed.length)}
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
  const t = useMessages()
  const a = t.adminTags

  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={a.mergeTitle}
      description={a.mergeHint(sources.map((s) => s.name))}
      confirmLabel={target ? a.mergeTo(target.name) : a.pickTarget}
      onConfirm={async () => {
        if (!target) throw new Error(a.targetRequired)
        await api('/admin/tags/merge', { method: 'POST', json: { source_ids: sources.map((s) => s.id), target_id: target.id } })
        await refresh()
        toast.success(a.merged(target.name))
        onDone()
      }}
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="merge-search">{a.target}</Label>
        <Input id="merge-search" type="search" placeholder={a.searchTags} value={q} onChange={(e) => setQ(e.target.value)} className="h-10 text-base md:text-sm" />
        <ul role="listbox" aria-label={a.target} className="flex max-h-56 flex-col gap-0.5 overflow-y-auto rounded-lg border p-1">
          {options.length === 0 && <li className="px-3 py-4 text-center text-sm text-muted-foreground">{data ? a.noOptions : t.common.loadingMore}</li>}
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
                <span className={cn('text-xs tabular-nums', target?.id === o.id ? 'text-background/70' : 'text-muted-foreground')}>{a.uses(o.usage)}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </ConfirmDialog>
  )
}

function TagDuplicates({ tabs, groups }: { tabs: React.ReactNode; groups?: TagUsage[][] }) {
  const [pending, setPending] = useState<{ target: TagUsage; sources: TagUsage[] } | null>(null)
  const t = useMessages()
  const a = t.adminTags

  return (
    <>
      <div className="flex flex-col gap-3">
        {tabs}
        <p className="text-sm text-muted-foreground">{a.duplicatesHint}</p>
      </div>

      {!groups ? (
        <p className="py-10 text-center text-sm text-muted-foreground">{t.common.loadingMore}</p>
      ) : groups.length === 0 ? (
        <EmptyState icon={Merge} title={a.noDuplicates} />
      ) : (
        <ul className="flex flex-col gap-3">
          {groups.map((g) => (
            <DuplicateGroup key={g.map((tag) => tag.id).join()} group={g} onMerge={(target, sources) => setPending({ target, sources })} />
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={!!pending}
        onOpenChange={(o) => !o && setPending(null)}
        title={a.mergeTitle}
        description={pending ? a.mergeIntoHint(pending.sources.map((s) => s.name), pending.target.name) : ''}
        confirmLabel={a.merge}
        onConfirm={async () => {
          if (!pending) return
          await api('/admin/tags/merge', { method: 'POST', json: { source_ids: pending.sources.map((s) => s.id), target_id: pending.target.id } })
          await refresh()
          toast.success(a.merged(pending.target.name))
        }}
      />
    </>
  )
}

function DuplicateGroup({ group, onMerge }: { group: TagUsage[]; onMerge: (target: TagUsage, sources: TagUsage[]) => void }) {
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const [target, ...sources] = group.filter((tag) => !excluded.has(tag.id))
  const t = useMessages()
  const toggle = (id: string) =>
    setExcluded((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })

  return (
    <li className="flex flex-col gap-3 rounded-xl border bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
      <ul aria-label={t.adminTags.group} className="flex flex-wrap gap-1.5">
        {group.map((tag) => (
          <li key={tag.id}>
            <button
              type="button"
              aria-pressed={!excluded.has(tag.id)}
              onClick={() => toggle(tag.id)}
              className={cn(
                'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm',
                excluded.has(tag.id) ? 'text-muted-foreground line-through' : tag === target ? 'border-transparent bg-foreground text-background' : 'border-transparent bg-muted',
              )}
            >
              #{tag.name}
              <span className="text-xs tabular-nums opacity-70">
                {tag.usage}
                {tag.hidden && ` · ${t.adminTags.hidden}`}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <Button size="sm" variant="secondary" disabled={!sources.length} onClick={() => onMerge(target, sources)} className="shrink-0">
        <Merge aria-hidden />
        {sources.length ? t.adminTags.mergeTo(target.name) : t.adminTags.keepTwo}
      </Button>
    </li>
  )
}
