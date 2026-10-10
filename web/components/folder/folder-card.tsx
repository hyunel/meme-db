'use client'

import Link from 'next/link'
import { Images } from 'lucide-react'
import type { Folder } from '@/lib/types'
import { useSession } from '@/lib/session'
import { MemeMedia } from '@/components/meme/meme-media'
import { FavoriteButton } from '@/components/meme/meme-actions'

export function FolderCard({ folder, showOwner = true }: { folder: Folder; showOwner?: boolean }) {
  const { user } = useSession()
  const href = folder.owner.id === user?.id ? `/library?folder=${folder.id}` : `/f/${folder.id}`

  return (
    <div className="group relative flex flex-col gap-3 rounded-xl border bg-card p-3 transition hover:border-foreground/30 hover:shadow-md">
      <Link href={href} className="flex flex-col gap-3 rounded-lg focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
        <div className="grid aspect-[4/3] grid-cols-2 grid-rows-2 gap-1.5 overflow-hidden rounded-lg">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="overflow-hidden rounded-md bg-muted p-1.5">
              {folder.previews[i] && <MemeMedia meme={folder.previews[i]} />}
            </div>
          ))}
        </div>
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
      <div className="absolute right-2 bottom-12">
        <FavoriteButton kind="folder" id={folder.id} active={folder.is_favorite} count={folder.favorite_count} size="icon-sm" variant="ghost" />
      </div>
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
