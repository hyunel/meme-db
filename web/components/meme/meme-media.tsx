'use client'

import { useCallback, useEffect, useRef } from 'react'
import { kindOf, memeAlt } from '@/lib/media'
import { LottiePlayer } from './lottie-player'
import type { MemeThumb } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useMessages } from '@/lib/i18n/client'
import { useIntersection } from '@/hooks/use-intersection'

// As large as fits in the box, up to its own size, with the checkerboard behind the meme alone; size-full fills a box of its ratio.
// Hidden until reveal marks it loaded (or failed, to show the broken image), then faded in.
const fitted = 'max-h-full max-w-full bg-checker object-contain opacity-0 transition-opacity duration-200 data-loaded:opacity-100 motion-reduce:transition-none'

// Marks the element itself, which React leaves alone, so revealing costs no render.
const reveal = (e: React.SyntheticEvent<HTMLElement>) => {
  e.currentTarget.dataset.loaded = ''
}

// An image the browser already holds, as on coming back to a page, shows at once rather than fading in again.
const revealHeld = (el: HTMLImageElement | null) => {
  if (el?.complete) el.dataset.loaded = ''
}

function AutoVideo({ src, className, controls, label }: { src: string; className?: string; controls: boolean; label: string }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    // React drops media events from before it mounts, which a video the browser holds, as on coming back to a page, may already have fired.
    if (el.readyState >= el.HAVE_METADATA || el.error) el.dataset.loaded = ''
    if (controls) return
    return () => el.pause()
  }, [src, controls])
  // Set before playing: a source set after play() reloads the video paused.
  const load = useCallback((el: HTMLVideoElement) => {
    if (!el.hasAttribute('src')) el.src = src
  }, [src])
  useIntersection(controls ? null : ref, useCallback((entry) => {
    if (!entry.isIntersecting) return
    const el = entry.target as HTMLVideoElement
    load(el)
    return () => {
      if (!el.hasAttribute('src')) return
      el.removeAttribute('src')
      el.load() // Frees its decoder and connection, which a video keeps until collected otherwise
      delete el.dataset.loaded // Fades in again once it comes back
    }
  }, [load]), { rootMargin: '100% 0px' })
  useIntersection(controls ? null : ref, useCallback((entry) => {
    const el = entry.target as HTMLVideoElement
    if (entry.isIntersecting) {
      load(el)
      el.play().catch(() => {})
    } else el.pause()
  }, [load]), { threshold: 0.25 })
  return (
    <video
      ref={ref}
      src={controls ? src : undefined}
      className={cn(fitted, className)}
      onLoadedMetadata={reveal}
      onError={reveal}
      muted
      loop
      playsInline
      preload="metadata"
      autoPlay={controls}
      controls={controls}
      aria-label={label}
    />
  )
}

export function MemeMedia({
  meme,
  className,
  controls = false,
}: {
  meme: MemeThumb & { title?: string }
  className?: string
  controls?: boolean
}) {
  const kind = kindOf(meme.mime_type)
  const alt = memeAlt(meme, useMessages())
  if (kind === 'video') {
    return <AutoVideo src={meme.url} className={className} controls={controls} label={alt} />
  }
  if (kind === 'lottie') {
    return <LottiePlayer url={meme.url} mime={meme.mime_type} label={alt} className={className} />
  }
  return (
    <img src={meme.url} alt={alt} loading="lazy" decoding="async" className={cn(fitted, className)} ref={revealHeld} onLoad={reveal} onError={reveal} />
  )
}
