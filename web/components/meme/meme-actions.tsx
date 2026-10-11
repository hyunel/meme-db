'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Download, FolderInput, FolderPlus, Heart, Loader2, MoreHorizontal, Share2 } from 'lucide-react'
import { toast } from 'sonner'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { useRequireLogin } from '@/components/app-providers'
import { FolderPickerDialog } from '@/components/library/folder-picker-dialog'
import { DownloadDialog } from './download-dialog'
import { api, refresh } from '@/lib/api'
import { shareMeme } from '@/lib/meme-transfer'
import type { Entry, EntryRef, Meme } from '@/lib/types'
import { cn } from '@/lib/utils'

type BtnSize = 'default' | 'sm' | 'icon' | 'icon-sm' | 'lg'

export function FavoriteButton({
  kind,
  id,
  active,
  count,
  variant = 'outline',
  size = 'default',
  showCount = false,
  className,
}: {
  kind: 'meme' | 'folder'
  id: string
  active: boolean
  count: number
  variant?: 'outline' | 'ghost' | 'secondary'
  size?: BtnSize
  showCount?: boolean
  className?: string
}) {
  const requireLogin = useRequireLogin()
  const pending = useRef(false)
  // Optimistic state, valid until fresh data for this target arrives.
  const base = `${active}:${count}`
  const [optimistic, setOptimistic] = useState<{ base: string; active: boolean; count: number } | null>(null)
  const shown = optimistic?.base === base ? optimistic : { active, count }
  const iconOnly = size === 'icon' || size === 'icon-sm'

  const onClick = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!requireLogin(kind === 'meme' ? '登录后即可收藏表情包。' : '登录后即可收藏文件夹。')) return
    if (pending.current) return
    pending.current = true
    const next = !shown.active
    setOptimistic({ base, active: next, count: shown.count + (next ? 1 : -1) })
    try {
      await api(`/favorites/${kind}/${id}`, { method: next ? 'PUT' : 'DELETE' })
      toast.success(next ? '已收藏' : '已取消收藏')
      void refresh()
    } catch (err) {
      setOptimistic(null)
      toast.error('操作失败，已恢复原状态', { description: (err as Error).message })
    } finally {
      pending.current = false
    }
  }

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      onClick={onClick}
      aria-pressed={shown.active}
      aria-label={iconOnly ? (shown.active ? '取消收藏' : '收藏') : undefined}
      className={className}
    >
      <Heart className={cn(shown.active && 'fill-destructive text-destructive')} data-icon={iconOnly ? undefined : 'inline-start'} />
      {!iconOnly && (shown.active ? '已收藏' : '收藏')}
      {showCount && !iconOnly && <span className="tabular-nums text-muted-foreground">{shown.count}</span>}
    </Button>
  )
}

function useAddToLibrary(meme: Meme) {
  const router = useRouter()
  const requireLogin = useRequireLogin()
  const [pending, setPending] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  // The entry just created or moved here, until the meme is refetched.
  const [local, setLocal] = useState<EntryRef | null>(null)
  const entry = local ?? meme.entry

  const add = async () => {
    if (!requireLogin('登录后即可把表情包加入你的私人库。')) return
    if (pending) return
    setPending(true)
    try {
      const added = await api<Entry>('/library/entries', { method: 'POST', json: { meme_id: meme.id } })
      setLocal({ id: added.id, folder_id: added.parent_id })
      void refresh()
      toast.success('已加入我的库', {
        action: { label: '移动到文件夹', onClick: () => setPickerOpen(true) },
      })
    } catch (err) {
      toast.error('加入失败，请重试', { description: (err as Error).message })
    } finally {
      setPending(false)
    }
  }

  const dialog = pickerOpen && entry && (
    <FolderPickerDialog
      open
      onOpenChange={setPickerOpen}
      mode="move"
      count={1}
      initialFolder={null}
      sourceFolder={entry.folder_id}
      onConfirm={async (target) => {
        await api('/library/nodes/move', { method: 'POST', json: { ids: [entry.id], target_id: target } })
        setLocal({ id: entry.id, folder_id: target })
        void refresh()
        toast.success('已移动', {
          action: { label: '前往', onClick: () => router.push(target ? `/library?folder=${target}` : '/library') },
        })
      }}
    />
  )

  return { add, pending, dialog, inLibrary: Boolean(entry), openPicker: () => setPickerOpen(true) }
}

export function MemeMoreMenu({ meme, className, allowAdd = false }: { meme: Meme; className?: string; allowAdd?: boolean }) {
  const [downloadOpen, setDownloadOpen] = useState(false)
  const lib = useAddToLibrary(meme)
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="更多操作"
              className={className}
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
              }}
            />
          }
        >
          <MoreHorizontal />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem onClick={() => shareMeme(meme)}>
            <Share2 />
            分享
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setDownloadOpen(true)}>
            <Download />
            下载
          </DropdownMenuItem>
          {allowAdd && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={lib.inLibrary || lib.pending} onClick={lib.add}>
                {lib.inLibrary ? <Check /> : <FolderPlus />}
                {lib.inLibrary ? '已在我的库' : '加入我的库'}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {downloadOpen && <DownloadDialog meme={meme} open onOpenChange={setDownloadOpen} />}
      {allowAdd && lib.dialog}
    </>
  )
}

export function AddToLibraryButton({ meme, className }: { meme: Meme; className?: string }) {
  const lib = useAddToLibrary(meme)

  return (
    <div className={cn('flex flex-wrap gap-2', className)}>
      <Button type="button" onClick={lib.add} disabled={lib.inLibrary || lib.pending}>
        {lib.pending ? <Loader2 className="animate-spin" data-icon="inline-start" /> : lib.inLibrary ? <Check data-icon="inline-start" /> : <FolderPlus data-icon="inline-start" />}
        {lib.inLibrary ? '已在我的库' : '加入我的库'}
      </Button>
      {lib.inLibrary && (
        <Button type="button" variant="outline" onClick={lib.openPicker}>
          <FolderInput data-icon="inline-start" />
          移动到文件夹
        </Button>
      )}
      {lib.dialog}
    </div>
  )
}
