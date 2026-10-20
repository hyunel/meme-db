'use client'

import Link from 'next/link'
import useSWR from 'swr'
import { ArrowRight, Clock, Flame, X } from 'lucide-react'
import { SearchBar } from '@/components/search/search-bar'
import { MemeGrid } from '@/components/meme/meme-card'
import { FolderGrid } from '@/components/folder/folder-card'
import { MemeGridSkeleton } from '@/components/states'
import { Button } from '@/components/ui/button'
import { clearRecentSearches, useRecentSearches } from '@/lib/recent-searches'
import type { Feed, Folder, Meme, SiteStats } from '@/lib/types'
import { useMessages } from '@/lib/i18n/client'

function Chip({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="rounded-full border bg-card px-3 py-1 text-sm transition-colors hover:border-foreground/40 hover:bg-brand/30">
      {children}
    </Link>
  )
}

export function HomeView() {
  const recent = useRecentSearches()
  const { data: hot } = useSWR<string[]>('/tags/hot?limit=8')
  const { data: stats } = useSWR<SiteStats>('/stats')
  const { data: popular } = useSWR<Feed<Meme>>('/memes?limit=12')
  const { data: folders } = useSWR<Feed<Folder>>('/folders?limit=6')
  const t = useMessages()

  return (
    <>
      <section className="border-b bg-[radial-gradient(ellipse_at_top,var(--color-brand)/0.35,transparent_60%)]">
        <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-6 px-4 pt-20 pb-16 text-center md:pt-28 md:pb-20">
          <p className="rounded-full border bg-card px-3 py-1 text-xs text-muted-foreground">
            {t.home.indexedBefore}
            <span className="font-medium text-foreground tabular-nums">{stats?.memes ?? '…'}</span>
            {t.home.indexedAfter}
          </p>
          {/* break-keep wraps Chinese only between phrases: at the <wbr>, or after punctuation */}
          <h1 className="text-4xl font-semibold tracking-tight text-balance break-keep md:text-6xl">
            {t.home.heroBefore}
            <wbr />
            <span className="relative whitespace-nowrap">
              {/* On a dark page the word itself turns yellow, as light text would vanish into the marker */}
              <span className="relative z-10 dark:text-brand">{t.home.heroMark}</span>
              <span className="absolute inset-x-0 bottom-1 -z-0 h-3 rounded-sm bg-brand md:h-4 dark:hidden" aria-hidden />
            </span>
            {t.home.heroAfter}
          </h1>
          <p className="max-w-xl text-pretty break-keep text-muted-foreground md:text-lg">
            <span className="inline-block">{t.home.intro1}</span>
            <span className="inline-block">{t.home.intro2}</span>
          </p>
          <SearchBar size="lg" className="max-w-2xl" />
          <div className="flex flex-col items-center gap-3">
            {recent.length > 0 && (
              <div className="flex flex-wrap items-center justify-center gap-2">
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock className="size-3" aria-hidden />
                  {t.home.recent}
                </span>
                {recent.slice(0, 5).map((q) => (
                  <Chip key={q} href={`/search?q=${encodeURIComponent(q)}`}>
                    {q}
                  </Chip>
                ))}
                <Button variant="ghost" size="icon-xs" onClick={clearRecentSearches} aria-label={t.home.clearRecent}>
                  <X />
                </Button>
              </div>
            )}
            {hot && hot.length > 0 && (
            <div className="flex flex-wrap items-center justify-center gap-2">
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Flame className="size-3" aria-hidden />
                {t.home.hot}
              </span>
              {hot.map((k) => (
                <Chip key={k} href={`/search?q=${encodeURIComponent(k)}`}>
                  {k}
                </Chip>
              ))}
            </div>
            )}
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-4 py-12" aria-labelledby="popular-heading">
        <div className="mb-5 flex items-end justify-between gap-4">
          <div>
            <h2 id="popular-heading" className="text-xl font-semibold tracking-tight">
              {t.browse.popular}
            </h2>
            <p className="text-sm text-muted-foreground">{t.home.popularHint}</p>
          </div>
          <Button variant="ghost" nativeButton={false} render={<Link href="/discover" />}>
            {t.home.browseAll}
            <ArrowRight data-icon="inline-end" />
          </Button>
        </div>
        {popular ? <MemeGrid memes={popular.items} /> : <MemeGridSkeleton />}
      </section>

      {folders && folders.items.length > 0 && (
      <section className="mx-auto w-full max-w-6xl px-4 pb-16" aria-labelledby="folders-heading">
        <div className="mb-5">
          <h2 id="folders-heading" className="text-xl font-semibold tracking-tight">
            {t.home.folders}
          </h2>
          <p className="text-sm text-muted-foreground">{t.home.foldersHint}</p>
        </div>
        <FolderGrid folders={folders.items} />
      </section>
      )}
    </>
  )
}
