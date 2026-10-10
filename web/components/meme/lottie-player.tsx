'use client'

import { useEffect, useRef, useState } from 'react'
import type { AnimationItem } from 'lottie-web'
import { Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Fetches a Lottie animation: JSON, or gzip-compressed JSON (Telegram .tgs stickers). */
async function fetchAnimation(url: string, mime: string, signal: AbortSignal) {
  const res = await fetch(url, { signal })
  if (!res.ok || !res.body) throw new Error(`failed to fetch ${url}`)
  const body = mime.includes('gzip') ? res.body.pipeThrough(new DecompressionStream('gzip')) : res.body
  return new Response(body).json()
}

/** Plays a Lottie animation while it is on screen; it is only fetched once scrolled into view. */
export function LottiePlayer({ url, mime, label, className }: { url: string; mime: string; label: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ctrl = new AbortController()
    let anim: AnimationItem | undefined
    let visible = false
    let started = false

    const start = async () => {
      started = true
      try {
        const [data, { default: lottie }] = await Promise.all([fetchAnimation(url, mime, ctrl.signal), import('lottie-web/build/player/lottie_light')])
        if (ctrl.signal.aborted) return
        anim = lottie.loadAnimation({ container: el, renderer: 'svg', loop: true, autoplay: visible, animationData: data })
      } catch {
        if (!ctrl.signal.aborted) setFailed(true) // e.g. a zipped .lottie file, which lottie-web cannot read
      }
    }

    const io = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting
        if (anim) {
          if (visible) anim.play()
          else anim.pause()
        } else if (visible && !started) {
          void start()
        }
      },
      { threshold: 0.1 },
    )
    io.observe(el)
    return () => {
      ctrl.abort()
      io.disconnect()
      anim?.destroy()
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
  return <div ref={ref} className={cn('size-full', className)} role="img" aria-label={label} />
}
