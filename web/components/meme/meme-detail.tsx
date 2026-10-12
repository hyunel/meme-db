'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import { ArrowLeft, ChevronDown, ChevronRight, Download, FolderOpen, Library, Loader2, Link2, Plus, RotateCw, UserRound, X, type LucideIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MemeMedia } from './meme-media'
import { MemeFeed } from './meme-feed'
import { FavoriteButton, LibraryButton } from './meme-actions'
import { DownloadDialog } from './download-dialog'
import { ShareButton } from './share-dialog'
import { ProcessBadge } from '@/components/status-badges'
import { useFeed } from '@/hooks/use-feed'
import { ErrorState, NotFoundState, PageLoading } from '@/components/states'
import { ApiError, api, qs } from '@/lib/api'
import { isProcessing, kindOf, memeTitle } from '@/lib/media'
import { formatBytes, formatDateTime } from '@/lib/format'
import { useSession } from '@/lib/session'
import type { EntryDetail, Feed, Folder, Meme, MemeTag, MemeThumb } from '@/lib/types'
import { cn } from '@/lib/utils'

type Place = { key: string; href: string; name: string; meta: string; icon: LucideIcon; cover?: MemeThumb; current?: boolean }

const PLACES_SHOWN = 3
const LIBRARY_ROOT: Place = { key: 'library', href: '/library', name: '我的库', meta: '根目录', icon: Library }

