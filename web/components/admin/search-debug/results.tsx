'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { CircleAlert, CircleCheck, Eye, Info, PanelRightOpen, SearchX } from 'lucide-react'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { EmptyState } from '@/components/states'
import { MemeMedia } from '@/components/meme/meme-media'
import { CopyId, DataList, FilterSelect, StatCard, sortRows, type Column, type SortState } from '../admin-ui'
import { ChannelCell, RerankScore, ScoreBar, fmt3 } from './score'
import { formatDuration } from '@/lib/format'
import { type DebugResult, type FinalRow, type TrackVerdict } from '@/lib/search-debug'
import { cn } from '@/lib/utils'
import { useMessages } from '@/lib/i18n/client'

const ms = (n: number) => (n < 1000 ? `${n} ms` : formatDuration(n))

export function Overview({ result }: { result: DebugResult }) {
  const { timings, channels } = result
  const image = result.mode === 'image'
  const t = useMessages()
  const d = t.searchDebug
  return (
    <section aria-label={t.titles.overview} className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={d.embed} value={ms(timings.embed)} hint={image ? d.embedImage : d.embedText} />
        <StatCard label={d.recall} value={ms(timings.recall)} hint={d.parallel(channels.length)} />
        <StatCard label={d.rerank} value={image ? '—' : ms(timings.rerank)} hint={image ? d.noRerank : d.candidates(result.final.length)} />
        <StatCard label={d.total} value={ms(timings.total)} />
      </div>
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-4">
        <dl className="flex flex-wrap gap-x-6 gap-y-3 text-sm">
          {channels.map((c) => (
            <div key={c.channel} className="flex flex-col gap-0.5">
              <dt className="text-xs text-muted-foreground">{d.hits(d.channels[c.channel])}</dt>
              <dd className="font-medium tabular-nums">
                {c.hits.length}
                <span className="font-normal text-muted-foreground"> / {c.topK}</span>
              </dd>
            </div>
          ))}
          <div className="flex flex-col gap-0.5">
            <dt className="text-xs text-muted-foreground">{d.merged}</dt>
            <dd className="font-medium tabular-nums">{result.final.length}</dd>
          </div>
        </dl>
        {!image && (
          <details className="group rounded-lg border bg-muted/30">
            <summary className="flex h-10 cursor-pointer list-none items-center gap-2 px-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
              <span className="text-muted-foreground transition-transform group-open:rotate-90" aria-hidden>
                ›
              </span>
              {d.prompt}
            </summary>
            <pre className="overflow-x-auto border-t px-3 py-2.5 font-mono text-xs leading-relaxed whitespace-pre-wrap">{result.prompt}</pre>
          </details>
        )}
      </div>
    </section>
  )
}

export function TrackBanner({ verdict, memeId, onOpen }: { verdict: TrackVerdict; memeId: string; onOpen: () => void }) {
  const t = useMessages()
  const d = t.searchDebug
  if (verdict.kind === 'ranked') {
    return (
      <Banner tone="ok" title={d.trackedRank(verdict.rank)} memeId={memeId} onOpen={onOpen}>
        {d.highlighted}
      </Banner>
    )
  }
  if (verdict.kind === 'unknown') {
    return <Banner tone="warn" title={d.trackedMissing} memeId={memeId}>{d.trackedMissingHint}</Banner>
  }
  if (verdict.kind === 'out_of_scope') {
    return (
      <Banner tone="warn" title={d.outOfScope} memeId={memeId} onOpen={onOpen}>
        {d.outOfScopeReasons[verdict.reason]}
      </Banner>
    )
  }
  return (
    <Banner tone="warn" title={d.notRecalled} memeId={memeId} onOpen={onOpen}>
      <span>{d.notRecalledHint}</span>
      <ul className="mt-2 grid gap-2 sm:grid-cols-2">
        {verdict.channels.map((c) => (
          <li key={c.channel} className="flex flex-col gap-1 rounded-lg border bg-background/70 px-3 py-2">
            <span className="text-xs font-medium text-foreground">{d.channels[c.channel]}</span>
            <ScoreBar value={c.similarity} />
            <span className="text-xs">
              {c.rank === null ? (
                d.noMatch
              ) : (
                <>
                  {d.rankedBefore}
                  <b className="font-medium text-foreground tabular-nums">{c.rank}</b>
                  {d.rankedAfter(c.topK)}
                </>
              )}
              {c.cutoff !== null && d.cutoff(fmt3(c.cutoff))}
            </span>
          </li>
        ))}
      </ul>
    </Banner>
  )
}

