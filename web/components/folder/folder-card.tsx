'use client'

import Link from 'next/link'
import { Folder as FolderIcon } from 'lucide-react'
import type { Folder, MemeThumb } from '@/lib/types'
import { useSession } from '@/lib/session'
import { MemeMedia } from '@/components/meme/meme-media'
import { FavoriteButton } from '@/components/meme/meme-actions'
import { Skeleton } from '@/components/ui/skeleton'
import { cn, qs } from '@/lib/utils'

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
    <div className="group relative flex flex-col gap-2 rounded-xl border bg-card p-2.5 transition hover:border-foreground/30 hover:shadow-md">
      <Link href={href} className="flex flex-col gap-2 rounded-lg focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
        <FolderMosaic previews={folder.previews} className="aspect-[4/3] bg-muted/60" />
        <p className="truncate px-1 font-medium">{folder.name}</p>
      </Link>
      <p className="-mt-1.5 flex min-w-0 gap-1 px-1 text-xs whitespace-nowrap text-muted-foreground">
        {showOwner && (
          <>
            <Link href={`/u/${folder.owner.username}`} className="truncate hover:text-foreground hover:underline">
              @{folder.owner.username}
            </Link>
            ·
          </>
        )}
        <span className="tabular-nums">{folder.item_count} 项</span>
      </p>
      {/* On the cover's corner, as on a meme card */}
      {!viaLink && (
        <div className="absolute top-4 right-4 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
          <FavoriteButton
            kind="folder"
            id={folder.id}
            active={folder.is_favorite}
            count={folder.favorite_count}
            size="icon-sm"
            variant="secondary"
            className="bg-background/90 shadow-sm backdrop-blur"
          />
        </div>
      )}
    </div>
  )
}

export function FolderGridSkeleton() {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6" aria-busy="true" aria-label="加载中">
      {Array.from({ length: 6 }, (_, i) => (
        <li key={i} className="flex flex-col gap-2 rounded-xl border bg-card p-2.5">
          <Skeleton className="aspect-[4/3] rounded-lg" />
          <Skeleton className="mx-1 h-5 w-2/3" />
          <Skeleton className="mx-1 -mt-0.5 h-3.5 w-1/3" />
        </li>
      ))}
    </ul>
  )
}

export function FolderGrid({ folders, showOwner, share }: { folders: Folder[]; showOwner?: boolean; share?: string }) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {folders.map((f) => (
        <li key={f.id}>
          <FolderCard folder={f} showOwner={showOwner} share={share} />
        </li>
      ))}
    </ul>
  )
}
