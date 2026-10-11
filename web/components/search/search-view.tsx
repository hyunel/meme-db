'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import useSWR from 'swr'
import { Clock, Folder as FolderIcon, Globe, ImageIcon, Info, Library, Loader2, RotateCcw, Search, SearchX, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useRequireLogin } from '@/components/app-providers'
import { MemeGrid } from '@/components/meme/meme-card'
import { useImageInput } from './use-image-input'
import { ErrorState, EmptyState, MemeGridSkeleton } from '@/components/states'
import { api } from '@/lib/api'
import { getImageQuery, putImageQuery, validateQueryImage, type ImageQuery } from '@/lib/image-query'
import { clearRecentSearches, pushRecentSearch, removeRecentSearch, useRecentSearches } from '@/lib/recent-searches'
import { useSession } from '@/lib/session'
import type { LibraryView, SearchResult } from '@/lib/types'
import { cn } from '@/lib/utils'

type Scope = 'public' | 'mine'

function search(q: string, scope: Scope, folderId: string | null, image: ImageQuery | null) {
  const form = new FormData()
  form.set('q', q)
  form.set('scope', scope)
  if (folderId) form.set('folder_id', folderId)
  if (image) form.set('image', image.file)
  return api<SearchResult[]>('/search', { method: 'POST', form })
}

