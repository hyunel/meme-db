'use client'

import { Activity, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import { Check, ChevronRight, FolderOpen, FolderPlus, Hash, ImageOff, Library, Link2, Share2, UserRound } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { MemeFeed } from '@/components/meme/meme-feed'
import { FeedList } from '@/components/feed-list'
import { SearchBar } from '@/components/search/search-bar'
import { FolderGrid, FolderGridSkeleton } from '@/components/folder/folder-card'
import { FavoriteButton } from '@/components/meme/meme-actions'
import { PrivateLinkDialog, shareFolder } from '@/components/meme/share-dialog'
import { FolderPickerDialog } from '@/components/library/folder-picker-dialog'
import { useRequireLogin } from '@/components/app-providers'
import { EmptyState } from '@/components/states'
import { useFeed } from '@/hooks/use-feed'
import { api, refresh } from '@/lib/api'
import { qs } from '@/lib/utils'
import { formatDate } from '@/lib/format'
import { useSession } from '@/lib/session'
import type { Entry, Feed, Folder, FolderPage, Meme, Profile } from '@/lib/types'
import { TabSwitch, useTabParam } from '@/components/tab-switch'

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

export function TagView({ tag, hot: initialHot }: { tag: string; hot: string[] }) {
  const memes = useFeed(['tag', tag], (cursor) => api<Feed<Meme>>(`/memes${qs({ tag, cursor })}`))
  const { data: hot = initialHot } = useSWR<string[]>('/tags/hot?limit=12', { fallbackData: initialHot })
  const others = hot.filter((t) => t !== tag)
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader
        eyebrow={<span className="inline-flex items-center gap-1"><Hash className="size-3.5" aria-hidden />标签</span>}
        title={`#${tag}`}
      />
      {others.length > 0 && (
        <nav aria-label="其他标签" className="scroll-row -mx-4 px-4 sm:-mx-1 sm:px-1">
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
      <MemeFeed
        memes={memes.items}
        feed={memes}
        allowAdd
        empty={<EmptyState icon={ImageOff} title="该标签下暂无表情包" description="试试其他标签或直接搜索。" />}
      />
    </div>
  )
}

export function DiscoverView() {
  const [tab, setTab] = useTabParam(['memes', 'folders'] as const)
  const memes = useFeed(['popular'], (cursor) => api<Feed<Meme>>(`/memes${qs({ cursor })}`))
  const folders = useFeed(['public-folders'], (cursor) => api<Feed<Folder>>(`/folders${qs({ cursor })}`))
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader title="发现" description="全站热门表情包与社区公开分享的合集" />
      <TabSwitch label="内容类型" value={tab} onChange={setTab} tabs={[['memes', '热门表情包'], ['folders', '公开合集']] as const} />
      {/* Both tabs stay mounted, so switching shows the cards built before rather than building them again */}
      <div role="tabpanel">
        <Activity mode={tab === 'memes' ? 'visible' : 'hidden'}>
          <MemeFeed memes={memes.items} feed={memes} allowAdd empty={<EmptyState icon={ImageOff} title="暂无表情包" />} />
        </Activity>
        <Activity mode={tab === 'folders' ? 'visible' : 'hidden'}>
          <FeedList items={folders.items} feed={folders} skeleton={<FolderGridSkeleton />} empty={<EmptyState icon={FolderOpen} title="暂无公开合集" />}>
            {(list) => <FolderGrid folders={list} />}
          </FeedList>
        </Activity>
      </div>
    </div>
  )
}

export function UserProfileView({ profile: initial }: { profile: Profile }) {
  const { user: viewer } = useSession()
  const username = initial.user.username
  const path = `/users/${encodeURIComponent(username)}`
  const { data: { user, folder_count, meme_count } = initial } = useSWR<Profile>(path, { fallbackData: initial })
  // Opens on the collections, or on the memes of a profile with only those
  const memesFirst = Boolean(!folder_count && meme_count)
  const [tab, setTab] = useTabParam(memesFirst ? (['memes', 'folders'] as const) : (['folders', 'memes'] as const))
  const folders = useFeed(['profile-folders', username], (cursor) => api<Feed<Folder>>(`${path}/folders${qs({ cursor })}`), { live: true })
  const memes = useFeed(['profile-memes', username], (cursor) => api<Feed<Meme>>(`${path}/memes${qs({ cursor })}`), { live: true })
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
      <header className="flex items-center gap-4">
        <span className="flex size-16 shrink-0 items-center justify-center rounded-full bg-brand text-2xl font-semibold text-brand-foreground uppercase" aria-hidden>
          {user.username.slice(0, 1)}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h1 className="truncate text-2xl font-semibold tracking-tight">@{user.username}</h1>
          <p className="text-sm text-muted-foreground">{formatDate(user.created_at)} 加入</p>
        </div>
        {user.id === viewer?.id && (
          <Button variant="outline" nativeButton={false} render={<Link href="/library" />} className="shrink-0">
            <Library data-icon="inline-start" />
            管理我的库
          </Button>
        )}
      </header>
      <TabSwitch label="内容类型" value={tab} onChange={setTab} tabs={[['folders', '合集', folder_count], ['memes', '表情包', meme_count]] as const} />
      <div role="tabpanel">
        <Activity mode={tab === 'folders' ? 'visible' : 'hidden'}>
          <FeedList items={folders.items} feed={folders} skeleton={<FolderGridSkeleton />} empty={<EmptyState icon={FolderOpen} title="暂无公开合集" />}>
            {(list) => <FolderGrid folders={list} showOwner={false} />}
          </FeedList>
        </Activity>
        <Activity mode={tab === 'memes' ? 'visible' : 'hidden'}>
          <MemeFeed memes={memes.items} feed={memes} allowAdd empty={<EmptyState icon={ImageOff} title="暂无公开表情包" />} />
        </Activity>
      </div>
    </div>
  )
}

