'use client'

import { useEffect, useRef, useState } from 'react'
import type { DotLottieWorker } from '@lottiefiles/dotlottie-web'
import { Sparkles } from 'lucide-react'
import { fetchAnimation } from '@/lib/media'
import { cn } from '@/lib/utils'

// Served with the app rather than fetched from the player's CDN.
const wasmUrl = new URL('@lottiefiles/dotlottie-web/dotlottie-player.wasm', import.meta.url).href
const WORKERS = 4 // Players render off the main thread, spread over this many shared workers
let nextWorker = 0

export function LottiePlayer({ url, mime, label, className }: { url: string; mime: string; label: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    let ctrl: AbortController | undefined
    let player: DotLottieWorker | undefined
    let canvas: HTMLCanvasElement | undefined

    const stop = () => {
      ctrl?.abort()
      ctrl = undefined
      void player?.destroy()
      player = undefined
      canvas?.remove() // A canvas handed to a worker cannot be handed over again
      canvas = undefined
    }
    const start = async () => {
      const c = (ctrl = new AbortController())
      try {
        const [data, { DotLottieWorker }] = await Promise.all([fetchAnimation(url, mime, c.signal), import('@lottiefiles/dotlottie-web')])
        if (c.signal.aborted) return
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
        if (!c.signal.aborted) setFailed(true)
      }
    }

    // Players exist only within a screen of the viewport, so a long grid holds a few dozen however many memes it has.
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) stop()
        else if (!ctrl) void start()
      },
      { rootMargin: '100% 0px' },
    )
    io.observe(el)
    return () => {
      io.disconnect()
      stop()
    }
  }, [url, mime])

  if (failed) {
    return (
      <div className={cn('flex size-full flex-col items-center justify-center gap-2 text-muted-foreground', className)} role="img" aria-label={label}>
        <Sparkles className="size-8" aria-hidden />
        <span className="text-xs">Lottie 动画</span>
      </div>
    )
  }
  // The checkerboard shows through transparent areas, as behind other memes.
  return <div ref={ref} className={cn('size-full bg-checker', className)} role="img" aria-label={label} />
}
