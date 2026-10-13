'use client'

import { memo, useMemo, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { mutate } from 'swr'
import { qs } from '@/lib/api'
import type { Entry, Meme } from '@/lib/types'
import { kindOf, memeHref } from '@/lib/media'
import { MemeMedia } from './meme-media'
import { FavoriteButton, MemeMoreMenu } from './meme-actions'
import { ProcessBadge } from '@/components/status-badges'
import { cn } from '@/lib/utils'

// Height over width, bounded so panoramas and long screenshots keep a usable card.
const ratioOf = (m: Meme) => (m.width && m.height ? Math.min(Math.max(m.height / m.width, 0.5), 2) : 1)

/** share is the private link the meme was reached by, which it passes on. Memoized, as grids hold many and rerender with their page. */
export const MemeCard = memo(function MemeCard({
  meme,
  entryId,
  share,
  similarity,
  allowAdd,
  className,
}: {
  meme: Meme
  entryId?: string
  share?: string
  similarity?: number
  allowAdd?: boolean
  className?: string
}) {
  const kind = kindOf(meme.mime_type)
  const shown = [...new Set(meme.tags.filter((t) => !t.rare).map((t) => t.name))].slice(0, 2)
  const viaLink = Boolean(share) && !meme.is_public && meme.entries.length === 0 // Opened only by the link, so not to be favorited, as on its page

  return (
    <div className={cn('group relative flex flex-col gap-1.5', className)}>
      <Link
        href={memeHref(meme.id, entryId, share)}
        // The detail page opens with what the card knows, rather than a skeleton, and refreshes it.
        onClick={() => void mutate(`/memes/${meme.id}${qs({ share })}`, (cached?: Meme) => cached ?? meme, { revalidate: false })}
        className="relative block overflow-hidden rounded-xl border bg-card transition hover:border-foreground/30 hover:shadow-md focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        style={{ aspectRatio: 1 / ratioOf(meme) }}
      >
        <MemeMedia meme={meme} className="size-full transition-[opacity,transform] duration-300 group-hover:scale-[1.03]" />
        <span className="sr-only">查看详情</span>
        {kind !== 'image' && (
          <span className="pointer-events-none absolute top-2 left-2 rounded bg-foreground/80 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-background uppercase">
            {kind}
          </span>
        )}
        {meme.status !== 'success' && <ProcessBadge status={meme.status} className="absolute bottom-2 left-2 bg-background/80" />}
        {similarity !== undefined && (
          <span className="pointer-events-none absolute bottom-2 left-2 rounded-full bg-brand px-2 py-0.5 text-xs font-medium text-brand-foreground tabular-nums">
            {Math.round(similarity * 100)}% 相似
          </span>
        )}
      </Link>
      {!viaLink && (
        <div className="absolute top-1.5 right-1.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
          <FavoriteButton
            kind="meme"
            id={meme.id}
            active={meme.is_favorite}
            count={meme.favorite_count}
            size="icon-sm"
            variant="secondary"
            className="bg-background/90 shadow-sm backdrop-blur"
          />
        </div>
      )}
      <div className="flex min-h-8 items-center gap-1">
        <div className="flex min-w-0 flex-1 gap-1">
          {shown.map((t) => (
            <Link
              key={t}
              href={`/tags/${encodeURIComponent(t)}`}
              className="truncate rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-brand hover:text-brand-foreground"
            >
              #{t}
            </Link>
          ))}
        </div>
        <MemeMoreMenu meme={meme} share={share} allowAdd={allowAdd} className="shrink-0 text-muted-foreground" />
      </div>
    </div>
  )
})

// The Tailwind lg / md / sm breakpoints, widest first.
const columnQueries: [string, number][] = [
  ['(min-width: 64rem)', 5],
  ['(min-width: 48rem)', 4],
  ['(min-width: 40rem)', 3],
]

function useColumnCount() {
  return useSyncExternalStore(
    (onChange) => {
      const lists = columnQueries.map(([q]) => window.matchMedia(q))
      lists.forEach((l) => l.addEventListener('change', onChange))
      return () => lists.forEach((l) => l.removeEventListener('change', onChange))
    },
    () => columnQueries.find(([q]) => window.matchMedia(q).matches)?.[1] ?? 2,
    () => 2,
  )
}

/** Lays out memes, or the entries of a folder, which open under their names there. */
export function MemeGrid({ memes, share, similarity, allowAdd }: { memes: Meme[] | Entry[]; share?: string; similarity?: Map<string, number>; allowAdd?: boolean }) {
  const count = useColumnCount()
  const columns = useMemo(() => {
    const cols: (Meme | Entry)[][] = Array.from({ length: count }, () => [])
    const heights = Array<number>(count).fill(0) // In column widths
    const seen = new Set<string>()
    for (const item of memes) {
      if (seen.has(item.id)) continue // Pages of a feed may repeat one
      seen.add(item.id)
      // Into the leftmost column about as short as the shortest, so cards of a size fill rows left to right,
      // while appended pages keep the columns even and earlier cards in place.
      const lowest = Math.min(...heights)
      const c = heights.findIndex((h) => h <= lowest + 0.2)
      cols[c].push(item)
      heights[c] += ratioOf('meme' in item ? item.meme : item) + 0.25 // The tag row and gap take about a quarter width
    }
    return cols
  }, [memes, count])

  return (
    <div className="flex items-start gap-3">
      {columns.map((col, i) => (
        <ul key={i} className="flex min-w-0 flex-1 flex-col gap-4">
          {col.map((item) => {
            const [meme, entryId] = 'meme' in item ? [item.meme, item.id] : [item]
            return (
              <li key={item.id}>
                <MemeCard meme={meme} entryId={entryId} share={share} similarity={similarity?.get(meme.id)} allowAdd={allowAdd} />
              </li>
            )
          })}
        </ul>
      ))}
    </div>
  )
}
