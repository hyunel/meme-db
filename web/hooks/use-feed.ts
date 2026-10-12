'use client'

import { useCallback, useMemo } from 'react'
import useSWRInfinite from 'swr/infinite'
import { useSession } from '@/lib/session'
import type { Feed } from '@/lib/types'

export interface FeedStatus {
  hasMore: boolean
  isLoadingMore: boolean
  error: Error | undefined
  loadMore: () => void
  /** Fetches the page that failed again, keeping the pages loaded */
  retry: () => void
}

/**
 * Pages through a feed by its cursors, kept apart for each viewer; a null key fetches nothing.
 * A live feed fetches its first page again on revisits and with each page after, to show what changed.
 */
export function useFeed<T>(key: unknown[] | null, fetchPage: (cursor: string | null, page: number) => Promise<Feed<T>>, { live = false } = {}) {
  const { user, ready } = useSession()
  const { data, error, size, setSize, isLoading } = useSWRInfinite<Feed<T>, Error>(
    (i, prev: Feed<T> | null) => (key && ready && (i === 0 || prev?.next) ? [key, user?.id ?? null, i, prev?.next ?? null] : null),
    ([, , page, cursor]: [unknown, unknown, number, string | null]) => fetchPage(cursor, page),
    // Unless live, loading a page must not fetch the first one again, which may cost a rerank.
    { revalidateFirstPage: live, revalidateIfStale: live },
  )

  const items = useMemo(() => data?.flatMap((p) => p.items), [data])
  const isLoadingMore = Boolean(data && size > data.length && !error)
  const loadMore = useCallback(() => setSize((s) => (data && s > data.length ? s : s + 1)), [data, setSize])
  const retry = useCallback(() => setSize((s) => s), [setSize])

  return { items, isLoading, hasMore: Boolean(data?.at(-1)?.next), isLoadingMore, error, loadMore, retry }
}