/** Saves another user's folder to the viewer's library, favorites and shares it; its owner opens it in their library instead. */
function FolderActions({ folder, own, viaLink, share }: { folder: Folder; own: boolean; viaLink: boolean; share?: string }) {
  const router = useRouter()
  const requireLogin = useRequireLogin()
  const [picking, setPicking] = useState(false)
  const [privateLink, setPrivateLink] = useState(false)

  const save = async (target: string | null) => {
    const copy = await api<Folder>(`/library/folders/${folder.id}/save`, { method: 'POST', json: { parent_id: target, share } })
    void refresh()
    toast.success(`已保存到我的库：${copy.name}`, { action: { label: '前往', onClick: () => router.push(`/library?folder=${copy.id}`) } })
  }

  return (
    <div className="flex gap-2 self-stretch sm:self-start">
      {own ? (
        <Button nativeButton={false} render={<Link href={`/library?folder=${folder.id}`} />} variant="secondary" className="h-11 flex-1 sm:h-9 sm:flex-none">
          <Check data-icon="inline-start" />
          在我的库中打开
        </Button>
      ) : (
        <Button onClick={() => requireLogin('登录后即可把合集保存到你的库。') && setPicking(true)} className="h-11 flex-1 sm:h-9 sm:flex-none">
          <FolderPlus data-icon="inline-start" />
          保存到我的库
        </Button>
      )}
      {!viaLink && <FavoriteButton kind="folder" id={folder.id} active={folder.is_favorite} count={folder.favorite_count} showCount className="h-11 sm:h-9" />}
      <Button variant="outline" onClick={() => shareFolder(folder, own, () => setPrivateLink(true), share)} className="h-11 sm:h-9">
        <Share2 data-icon="inline-start" />
        分享
      </Button>
      {picking && <FolderPickerDialog open onOpenChange={setPicking} mode="save" count={1} name={folder.name} initialFolder={null} onConfirm={save} />}
      {privateLink && <PrivateLinkDialog target={{ kind: 'folder', id: folder.id, title: folder.name }} onOpenChange={setPrivateLink} />}
    </div>
  )
}

/** A folder opened by its link, public or opened by a private link (share), which its pages pass on. */
export function PublicFolderView({ page: initial, share }: { page: FolderPage; share?: string }) {
  const { user } = useSession()
  const id = initial.folder.id
  const { data: { folder, ancestors, folders } = initial } = useSWR<FolderPage>(`/folders/${id}${qs({ share })}`, { fallbackData: initial })
  const entries = useFeed(['folder-entries', id, share], (cursor) => api<Feed<Entry>>(`/folders/${id}/entries${qs({ share, cursor })}`), { live: true })
  // Counts one view per page load for the link's stats, as a meme's page does.
  const viewed = useRef(false)
  useEffect(() => {
    if (!share || viewed.current) return
    viewed.current = true
    api(`/folders/${id}/share/views`, { method: 'POST', json: { share } }).catch(() => {})
  }, [id, share])

  const own = folder.owner.id === user?.id
  const viaLink = Boolean(share) && folder.visibility === 'private' && !own
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
      <nav aria-label="合集路径" className="scroll-row -mx-4 px-4 sm:-mx-1 sm:px-1">
        <ol className="flex w-max items-center gap-1 text-sm text-muted-foreground">
          <li>
            <Link href={`/u/${folder.owner.username}`} className="inline-flex items-center gap-1 hover:text-foreground">
              <UserRound className="size-3.5" aria-hidden />@{folder.owner.username}
            </Link>
          </li>
          {ancestors.map((f) => (
            <li key={f.id} className="flex items-center gap-1">
              <ChevronRight className="size-3.5" aria-hidden />
              <Link href={`/f/${f.id}${qs({ share })}`} className="hover:text-foreground">
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
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {folders.length} 个子文件夹 · 共 {folder.item_count} 个表情包
            {viaLink && (
              <span className="inline-flex items-center gap-1.5">
                <Link2 className="size-4 shrink-0" aria-hidden />
                通过私密链接查看
              </span>
            )}
          </span>
        }
        action={<FolderActions folder={folder} own={own} viaLink={viaLink} share={share} />}
      />
      <SearchBar folderId={folder.id} share={share} className="max-w-md" />
      {folders.length > 0 && <FolderGrid folders={folders} showOwner={false} share={share} />}
      <MemeFeed
        memes={entries.items}
        feed={entries}
        share={share}
        allowAdd
        empty={folders.length === 0 && <EmptyState icon={FolderOpen} title="这个合集还是空的" />}
      />
    </div>
  )
}
