'use client'

import { useCallback, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import useSWR from 'swr'
import { Loader2, ScanSearch } from 'lucide-react'
import { EmptyState, ErrorState } from '@/components/states'
import { TabSwitch } from '@/components/tab-switch'
import { AdminPageHeader } from '../admin-ui'
import { QueryPanel } from './query-panel'
import { CandidateSheet } from './candidate-sheet'
import { ChannelColumns, FinalRanking, Overview, TrackBanner } from './results'
import { putImageQuery, type ImageQuery } from '@/lib/image-query'
import { explainTrack, runSearchDebug, type DebugScope, type TopK } from '@/lib/search-debug'
import { useMessages } from '@/lib/i18n/client'

export function AdminSearchDebug() {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const q = params.get('q') ?? ''
  const scope: DebugScope = params.get('scope') === 'public' ? 'public' : 'all'
  const track = params.get('track')

  const [image, setImage] = useState<ImageQuery | null>(null)
  const [topK, setTopK] = useState<TopK>({})
  const [tab, setTab] = useState<'final' | 'channels'>('final')
  const [selected, setSelected] = useState<string | null>(null)
  const t = useMessages()
  const d = t.searchDebug

  const setParams = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString())
    Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)))
    const qs = next.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }

  // Runs are keyed by their inputs, so switching back to an earlier one is instant.
  const { data: result, error, isLoading, mutate } = useSWR(
    image || q ? ['search-debug', q, image?.id, scope, JSON.stringify(topK), track] : null,
    () => runSearchDebug({ q, image: image?.file ?? null, scope, topK, track }),
    { revalidateIfStale: false, keepPreviousData: true },
  )
  const verdict = result && track ? explainTrack(result) : null
  const open = useCallback((id: string) => setSelected(id), [])

  return (
    <>
      <AdminPageHeader title={t.titles.searchDebug} description={d.description} />

      <QueryPanel
        key={q}
        initialQ={q}
        scope={scope}
        onScopeChange={(v) => setParams({ scope: v === 'public' ? 'public' : null })}
        topK={topK}
        onTopKChange={setTopK}
        image={image}
        onSubmitText={(text) => {
          setImage(null)
          if (text === q && !image) void mutate()
          else setParams({ q: text || null })
        }}
        onImage={(file) => {
          setImage(putImageQuery(file, t))
          setParams({ q: null })
        }}
        onClearImage={() => setImage(null)}
        track={track}
        onClearTrack={() => setParams({ track: null })}
      />

      {error && !isLoading ? (
        <ErrorState title={d.failed} description={(error as Error).message} onRetry={() => mutate()} />
      ) : !result ? (
        <div className="rounded-xl border bg-card">
          {isLoading ? (
            <p className="flex h-40 items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              {d.searching}
            </p>
          ) : (
            <EmptyState
              icon={ScanSearch}
              title={track ? d.startTracking : d.start}
              description={d.startHint}
            />
          )}
        </div>
      ) : (
        <>
          {verdict && track && <TrackBanner verdict={verdict} memeId={track} onOpen={() => open(track)} />}
          <Overview result={result} />
          <section aria-label={d.results} aria-busy={isLoading} className="flex flex-col gap-3">
            <TabSwitch
              fill
              label={d.resultView}
              value={tab}
              onChange={setTab}
              tabs={[
                ['final', d.finalTab(result.final.length)],
                ['channels', result.mode === 'image' ? d.imageRecallTab : d.channelsTab(result.channels.length)],
              ]}
            />
            {tab === 'final' ? <FinalRanking result={result} track={track} onOpen={open} /> : <ChannelColumns result={result} track={track} onOpen={open} />}
          </section>
          <CandidateSheet result={result} memeId={selected} onClose={() => setSelected(null)} />
        </>
      )}
    </>
  )
}
