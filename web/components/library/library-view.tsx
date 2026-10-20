'use client'

import { memo, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import useSWR from 'swr'
import {
  Check,
  CheckSquare,
  ChevronRight,
  Copy,
  Download,
  Folder as FolderIcon,
  FolderInput,
  FolderPlus,
  Globe,
  Home,
  Inbox,
  Lock,
  Pencil,
  Search,
  Share2,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@/components/ui/context-menu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { MemeMedia } from '@/components/meme/meme-media'
import { FolderMosaic } from '@/components/folder/folder-card'
import { PrivateLinkDialog, shareFolder, shareMeme, type ShareTarget } from '@/components/meme/share-dialog'
import { ProcessBadge, VisibilityBadge } from '@/components/status-badges'
import { EmptyState } from '@/components/states'
import { Skeleton } from '@/components/ui/skeleton'
import { Loadable } from '@/components/loadable'
import { FolderPickerDialog, type PickerMode } from './folder-picker-dialog'
import { UploadDialog } from './upload-dialog'
import { ROOT, useDragMove } from './use-drag-move'
import { api, refresh } from '@/lib/api'
import { toMs } from '@/lib/format'
import { isProcessing, memeHref, memeTitle } from '@/lib/media'
import { downloadMany } from '@/lib/meme-transfer'
import type { Entry, Folder, LibraryView as Library } from '@/lib/types'
import { cn, qs } from '@/lib/utils'
import { useMessages } from '@/lib/i18n/client'

type Sort = 'name' | 'newest' | 'oldest'
type Item = { type: 'folder'; folder: Folder } | { type: 'entry'; entry: Entry }
const nodeOf = (i: Item) => (i.type === 'folder' ? i.folder : i.entry)

export function LibraryView() {
  const params = useSearchParams()
  const folderId = params.get('folder')
  const library = useSWR<Library>(`/library${qs({ folder_id: folderId })}`, {
    keepPreviousData: true, // A folder being opened leaves the last one in view, rather than a skeleton
    refreshInterval: (lib) => (lib?.entries.some((e) => isProcessing(e.meme)) ? 3000 : 0),
  })
  const t = useMessages()
  return (
    <Loadable
      result={library}
      notFound={{ title: t.library.notFound, description: t.library.notFoundHint }}
      loading={
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-6 sm:px-6 sm:py-8" aria-busy="true" aria-label={t.common.loading}>
          <Skeleton className="h-5 w-20" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-9 w-36" />
            <Skeleton className="h-4 w-48" />
          </div>
          <Skeleton className="h-9 w-28" />
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {Array.from({ length: 12 }, (_, i) => (
              <li key={i} className="flex flex-col gap-2 rounded-xl border bg-card p-2">
                <Skeleton className="aspect-square rounded-lg" />
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-5 w-12 rounded-full" />
              </li>
            ))}
          </ul>
        </div>
      }
    >
      {(lib) => <LibraryContent key={lib.folder?.id ?? 'root'} lib={lib} opening={library.isLoading} />}
    </Loadable>
  )
}

/** opening tells that another folder is on its way, which this one dims for if it takes a moment. */
// What an item shows, kept apart from the controls around it, as selecting and dragging rerender every item.
const TileBody = memo(function TileBody({ item }: { item: Item }) {
  const node = nodeOf(item)
  const meme = item.type === 'entry' ? item.entry.meme : null
  const t = useMessages()
  return (
    <>
      <div className="relative aspect-square overflow-hidden rounded-lg">
        <div data-thumb className={cn('flex size-full items-center justify-center bg-muted/60', item.type === 'folder' && 'p-2')}>
          {item.type === 'entry' ? <MemeMedia meme={item.entry.meme} /> : <FolderMosaic previews={item.folder.previews} className="size-full" />}
        </div>
        {item.type === 'folder' && (
          <span className="absolute bottom-1.5 left-1.5 inline-flex items-center gap-1 rounded-md bg-background/90 px-1.5 py-0.5 text-xs shadow-sm tabular-nums">
            <FolderIcon className="size-3" aria-hidden />
            {t.meme.items(item.folder.item_count)}
          </span>
        )}
        {meme && meme.status !== 'success' && <ProcessBadge status={meme.status} className="absolute bottom-1.5 left-1.5 bg-background/80" />}
      </div>
      <div className="flex min-w-0 flex-col gap-1 px-0.5">
        <span className="truncate text-sm font-medium">{node.name}</span>
        <VisibilityBadge visibility={node.visibility} className="self-start" />
      </div>
    </>
  )
})

function LibraryContent({ lib, opening }: { lib: Library; opening: boolean }) {
  const router = useRouter()
  const params = useSearchParams()
  const folder = lib.folder
  const t = useMessages()
  const here = folder?.name ?? t.titles.library
  const libraryHref = (id: string | null) => (id ? `/library?folder=${id}` : '/library')

  const [sort, setSort] = useState<Sort>('newest')
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [picker, setPicker] = useState<{ mode: PickerMode; items: Item[] } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Item[] | null>(null)
  const [privateLink, setPrivateLink] = useState<ShareTarget | null>(null)
  const [rename, setRename] = useState<Item | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [uploadOpen, setUploadOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  // The header's upload button links here with ?upload=1.
  const uploadRequested = params.get('upload') === '1'

  const items = useMemo<Item[]>(() => {
    const cmp = (a: { name: string; created_at: string }, b: { name: string; created_at: string }) =>
      sort === 'name' ? a.name.localeCompare(b.name, 'zh-CN') : (toMs(b.created_at) - toMs(a.created_at)) * (sort === 'newest' ? 1 : -1)
    return [
      ...[...lib.folders].sort(cmp).map((f) => ({ type: 'folder' as const, folder: f })),
      ...[...lib.entries].sort(cmp).map((e) => ({ type: 'entry' as const, entry: e })),
    ]
  }, [lib, sort])

  const exitSelect = () => {
    setSelecting(false)
    setSelected(new Set())
  }
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true)
    try {
      await fn()
      await refresh()
      toast.success(ok)
      exitSelect()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const ids = (sel: Item[]) => sel.map((i) => nodeOf(i).id)

  const transfer = async (mode: PickerMode, nodeIds: string[], target: string | null) => {
    await api(`/library/nodes/${mode}`, { method: 'POST', json: { ids: nodeIds, target_id: target } })
    await refresh()
    toast.success(mode === 'move' ? t.library.moved : t.library.copied, {
      action: { label: t.libraryDialog.go, onClick: () => router.push(libraryHref(target)) },
    })
    exitSelect()
  }

  const drag = useDragMove({
    current: folder?.id ?? ROOT,
    selected,
    onMove: (nodeIds, target) => transfer('move', nodeIds, target || null).catch((e: Error) => toast.error(e.message)),
  })
  const dropHighlight = (target: string) => drag.isOver(target) && 'bg-brand/40 text-foreground ring-2 ring-foreground/20'

  const setPublic = (sel: Item[], isPublic: boolean) =>
    run(() => api('/library/nodes', { method: 'PATCH', json: { ids: ids(sel), is_public: isPublic } }), isPublic ? t.library.madePublic : t.library.madePrivate)

  const share = (item: Item) => {
    if (item.type === 'entry') {
      const { meme } = item.entry
      shareMeme(meme, () => setPrivateLink({ kind: 'meme', id: meme.id, title: memeTitle(meme, t) }), t)
    } else {
      const { folder } = item
      shareFolder(folder, true, () => setPrivateLink({ kind: 'folder', id: folder.id, title: folder.name }), t)
    }
  }

  const download = (sel: Item[]) => {
    const memes = sel.flatMap((i) => (i.type === 'entry' ? [i.entry.meme] : []))
    if (!memes.length) {
      toast.info(t.library.nothingToDownload)
      return
    }
    void downloadMany(memes)
  }

  const submitRename = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!rename) return
    const v = renameValue.trim()
    if (!v || v.length > 255) return
    setBusy(true)
    try {
      await api(`/library/nodes/${nodeOf(rename).id}`, { method: 'PATCH', json: { name: v } })
      await refresh()
      toast.success(t.library.renamed)
      setRename(null)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const submitNewFolder = async (e: React.FormEvent) => {
    e.preventDefault()
    const v = newFolderName.trim()
    if (!v) return
    setBusy(true)
    try {
      await api('/library/folders', { method: 'POST', json: { parent_id: folder?.id, name: v } })
      await refresh()
      toast.success(t.library.folderCreated)
      setNewFolderOpen(false)
      setNewFolderName('')
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const setUpload = (open: boolean) => {
    setUploadOpen(open)
    if (!open && uploadRequested) router.replace(libraryHref(folder?.id ?? null))
  }

  const sel = items.filter((i) => selected.has(nodeOf(i).id))
  const allIds = items.map((i) => nodeOf(i).id)
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id))
  const crumbs = [...lib.ancestors, ...(folder ? [folder] : [])]

  return (
    <div
      aria-busy={opening}
      className={cn('mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-6 sm:px-6 sm:py-8', opening && 'pointer-events-none opacity-60 transition-opacity delay-150')}
    >
      <nav aria-label={t.library.path} className="scroll-row -mx-4 px-4 sm:-mx-1 sm:px-1">
        <ol className="flex w-max items-center gap-0.5 text-sm text-muted-foreground">
          <li>
            <Link href="/library" {...drag.target(ROOT)} className={cn('flex h-8 items-center gap-1 rounded-md px-1.5 hover:bg-muted hover:text-foreground', dropHighlight(ROOT))}>
              <Home className="size-3.5" aria-hidden />
              {t.titles.library}
            </Link>
          </li>
          {crumbs.map((f) => (
            <li key={f.id} className="flex items-center gap-0.5">
              <ChevronRight className="size-3.5" aria-hidden />
              <Link
                href={libraryHref(f.id)}
                aria-current={f.id === folder?.id ? 'page' : undefined}
                {...drag.target(f.id)}
                className={cn(
                  'flex h-8 max-w-40 items-center truncate rounded-md px-1.5 hover:bg-muted hover:text-foreground aria-[current]:font-medium aria-[current]:text-foreground',
                  dropHighlight(f.id),
                )}
              >
                {f.name}
              </Link>
            </li>
          ))}
        </ol>
      </nav>

      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-2xl font-semibold tracking-tight sm:text-3xl">{here}</h1>
            {folder && <VisibilityBadge visibility={folder.visibility} />}
          </div>
          <p className="text-sm text-muted-foreground">
            {t.meme.items(items.length)}
            {items.length > 0 && (
              <>
                {' · '}
                <span className="pointer-coarse:hidden">{t.library.rightClickHint}</span>
                <span className="hidden pointer-coarse:inline">{t.library.longPressHint}</span>
              </>
            )}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <Button onClick={() => setUploadOpen(true)} className="h-11 sm:h-9">
            <Upload data-icon="inline-start" />
            {t.nav.upload}
          </Button>
          <Button variant="outline" onClick={() => setNewFolderOpen(true)} className="h-11 sm:h-9">
            <FolderPlus data-icon="inline-start" />
            {t.libraryDialog.newFolder}
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        {selecting ? (
          <>
            <Button variant="outline" onClick={() => setSelected(allSelected ? new Set() : new Set(allIds))}>
              {allSelected ? t.library.deselectAll : t.library.selectAll}
            </Button>
            <span className="text-sm text-muted-foreground tabular-nums">{t.library.selected(selected.size)}</span>
            <Button variant="ghost" className="ml-auto" onClick={exitSelect}>
              {t.tokens.done}
            </Button>
          </>
        ) : (
          <>
            <Select value={sort} onValueChange={(v) => setSort(v as Sort)}>
              <SelectTrigger className="h-9 w-32" aria-label={t.library.sortBy}>
                <SelectValue>{t.library.sort[sort]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">{t.library.sort.newest}</SelectItem>
                <SelectItem value="oldest">{t.library.sort.oldest}</SelectItem>
                <SelectItem value="name">{t.library.sort.name}</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="ghost" nativeButton={false} render={<Link href={folder ? `/search?folder=${folder.id}` : '/search?scope=mine'} />}>
              <Search data-icon="inline-start" />
              <span className="hidden sm:inline">{folder ? t.library.searchFolder : t.library.searchLibrary}</span>
              <span className="sm:hidden">{t.search.submit}</span>
            </Button>
            <Button variant="ghost" className="ml-auto" onClick={() => setSelecting(true)} disabled={!items.length}>
              <CheckSquare data-icon="inline-start" />
              {t.library.select}
            </Button>
          </>
        )}
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title={folder ? t.library.folderEmpty : t.library.empty}
          description={t.library.emptyHint}
          action={
            <Button onClick={() => setUploadOpen(true)}>
              <Upload data-icon="inline-start" />
              {t.nav.uploadLabel}
            </Button>
          }
        />
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {items.map((item) => {
            const node = nodeOf(item)
            const checked = selected.has(node.id)
            const meme = item.type === 'entry' ? item.entry.meme : null
            const href = meme ? memeHref(meme.id, node.id) : libraryHref(node.id)
            const isPublicSelf = node.visibility === 'public'
            const dropTarget = drag.isOver(node.id) && 'border-foreground bg-brand/30 ring-2 ring-foreground/20'

            const body = <TileBody item={item} />

            return (
              <li
                key={node.id}
                data-node-id={node.id}
                {...drag.source(node.id)}
                {...(item.type === 'folder' ? drag.target(node.id) : {})}
                className={cn('relative transition-opacity', drag.isDragging(node.id) && 'opacity-50')}
              >
                {selecting ? (
                  <button
                    type="button"
                    onClick={() => toggle(node.id)}
                    aria-pressed={checked}
                    className={cn(
                      'flex w-full flex-col gap-2 rounded-xl border bg-card p-2 text-left transition',
                      checked ? 'border-foreground ring-2 ring-foreground/15' : 'hover:border-foreground/30',
                      dropTarget,
                    )}
                  >
                    {body}
                    {/* Drawn like a checkbox, without the cost of one on every item */}
                    <span
                      aria-hidden
                      className={cn(
                        'absolute top-3 left-3 flex size-5 items-center justify-center rounded-[4px] border border-input bg-background',
                        checked && 'border-primary bg-primary text-primary-foreground',
                      )}
                    >
                      {checked && <Check className="size-3.5" />}
                    </span>
                    <span className="sr-only">
                      {checked ? t.library.deselect(node.name) : t.library.selectItem(node.name)}
                    </span>
                  </button>
                ) : (
                  <ContextMenu
                    // On touch screens a long press opens it, with a tap where the phone can vibrate
                    onOpenChange={(open, { event }) => {
                      if (open && (event.type.startsWith('touch') || (event as PointerEvent).pointerType === 'touch')) navigator.vibrate?.(10)
                    }}
                  >
                    <ContextMenuTrigger
                      render={<Link href={href} />}
                      className={cn(
                        'flex flex-col gap-2 rounded-xl border bg-card p-2 transition select-none hover:border-foreground/30 hover:shadow-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none data-popup-open:border-foreground/30',
                        dropTarget,
                      )}
                    >
                      {body}
                    </ContextMenuTrigger>
                    <ContextMenuContent className="w-44">
                      <DropdownMenuItem
                        onClick={() => {
                          setRename(item)
                          setRenameValue(node.name)
                        }}
                      >
                        <Pencil />
                        {t.library.rename}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setPicker({ mode: 'move', items: [item] })}>
                        <FolderInput />
                        {t.library.moveTo}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setPicker({ mode: 'copy', items: [item] })}>
                        <Copy />
                        {t.library.copyTo}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setPublic([item], !isPublicSelf)}>
                        {isPublicSelf ? <Lock /> : <Globe />}
                        {isPublicSelf ? t.library.makePrivate : t.library.makePublic}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => share(item)}>
                        <Share2 />
                        {t.shares.share}
                      </DropdownMenuItem>
                      {item.type === 'entry' && (
                        <DropdownMenuItem onClick={() => download([item])}>
                          <Download />
                          {t.meme.download}
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onClick={() => setConfirmDelete([item])}>
                        <Trash2 />
                        {t.library.delete}
                      </DropdownMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {selecting && selected.size > 0 && (
        <div
          role="toolbar"
          aria-label={t.library.bulk}
          className="fixed inset-x-3 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-xl items-center gap-1 overflow-x-auto rounded-2xl border bg-foreground p-1.5 text-background shadow-xl md:bottom-6"
        >
          <span className="shrink-0 px-2 text-sm tabular-nums">{t.meme.items(selected.size)}</span>
          {(
            [
              { key: 'move', icon: FolderInput, on: () => setPicker({ mode: 'move', items: sel }) },
              { key: 'copy', icon: Copy, on: () => setPicker({ mode: 'copy', items: sel }) },
              { key: 'public', icon: Globe, on: () => setPublic(sel, true) },
              { key: 'private', icon: Lock, on: () => setPublic(sel, false) },
              { key: 'download', icon: Download, on: () => download(sel) },
              { key: 'delete', icon: Trash2, on: () => setConfirmDelete(sel) },
            ] as const
          ).map((a) => (
            <button
              key={a.key}
              type="button"
              onClick={a.on}
              disabled={busy}
              className={cn(
                'flex h-12 min-w-12 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl px-2 text-[11px] transition-colors hover:bg-background/15 disabled:opacity-50',
                a.key === 'delete' && 'text-[oklch(0.8_0.15_25)] dark:text-[oklch(0.55_0.2_27)]',
              )}
            >
              <a.icon className="size-4" aria-hidden />
              {t.library.bulkActions[a.key]}
            </button>
          ))}
          <button type="button" onClick={exitSelect} aria-label={t.library.exitSelect} className="ml-auto flex size-12 shrink-0 items-center justify-center rounded-xl hover:bg-background/15">
            <X className="size-4" />
          </button>
        </div>
      )}

      <UploadDialog open={uploadOpen || uploadRequested} onOpenChange={setUpload} folderId={folder?.id ?? null} folderName={here} />

      {privateLink && <PrivateLinkDialog target={privateLink} onOpenChange={() => setPrivateLink(null)} />}

      {picker && (
        <FolderPickerDialog
          open
          onOpenChange={(o) => !o && setPicker(null)}
          mode={picker.mode}
          count={picker.items.length}
          initialFolder={folder?.id ?? null}
          sourceFolder={folder?.id ?? null}
          movingFolderIds={picker.items.flatMap((i) => (i.type === 'folder' ? [i.folder.id] : []))}
          onConfirm={(target) => transfer(picker.mode, ids(picker.items), target)}
        />
      )}

      <Dialog open={rename !== null} onOpenChange={(o) => !o && setRename(null)}>
        <DialogContent className="sm:max-w-sm">
          <form onSubmit={submitRename} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>{t.library.rename}</DialogTitle>
              <DialogDescription>{t.library.renameHint}</DialogDescription>
            </DialogHeader>
            <Input autoFocus value={renameValue} onChange={(e) => setRenameValue(e.target.value)} maxLength={255} aria-label={t.library.newName} className="h-11 text-base md:h-9 md:text-sm" />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRename(null)}>
                {t.common.cancel}
              </Button>
              <Button type="submit" disabled={!renameValue.trim() || busy}>
                {t.library.save}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={newFolderOpen} onOpenChange={setNewFolderOpen}>
        <DialogContent className="sm:max-w-sm">
          <form onSubmit={submitNewFolder} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>{t.libraryDialog.newFolder}</DialogTitle>
              <DialogDescription>{t.library.newFolderHint(here)}</DialogDescription>
            </DialogHeader>
            <Input autoFocus value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)} maxLength={255} placeholder={t.library.folderName} aria-label={t.library.folderName} className="h-11 text-base md:h-9 md:text-sm" />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setNewFolderOpen(false)}>
                {t.common.cancel}
              </Button>
              <Button type="submit" disabled={!newFolderName.trim() || busy}>
                {t.tokens.create}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDelete !== null} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.library.confirmDelete(confirmDelete?.length ?? 0)}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete?.some((i) => i.type === 'folder') ? t.library.deleteFoldersHint : ''}
              {t.library.deleteHint}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const target = confirmDelete
                setConfirmDelete(null)
                if (target) void run(() => api('/library/nodes', { method: 'DELETE', json: { ids: ids(target) } }), t.library.deleted)
              }}
            >
              {t.library.delete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