/** Where the meme lives: the place it was opened from (by the private link share, if any), then the viewer's folders and the public collections holding it. */
function MemePlaces({ meme, entry, mine, share }: { meme: Meme; entry?: EntryDetail; mine: boolean; share?: string }) {
  const { user } = useSession()
  const { data: folders = [] } = useSWR<Folder[]>(`/memes/${meme.id}/folders`)
  const [expanded, setExpanded] = useState(false)

  const folderPlace = (f: Folder): Place => {
    const own = f.owner.id === user?.id
    return {
      key: f.id,
      href: own ? `/library?folder=${f.id}` : `/f/${f.id}`,
      name: f.name,
      meta: `${own ? `我的库 · ${f.visibility === 'private' ? '私有' : '公开'}` : `@${f.owner.username}`} · ${f.item_count} 项`,
      icon: FolderOpen,
      cover: f.previews[0],
    }
  }

  // The folder the entry sits in; without one the viewer may see, the library root or the owner's page.
  const folder = entry?.ancestors.at(-1)
  const openedPlace = ({ owner }: EntryDetail): Place => {
    const found = folder && folders.find((f) => f.id === folder.id)
    if (found) return folderPlace(found)
    if (folder) return { key: folder.id, href: mine ? `/library?folder=${folder.id}` : `/f/${folder.id}${qs({ share })}`, name: folder.name, meta: mine ? '我的库' : `@${owner.username}`, icon: FolderOpen }
    return mine ? LIBRARY_ROOT : { key: 'owner', href: `/u/${owner.username}`, name: `@${owner.username}`, meta: '公开的表情包', icon: UserRound }
  }

  // The first of each place is kept, so the one opened from stays marked.
  const places = [
    ...(entry ? [{ ...openedPlace(entry), current: true }] : []),
    ...(meme.entries.some((e) => !e.folder_id) ? [LIBRARY_ROOT] : []),
    ...folders.map(folderPlace),
  ].filter((p, i, all) => all.findIndex((q) => q.key === p.key) === i)
  if (!places.length) return null
  const shown = expanded ? places : places.slice(0, PLACES_SHOWN)

  return (
    <section className="flex flex-col gap-2" aria-labelledby="places-heading">
      <h2 id="places-heading" className="text-sm font-medium">
        收录于
      </h2>
      <ul className="flex flex-col divide-y overflow-hidden rounded-xl border bg-card">
        {shown.map(({ key, href, name, meta, icon: Icon, cover, current }) => (
          <li key={key}>
            <Link
              href={href}
              className="group flex items-center gap-3 p-2.5 transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-inset"
            >
              {cover ? (
                <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted/50" aria-hidden>
                  <MemeMedia meme={cover} />
                </span>
              ) : (
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted" aria-hidden>
                  <Icon className="size-5 text-muted-foreground" />
                </span>
              )}
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium">{name}</span>
                <span className="truncate text-xs text-muted-foreground">{meta}</span>
              </span>
              {current && <span className="shrink-0 rounded-full bg-brand/40 px-2 py-0.5 text-xs">当前</span>}
              <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
      {places.length > PLACES_SHOWN && (
        <Button variant="ghost" size="sm" className="-ml-2 self-start text-muted-foreground" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          <ChevronDown className={cn('transition-transform', expanded && 'rotate-180')} data-icon="inline-start" />
          {expanded ? '收起' : `展开其余 ${places.length - PLACES_SHOWN} 个`}
        </Button>
      )}
    </section>
  )
}

/** Opened from an entry, the meme goes by the entry's name and links back to where it lives; share is a private link that opens it. */
export function MemeDetail({ id, entryId, share }: { id: string; entryId?: string; share?: string }) {
  const router = useRouter()
  const { user } = useSession()
  const { data: meme, error, mutate } = useSWR<Meme>(`/memes/${id}${qs({ share })}`, {
    refreshInterval: (m) => (isProcessing(m) ? 3000 : 0),
  })
  const similar = useFeed(meme?.status === 'success' ? ['similar', id, share] : null, (cursor) => api<Feed<Meme>>(`/memes/${id}/similar${qs({ share, cursor })}`))
  const { data: opened, isLoading: openingEntry } = useSWR<EntryDetail>(entryId ? `/entries/${entryId}${qs({ share })}` : null)
  const entry = opened?.meme.id === id ? opened : undefined // A hand-edited link may pair an entry with another meme
  const mine = Boolean(entry && entry.owner.id === user?.id)
  const [downloadOpen, setDownloadOpen] = useState(false)
  const [tagInput, setTagInput] = useState('')
  // Counts one view per page load for the link's stats; refetches of the meme must not.
  const viewed = useRef(false)
  useEffect(() => {
    if (!share || !meme || viewed.current) return
    viewed.current = true
    api(`/memes/${id}/share/views`, { method: 'POST', json: { share } }).catch(() => {})
  }, [id, share, meme])
  const [tagPending, setTagPending] = useState(false)

  if (error) {
    return error instanceof ApiError && error.status === 404 ? (
      share ? (
        <NotFoundState title="链接已失效" description="分享者可能停用了这个链接，或把表情包移出了自己的库。" />
      ) : (
        <NotFoundState title="表情包不存在" description="它可能已被删除，或尚未公开。" />
      )
    ) : (
      <div className="mx-auto max-w-lg px-4 py-24">
        <ErrorState onRetry={() => mutate()} />
      </div>
    )
  }
  if (!meme || openingEntry) return <PageLoading />

  // Opened only by a private link: the viewer may look and save it, but not favorite or tag it.
  const viaLink = Boolean(share) && !meme.is_public && meme.entries.length === 0
  const ratio = meme.width && meme.height ? meme.width / meme.height : 1
  const systemTags = meme.tags.filter((t) => !t.mine)
  const myTags = meme.tags.filter((t) => t.mine)

  const addTag = async (e: React.FormEvent) => {
    e.preventDefault()
    const name = tagInput.trim().replace(/^#/, '')
    if (!name) return
    if (name.length > 20) {
      toast.error('标签最多 20 个字符')
      return
    }
    setTagPending(true)
    try {
      const tag = await api<MemeTag>(`/memes/${meme.id}/tags`, { method: 'POST', json: { name } })
      await mutate({ ...meme, tags: [...meme.tags.filter((t) => t.id !== tag.id || !t.mine), tag] })
      setTagInput('')
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setTagPending(false)
    }
  }

  const removeTag = async (tag: MemeTag) => {
    try {
      await api(`/memes/${meme.id}/tags/${tag.id}`, { method: 'DELETE' })
      await mutate({ ...meme, tags: meme.tags.filter((t) => !(t.mine && t.id === tag.id)) })
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const retry = async () => {
    try {
      await api(`/memes/${meme.id}/retry`, { method: 'POST' })
      toast.success('已重新加入处理队列')
      await mutate()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const kind = kindOf(meme.mime_type)
  const info = [
    ['格式', kind === 'lottie' ? 'Lottie' : (meme.mime_type.split('/')[1]?.toUpperCase() ?? '—')],
    ['尺寸', meme.width ? `${meme.width} × ${meme.height}` : '—'],
    ['大小', formatBytes(meme.file_size)],
    ['上传时间', formatDateTime(meme.created_at)],
  ]

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-4 py-4 sm:px-6 sm:py-8">
      <div className="flex flex-col gap-4">
        <Button variant="ghost" className="-ml-2 self-start" onClick={() => (window.history.length > 1 ? router.back() : router.push('/'))}>
          <ArrowLeft data-icon="inline-start" />
          返回
        </Button>

        <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] md:gap-10">
          <div className="flex items-center justify-center rounded-2xl bg-muted/50 p-4 md:min-h-[28rem] md:self-start md:p-8">
            {/* As large as fits at the meme's own ratio, even above its size */}
            <div className="overflow-hidden rounded-lg border" style={{ aspectRatio: ratio, width: `min(100%, calc(70vh * ${ratio}))` }}>
              <MemeMedia meme={meme} controls className="size-full" />
            </div>
          </div>

          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <h1 className="text-pretty text-2xl font-semibold tracking-tight wrap-anywhere">{entry?.name ?? memeTitle(meme)}</h1>
                {entry && meme.title && <p className="text-sm text-muted-foreground">{meme.title}</p>}
              </div>
              {viaLink && (
                <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Link2 className="size-4 shrink-0" aria-hidden />
                  通过私密链接查看
                </p>
              )}
              {meme.summary && <p className="text-sm leading-relaxed text-pretty">{meme.summary}</p>}
              {meme.status !== 'success' && (
                <div className="flex flex-wrap items-center gap-2">
                  <ProcessBadge status={meme.status} />
                  {meme.status === 'failed' && (
                    <>
                      <span className="text-sm break-all text-muted-foreground">{meme.fail_reason ?? '识别失败'}</span>
                      {(meme.entries.length > 0 || user?.role === 'admin') && (
                        <Button size="sm" variant="outline" onClick={retry}>
                          <RotateCw data-icon="inline-start" />
                          重试
                        </Button>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <LibraryButton meme={meme} share={share} className="h-11 md:h-9" />
              <div className={cn('grid gap-2', viaLink ? 'grid-cols-2' : 'grid-cols-3')}>
                {!viaLink && <FavoriteButton kind="meme" id={meme.id} active={meme.is_favorite} count={meme.favorite_count} showCount className="h-11 md:h-9" />}
                <Button variant="outline" className="h-11 md:h-9" onClick={() => setDownloadOpen(true)}>
                  <Download data-icon="inline-start" />
                  下载
                </Button>
                <ShareButton meme={meme} share={share} className="h-11 md:h-9" />
              </div>
            </div>

            <section className="flex flex-col gap-2" aria-labelledby="tags-heading">
              <h2 id="tags-heading" className="text-sm font-medium">
                标签
              </h2>
              <ul className="flex flex-wrap gap-1.5">
                {systemTags.map((t) => (
                  <li key={t.id}>
                    <Link href={`/tags/${encodeURIComponent(t.name)}`} className="inline-flex h-8 items-center rounded-full bg-muted px-3 text-sm hover:bg-brand hover:text-brand-foreground">
                      #{t.name}
                    </Link>
                  </li>
                ))}
                {myTags.map((t) => (
                  <li key={`u-${t.id}`} className="inline-flex h-8 items-center rounded-full border border-dashed bg-card pl-3 text-sm">
                    <Link href={`/tags/${encodeURIComponent(t.name)}`} className="hover:underline">
                      #{t.name}
                    </Link>
                    <button type="button" aria-label={`移除标签 ${t.name}`} onClick={() => removeTag(t)} className="flex size-8 items-center justify-center rounded-full text-muted-foreground hover:text-foreground">
                      <X className="size-3.5" />
                    </button>
                  </li>
                ))}
                {meme.tags.length === 0 && <li className="text-sm text-muted-foreground">暂无标签</li>}
              </ul>
              {user && !viaLink && (
                <form onSubmit={addTag} className="flex gap-2">
                  <Input value={tagInput} onChange={(e) => setTagInput(e.target.value)} placeholder="添加我的标签" aria-label="添加我的标签" maxLength={20} className="h-10 text-base md:h-9 md:text-sm" />
                  <Button type="submit" variant="secondary" disabled={!tagInput.trim() || tagPending} className="h-10 md:h-9">
                    {tagPending ? <Loader2 className="animate-spin" /> : <Plus data-icon="inline-start" />}
                    添加
                  </Button>
                </form>
              )}
            </section>

            <MemePlaces meme={meme} entry={entry} mine={mine} share={share} />

            {meme.ocr_text && (
              <section className="flex flex-col gap-2" aria-labelledby="ocr-heading">
                <h2 id="ocr-heading" className="text-sm font-medium">
                  识别文字
                </h2>
                <p className="rounded-lg bg-muted px-3 py-2 text-sm whitespace-pre-line">{meme.ocr_text}</p>
              </section>
            )}

            <section aria-labelledby="info-heading" className="flex flex-col gap-2">
              <h2 id="info-heading" className="text-sm font-medium">
                文件信息
              </h2>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                {info.map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="tabular-nums">{v}</dd>
                  </div>
                ))}
              </dl>
            </section>
          </div>
        </div>
      </div>

      {similar.items && similar.items.length > 0 && (
        <section className="flex flex-col gap-4" aria-labelledby="related-heading">
          <h2 id="related-heading" className="text-lg font-semibold">
            相似表情包
          </h2>
          <MemeFeed memes={similar.items} feed={similar} allowAdd />
        </section>
      )}

      {downloadOpen && <DownloadDialog meme={meme} open onOpenChange={setDownloadOpen} />}
    </div>
  )
}
