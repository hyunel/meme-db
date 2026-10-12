'use client'

import Link from 'next/link'
import { Folder as FolderIcon, Images } from 'lucide-react'
import type { Folder, MemeThumb } from '@/lib/types'
import { qs } from '@/lib/api'
import { useSession } from '@/lib/session'
import { MemeMedia } from '@/components/meme/meme-media'
import { FavoriteButton } from '@/components/meme/meme-actions'
import { cn } from '@/lib/utils'

/** Up to four memes of a folder, or a folder icon while it has none. */
export function FolderMosaic({ previews, className }: { previews: MemeThumb[]; className?: string }) {
  if (!previews.length) {
    return (
      <div className={cn('flex items-center justify-center rounded-lg', className)}>
        <FolderIcon className="size-12 fill-brand/50 text-foreground/70" strokeWidth={1.25} aria-hidden />
      </div>
    )
  }
  return (
    <div className={cn('grid grid-cols-2 grid-rows-2 gap-1.5 overflow-hidden rounded-lg', className)}>
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="flex items-center justify-center overflow-hidden rounded-md bg-muted">
          {previews[i] && <MemeMedia meme={previews[i]} />}
        </div>
      ))}
    </div>
  )
}

/** share is the private link the folder was reached by, which it passes on. */
export function FolderCard({ folder, showOwner = true, share }: { folder: Folder; showOwner?: boolean; share?: string }) {
  const { user } = useSession()
  const own = folder.owner.id === user?.id
  const href = own ? `/library?folder=${folder.id}` : `/f/${folder.id}${qs({ share })}`
  const viaLink = Boolean(share) && folder.visibility === 'private' && !own // Opened only by the link, so not to be favorited

  return (
    <div className="group relative flex flex-col gap-3 rounded-xl border bg-card p-3 transition hover:border-foreground/30 hover:shadow-md">
      <Link href={href} className="flex flex-col gap-3 rounded-lg focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
        <FolderMosaic previews={folder.previews} className="aspect-[4/3] bg-muted/60" />
        <p className="truncate px-1 pr-10 font-medium">{folder.name}</p>
      </Link>
      <div className="flex items-center gap-3 px-1 text-xs text-muted-foreground">
        {showOwner && (
          <Link href={`/u/${folder.owner.username}`} className="truncate hover:text-foreground hover:underline">
            @{folder.owner.username}
          </Link>
        )}
        <span className="ml-auto flex items-center gap-1 tabular-nums">
          <Images className="size-3" aria-hidden />
          {folder.item_count} 项
        </span>
      </div>
      {!viaLink && (
        <div className="absolute right-2 bottom-12">
          <FavoriteButton kind="folder" id={folder.id} active={folder.is_favorite} count={folder.favorite_count} size="icon-sm" variant="ghost" />
        </div>
      )}
    </div>
  )
}

export function FolderGrid({ folders, showOwner }: { folders: Folder[]; showOwner?: boolean }) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {folders.map((f) => (
        <li key={f.id}>
          <FolderCard folder={f} showOwner={showOwner} />
        </li>
      ))}
    </ul>
  )
}
