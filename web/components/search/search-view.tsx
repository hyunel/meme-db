'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import useSWR from 'swr'
import { Clock, Folder as FolderIcon, Globe, ImageIcon, Info, Library, Loader2, MessageCircle, RotateCcw, ScanText, Search, SearchX, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useRequireLogin } from '@/components/app-providers'
import { MemeFeed } from '@/components/meme/meme-feed'
import { MemeMedia } from '@/components/meme/meme-media'
import { useFeed } from '@/hooks/use-feed'
import { useImageInput } from '@/hooks/use-image-input'
import { ErrorState, EmptyState, MemeGridSkeleton } from '@/components/states'
import { ApiError, api, qs } from '@/lib/api'
import { getImageQuery, putImageQuery, type ImageQuery } from '@/lib/image-query'
import { clearRecentSearches, pushRecentSearch, removeRecentSearch, useRecentSearches } from '@/lib/recent-searches'
import { useSession } from '@/lib/session'
import type { FolderPage, SearchFeed } from '@/lib/types'
import { cn } from '@/lib/utils'

type Scope = 'all' | 'mine'

// One example of each way to search, which runs in the scope chosen.
const EXAMPLES = [
  { icon: MessageCircle, title: '描述情境或情绪', query: '被夸了有点害羞' },
  { icon: ScanText, title: '搜图中的文字', query: '收到' },
] as const

async function search(q: string, scope: Scope, folderId: string | null, share: string | null, image: ImageQuery | null, cursor: string | null, page: number) {
  if (cursor) {
    try {
      return await api<SearchFeed>(`/search${qs({ cursor })}`)
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 404)) throw err // The search expired: run it again from this page
    }
  }
  const form = new FormData()
  form.set('q', q)
  form.set('scope', scope)
  if (folderId) form.set('folder_id', folderId)
  if (share) form.set('share', share)
  if (image) form.set('image', image.file)
  if (page) form.set('page', String(page))
  return api<SearchFeed>('/search', { method: 'POST', form })
}

