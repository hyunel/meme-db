'use client'

import Link from 'next/link'
import type { Meme } from '@/lib/types'
import { kindOf } from '@/lib/media'
import { MemeMedia } from './meme-media'
import { FavoriteButton, MemeMoreMenu } from './meme-actions'
import { ProcessBadge } from '@/components/status-badges'
import { cn } from '@/lib/utils'

export function MemeCard({ meme, similarity, allowAdd, className }: { meme: Meme; similarity?: number; allowAdd?: boolean; className?: string }) {
  const kind = kindOf(meme.mime_type)
  const shown = [...new Set(meme.tags.map((t) => t.name))].slice(0, 2)

  return (
    <div className={cn('group relative flex flex-col gap-1.5', className)}>
      <Link
        href={`/m/${meme.id}`}
        className="relative block aspect-square overflow-hidden rounded-xl border bg-card p-2 transition hover:border-foreground/30 hover:shadow-md focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none sm:p-3"
      >
        <MemeMedia meme={meme} className="transition-transform duration-300 group-hover:scale-[1.03]" />
        <span className="sr-only">查看详情</span>
        {kind !== 'image' && (
          <span className="pointer-events-none absolute top-2 left-2 rounded bg-foreground/80 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-background uppercase">
            {kind}
          </span>
        )}
        {meme.status !== 'success' && <ProcessBadge status={meme.status} className="absolute bottom-2 left-2" />}
        {similarity !== undefined && (
          <span className="pointer-events-none absolute bottom-2 left-2 rounded-full bg-brand px-2 py-0.5 text-xs font-medium text-brand-foreground tabular-nums">
            {Math.round(similarity * 100)}% 相似
          </span>
        )}
      </Link>
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
      <div className="flex min-h-8 items-center gap-1">
        <div className="flex min-w-0 flex-1 gap-1 overflow-hidden">
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
        <MemeMoreMenu meme={meme} allowAdd={allowAdd} className="shrink-0 text-muted-foreground" />
      </div>
    </div>
  )
}

export function MemeGrid({ memes, similarity, allowAdd }: { memes: Meme[]; similarity?: Map<string, number>; allowAdd?: boolean }) {
  return (
    <ul className="grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      {memes.map((m) => (
        <li key={m.id}>
          <MemeCard meme={m} similarity={similarity?.get(m.id)} allowAdd={allowAdd} />
        </li>
      ))}
    </ul>
  )
}
