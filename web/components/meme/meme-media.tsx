'use client'

import { useEffect, useRef } from 'react'
import { kindOf, memeAlt } from '@/lib/media'
import { LottiePlayer } from './lottie-player'
import type { MemeThumb } from '@/lib/types'
import { cn } from '@/lib/utils'

// As large as fits in the box, up to its own size, with the checkerboard behind the meme alone; size-full fills a box of its ratio.
// Hidden until reveal marks it loaded (or failed, to show the broken image), then faded in.
const fitted = 'max-h-full max-w-full bg-checker object-contain opacity-0 transition-opacity duration-200 data-loaded:opacity-100 motion-reduce:transition-none'

// Marks the element itself, which React leaves alone, so revealing costs no render.
const reveal = (e: React.SyntheticEvent<HTMLElement>) => {
  e.currentTarget.dataset.loaded = ''
}

function AutoVideo({ src, className, controls, label }: { src: string; className?: string; controls: boolean; label: string }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || controls) return
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) el.play().catch(() => {})
        else el.pause()
      },
      { threshold: 0.25 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [controls])
  return (
    <video
      ref={ref}
      src={src}
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
  const alt = memeAlt(meme)
  if (kind === 'video') {
    return <AutoVideo src={meme.url} className={className} controls={controls} label={alt} />
  }
  if (kind === 'lottie') {
    return <LottiePlayer url={meme.url} mime={meme.mime_type} label={alt} className={className} />
  }
  return (
    <img src={meme.url} alt={alt} loading="lazy" decoding="async" className={cn(fitted, className)} onLoad={reveal} onError={reveal} />
  )
}
