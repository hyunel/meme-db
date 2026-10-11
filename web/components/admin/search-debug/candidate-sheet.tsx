'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Check, Copy, Eye, Images, ListChecks } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { MemeMedia } from '@/components/meme/meme-media'
import { CopyId } from '../admin-ui'
import { RerankScore, ScoreBar } from './score'
import { RERANK_PARSE_FAILED, channelLabel, channelRank, type DebugResult } from '@/lib/search-debug'
import { cn } from '@/lib/utils'

export function CandidateSheet({ result, memeId, onClose }: { result: DebugResult; memeId: string | null; onClose: () => void }) {
  return (
    <Sheet open={memeId !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-xl">
        {memeId && <Body result={result} memeId={memeId} />}
      </SheetContent>
    </Sheet>
  )
}

function Body({ result, memeId }: { result: DebugResult; memeId: string }) {
  const meme = result.memes.get(memeId)
  if (!meme) {
    return (
      <SheetHeader className="border-b p-4 pr-12">
        <SheetTitle>候选详情</SheetTitle>
        <SheetDescription>找不到该表情包。</SheetDescription>
      </SheetHeader>
    )
  }
  const caption = result.captions[memeId]
  const vlm = caption?.vlm
  const row = result.final.find((r) => r.memeId === memeId)
  const json = JSON.stringify(caption?.raw ?? null, null, 2)

  return (
    <>
      <SheetHeader className="gap-1 border-b p-4 pr-12">
        <SheetTitle>候选详情</SheetTitle>
        <SheetDescription render={<div />}>
          <CopyId value={memeId} />
        </SheetDescription>
      </SheetHeader>

      <div className="flex flex-1 flex-col gap-6 overflow-y-auto overscroll-contain p-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
        <div className="flex flex-col gap-4 sm:flex-row">
          <div className="aspect-square w-full shrink-0 overflow-hidden rounded-xl border bg-checker sm:w-48">
            <MemeMedia meme={meme} controls />
          </div>
          <dl className="grid flex-1 grid-cols-2 content-start gap-3 text-sm sm:grid-cols-1">
            <Stat label="最终名次" value={row ? `第 ${row.rank} 名` : '未进入候选'} />
            <Stat
              label={result.mode === 'image' ? '最终分数（相似度）' : '重排分数'}
              value={row ? result.mode === 'image' ? <ScoreBar value={row.finalScore} /> : <RerankScore value={row.rerankScore} /> : '—'}
            />
          </dl>
        </div>

        <Section title="各路分数">
          <ul className="divide-y rounded-lg border">
            {result.channels.map((ch) => {
              const h = channelRank(result, ch, memeId)
              const hit = h?.rank != null && h.rank <= ch.topK
              return (
                <li key={ch.channel} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <span className="text-sm">{channelLabel[ch.channel]}</span>
                  {h ? (
                    <span className="flex items-center gap-3">
                      <ScoreBar value={h.similarity} />
                      <span className={cn('w-24 text-right text-xs tabular-nums', hit ? 'font-medium' : 'text-muted-foreground')}>
                        {h.rank === null ? '未匹配' : `第 ${h.rank} 名${hit ? '' : `（> ${ch.topK}）`}`}
                      </span>
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">未进入前 {ch.topK} 名</span>
                  )}
                </li>
              )
            })}
          </ul>
        </Section>

        <Section title="VLM Caption">
          {!caption ? (
            <p className="text-sm text-muted-foreground">暂无识别结果。</p>
          ) : !vlm ? (
            <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-sm">识别结果无法解析，未参与重排（记为 {RERANK_PARSE_FAILED}），原文见下方原始 JSON。</p>
          ) : (
            <dl className="grid gap-3 text-sm">
              <Field label="OCR 文本">{vlm.ocr_text || <Muted />}</Field>
              <Field label="画面描述">{vlm.description || <Muted />}</Field>
              <Field label="含义">{vlm.meaning || <Muted />}</Field>
              <Field label="搜索词">
                <Chips items={vlm.queries} />
              </Field>
              <Field label="标题">{vlm.title || <Muted />}</Field>
              <Field label="说明">{vlm.summary || <Muted />}</Field>
              <Field label="标签">
                <Chips items={vlm.tags} />
              </Field>
            </dl>
          )}
        </Section>

        {vlm && (
          <Section title="派生文本">
            <div className="flex flex-col gap-3">
              <Labeled label="Metaphor 文本">
                <Pre>{caption.metaphor_text || '（空）'}</Pre>
              </Labeled>
              <Labeled label="Semantic 文本（用于向量化）">
                <Pre>{caption.semantic_text || '（空）'}</Pre>
              </Labeled>
              <Labeled label="重排文档原文">
                <Pre>{caption.rerank_doc || '（空）'}</Pre>
              </Labeled>
            </div>
          </Section>
        )}

        {caption && (
          <Section title="原始 JSON" action={<CopyButton text={json} />}>
            <Pre className="max-h-72 overflow-auto">{json}</Pre>
          </Section>
        )}

        <nav aria-label="跳转" className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Button variant="outline" className="h-10" render={<Link href={`/m/${memeId}`} />}>
            <Eye />
            表情详情
          </Button>
          <Button variant="outline" className="h-10" render={<Link href={`/admin/content?q=${encodeURIComponent(memeId)}`} />}>
            <Images />
            内容管理
          </Button>
          <Button variant="outline" className="h-10" render={<Link href={`/admin/tasks?view=history&meme=${encodeURIComponent(memeId)}`} />}>
            <ListChecks />
            相关任务
          </Button>
        </nav>
      </div>
    </>
  )
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex h-8 items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[6rem_1fr] sm:gap-3">
      <dt className="text-xs text-muted-foreground sm:pt-0.5">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  )
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  )
}

function Chips({ items }: { items: string[] | null }) {
  if (!items?.length) return <Muted />
  return (
    <span className="flex flex-wrap gap-1">
      {items.map((t, i) => (
        <span key={`${t}-${i}`} className="rounded-md bg-muted px-1.5 py-0.5 text-xs">
          {t}
        </span>
      ))}
    </span>
  )
}

const Muted = () => <span className="text-muted-foreground">（空）</span>

function Pre({ children, className }: { children: React.ReactNode; className?: string }) {
  return <pre className={cn('rounded-lg border bg-muted/40 px-3 py-2.5 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap', className)}>{children}</pre>
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false)
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-8"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setDone(true)
          setTimeout(() => setDone(false), 1500)
        } catch {
          toast.error('复制失败')
        }
      }}
    >
      {done ? <Check /> : <Copy />}
      {done ? '已复制' : '复制'}
    </Button>
  )
}
