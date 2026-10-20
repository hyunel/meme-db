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
import type { Messages } from '@/lib/i18n'
import { useMessages } from '@/lib/i18n/client'

const formats: DownloadFormat[] = ['original', 'png', 'jpg', 'gif']

type Setting = keyof ConvertOptions

const choices: Record<Exclude<Setting, 'quality'>, { values: number[]; text: (v: number, t: Messages) => string }> = {
  fps: { values: [10, 15, 20, 25, 30], text: String },
  speed: { values: [0.5, 1, 2, 3, 5], text: (v) => `${v}×` },
  scale: { values: [1, 0.75, 0.5, 0.25], text: (v, t) => (v === 1 ? t.download.fullSize : `${v * 100}%`) },
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
  const t = useMessages()
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
      toast.success(format === 'original' ? t.download.started : t.download.converted(format.toUpperCase()))
      onOpenChange(false)
    } catch (err) {
      if (!ctrl.signal.aborted) toast.error(t.download.failed, { description: (err as Error).message })
    } finally {
      setProgress(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.download.title}</DialogTitle>
          <DialogDescription>{t.download.description}</DialogDescription>
        </DialogHeader>
        <div role="radiogroup" aria-label={t.download.format} className="grid grid-cols-2 gap-2">
          {formats.map((f) => (
            <button
              key={f}
              type="button"
              role="radio"
              aria-checked={format === f}
              disabled={busy}
              onClick={() => setFormat(f)}
              className={cn(
                'flex min-h-16 flex-col items-start justify-center gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors hover:bg-muted disabled:opacity-60',
                format === f && 'border-foreground bg-brand/30 hover:bg-brand/40',
              )}
            >
              <span className="text-sm font-medium">{t.download.formats[f].label}</span>
              <span className="text-xs text-muted-foreground">{t.download.formats[f].hint}</span>
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
                aria-label={t.download.advanced}
                onClick={() => setExpanded(!expanded)}
                className="absolute inset-0 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              />
              <span className="font-medium">{t.download.advanced}</span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {!expanded && changed.length > 0 && `· ${changed.map((s) => t.download.summaries[s](options[s])).join(' · ')}`}
              </span>
              {expanded && changed.length > 0 && (
                <Button variant="ghost" size="sm" className="relative text-muted-foreground" disabled={busy} onClick={() => setOptions(defaultOptions)}>
                  {t.download.reset}
                </Button>
              )}
              <ChevronDown className={cn('size-4 text-muted-foreground transition-transform', expanded && 'rotate-180')} aria-hidden />
            </div>
            {expanded && (
              <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 text-sm">
                {shown.map((s) => (
                  <Fragment key={s}>
                    <span className="text-muted-foreground">{t.download.settings[s]}</span>
                    <div className="flex min-w-0 items-center gap-3">
                      {s === 'quality' ? (
                        <>
                          <Slider aria-label={t.download.settings.quality} min={1} max={100} value={options.quality} disabled={busy} onValueChange={(v) => set({ quality: v })} />
                          <span className="w-7 shrink-0 text-right tabular-nums">{options.quality}</span>
                        </>
                      ) : (
                        <>
                          <div role="radiogroup" aria-label={t.download.settings[s]} className="flex rounded-lg border bg-card p-0.5">
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
                                {choices[s].text(v, t)}
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
            <span className="text-xs text-muted-foreground tabular-nums">{t.download.converting(progress)}</span>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t.common.cancel}
          </Button>
          <Button onClick={start} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Download data-icon="inline-start" />}
            {t.meme.download}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
