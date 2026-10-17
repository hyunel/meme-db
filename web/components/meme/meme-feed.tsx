'use client'

import { FeedList } from '@/components/feed-list'
import { MemeGridSkeleton } from '@/components/states'
import type { FeedStatus } from '@/hooks/use-feed'
import type { Entry, Meme } from '@/lib/types'
import { MemeGrid } from './meme-card'

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
  return (
    <FeedList items={memes} feed={feed} skeleton={<MemeGridSkeleton />} empty={empty}>
      {(items) => <MemeGrid memes={items} share={share} similarity={similarity} allowAdd={allowAdd} />}
    </FeedList>
  )
}