function Banner({ tone, title, memeId, onOpen, children }: { tone: 'ok' | 'warn'; title: string; memeId: string; onOpen?: () => void; children: React.ReactNode }) {
  const Icon = tone === 'ok' ? CircleCheck : CircleAlert
  const t = useMessages()
  return (
    <section
      aria-live="polite"
      className={cn('flex gap-3 rounded-xl border p-4', tone === 'ok' ? 'border-success/40 bg-success/10' : 'border-warning/50 bg-warning/10')}
    >
      <Icon className={cn('mt-0.5 size-5 shrink-0', tone === 'ok' ? 'text-success' : 'text-warning-strong')} aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-x-2">
          <h2 className="font-medium">{title}</h2>
          <CopyId value={memeId} className="text-muted-foreground" />
        </div>
        <div className="text-sm text-muted-foreground">{children}</div>
      </div>
      {onOpen && (
        <button type="button" onClick={onOpen} className="-m-1 flex size-10 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground" aria-label={t.searchDebug.viewCandidate}>
          <PanelRightOpen className="size-4" />
        </button>
      )}
    </section>
  )
}

export function FinalRanking({ result, track, onOpen }: { result: DebugResult; track: string | null; onOpen: (id: string) => void }) {
  const image = result.mode === 'image'
  const [sort, setSort] = useState<SortState>({ key: 'rank', dir: 'asc' })
  const t = useMessages()
  const d = t.searchDebug

  const columns = useMemo<Column<FinalRow>[]>(() => {
    const cols: Column<FinalRow>[] = [
      { key: 'rank', header: d.rankHeader, mobile: 'hidden', className: 'w-14', sortValue: (r) => r.rank, cell: (r) => <span className="font-mono tabular-nums">{r.rank}</span> },
      {
        key: 'meme',
        header: t.content.meme,
        mobile: 'title',
        cell: (r) => {
          const meme = result.memes.get(r.memeId)!
          return (
            <div className="flex min-w-0 items-center gap-3">
              <span className="w-7 shrink-0 font-mono text-sm text-muted-foreground tabular-nums md:hidden">#{r.rank}</span>
              <button type="button" onClick={() => onOpen(r.memeId)} className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted/50 transition hover:ring-2 hover:ring-foreground/30" aria-label={d.viewCandidateOf(r.memeId)}>
                <MemeMedia meme={meme} />
              </button>
              <div className="flex min-w-0 flex-col">
                <CopyId value={r.memeId} />
                {track === r.memeId && <span className="text-xs font-medium">{d.tracking}</span>}
              </div>
            </div>
          )
        },
      },
      {
        key: 'score',
        header: image ? d.similarity : d.rerankScore,
        sortValue: (r) => r.finalScore,
        cell: (r) => (image ? <ScoreBar value={r.finalScore} /> : <RerankScore value={r.rerankScore} />),
      },
      { key: 'best', header: d.bestChannel, sortValue: (r) => d.channels[r.bestChannel], cell: (r) => <span className="text-sm whitespace-nowrap">{d.channels[r.bestChannel]}</span> },
    ]
    if (!image) {
      result.channels.forEach((c) =>
        cols.push({
          key: c.channel,
          header: d.channels[c.channel],
          sortValue: (r) => r.perChannel[c.channel]?.similarity ?? null,
          cell: (r) => <ChannelCell hit={r.perChannel[c.channel]} />,
        }),
      )
    }
    return cols
  }, [result, track, image, onOpen, t, d])

  const rows = useMemo(() => sortRows(result.final, columns, sort), [result.final, columns, sort])
  const sortOptions = columns.filter((c) => c.sortValue).map((c) => [c.key, c.header] as const)

  return (
    <div className="flex flex-col gap-3">
      {image && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Info className="size-4 shrink-0" aria-hidden />
          {d.imageNoRerank}
        </p>
      )}
      <div className="flex gap-2 md:hidden">
        <FilterSelect value={sort.key} onChange={(key) => setSort({ key, dir: key === 'rank' ? 'asc' : 'desc' })} options={sortOptions} label={t.library.sortBy} className="flex-1" />
        <FilterSelect
          value={sort.dir}
          onChange={(dir) => setSort({ ...sort, dir })}
          options={[
            ['desc', d.desc],
            ['asc', d.asc],
          ]}
          label={d.direction}
        />
      </div>
      <DataList
        rows={rows}
        columns={columns}
        getId={(r) => r.memeId}
        rowLabel={(r) => r.memeId}
        sort={sort}
        onSortChange={(next) => setSort(next.key === 'rank' && sort.key !== 'rank' ? { key: 'rank', dir: 'asc' } : next)}
        rowClassName={(r) => (r.memeId === track ? 'bg-brand/25 hover:bg-brand/30 md:shadow-[inset_3px_0_0_var(--foreground)] border-foreground/40' : undefined)}
        empty={<EmptyState icon={SearchX} title={d.noResults} description={d.noResultsHint} />}
        actions={(r) => (
          <>
            <DropdownMenuItem onClick={() => onOpen(r.memeId)}>
              <PanelRightOpen />
              {d.candidate}
            </DropdownMenuItem>
            <DropdownMenuItem render={<Link href={`/m/${r.memeId}`} />}>
              <Eye />
              {d.memeDetails}
            </DropdownMenuItem>
          </>
        )}
      />
    </div>
  )
}

