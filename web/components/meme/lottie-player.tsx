'use client'

import { useCallback, useRef, useState } from 'react'
import type { DotLottieWorker } from '@lottiefiles/dotlottie-web'
import { Sparkles } from 'lucide-react'
import { fetchAnimation } from '@/lib/media'
import { useMessages } from '@/lib/i18n/client'
import { cn } from '@/lib/utils'
import { useIntersection } from '@/hooks/use-intersection'

// Served with the app rather than fetched from the player's CDN.
const wasmUrl = new URL('@lottiefiles/dotlottie-web/dotlottie-player.wasm', import.meta.url).href
const WORKERS = 4 // Players render off the main thread, spread over this many shared workers
let nextWorker = 0

export function LottiePlayer({ url, mime, label, className }: { url: string; mime: string; label: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [failed, setFailed] = useState(false)
  const t = useMessages()

  useIntersection(failed ? null : ref, useCallback((entry) => {
    if (!entry.isIntersecting) return
    const el = entry.target as HTMLDivElement
    const ctrl = new AbortController()
    let player: DotLottieWorker | undefined
    let canvas: HTMLCanvasElement | undefined

    const stop = () => {
      ctrl.abort()
      void player?.destroy()
      player = undefined
      canvas?.remove() // A canvas handed to a worker cannot be handed over again
      canvas = undefined
    }
    const start = async () => {
      try {
        const [data, { DotLottieWorker }] = await Promise.all([fetchAnimation(url, mime, ctrl.signal), import('@lottiefiles/dotlottie-web')])
        if (ctrl.signal.aborted) return
        DotLottieWorker.setWasmUrl(wasmUrl)
        canvas = document.createElement('canvas')
        canvas.className = 'size-full'
        el.append(canvas)
        // Pauses itself while offscreen and follows the box's size.
        player = new DotLottieWorker({ canvas, data, loop: true, autoplay: true, workerId: `lottie-${nextWorker++ % WORKERS}`, renderConfig: { autoResize: true } })
        player.addEventListener('loadError', () => {
          stop()
          setFailed(true)
        })
      } catch {
        if (!ctrl.signal.aborted) setFailed(true)
      }
    }

    void start()
    return stop
  }, [url, mime]), { rootMargin: '100% 0px' })

  if (failed) {
    return (
      <div className={cn('flex size-full flex-col items-center justify-center gap-2 text-muted-foreground', className)} role="img" aria-label={label}>
        <Sparkles className="size-8" aria-hidden />
        <span className="text-xs">{t.media.lottie}</span>
      </div>
    )
  }
  // The checkerboard shows through transparent areas, as behind other memes.
  return <div ref={ref} className={cn('size-full bg-checker', className)} role="img" aria-label={label} />
}
