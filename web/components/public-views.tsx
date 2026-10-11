'use client'

import { useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { ChevronRight, FolderOpen, Hash, ImageOff, UserRound } from 'lucide-react'
import { MemeGrid } from '@/components/meme/meme-card'
import { FolderCard, FolderGrid } from '@/components/folder/folder-card'
import { FavoriteButton } from '@/components/meme/meme-actions'
import { EmptyState, MemeGridSkeleton } from '@/components/states'
import { Loadable } from '@/components/loadable'
import { formatDate } from '@/lib/format'
import type { Folder, FolderPage, Meme, Page, Profile } from '@/lib/types'
import { TabSwitch } from '@/components/tab-switch'

function PageHeader({ eyebrow, title, description, action }: { eyebrow?: React.ReactNode; title: string; description?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1.5">
        {eyebrow && <div className="text-sm text-muted-foreground">{eyebrow}</div>}
        <h1 className="truncate text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </header>
  )
}

export function TagView({ tag }: { tag: string }) {
  const memes = useSWR<Page<Meme>>(`/memes?tag=${encodeURIComponent(tag)}&limit=100`)
  const { data: hot } = useSWR<string[]>('/tags/hot?limit=12')
  const others = hot?.filter((t) => t !== tag) ?? []
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader
        eyebrow={<span className="inline-flex items-center gap-1"><Hash className="size-3.5" aria-hidden />标签</span>}
        title={`#${tag}`}
        description={memes.data ? `${memes.data.total} 个表情包` : undefined}
      />
      {others.length > 0 && (
        <nav aria-label="其他标签" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <ul className="flex w-max gap-2 sm:w-auto sm:flex-wrap">
            {others.map((t) => (
              <li key={t}>
                <Link href={`/tags/${encodeURIComponent(t)}`} className="inline-flex h-9 items-center rounded-full bg-muted px-3.5 text-sm whitespace-nowrap hover:bg-brand hover:text-brand-foreground">
                  #{t}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
      <Loadable result={memes} loading={<MemeGridSkeleton />}>
        {(page) =>
          page.items.length ? <MemeGrid memes={page.items} allowAdd /> : <EmptyState icon={ImageOff} title="该标签下暂无表情包" description="试试其他标签或直接搜索。" />
        }
      </Loadable>
    </div>
  )
}

export function DiscoverView() {
  const [tab, setTab] = useState<'memes' | 'folders'>('memes')
  const memes = useSWR<Page<Meme>>('/memes?limit=40')
  const folders = useSWR<Folder[]>('/folders?limit=40')
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader title="发现" description="全站热门表情包与社区公开分享的合集" />
      <TabSwitch label="内容类型" value={tab} onChange={setTab} tabs={[['memes', '热门表情包', memes.data?.total], ['folders', '公开合集', folders.data?.length]] as const} />
      <div role="tabpanel">
        {tab === 'memes' ? (
          <Loadable result={memes} loading={<MemeGridSkeleton />}>
            {(page) => (page.items.length ? <MemeGrid memes={page.items} allowAdd /> : <EmptyState icon={ImageOff} title="暂无表情包" />)}
          </Loadable>
        ) : (
          <Loadable result={folders} loading={<MemeGridSkeleton count={4} />}>
            {(list) => (list.length ? <FolderGrid folders={list} /> : <EmptyState icon={FolderOpen} title="暂无公开合集" />)}
          </Loadable>
        )}
      </div>
    </div>
  )
}

export function UserProfileView({ username }: { username: string }) {
  const profile = useSWR<Profile>(`/users/${encodeURIComponent(username)}`)
  return (
    <Loadable result={profile} notFound={{ title: '用户不存在', description: '该用户不存在或已被停用。' }}>
      {({ user, folders, memes }) => (
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-6 sm:px-6 sm:py-8">
          <header className="flex items-center gap-4">
            <span className="flex size-16 shrink-0 items-center justify-center rounded-full bg-brand text-2xl font-semibold text-brand-foreground uppercase" aria-hidden>
              {user.username.slice(0, 1)}
            </span>
            <div className="flex min-w-0 flex-col gap-0.5">
              <h1 className="truncate text-2xl font-semibold tracking-tight">@{user.username}</h1>
              <p className="text-sm text-muted-foreground">
                {formatDate(user.created_at)} 加入 · {folders.length} 个公开合集 · {memes.length} 个公开表情包
              </p>
            </div>
          </header>
          <section className="flex flex-col gap-4" aria-labelledby="pf-folders">
            <h2 id="pf-folders" className="text-lg font-semibold">
              公开合集
            </h2>
            {folders.length ? <FolderGrid folders={folders} showOwner={false} /> : <p className="text-sm text-muted-foreground">暂无公开合集</p>}
          </section>
          <section className="flex flex-col gap-4" aria-labelledby="pf-memes">
            <h2 id="pf-memes" className="text-lg font-semibold">
              公开表情包
            </h2>
            {memes.length ? <MemeGrid memes={memes} allowAdd /> : <p className="text-sm text-muted-foreground">暂无单独公开的表情包</p>}
          </section>
        </div>
      )}
    </Loadable>
  )
}

export function PublicFolderView({ id }: { id: string }) {
  const page = useSWR<FolderPage>(`/folders/${id}`)
  return (
    <Loadable result={page} notFound={{ title: '合集不存在', description: '它可能已被删除，或已设为私有。' }}>
      {({ folder, ancestors, folders, memes }) => (
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
          <nav aria-label="合集路径" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <ol className="flex w-max items-center gap-1 text-sm text-muted-foreground">
              <li>
                <Link href={`/u/${folder.owner.username}`} className="inline-flex items-center gap-1 hover:text-foreground">
                  <UserRound className="size-3.5" aria-hidden />@{folder.owner.username}
                </Link>
              </li>
              {ancestors.map((f) => (
                <li key={f.id} className="flex items-center gap-1">
                  <ChevronRight className="size-3.5" aria-hidden />
                  <Link href={`/f/${f.id}`} className="hover:text-foreground">
                    {f.name}
                  </Link>
                </li>
              ))}
              <li className="flex items-center gap-1">
                <ChevronRight className="size-3.5" aria-hidden />
                <span aria-current="page" className="font-medium text-foreground">
                  {folder.name}
                </span>
              </li>
            </ol>
          </nav>
          <PageHeader
            title={folder.name}
            description={`${folders.length} 个子文件夹 · ${memes.length} 个表情包`}
            action={<FavoriteButton kind="folder" id={folder.id} active={folder.is_favorite} count={folder.favorite_count} showCount className="h-11 self-start sm:h-9" />}
          />
          {folders.length > 0 && (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {folders.map((f) => (
                <li key={f.id}>
                  <FolderCard folder={f} showOwner={false} />
                </li>
              ))}
            </ul>
          )}
          {memes.length ? <MemeGrid memes={memes} allowAdd /> : folders.length === 0 && <EmptyState icon={FolderOpen} title="这个合集还是空的" />}
        </div>
      )}
    </Loadable>
  )
}
