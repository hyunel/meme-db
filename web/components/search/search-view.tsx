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
import { ApiError, api } from '@/lib/api'
import { getImageQuery, putImageQuery, type ImageQuery } from '@/lib/image-query'
import { clearRecentSearches, pushRecentSearch, removeRecentSearch, useRecentSearches } from '@/lib/recent-searches'
import { useSession } from '@/lib/session'
import type { FolderPage, SearchFeed } from '@/lib/types'
import { cn, qs } from '@/lib/utils'
import { useMessages } from '@/lib/i18n/client'

type Scope = 'all' | 'mine'

// One example of each way to search, which runs in the scope chosen.
const EXAMPLES = [
  { icon: MessageCircle, key: 'mood' },
  { icon: ScanText, key: 'text' },
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
  const t = useMessages()

  const q = params.get('q')?.trim() ?? ''
  const scope: Scope = params.get('scope') === 'mine' ? 'mine' : 'all'
  const folderId = params.get('folder') // A folder or collection to search within, whatever the scope
  const share = params.get('share') // The private link opening it
  const imageRef = params.get('img')
  const image = getImageQuery(imageRef)
  const hasQuery = Boolean(q || image)
  const blocked = scope === 'mine' && !folderId && !user

  const [run, setRun] = useState(0) // Bumped to run the same search again
  // Searches are keyed by their parameters, so revisiting one is instant.
  const feed = useFeed(ready && hasQuery && !blocked ? ['search', q, scope, folderId, share, image?.id ?? null, run] : null, (cursor, page) =>
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
  // Only with a mouse: a touch screen opens no keyboard for a focus outside a tap, and the focus alone would hide the tab bar.
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!hasQuery && matchMedia('(pointer: fine)').matches) inputRef.current?.focus()
  }, [hasQuery])

  // Query images last as long as the tab, so after a reload or in a copied link the reference is dropped.
  useEffect(() => {
    if (!imageRef || image) return
    const p = new URLSearchParams(params)
    p.delete('img')
    router.replace(p.size ? `${pathname}?${p}` : pathname)
  }, [imageRef, image, params, pathname, router])

  const folder = folderPage.data?.folder
  const own = Boolean(folder && folder.owner.id === user?.id)
  const within = folder ? t.search.quoted(folder.name) : !folderId && scope === 'mine' ? t.search.myLibrary : null
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
      toast.info(t.errors.empty_search)
      return
    }
    if (v) pushRecentSearch(v)
    if (v === q) setRun((r) => r + 1)
    else navigate({ q: v })
  }

  const imageInput = useImageInput((file) => navigate({ img: putImageQuery(file, t).id, q: input.trim() }))
  const dragging = imageInput.dragging

  const setScope = (next: Scope) => {
    if (next === scope && !folderId) return
    if (next === 'mine' && !requireLogin(t.search.minePrompt)) return
    navigate({ scope: next, folder: null })
  }

  // Each collection by the meme of it found best, as a meme's page lists the places holding it.
  const related = collections?.length ? (
    <section aria-labelledby="related-collections" className="flex flex-col gap-2">
      <h2 id="related-collections" className="text-sm font-medium">
        {image ? t.search.collectionsSimilar : t.search.collections}
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
                  <span className="text-xs text-muted-foreground tabular-nums">{t.search.count(f.item_count)}</span>
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
      <h1 className="sr-only">{t.search.title}</h1>
      <form
        role="search"
        onSubmit={submit}
        {...imageInput.dropProps}
        className={cn(
          'rounded-2xl border bg-card p-2 shadow-xs transition focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/20',
          dragging && 'border-dashed border-foreground bg-brand/20',
        )}
      >
        <div className="flex items-center gap-1">
          {image ? (
            // Into the form's padding, its corners concentric with the form's
            <button
              type="button"
              title={t.search.removeImage}
              onClick={() => navigate({ img: null })}
              className="group relative -my-1 -ml-1 size-13 shrink-0 overflow-hidden rounded-xl border bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              <img src={image.url} alt="" className="size-full object-contain" />
              <span
                className="absolute inset-0 flex items-center justify-center bg-foreground/50 text-background opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                aria-hidden
              >
                <X className="size-5" />
              </span>
            </button>
          ) : (
            <Search className="ml-2 size-5 shrink-0 text-muted-foreground" aria-hidden />
          )}
          <label htmlFor="search-main" className="sr-only">
            {t.search.keywords}
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
            placeholder={dragging ? t.search.dropToAdd : within ? t.search.searchIn(within) : image ? t.search.moreKeywords : t.search.placeholderMore}
            className="h-11 min-w-0 flex-1 bg-transparent px-2 text-base text-ellipsis outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
          />
          <input {...imageInput.inputProps} />
          <Button type="button" variant="ghost" size="icon-lg" onClick={imageInput.open} aria-label={image ? t.search.replaceImage : t.search.addImage}>
            <ImageIcon />
          </Button>
          <Button type="submit" size="lg" className="h-10 px-4 sm:px-5" disabled={isLoading}>
            {isLoading ? <Loader2 className="animate-spin" /> : null}
            <span className="hidden sm:inline">{t.search.submit}</span>
            <Search className="sm:hidden" aria-hidden />
            <span className="sr-only sm:hidden">{t.search.submit}</span>
          </Button>
        </div>
      </form>

      <div className="flex flex-wrap items-center gap-2">
        <div role="radiogroup" aria-label={t.search.scope} className="inline-flex rounded-lg border bg-card p-0.5">
          {(
            [
              { id: 'all', label: t.search.all, icon: Globe },
              { id: 'mine', label: t.titles.library, icon: Library },
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
            </button>
          ))}
        </div>
        {folderId && (
          <span className="inline-flex h-9 items-center gap-1.5 rounded-lg border bg-brand/30 pr-1 pl-3 text-sm">
            <FolderIcon className="size-4" aria-hidden />
            <span className="max-w-56 truncate">
              {t.search.limitedTo}
              {folder ? `${own ? t.titles.library : `@${folder.owner.username}`} / ${folder.name}` : folderPage.error ? t.search.unavailable : '…'}
            </span>
            <button
              type="button"
              aria-label={t.search.removeFolder}
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
            {t.search.new}
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
                    {t.home.recent}
                  </h2>
                  <Button variant="ghost" size="sm" onClick={clearRecentSearches}>
                    {t.search.clear}
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
                        aria-label={t.search.removeRecent(r)}
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
              <h2 className="text-sm font-medium">{within ? t.search.tryIn(within) : t.search.try}</h2>
              <ul className="grid gap-2 sm:grid-cols-3">
                {[
                  ...EXAMPLES.map(({ icon, key }) => {
                    const { title, query } = t.search.examples[key]
                    return { icon, title, hint: t.search.quoted(query), onClick: () => navigate({ q: query }) }
                  }),
                  { icon: ImageIcon, title: t.search.imageExample, hint: t.search.imageExampleHint, onClick: imageInput.open },
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
            title={t.errors.library_search_unauthenticated}
            description={t.search.blockedHint}
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="outline" onClick={() => navigate({ scope: 'all', folder: null })}>
                  {t.search.switchAll}
                </Button>
                <Button nativeButton={false} render={<Link href={`/login?redirect=${encodeURIComponent(`${pathname}?${params.toString()}`)}`} />}>
                  {t.login.go}
                </Button>
              </div>
            }
          />
        ) : error ? (
          <ErrorState title={t.search.failed} description={error.message} onRetry={feed.retry} />
        ) : !memes ? (
          <div className="flex flex-col gap-4">
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              {t.search.searching}
            </p>
            <MemeGridSkeleton />
          </div>
        ) : memes.length > 0 ? (
          <div className="flex flex-col gap-4">
            {related}
            {(folderId ? own : scope === 'mine') && (
              <p className="flex items-start gap-2 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
                <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                {t.search.pendingHint}
              </p>
            )}
            <MemeFeed memes={memes} feed={feed} share={share ?? undefined} similarity={similarity} allowAdd />
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {related}
            <EmptyState
              icon={SearchX}
              title={t.search.none}
              description={t.search.noneHint}
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  {(scope === 'mine' || folderId) && (
                    <Button variant="outline" onClick={() => navigate({ scope: 'all', folder: null })}>
                      {t.search.switchAll}
                    </Button>
                  )}
                  {image && (
                    <Button variant="outline" onClick={() => navigate({ img: null })}>
                      {t.search.removeImage}
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
