'use client'

import Link from 'next/link'
import useSWR from 'swr'
import { ArrowRight, Clock, Flame, X } from 'lucide-react'
import { SearchBar } from '@/components/search/search-bar'
import { MemeGrid } from '@/components/meme/meme-card'
import { FolderCard } from '@/components/folder/folder-card'
import { MemeGridSkeleton } from '@/components/states'
import { Button } from '@/components/ui/button'
import { clearRecentSearches, useRecentSearches } from '@/lib/recent-searches'
import type { Folder, Meme, Page } from '@/lib/types'

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
  const { data: popular } = useSWR<Page<Meme>>('/memes?limit=10')
  const { data: folders } = useSWR<Folder[]>('/folders?limit=4')

  return (
    <>
      <section className="border-b bg-[radial-gradient(ellipse_at_top,var(--color-brand)/0.35,transparent_60%)]">
        <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-6 px-4 pt-20 pb-16 text-center md:pt-28 md:pb-20">
          <p className="rounded-full border bg-card px-3 py-1 text-xs text-muted-foreground">
            {'已收录 '}
            <span className="font-medium text-foreground tabular-nums">{popular?.total ?? '…'}</span>
            {' 张公开表情包，支持以图搜图'}
          </p>
          <h1 className="text-4xl font-semibold tracking-tight text-balance md:text-6xl">
            找到那张<span className="relative whitespace-nowrap">
              <span className="relative z-10">刚刚好</span>
              <span className="absolute inset-x-0 bottom-1 -z-0 h-3 rounded-sm bg-brand md:h-4" aria-hidden />
            </span>
            的表情包
          </h1>
          <p className="max-w-xl text-pretty text-muted-foreground md:text-lg">
            输入一句话、一个情绪，或直接丢一张图进来。MemeDB 会识别图中的文字和角色，帮你秒找同款。
          </p>
          <SearchBar size="lg" className="max-w-2xl" />
          <div className="flex flex-col items-center gap-3">
            {recent.length > 0 && (
              <div className="flex flex-wrap items-center justify-center gap-2">
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock className="size-3" aria-hidden />
                  最近搜索
                </span>
                {recent.slice(0, 5).map((q) => (
                  <Chip key={q} href={`/search?q=${encodeURIComponent(q)}`}>
                    {q}
                  </Chip>
                ))}
                <Button variant="ghost" size="icon-xs" onClick={clearRecentSearches} aria-label="清除最近搜索">
                  <X />
                </Button>
              </div>
            )}
            {hot && hot.length > 0 && (
            <div className="flex flex-wrap items-center justify-center gap-2">
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Flame className="size-3" aria-hidden />
                热门
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
              热门表情包
            </h2>
            <p className="text-sm text-muted-foreground">大家最近都在收藏这些</p>
          </div>
          <Button variant="ghost" nativeButton={false} render={<Link href="/search" />}>
            浏览全部
            <ArrowRight data-icon="inline-end" />
          </Button>
        </div>
        {popular ? <MemeGrid memes={popular.items} /> : <MemeGridSkeleton />}
      </section>

      {folders && folders.length > 0 && (
      <section className="mx-auto w-full max-w-6xl px-4 pb-16" aria-labelledby="folders-heading">
        <div className="mb-5">
          <h2 id="folders-heading" className="text-xl font-semibold tracking-tight">
            精选公开文件夹
          </h2>
          <p className="text-sm text-muted-foreground">由用户整理并公开分享的表情包合集</p>
        </div>
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {folders.map((f) => (
            <li key={f.id}>
              <FolderCard folder={f} />
            </li>
          ))}
        </ul>
      </section>
      )}
    </>
  )
}