export function ChannelColumns({ result, track, onOpen }: { result: DebugResult; track: string | null; onOpen: (id: string) => void }) {
  const [hovered, setHovered] = useState<string | null>(null)
  const single = result.channels.length === 1
  const t = useMessages()
  const d = t.searchDebug

  return (
    <div
      className={cn(
        single ? 'flex flex-col' : '-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:px-6 lg:mx-0 lg:grid lg:grid-cols-4 lg:overflow-visible lg:px-0 lg:pb-0',
      )}
      onPointerLeave={() => setHovered(null)}
    >
      {!single && <p className="sr-only">{d.swipe}</p>}
      {result.channels.map((c) => (
        <section
          key={c.channel}
          aria-label={d.channelRecall(d.channels[c.channel])}
          className={cn('flex min-w-0 flex-col rounded-xl border bg-card', !single && 'w-[85%] shrink-0 snap-start sm:w-[46%] lg:w-auto')}
        >
          <header className="flex items-baseline justify-between gap-2 border-b px-3 py-2.5">
            <div className="flex min-w-0 flex-col">
              <h3 className="text-sm font-medium">{d.channels[c.channel]}</h3>
              <span className="truncate text-xs text-muted-foreground">{d.channelHints[c.channel]}</span>
            </div>
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
              {c.hits.length} / {c.topK}
            </span>
          </header>
          {c.hits.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">{d.noHits}</p>
          ) : (
            <ol className={cn('flex flex-col p-1.5', single && 'grid gap-0.5 sm:grid-cols-2 xl:grid-cols-3')}>
              {c.hits.map((h) => {
                const meme = result.memes.get(h.memeId)!
                const active = hovered === h.memeId
                const tracked = track === h.memeId
                return (
                  <li key={h.memeId}>
                    <button
                      type="button"
                      onClick={() => onOpen(h.memeId)}
                      onPointerEnter={(e) => e.pointerType === 'mouse' && setHovered(h.memeId)}
                      onFocus={() => setHovered(h.memeId)}
                      onBlur={() => setHovered(null)}
                      aria-label={d.hitLabel(h.rank, h.memeId, fmt3(h.similarity))}
                      className={cn(
                        'flex min-h-12 w-full items-center gap-2.5 rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-muted',
                        active && 'bg-brand/35 hover:bg-brand/35',
                        tracked && 'ring-2 ring-foreground ring-inset',
                      )}
                    >
                      <span className="w-6 shrink-0 text-right font-mono text-xs text-muted-foreground tabular-nums">{h.rank}</span>
                      <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted/50">
                        <MemeMedia meme={meme} />
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="truncate font-mono text-xs">{h.memeId}</span>
                        <ScoreBar value={h.similarity} />
                      </span>
                    </button>
                  </li>
                )
              })}
            </ol>
          )}
        </section>
      ))}
    </div>
  )
}
