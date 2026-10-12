'use client'

import { useEffect, useRef } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ErrorState, MemeGridSkeleton } from '@/components/states'
import type { FeedStatus } from '@/hooks/use-feed'
import type { Entry, Meme } from '@/lib/types'
import { MemeGrid } from './meme-card'

/** A meme grid that loads the next page of its feed as the end comes near; memes are undefined until the first page comes. */
export function MemeFeed({
  memes,
  feed,
  empty,
  share,
  similarity,
  allowAdd,
}: {
  memes: Meme[] | Entry[] | undefined
  feed: FeedStatus
  empty?: React.ReactNode
  share?: string
  similarity?: Map<string, number>
  allowAdd?: boolean
}) {
  const { hasMore, isLoadingMore, error, loadMore, retry } = feed
  const sentinel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = sentinel.current
    if (!el || !hasMore || isLoadingMore || error) return
    // A screen ahead, so the next page (and its rerank) loads while the viewer is still scrolling.
    const io = new IntersectionObserver((entries) => entries[0].isIntersecting && loadMore(), { rootMargin: '100% 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [memes, hasMore, isLoadingMore, error, loadMore])

  if (!memes) return error ? <ErrorState description={error.message} onRetry={retry} /> : <MemeGridSkeleton />
  if (!memes.length) return empty

  return (
    <div className="flex flex-col gap-4">
      <MemeGrid memes={memes} share={share} similarity={similarity} allowAdd={allowAdd} />
      <div ref={sentinel} className="flex min-h-9 items-center justify-center gap-2 text-sm text-muted-foreground">
        {error ? (
          <>
            加载失败
            <Button variant="ghost" size="sm" onClick={retry}>
              重试
            </Button>
          </>
        ) : isLoadingMore ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden />
            加载中…
          </>
        ) : (
          !hasMore && '没有更多了'
        )}
      </div>
    </div>
  )
}
