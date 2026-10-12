'use client'

import { useRef, useState } from 'react'
import { Check, Download, FolderPlus, Heart, MoreHorizontal, Share2 } from 'lucide-react'
import { toast } from 'sonner'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { useRequireLogin } from '@/components/app-providers'
import { DownloadDialog } from './download-dialog'
import { LibraryDialog } from './library-dialog'
import { useShareMeme } from './share-dialog'
import { api, refresh } from '@/lib/api'
import type { Meme } from '@/lib/types'
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

/** Opens the dialog choosing where the meme goes in the viewer's library, once they are signed in. */
function useLibraryDialog(meme: Meme, share?: string) {
  const requireLogin = useRequireLogin()
  const [open, setOpen] = useState(false)
  return {
    count: meme.entries.length,
    open: () => requireLogin('登录后即可把表情包加入你的私人库。') && setOpen(true),
    dialog: open && <LibraryDialog meme={meme} share={share} onOpenChange={setOpen} />,
  }
}

export function MemeMoreMenu({ meme, share, className, allowAdd = false }: { meme: Meme; share?: string; className?: string; allowAdd?: boolean }) {
  const [downloadOpen, setDownloadOpen] = useState(false)
  const lib = useLibraryDialog(meme, share)
  const sharing = useShareMeme(meme, share)
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
          <DropdownMenuItem onClick={sharing.start}>
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
              <DropdownMenuItem onClick={lib.open}>
                {lib.count ? <Check /> : <FolderPlus />}
                {lib.count ? '已在我的库…' : '加入我的库…'}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {downloadOpen && <DownloadDialog meme={meme} open onOpenChange={setDownloadOpen} />}
      {allowAdd && lib.dialog}
      {sharing.dialog}
    </>
  )
}

export function LibraryButton({ meme, share, className }: { meme: Meme; share?: string; className?: string }) {
  const lib = useLibraryDialog(meme, share)
  return (
    <>
      <Button type="button" variant={lib.count ? 'secondary' : 'default'} onClick={lib.open} className={className}>
        {lib.count ? <Check data-icon="inline-start" /> : <FolderPlus data-icon="inline-start" />}
        {lib.count ? (lib.count > 1 ? `已在我的库 · ${lib.count} 处` : '已在我的库') : '加入我的库'}
      </Button>
      {lib.dialog}
    </>
  )
}
