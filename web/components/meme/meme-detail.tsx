'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import { ArrowLeft, ChevronRight, Download, FolderOpen, Library, Loader2, Plus, RotateCw, Share2, UserRound, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MemeMedia } from './meme-media'
import { MemeGrid } from './meme-card'
import { AddToLibraryButton, FavoriteButton } from './meme-actions'
import { DownloadDialog } from './download-dialog'
import { ProcessBadge } from '@/components/status-badges'
import { ErrorState, NotFoundState, PageLoading } from '@/components/states'
import { ApiError, api } from '@/lib/api'
import { isProcessing, kindOf, memeTitle } from '@/lib/media'
import { shareMeme } from '@/lib/meme-transfer'
import { formatBytes, formatDateTime } from '@/lib/format'
import { useSession } from '@/lib/session'
import type { EntryDetail, Meme, MemeTag } from '@/lib/types'

/** Where an entry the meme was opened from lives, linking back there. */
function EntrySource({ entry, mine }: { entry: EntryDetail; mine: boolean }) {
  const folder = entry.ancestors.at(-1)
  const { icon: Icon, label, name, href } = folder
    ? {
        icon: FolderOpen,
        label: mine ? ['我的库', ...entry.ancestors.slice(0, -1).map((a) => a.name)].join(' / ') : `@${entry.owner.username} 的合集`,
        name: folder.name,
        href: mine ? `/library?folder=${folder.id}` : `/f/${folder.id}`,
      }
    : mine
      ? { icon: Library, label: '位于', name: '我的库', href: '/library' }
      : { icon: UserRound, label: '来自', name: `@${entry.owner.username}`, href: `/u/${entry.owner.username}` }

  return (
    <Link
      href={href}
      className="group flex items-center gap-3 rounded-xl border bg-card p-3 transition hover:border-foreground/30 hover:shadow-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand/40" aria-hidden>
        <Icon className="size-5" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-xs text-muted-foreground">{label}</span>
        <span className="truncate font-medium">{name}</span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
    </Link>
  )
}

/** Opened from an entry, the meme goes by the entry's name and links back to where it lives. */
export function MemeDetail({ id, entryId }: { id: string; entryId?: string }) {
  const router = useRouter()
  const { user } = useSession()
  const { data: meme, error, mutate } = useSWR<Meme>(`/memes/${id}`, {
    refreshInterval: (m) => (isProcessing(m) ? 3000 : 0),
  })
  const { data: related } = useSWR<Meme[]>(meme?.status === 'success' ? `/memes/${id}/similar?limit=10` : null)
  const { data: opened, isLoading: openingEntry } = useSWR<EntryDetail>(entryId ? `/entries/${entryId}` : null)
  const entry = opened?.meme.id === id ? opened : undefined // A hand-edited link may pair an entry with another meme
  const mine = Boolean(entry && entry.owner.id === user?.id)
  const [downloadOpen, setDownloadOpen] = useState(false)
  const [tagInput, setTagInput] = useState('')
  const [tagPending, setTagPending] = useState(false)

  if (error) {
    return error instanceof ApiError && error.status === 404 ? (
      <NotFoundState title="表情包不存在" description="它可能已被删除，或尚未公开。" />
    ) : (
      <div className="mx-auto max-w-lg px-4 py-24">
        <ErrorState onRetry={() => mutate()} />
      </div>
    )
  }
  if (!meme || openingEntry) return <PageLoading />

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
          <div className="flex aspect-square items-center justify-center overflow-hidden rounded-2xl border bg-card p-6 md:aspect-auto md:min-h-[28rem] md:p-10">
            <MemeMedia meme={meme} controls className="max-h-[70vh]" />
          </div>

          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <h1 className="text-pretty text-2xl font-semibold tracking-tight wrap-anywhere">{entry?.name ?? memeTitle(meme)}</h1>
                {entry && meme.title && <p className="text-sm text-muted-foreground">{meme.title}</p>}
              </div>
              {meme.summary && <p className="text-sm leading-relaxed text-pretty">{meme.summary}</p>}
              {meme.status !== 'success' && (
                <div className="flex flex-wrap items-center gap-2">
                  <ProcessBadge status={meme.status} />
                  {meme.status === 'failed' && (
                    <>
                      <span className="text-sm break-all text-muted-foreground">{meme.fail_reason ?? '识别失败'}</span>
                      {(meme.entry || user?.role === 'admin') && (
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

            {entry && <EntrySource entry={entry} mine={mine} />}

            <div className="grid grid-cols-2 gap-2">
              <FavoriteButton kind="meme" id={meme.id} active={meme.is_favorite} count={meme.favorite_count} showCount className="h-11 md:h-9" />
              <Button variant="outline" className="h-11 md:h-9" onClick={() => setDownloadOpen(true)}>
                <Download data-icon="inline-start" />
                下载
              </Button>
              <Button variant="outline" className="col-span-2 h-11 md:h-9" onClick={() => shareMeme(meme)}>
                <Share2 data-icon="inline-start" />
                分享
              </Button>
            </div>
            <AddToLibraryButton meme={entry && mine ? { ...meme, entry: { id: entry.id, folder_id: entry.parent_id } } : meme} className="[&>button]:h-11 [&>button]:flex-1 md:[&>button]:h-9" />

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
              {user && (
                <form onSubmit={addTag} className="flex gap-2">
                  <Input value={tagInput} onChange={(e) => setTagInput(e.target.value)} placeholder="添加我的标签" aria-label="添加我的标签" maxLength={20} className="h-10 text-base md:h-9 md:text-sm" />
                  <Button type="submit" variant="secondary" disabled={!tagInput.trim() || tagPending} className="h-10 md:h-9">
                    {tagPending ? <Loader2 className="animate-spin" /> : <Plus data-icon="inline-start" />}
                    添加
                  </Button>
                </form>
              )}
            </section>

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

      {related && related.length > 0 && (
        <section className="flex flex-col gap-4" aria-labelledby="related-heading">
          <h2 id="related-heading" className="text-lg font-semibold">
            相似表情包
          </h2>
          <MemeGrid memes={related} allowAdd />
        </section>
      )}

      {downloadOpen && <DownloadDialog meme={meme} open onOpenChange={setDownloadOpen} />}
    </div>
  )
}