export function SearchView() {
  const { user, ready } = useSession()
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const requireLogin = useRequireLogin()

  const q = params.get('q')?.trim() ?? ''
  const scope: Scope = params.get('scope') === 'mine' ? 'mine' : 'public'
  const folderId = scope === 'mine' ? params.get('folder') : null
  const imageRef = params.get('img')
  const image = getImageQuery(imageRef)
  const imageLost = Boolean(imageRef && !image)
  const hasQuery = Boolean(q || image)
  const blocked = scope === 'mine' && !user

  // Searches are keyed by their parameters (and the viewer), so revisiting one is instant.
  const {
    data: results,
    error,
    isLoading,
    mutate,
  } = useSWR(ready && hasQuery && !blocked ? ['search', q, scope, folderId, imageRef, user?.id] : null, () => search(q, scope, folderId, image), {
    revalidateIfStale: false,
  })
  const { data: folderView } = useSWR<LibraryView>(folderId && user ? `/library?folder_id=${folderId}` : null)
  const { data: hot } = useSWR<string[]>('/tags/hot?limit=10')
  const recent = useRecentSearches()

  const [input, setInput] = useState(q)
  const [lastQ, setLastQ] = useState(q)
  if (lastQ !== q) {
    setLastQ(q)
    setInput(q)
  }
  const fileRef = useRef<HTMLInputElement>(null)

  const folder = folderView?.folder
  const memes = results?.map((r) => r.meme)
  const similarity = image && results ? new Map(results.map((r) => [r.meme.id, r.similarity])) : undefined

  const navigate = (next: { q?: string; scope?: Scope; folder?: string | null; img?: string | null }) => {
    const p = new URLSearchParams()
    const nq = next.q ?? q
    const ns = next.scope ?? scope
    const nf = next.folder === undefined ? folderId : next.folder
    const ni = next.img === undefined ? imageRef : next.img
    if (nq) p.set('q', nq)
    if (ns === 'mine') p.set('scope', 'mine')
    if (ns === 'mine' && nf) p.set('folder', nf)
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
    if (v === q) void mutate()
    else navigate({ q: v })
  }

  const attach = (file: File | null | undefined) => {
    if (!file) return
    const err = validateQueryImage(file)
    if (err) {
      toast.error('图片无法使用', { description: err })
      return
    }
    const iq = putImageQuery(file)
    navigate({ img: iq.id, q: input.trim() })
  }
  const imageInput = useImageInput(attach)
  const dragging = imageInput.dragging


  const setScope = (next: Scope) => {
    if (next === scope) return
    if (next === 'mine' && !requireLogin('登录后即可在你的私人库中搜索。')) return
    navigate({ scope: next, folder: null })
  }

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
            id="search-main"
            type="search"
            enterKeyHint="search"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPaste={imageInput.onPaste}
            autoComplete="off"
            placeholder={dragging ? '松开以添加图片' : scope === 'mine' ? '在我的库中搜索…' : '关键词，或粘贴/拖入图片'}
            className="h-11 min-w-0 flex-1 bg-transparent px-2 text-base outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
          />
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(e) => {
              attach(e.target.files?.[0])
              e.target.value = ''
            }}
          />
          <Button type="button" variant="ghost" size="icon-lg" onClick={() => fileRef.current?.click()} aria-label={image ? '替换图片' : '添加图片'}>
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
              { id: 'public', label: '全站公开', icon: Globe },
              { id: 'mine', label: '我的库', icon: Library },
            ] as const
          ).map((o) => (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={scope === o.id}
              onClick={() => setScope(o.id)}
              className={cn(
                'flex h-9 items-center gap-1.5 rounded-md px-3 text-sm transition-colors',
                scope === o.id ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <o.icon className="size-4" aria-hidden />
              {o.label}
              {o.id === 'mine' && !user && <span className="text-xs opacity-70">（需登录）</span>}
            </button>
          ))}
        </div>
        {folder && (
          <span className="inline-flex h-9 items-center gap-1.5 rounded-lg border bg-brand/30 pr-1 pl-3 text-sm">
            <FolderIcon className="size-4" aria-hidden />
            <span className="max-w-40 truncate">限定：{folder.name}</span>
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
              router.push(scope === 'mine' ? `${pathname}?scope=mine` : pathname)
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
            {user && (
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <h2 className="flex items-center gap-2 text-sm font-medium">
                    <Clock className="size-4 text-muted-foreground" aria-hidden />
                    最近搜索
                  </h2>
                  {recent.length > 0 && (
                    <Button variant="ghost" size="sm" onClick={clearRecentSearches}>
                      清空
                    </Button>
                  )}
                </div>
                {recent.length ? (
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
                ) : (
                  <p className="text-sm text-muted-foreground">暂无最近搜索</p>
                )}
              </div>
            )}
            {hot && hot.length > 0 && (
            <div className="flex flex-col gap-3">
              <h2 className="text-sm font-medium">热门标签</h2>
              <ul className="flex flex-wrap gap-2">
                {hot.map((t) => (
                  <li key={t}>
                    <Link
                      href={`/tags/${encodeURIComponent(t)}`}
                      className="inline-flex h-9 items-center rounded-full bg-muted px-3.5 text-sm transition-colors hover:bg-brand hover:text-brand-foreground"
                    >
                      #{t}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
            )}
          </div>
        ) : blocked && ready ? (
          <EmptyState
            icon={Library}
            title="登录后才可搜索我的库"
            description="你也可以切换到全站公开范围继续搜索。"
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="outline" onClick={() => navigate({ scope: 'public', folder: null })}>
                  切换到全站公开
                </Button>
                <Button nativeButton={false} render={<Link href={`/login?redirect=${encodeURIComponent(`${pathname}?${params.toString()}`)}`} />}>
                  去登录
                </Button>
              </div>
            }
          />
        ) : error ? (
          <ErrorState title="搜索暂时不可用" description={(error as Error).message} onRetry={() => mutate()} />
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
            <p className="text-sm text-muted-foreground">
              找到 <span className="font-medium text-foreground tabular-nums">{memes.length}</span> 个结果，按相关度排序
            </p>
            {scope === 'mine' && (
              <p className="flex items-start gap-2 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
                <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                新上传的表情包需处理完成后才能被搜到。
              </p>
            )}
            <MemeGrid memes={memes} similarity={similarity} allowAdd />
          </div>
        ) : (
          <EmptyState
            icon={SearchX}
            title="没有找到相关表情包"
            description="换个关键词试试，或调整搜索范围。"
            action={
              <div className="flex flex-wrap justify-center gap-2">
                {scope === 'mine' && (
                  <Button variant="outline" onClick={() => navigate({ scope: 'public', folder: null })}>
                    切换到全站公开
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
        )}
      </section>
    </div>
  )
}
