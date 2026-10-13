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
import { api, qs, refresh } from '@/lib/api'
import { toMs } from '@/lib/format'
import { isProcessing, memeHref, memeTitle } from '@/lib/media'
import { downloadMany } from '@/lib/meme-transfer'
import type { Entry, Folder, LibraryView as Library } from '@/lib/types'
import { cn } from '@/lib/utils'

type Sort = 'name' | 'newest' | 'oldest'
const SORT_LABELS: Record<Sort, string> = { newest: '最新添加', oldest: '最早添加', name: '按名称' }
type Item = { type: 'folder'; folder: Folder } | { type: 'entry'; entry: Entry }
const nodeOf = (i: Item) => (i.type === 'folder' ? i.folder : i.entry)

export function LibraryView() {
  const params = useSearchParams()
  const folderId = params.get('folder')
  const library = useSWR<Library>(`/library${qs({ folder_id: folderId })}`, {
    keepPreviousData: true, // A folder being opened leaves the last one in view, rather than a skeleton
    refreshInterval: (lib) => (lib?.entries.some((e) => isProcessing(e.meme)) ? 3000 : 0),
  })
  return (
    <Loadable
      result={library}
      notFound={{ title: '文件夹不存在', description: '它可能已被删除或移动。' }}
      loading={
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-6 sm:px-6 sm:py-8" aria-busy="true" aria-label="加载中">
          <Skeleton className="h-5 w-20" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-9 w-36" />
            <Skeleton className="h-4 w-48" />
          </div>
          <Skeleton className="h-9 w-28" />
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {Array.from({ length: 10 }, (_, i) => (
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
  return (
    <>
      <div className="relative aspect-square overflow-hidden rounded-lg">
        <div data-thumb className={cn('flex size-full items-center justify-center bg-muted/60', item.type === 'folder' && 'p-2')}>
          {item.type === 'entry' ? <MemeMedia meme={item.entry.meme} /> : <FolderMosaic previews={item.folder.previews} className="size-full" />}
        </div>
        {item.type === 'folder' && (
          <span className="absolute bottom-1.5 left-1.5 inline-flex items-center gap-1 rounded-md bg-background/90 px-1.5 py-0.5 text-xs shadow-sm tabular-nums">
            <FolderIcon className="size-3" aria-hidden />
            {item.folder.item_count} 项
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
  const here = folder?.name ?? '我的库'
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
    toast.success(mode === 'move' ? '已移动' : '已复制', {
      action: { label: '前往', onClick: () => router.push(libraryHref(target)) },
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
    run(() => api('/library/nodes', { method: 'PATCH', json: { ids: ids(sel), is_public: isPublic } }), isPublic ? '已设为公开' : '已设为私有')

  const share = (item: Item) => {
    if (item.type === 'entry') {
      const { meme } = item.entry
      shareMeme(meme, () => setPrivateLink({ kind: 'meme', id: meme.id, title: memeTitle(meme) }))
    } else {
      const { folder } = item
      shareFolder(folder, true, () => setPrivateLink({ kind: 'folder', id: folder.id, title: folder.name }))
    }
  }

  const download = (sel: Item[]) => {
    const memes = sel.flatMap((i) => (i.type === 'entry' ? [i.entry.meme] : []))
    if (!memes.length) {
      toast.info('所选内容中没有可下载的表情包')
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
      toast.success('已重命名')
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
      toast.success('文件夹已创建')
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
      <nav aria-label="文件夹路径" className="scroll-row -mx-4 px-4 sm:-mx-1 sm:px-1">
        <ol className="flex w-max items-center gap-0.5 text-sm text-muted-foreground">
          <li>
            <Link href="/library" {...drag.target(ROOT)} className={cn('flex h-8 items-center gap-1 rounded-md px-1.5 hover:bg-muted hover:text-foreground', dropHighlight(ROOT))}>
              <Home className="size-3.5" aria-hidden />
              我的库
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
            {items.length} 项
            {items.length > 0 && (
              <>
                {' · '}
                <span className="pointer-coarse:hidden">右键</span>
                <span className="hidden pointer-coarse:inline">长按</span>条目查看更多操作
              </>
            )}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <Button onClick={() => setUploadOpen(true)} className="h-11 sm:h-9">
            <Upload data-icon="inline-start" />
            上传
          </Button>
          <Button variant="outline" onClick={() => setNewFolderOpen(true)} className="h-11 sm:h-9">
            <FolderPlus data-icon="inline-start" />
            新建文件夹
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        {selecting ? (
          <>
            <Button variant="outline" onClick={() => setSelected(allSelected ? new Set() : new Set(allIds))}>
              {allSelected ? '取消全选' : '全选'}
            </Button>
            <span className="text-sm text-muted-foreground tabular-nums">已选 {selected.size} 项</span>
            <Button variant="ghost" className="ml-auto" onClick={exitSelect}>
              完成
            </Button>
          </>
        ) : (
          <>
            <Select value={sort} onValueChange={(v) => setSort(v as Sort)}>
              <SelectTrigger className="h-9 w-32" aria-label="排序方式">
                <SelectValue>{SORT_LABELS[sort]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">最新添加</SelectItem>
                <SelectItem value="oldest">最早添加</SelectItem>
                <SelectItem value="name">按名称</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="ghost" nativeButton={false} render={<Link href={`/search?scope=mine${folder ? `&folder=${folder.id}` : ''}`} />}>
              <Search data-icon="inline-start" />
              <span className="hidden sm:inline">在{folder ? '此文件夹' : '我的库'}中搜索</span>
              <span className="sm:hidden">搜索</span>
            </Button>
            <Button variant="ghost" className="ml-auto" onClick={() => setSelecting(true)} disabled={!items.length}>
              <CheckSquare data-icon="inline-start" />
              选择
            </Button>
          </>
        )}
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title={folder ? '这个文件夹是空的' : '你的库还是空的'}
          description="上传表情包，或从搜索与发现页加入你喜欢的表情包。"
          action={
            <Button onClick={() => setUploadOpen(true)}>
              <Upload data-icon="inline-start" />
              上传表情包
            </Button>
          }
        />
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
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
                      {checked ? '取消选择' : '选择'} {node.name}
                    </span>
                  </button>
                ) : (
                  <ContextMenu>
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
                        重命名
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setPicker({ mode: 'move', items: [item] })}>
                        <FolderInput />
                        移动到…
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setPicker({ mode: 'copy', items: [item] })}>
                        <Copy />
                        复制到…
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setPublic([item], !isPublicSelf)}>
                        {isPublicSelf ? <Lock /> : <Globe />}
                        {isPublicSelf ? '设为私有' : '设为公开'}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => share(item)}>
                        <Share2 />
                        分享
                      </DropdownMenuItem>
                      {item.type === 'entry' && (
                        <DropdownMenuItem onClick={() => download([item])}>
                          <Download />
                          下载
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onClick={() => setConfirmDelete([item])}>
                        <Trash2 />
                        删除
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
          aria-label="批量操作"
          className="fixed inset-x-3 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-xl items-center gap-1 overflow-x-auto rounded-2xl border bg-foreground p-1.5 text-background shadow-xl md:bottom-6"
        >
          <span className="shrink-0 px-2 text-sm tabular-nums">{selected.size} 项</span>
          {(
            [
              { label: '移动', icon: FolderInput, on: () => setPicker({ mode: 'move', items: sel }) },
              { label: '复制', icon: Copy, on: () => setPicker({ mode: 'copy', items: sel }) },
              { label: '公开', icon: Globe, on: () => setPublic(sel, true) },
              { label: '私有', icon: Lock, on: () => setPublic(sel, false) },
              { label: '下载', icon: Download, on: () => download(sel) },
              { label: '删除', icon: Trash2, on: () => setConfirmDelete(sel) },
            ] as const
          ).map((a) => (
            <button
              key={a.label}
              type="button"
              onClick={a.on}
              disabled={busy}
              className={cn(
                'flex h-12 min-w-12 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl px-2 text-[11px] transition-colors hover:bg-background/15 disabled:opacity-50',
                a.label === '删除' && 'text-[oklch(0.8_0.15_25)]',
              )}
            >
              <a.icon className="size-4" aria-hidden />
              {a.label}
            </button>
          ))}
          <button type="button" onClick={exitSelect} aria-label="退出选择" className="ml-auto flex size-12 shrink-0 items-center justify-center rounded-xl hover:bg-background/15">
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
              <DialogTitle>重命名</DialogTitle>
              <DialogDescription>同一位置下名称不能重复。</DialogDescription>
            </DialogHeader>
            <Input autoFocus value={renameValue} onChange={(e) => setRenameValue(e.target.value)} maxLength={255} aria-label="新名称" className="h-11 text-base md:h-9 md:text-sm" />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRename(null)}>
                取消
              </Button>
              <Button type="submit" disabled={!renameValue.trim() || busy}>
                保存
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={newFolderOpen} onOpenChange={setNewFolderOpen}>
        <DialogContent className="sm:max-w-sm">
          <form onSubmit={submitNewFolder} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>新建文件夹</DialogTitle>
              <DialogDescription>将创建在「{here}」中，默认私有。</DialogDescription>
            </DialogHeader>
            <Input autoFocus value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)} maxLength={255} placeholder="文件夹名称" aria-label="文件夹名称" className="h-11 text-base md:h-9 md:text-sm" />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setNewFolderOpen(false)}>
                取消
              </Button>
              <Button type="submit" disabled={!newFolderName.trim() || busy}>
                创建
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDelete !== null} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除 {confirmDelete?.length ?? 0} 项？</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete?.some((i) => i.type === 'folder') ? '文件夹内的所有子文件夹和表情包也会一并删除。' : ''}此操作无法撤销，但不会影响其他用户库中的同一表情包。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const target = confirmDelete
                setConfirmDelete(null)
                if (target) void run(() => api('/library/nodes', { method: 'DELETE', json: { ids: ids(target) } }), '已删除')
              }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