export function SearchView() {
  const { user, ready } = useSession()
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const requireLogin = useRequireLogin()

  const q = params.get('q')?.trim() ?? ''
  const scope: Scope = params.get('scope') === 'mine' ? 'mine' : 'all'
  const folderId = params.get('folder') // A folder or collection to search within, whatever the scope
  const share = params.get('share') // The private link opening it
  const imageRef = params.get('img')
  const image = getImageQuery(imageRef)
  const imageLost = Boolean(imageRef && !image)
  const hasQuery = Boolean(q || image)
  const blocked = scope === 'mine' && !folderId && !user

  const [run, setRun] = useState(0) // Bumped to run the same search again
  // Searches are keyed by their parameters, so revisiting one is instant.
  const feed = useFeed(ready && hasQuery && !blocked ? ['search', q, scope, folderId, share, imageRef, run] : null, (cursor, page) =>
    search(q, scope, folderId, share, image, cursor, page),
  )
  const collections = (feed.first as SearchFeed | undefined)?.collections
  const { items: results, isLoading } = feed
  const error = results ? undefined : feed.error // A later page's error shows at the end of the feed
  const folderPage = useSWR<FolderPage>(folderId ? `/folders/${folderId}${qs({ share })}` : null)
  const recent = useRecentSearches()

  const [input, setInput] = useState(q)
  const [lastQ, setLastQ] = useState(q)
  if (lastQ !== q) {
    setLastQ(q)
    setInput(q)
  }

  // The page without a query is for typing one; results are left unfocused, so no keyboard covers them.
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!hasQuery) inputRef.current?.focus()
  }, [hasQuery])

  const folder = folderPage.data?.folder
  const own = Boolean(folder && folder.owner.id === user?.id)
  const within = folder ? `「${folder.name}」` : !folderId && scope === 'mine' ? '我的库' : null
  // Kept across renders, as typing a new query rerenders the page under the results.
  const memes = useMemo(() => results?.map((r) => r.meme), [results])
  const similarity = useMemo(() => (image && results ? new Map(results.map((r) => [r.meme.id, r.similarity])) : undefined), [image, results])

  const navigate = (next: { q?: string; scope?: Scope; folder?: string | null; img?: string | null }) => {
    const p = new URLSearchParams()
    const nq = next.q ?? q
    const ns = next.scope ?? scope
    const nf = next.folder === undefined ? folderId : next.folder
    const ni = next.img === undefined ? imageRef : next.img
    if (nq) p.set('q', nq)
    if (nf) {
      p.set('folder', nf)
      if (share) p.set('share', share)
    } else if (ns === 'mine') p.set('scope', 'mine')
    if (ni) p.set('img', ni)
    const qs = p.toString()
    router.push(qs ? `${pathname}?${qs}` : pathname)
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const v = input.trim()
    setInput(v)
    if (!v && !image) {
      toast.info('请输入关键词或添加图片')
      return
    }
    if (v) pushRecentSearch(v)
    if (v === q) setRun((r) => r + 1)
    else navigate({ q: v })
  }

  const imageInput = useImageInput((file) => navigate({ img: putImageQuery(file).id, q: input.trim() }))
  const dragging = imageInput.dragging

  const setScope = (next: Scope) => {
    if (next === scope && !folderId) return
    if (next === 'mine' && !requireLogin('登录后即可在你的私人库中搜索。')) return
    navigate({ scope: next, folder: null })
  }

  // Each collection by the meme of it found best, as a meme's page lists the places holding it.
  const related = collections?.length ? (
    <section aria-labelledby="related-collections" className="flex flex-col gap-2">
      <h2 id="related-collections" className="text-sm font-medium">
        {image ? '包含相似表情的合集' : '相关合集'}
      </h2>
      <div className="scroll-row -mx-4 px-4 sm:-mx-1 sm:px-1">
        <ul className="flex w-max gap-2 sm:w-auto sm:flex-wrap">
          {collections.map((f) => (
            <li key={f.id}>
              <Link
                href={f.owner.id === user?.id ? `/library?folder=${f.id}` : `/f/${f.id}`}
                className="flex items-center gap-2.5 rounded-xl border bg-card p-1.5 pr-3.5 transition-colors hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted/50" aria-hidden>
                  {f.previews[0] && <MemeMedia meme={f.previews[0]} />}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="max-w-44 truncate text-sm font-medium">{f.name}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">{f.item_count} 张</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  ) : null

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-6 sm:px-6 sm:py-8">
      <h1 className="sr-only">搜索表情包</h1>
      <form
        role="search"
        onSubmit={submit}
        {...imageInput.dropProps}
        className={cn(
          'flex flex-col gap-2 rounded-2xl border bg-card p-2 shadow-xs transition focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/20',
          dragging && 'border-dashed border-foreground bg-brand/20',
        )}
      >
        <div className="flex items-center gap-1">
          <Search className="ml-2 size-5 shrink-0 text-muted-foreground" aria-hidden />
          <label htmlFor="search-main" className="sr-only">
            关键词
          </label>
          <input
            ref={inputRef}
            id="search-main"
            type="search"
            enterKeyHint="search"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPaste={imageInput.onPaste}
            autoComplete="off"
            placeholder={dragging ? '松开以添加图片' : within ? `在${within}中搜索…` : '关键词，或粘贴/拖入图片'}
            className="h-11 min-w-0 flex-1 bg-transparent px-2 text-base outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
          />
          <input {...imageInput.inputProps} />
          <Button type="button" variant="ghost" size="icon-lg" onClick={imageInput.open} aria-label={image ? '替换图片' : '添加图片'}>
            <ImageIcon />
          </Button>
          <Button type="submit" size="lg" className="h-10 px-4 sm:px-5" disabled={isLoading}>
            {isLoading ? <Loader2 className="animate-spin" /> : null}
            <span className="hidden sm:inline">搜索</span>
            <Search className="sm:hidden" aria-hidden />
            <span className="sr-only sm:hidden">搜索</span>
          </Button>
        </div>
        {(image || imageLost) && (
          <div className="flex items-center gap-3 rounded-xl bg-muted/60 p-2">
            {image ? (
              <img src={image.url} alt="用于搜索的图片" className="size-12 rounded-lg border bg-card object-contain" />
            ) : (
              <div className="flex size-12 items-center justify-center rounded-lg border bg-card">
                <ImageIcon className="size-5 text-muted-foreground" aria-hidden />
              </div>
            )}
            <div className="min-w-0 flex-1 text-sm">
              <p className="truncate font-medium">{image ? image.name : '图片已失效'}</p>
              <p className="text-xs text-muted-foreground">{image ? '按图片相似度搜索' : '刷新页面后需要重新添加图片'}</p>
            </div>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="移除图片" onClick={() => navigate({ img: null })}>
              <X />
            </Button>
          </div>
        )}
      </form>

      <div className="flex flex-wrap items-center gap-2">
        <div role="radiogroup" aria-label="搜索范围" className="inline-flex rounded-lg border bg-card p-0.5">
          {(
            [
              { id: 'all', label: '全站', icon: Globe },
              { id: 'mine', label: '我的库', icon: Library },
            ] as const
          ).map((o) => (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={!folderId && scope === o.id}
              onClick={() => setScope(o.id)}
              className={cn(
                'flex h-9 items-center gap-1.5 rounded-md px-3 text-sm transition-colors',
                !folderId && scope === o.id ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <o.icon className="size-4" aria-hidden />
              {o.label}
              {o.id === 'mine' && !user && <span className="text-xs opacity-70">（需登录）</span>}
            </button>
          ))}
        </div>
        {folderId && (
          <span className="inline-flex h-9 items-center gap-1.5 rounded-lg border bg-brand/30 pr-1 pl-3 text-sm">
            <FolderIcon className="size-4" aria-hidden />
            <span className="max-w-56 truncate">
              限定：
              {folder ? `${own ? '我的库' : `@${folder.owner.username}`} / ${folder.name}` : folderPage.error ? '合集不可用' : '…'}
            </span>
            <button
              type="button"
              aria-label="移除文件夹范围"
              onClick={() => navigate({ folder: null })}
              className="flex size-7 items-center justify-center rounded-md hover:bg-background/60"
            >
              <X className="size-4" />
            </button>
          </span>
        )}
        {(hasQuery || input) && (
          <Button
            variant="ghost"
            className="ml-auto"
            onClick={() => {
              setInput('')
              inputRef.current?.focus()
              navigate({ q: '', img: null })
            }}
          >
            <RotateCcw data-icon="inline-start" />
            新搜索
          </Button>
        )}
      </div>

      <section aria-live="polite" aria-busy={isLoading}>
        {!hasQuery ? (
          <div className="flex flex-col gap-8">
            {recent.length > 0 && (
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <h2 className="flex items-center gap-2 text-sm font-medium">
                    <Clock className="size-4 text-muted-foreground" aria-hidden />
                    最近搜索
                  </h2>
                  <Button variant="ghost" size="sm" onClick={clearRecentSearches}>
                    清空
                  </Button>
                </div>
                <ul className="flex flex-wrap gap-2">
                  {recent.map((r) => (
                    <li key={r} className="flex items-center rounded-full border bg-card">
                      <button type="button" onClick={() => navigate({ q: r })} className="h-9 pr-1 pl-3.5 text-sm">
                        {r}
                      </button>
                      <button
                        type="button"
                        onClick={() => removeRecentSearch(r)}
                        aria-label={`删除最近搜索：${r}`}
                        className="flex size-9 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
                      >
                        <X className="size-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex flex-col gap-3">
              <h2 className="text-sm font-medium">{within ? `在${within}中，试试这样搜` : '试试这样搜'}</h2>
              <ul className="grid gap-2 sm:grid-cols-3">
                {[
                  ...EXAMPLES.map(({ icon, title, query }) => ({ icon, title, hint: `“${query}”`, onClick: () => navigate({ q: query }) })),
                  { icon: ImageIcon, title: '以图搜图', hint: '粘贴、拖入或选择一张图片', onClick: imageInput.open },
                ].map(({ icon: Icon, title, hint, onClick }) => (
                  <li key={title}>
                    <button
                      type="button"
                      onClick={onClick}
                      className="flex w-full items-center gap-3 rounded-xl border bg-card p-3 text-left transition hover:border-foreground/30 hover:shadow-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                    >
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand/30" aria-hidden>
                        <Icon className="size-5" />
                      </span>
                      <span className="flex min-w-0 flex-col">
                        <span className="text-sm font-medium">{title}</span>
                        <span className="truncate text-sm text-muted-foreground">{hint}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : blocked && ready ? (
          <EmptyState
            icon={Library}
            title="登录后才可搜索我的库"
            description="你也可以切换到全站范围继续搜索。"
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="outline" onClick={() => navigate({ scope: 'all', folder: null })}>
                  切换到全站
                </Button>
                <Button nativeButton={false} render={<Link href={`/login?redirect=${encodeURIComponent(`${pathname}?${params.toString()}`)}`} />}>
                  去登录
                </Button>
              </div>
            }
          />
        ) : error ? (
          <ErrorState title="搜索暂时不可用" description={error.message} onRetry={feed.retry} />
        ) : !memes ? (
          <div className="flex flex-col gap-4">
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              正在搜索…
            </p>
            <MemeGridSkeleton />
          </div>
        ) : memes.length > 0 ? (
          <div className="flex flex-col gap-4">
            {related}
            {(folderId ? own : scope === 'mine') && (
              <p className="flex items-start gap-2 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
                <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                新上传的表情包需处理完成后才能被搜到。
              </p>
            )}
            <MemeFeed memes={memes} feed={feed} share={share ?? undefined} similarity={similarity} allowAdd />
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {related}
            <EmptyState
              icon={SearchX}
              title="没有找到相关表情包"
              description="换个关键词试试，或调整搜索范围。"
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  {(scope === 'mine' || folderId) && (
                    <Button variant="outline" onClick={() => navigate({ scope: 'all', folder: null })}>
                      切换到全站
                    </Button>
                  )}
                  {image && (
                    <Button variant="outline" onClick={() => navigate({ img: null })}>
                      移除图片
                    </Button>
                  )}
                </div>
              }
            />
          </div>
        )}
      </section>
    </div>
  )
}
