import { RERANK_PARSE_FAILED, type ChannelHit } from '@/lib/search-debug'
import { cn } from '@/lib/utils'
import { useMessages } from '@/lib/i18n/client'

export const fmt3 = (n: number) => n.toFixed(3)

export function ScoreBar({ value, className }: { value: number; className?: string }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100)
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <span className="h-1.5 w-14 shrink-0 overflow-hidden rounded-full bg-muted" aria-hidden>
        <span className="block h-full rounded-full bg-foreground/80" style={{ width: `${pct}%` }} />
      </span>
      <span className="font-mono text-xs tabular-nums">{fmt3(value)}</span>
    </span>
  )
}

export function RerankScore({ value }: { value: number | null }) {
  const t = useMessages()
  if (value === null) return <span className="text-muted-foreground">—</span>
  if (value === RERANK_PARSE_FAILED)
    return <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-xs font-medium text-destructive">{t.searchDebug.parseFailed}</span>
  return <span className="font-mono text-sm font-medium tabular-nums">{fmt3(value)}</span>
}

export function ChannelCell({ hit }: { hit: ChannelHit | undefined }) {
  const t = useMessages()
  if (!hit) return <span className="text-muted-foreground">—</span>
  return (
    <span className="flex flex-col gap-0.5">
      <ScoreBar value={hit.similarity} />
      <span className="text-xs text-muted-foreground tabular-nums">{t.searchDebug.rank(hit.rank)}</span>
    </span>
  )
}
