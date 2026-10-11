import { api } from './api'
import type { Meme } from './types'

export type TextChannel = 'metaphor' | 'semantic' | 'clip_text' | 'ocr'
export type Channel = TextChannel | 'clip_image'
export type DebugScope = 'all' | 'public'
export type TopK = Record<Channel, number>

export const textChannels: TextChannel[] = ['metaphor', 'semantic', 'clip_text', 'ocr']
export const channelLabel: Record<Channel, string> = {
  metaphor: 'Metaphor',
  semantic: 'Semantic',
  clip_text: 'CLIP 文本',
  ocr: 'OCR',
  clip_image: 'CLIP 图像',
}
export const channelHint: Record<Channel, string> = {
  metaphor: '隐喻文本向量',
  semantic: '语义文本向量',
  clip_text: '查询文本 → 图像向量',
  ocr: 'OCR 文字模糊匹配',
  clip_image: '查询图像 → 图像向量',
}
// The server's defaults
export const DEFAULT_TOP_K: TopK = { metaphor: 15, semantic: 10, clip_text: 15, ocr: 10, clip_image: 50 }
// The rerank score of a candidate whose caption cannot be parsed
export const RERANK_PARSE_FAILED = -1

export interface Caption {
  raw: unknown
  vlm: {
    ocr_text: string
    description: string
    meaning: string
    queries: string[] | null
    title: string
    summary: string
    tags: string[] | null
  } | null
  metaphor_text: string
  semantic_text: string
  rerank_doc: string
}

interface DebugResponse {
  prompt: string
  timings: { embed: number; recall: number; rerank: number; total: number }
  channels: { channel: Channel; limit: number; hits: { id: string; similarity: number }[] }[]
  candidates: { id: string; score: number; rerank_score: number | null; best_channel: Channel }[]
  memes: Meme[]
  captions: Record<string, Caption>
  tracked: { id: string; excluded?: 'missing' | 'not_analyzed' | 'private'; channels: { channel: Channel; similarity: number; rank: number | null }[] } | null
}

export interface ChannelHit {
  memeId: string
  similarity: number
  rank: number
}

export interface ChannelResult {
  channel: Channel
  topK: number
  hits: ChannelHit[]
}

export interface FinalRow {
  memeId: string
  rank: number
  /** null without a text query (nothing is reranked); RERANK_PARSE_FAILED when the caption cannot be parsed */
  rerankScore: number | null
  finalScore: number
  bestChannel: Channel
  perChannel: Partial<Record<Channel, ChannelHit>>
}

export interface DebugResult {
  mode: 'text' | 'image'
  prompt: string
  timings: DebugResponse['timings']
  channels: ChannelResult[]
  /** Every merged candidate, reranked; search returns all of them */
  final: FinalRow[]
  memes: Map<string, Meme>
  captions: Record<string, Caption>
  tracked: DebugResponse['tracked']
}

export async function runSearchDebug(input: { q: string; image: File | null; scope: DebugScope; topK: TopK; track: string | null }): Promise<DebugResult> {
  const form = new FormData()
  if (input.image) form.set('image', input.image)
  else form.set('q', input.q)
  if (input.scope === 'public') form.set('scope', 'public')
  if (input.track) form.set('track', input.track)
  for (const [channel, k] of Object.entries(input.topK)) form.set(channel, String(k))

  const r = await api<DebugResponse>('/admin/search/debug', { method: 'POST', form })

  const channels = r.channels.map((c) => ({ channel: c.channel, topK: c.limit, hits: c.hits.map((h, i) => ({ memeId: h.id, similarity: h.similarity, rank: i + 1 })) }))
  const final = r.candidates.map((c, i) => ({
    memeId: c.id,
    rank: i + 1,
    rerankScore: c.rerank_score,
    finalScore: c.score,
    bestChannel: c.best_channel,
    perChannel: Object.fromEntries(channels.flatMap((ch) => ch.hits.filter((h) => h.memeId === c.id).map((h) => [ch.channel, h]))),
  }))

  return { mode: input.image ? 'image' : 'text', prompt: r.prompt, timings: r.timings, channels, final, memes: new Map(r.memes.map((m) => [m.id, m])), captions: r.captions, tracked: r.tracked }
}

export type TrackVerdict =
  | { kind: 'unknown' }
  | { kind: 'out_of_scope'; reason: string }
  | { kind: 'ranked'; rank: number }
  | { kind: 'not_recalled'; channels: { channel: Channel; similarity: number; rank: number | null; topK: number; cutoff: number | null }[] }

export function explainTrack(r: DebugResult): TrackVerdict | null {
  const t = r.tracked
  if (!t) return null
  if (t.excluded === 'missing') return { kind: 'unknown' }
  if (t.excluded === 'not_analyzed') return { kind: 'out_of_scope', reason: r.memes.get(t.id)?.status === 'failed' ? '处理失败，未进入索引' : '尚未处理完成，未进入索引' }
  if (t.excluded === 'private') return { kind: 'out_of_scope', reason: '未公开，访客视角下不可检索' }

  const row = r.final.find((x) => x.memeId === t.id)
  if (row) return { kind: 'ranked', rank: row.rank }

  return {
    kind: 'not_recalled',
    channels: t.channels.map((c) => {
      const ch = r.channels.find((x) => x.channel === c.channel)!
      return { ...c, topK: ch.topK, cutoff: ch.hits.at(-1)?.similarity ?? null }
    }),
  }
}

/** A meme's similarity and rank in a channel: its hit there, or for the tracked meme its rank beyond the hits (null when unmatched). */
export function channelRank(r: DebugResult, channel: ChannelResult, memeId: string): { similarity: number; rank: number | null } | null {
  const hit = channel.hits.find((h) => h.memeId === memeId)
  if (hit) return hit

  const tracked = r.tracked?.id === memeId ? r.tracked.channels.find((c) => c.channel === channel.channel) : undefined
  return tracked ?? null
}
