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
import { DEFAULT_TOP_K, explainTrack, runSearchDebug, type DebugScope, type TopK } from '@/lib/search-debug'

export function AdminSearchDebug() {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const q = params.get('q') ?? ''
  const scope: DebugScope = params.get('scope') === 'public' ? 'public' : 'all'
  const track = params.get('track')

  const [image, setImage] = useState<ImageQuery | null>(null)
  const [topK, setTopK] = useState<TopK>(DEFAULT_TOP_K)
  const [tab, setTab] = useState<'final' | 'channels'>('final')
  const [selected, setSelected] = useState<string | null>(null)

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
      <AdminPageHeader title="检索调试" description="用与前台相同的查询复现一次搜索，查看各路召回、重排与每个候选的识别结果。调试请求不会写入最近搜索。" />

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
          setImage(putImageQuery(file))
          setParams({ q: null })
        }}
        onClearImage={() => setImage(null)}
        track={track}
        onClearTrack={() => setParams({ track: null })}
      />

      {error && !isLoading ? (
        <ErrorState title="检索失败" description={(error as Error).message} onRetry={() => mutate()} />
      ) : !result ? (
        <div className="rounded-xl border bg-card">
          {isLoading ? (
            <p className="flex h-40 items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              正在检索…
            </p>
          ) : (
            <EmptyState
              icon={ScanSearch}
              title={track ? '输入查询以追踪该表情包' : '输入查询开始调试'}
              description="支持关键词，或拖入、粘贴、选择一张图片进行以图搜图。"
            />
          )}
        </div>
      ) : (
        <>
          {verdict && track && <TrackBanner verdict={verdict} memeId={track} onOpen={() => open(track)} />}
          <Overview result={result} />
          <section aria-label="结果" aria-busy={isLoading} className="flex flex-col gap-3">
            <TabSwitch
              fill
              label="结果视图"
              value={tab}
              onChange={setTab}
              tabs={[
                ['final', `最终排名 · ${result.final.length}`],
                ['channels', result.mode === 'image' ? '召回 · CLIP 图像' : `各路召回 · ${result.channels.length}`],
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
