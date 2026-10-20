'use client'

import { useEffect, useRef } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ErrorState } from '@/components/states'
import type { FeedStatus } from '@/hooks/use-feed'
import { useMessages } from '@/lib/i18n/client'

/** Lays out a feed's items, loading the next page as the end comes near; items are undefined until the first page comes. */
export function FeedList<L extends unknown[]>({
  items,
  feed,
  skeleton,
  empty,
  children,
}: {
  items: L | undefined
  feed: FeedStatus
  skeleton: React.ReactNode
  empty?: React.ReactNode
  children: (items: L) => React.ReactNode
}) {
  const { hasMore, isLoadingMore, error, loadMore, retry } = feed
  const sentinel = useRef<HTMLDivElement>(null)
  const t = useMessages()

  useEffect(() => {
    const el = sentinel.current
    if (!el || !hasMore || isLoadingMore || error) return
    // A screen ahead, so the next page (and its rerank) loads while the viewer is still scrolling.
    const io = new IntersectionObserver((entries) => entries[0].isIntersecting && loadMore(), { rootMargin: '100% 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [items, hasMore, isLoadingMore, error, loadMore])

  if (!items) return error ? <ErrorState description={error.message} onRetry={retry} /> : skeleton
  if (!items.length) return empty

  return (
    <div className="flex flex-col gap-4">
      {children(items)}
      <div ref={sentinel} className="flex min-h-9 items-center justify-center gap-2 text-sm text-muted-foreground">
        {error ? (
          <>
            {t.common.loadFailed}
            <Button variant="ghost" size="sm" onClick={retry}>
              {t.common.retry}
            </Button>
          </>
        ) : isLoadingMore ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden />
            {t.common.loadingMore}
          </>
        ) : (
          !hasMore && t.common.noMore
        )}
      </div>
    </div>
  )
}
