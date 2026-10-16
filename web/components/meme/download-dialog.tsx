'use client'

import { Fragment, useEffect, useRef, useState } from 'react'
import { ChevronDown, Download, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Progress } from '@/components/ui/progress'
import { Slider } from '@/components/ui/slider'
import { animationOf } from '@/lib/animated-image'
import { kindOf } from '@/lib/media'
import { defaultOptions, downloadConverted, downloadOriginal, type ConvertOptions, type DownloadFormat } from '@/lib/meme-transfer'
import type { Meme } from '@/lib/types'
import { cn } from '@/lib/utils'

const formats: { id: DownloadFormat; label: string; hint: string }[] = [
  { id: 'original', label: '原格式', hint: '保留原始画质与动画' },
  { id: 'png', label: 'PNG', hint: '静态图，支持透明' },
  { id: 'jpg', label: 'JPG', hint: '静态图，白色背景' },
  { id: 'gif', label: 'GIF', hint: '保留动画，兼容性最好' },
]

type Setting = keyof ConvertOptions

const choices: Record<Exclude<Setting, 'quality'>, { label: string; values: number[]; text: (v: number) => string }> = {
  fps: { label: '帧率', values: [10, 15, 20, 25, 30], text: String },
  speed: { label: '倍速', values: [0.5, 1, 2, 3, 5], text: (v) => `${v}×` },
  scale: { label: '尺寸', values: [1, 0.75, 0.5, 0.25], text: (v) => (v === 1 ? '原始' : `${v * 100}%`) },
}

// How each setting reads, in the folded row, once changed
const summaries: Record<Setting, (v: number) => string> = {
  quality: (v) => `质量 ${v}`,
  fps: (v) => `${v} 帧/秒`,
  speed: (v) => `${v}×`,
  scale: (v) => `尺寸 ${v * 100}%`,
}

// Frame rate and speed only for an animation turned GIF
const settingsOf = (format: DownloadFormat, animated: boolean): Setting[] =>
  format === 'original' ? [] : format === 'jpg' ? ['quality', 'scale'] : format === 'gif' && animated ? ['fps', 'speed', 'scale'] : ['scale']

export function DownloadDialog({ meme, open, onOpenChange }: { meme: Meme; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [format, setFormat] = useState<DownloadFormat>('original')
  const [options, setOptions] = useState(defaultOptions)
  const [expanded, setExpanded] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const busy = progress !== null
  const abort = useRef<AbortController>(null)
  useEffect(() => () => abort.current?.abort(), []) // Closing stops a conversion under way

  // Only its bytes tell whether a WebP or PNG moves
  const kind = kindOf(meme.mime_type)
  const [animated, setAnimated] = useState(kind !== 'image')
  useEffect(() => {
    if (kind !== 'image') return
    fetch(meme.url)
      .then((res) => res.blob())
      .then(animationOf)
      .then((a) => setAnimated(!!a), () => {})
  }, [kind, meme.url])

  const shown = settingsOf(format, animated)
  const changed = shown.filter((s) => options[s] !== defaultOptions[s])
  const set = (patch: Partial<ConvertOptions>) => setOptions((o) => ({ ...o, ...patch }))

  const start = async () => {
    if (busy) return
    const ctrl = (abort.current = new AbortController())
    setProgress(0)
    try {
      if (format === 'original') await downloadOriginal(meme)
      // Settings the format doesn't show apply as their defaults
      else await downloadConverted(meme, format, { ...defaultOptions, ...Object.fromEntries(shown.map((s) => [s, options[s]])) }, setProgress, ctrl.signal)
      toast.success(format === 'original' ? '已开始下载' : `已转换为 ${format.toUpperCase()} 并开始下载`)
      onOpenChange(false)
    } catch (err) {
      if (!ctrl.signal.aborted) toast.error('下载失败', { description: (err as Error).message })
    } finally {
      setProgress(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>下载表情包</DialogTitle>
          <DialogDescription>选择下载格式，转换在你的设备上完成。</DialogDescription>
        </DialogHeader>
        <div role="radiogroup" aria-label="下载格式" className="grid grid-cols-2 gap-2">
          {formats.map((f) => (
            <button
              key={f.id}
              type="button"
              role="radio"
              aria-checked={format === f.id}
              disabled={busy}
              onClick={() => setFormat(f.id)}
              className={cn(
                'flex min-h-16 flex-col items-start justify-center gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors hover:bg-muted disabled:opacity-60',
                format === f.id && 'border-foreground bg-brand/30 hover:bg-brand/40',
              )}
            >
              <span className="text-sm font-medium">{f.label}</span>
              <span className="text-xs text-muted-foreground">{f.hint}</span>
            </button>
          ))}
        </div>
        {shown.length > 0 && (
          <div className="flex flex-col gap-3">
            <div className="relative flex h-8 items-center gap-2 text-sm">
              {/* Covers the row, under the reset button, so the whole row toggles */}
              <button
                type="button"
                aria-expanded={expanded}
                aria-label="高级选项"
                onClick={() => setExpanded(!expanded)}
                className="absolute inset-0 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              />
              <span className="font-medium">高级选项</span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {!expanded && changed.length > 0 && `· ${changed.map((s) => summaries[s](options[s])).join(' · ')}`}
              </span>
              {expanded && changed.length > 0 && (
                <Button variant="ghost" size="sm" className="relative text-muted-foreground" disabled={busy} onClick={() => setOptions(defaultOptions)}>
                  恢复默认
                </Button>
              )}
              <ChevronDown className={cn('size-4 text-muted-foreground transition-transform', expanded && 'rotate-180')} aria-hidden />
            </div>
            {expanded && (
              <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 text-sm">
                {shown.map((s) => (
                  <Fragment key={s}>
                    <span className="text-muted-foreground">{s === 'quality' ? '质量' : choices[s].label}</span>
                    <div className="flex min-w-0 items-center gap-3">
                      {s === 'quality' ? (
                        <>
                          <Slider aria-label="质量" min={1} max={100} value={options.quality} disabled={busy} onValueChange={(v) => set({ quality: v })} />
                          <span className="w-7 shrink-0 text-right tabular-nums">{options.quality}</span>
                        </>
                      ) : (
                        <>
                          <div role="radiogroup" aria-label={choices[s].label} className="flex rounded-lg border bg-card p-0.5">
                            {choices[s].values.map((v) => (
                              <button
                                key={v}
                                type="button"
                                role="radio"
                                aria-checked={options[s] === v}
                                disabled={busy}
                                onClick={() => set({ [s]: v })}
                                className={cn(
                                  'h-7 rounded-md px-2.5 tabular-nums whitespace-nowrap transition-colors disabled:opacity-60',
                                  options[s] === v ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground',
                                )}
                              >
                                {choices[s].text(v)}
                              </button>
                            ))}
                          </div>
                          {s === 'scale' && meme.width > 0 && (
                            <span className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
                              {Math.round(meme.width * options.scale)} × {Math.round(meme.height * options.scale)}
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  </Fragment>
                ))}
              </div>
            )}
          </div>
        )}
        {busy && format !== 'original' && (
          <div className="flex flex-col gap-1.5" aria-live="polite">
            <Progress value={progress} />
            <span className="text-xs text-muted-foreground tabular-nums">正在转换… {progress}%</span>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={start} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Download data-icon="inline-start" />}
            下载
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
