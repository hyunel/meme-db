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
import { useMessages } from '@/lib/i18n/client'

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
  const t = useMessages()

  const onClick = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!requireLogin(kind === 'meme' ? t.meme.favoriteMemePrompt : t.meme.favoriteFolderPrompt)) return
    if (pending.current) return
    pending.current = true
    const next = !shown.active
    setOptimistic({ base, active: next, count: shown.count + (next ? 1 : -1) })
    try {
      await api(`/favorites/${kind}/${id}`, { method: next ? 'PUT' : 'DELETE' })
      toast.success(next ? t.meme.favorited : t.meme.unfavorited)
      void refresh()
    } catch (err) {
      setOptimistic(null)
      toast.error(t.meme.favoriteFailed, { description: (err as Error).message })
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
      aria-label={iconOnly ? (shown.active ? t.meme.unfavorite : t.meme.favorite) : undefined}
      className={className}
    >
      <Heart className={cn(shown.active && 'fill-destructive text-destructive')} data-icon={iconOnly ? undefined : 'inline-start'} />
      {!iconOnly && (shown.active ? t.meme.favorited : t.meme.favorite)}
      {showCount && !iconOnly && <span className="tabular-nums text-muted-foreground">{shown.count}</span>}
    </Button>
  )
}

/** Opens the dialog choosing where the meme goes in the viewer's library, once they are signed in. */
function useLibraryDialog(meme: Meme, share?: string) {
  const requireLogin = useRequireLogin()
  const [open, setOpen] = useState(false)
  const t = useMessages()
  return {
    count: meme.entries.length,
    open: () => requireLogin(t.meme.addPrompt) && setOpen(true),
    dialog: open && <LibraryDialog meme={meme} share={share} onOpenChange={setOpen} />,
  }
}

export function MemeMoreMenu({ meme, share, className, allowAdd = false }: { meme: Meme; share?: string; className?: string; allowAdd?: boolean }) {
  const [downloadOpen, setDownloadOpen] = useState(false)
  const lib = useLibraryDialog(meme, share)
  const sharing = useShareMeme(meme, share)
  const t = useMessages()
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t.meme.more}
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
            {t.shares.share}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setDownloadOpen(true)}>
            <Download />
            {t.meme.download}
          </DropdownMenuItem>
          {allowAdd && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={lib.open}>
                {lib.count ? <Check /> : <FolderPlus />}
                {lib.count ? t.meme.inLibraryMore : t.meme.addMore}
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
  const t = useMessages()
  return (
    <>
      <Button type="button" variant={lib.count ? 'secondary' : 'default'} onClick={lib.open} className={className}>
        {lib.count ? <Check data-icon="inline-start" /> : <FolderPlus data-icon="inline-start" />}
        {lib.count ? (lib.count > 1 ? t.meme.inLibraryCount(lib.count) : t.meme.inLibrary) : t.meme.addToLibrary}
      </Button>
      {lib.dialog}
    </>
  )
}
