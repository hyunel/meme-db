'use client'

import { useEffect, useRef } from 'react'
import { kindOf, memeAlt } from '@/lib/media'
import { LottiePlayer } from './lottie-player'
import type { MemeThumb } from '@/lib/types'
import { cn } from '@/lib/utils'

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
      className={cn('size-full object-contain', className)}
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
  meme: MemeThumb & { keywords?: string[] }
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
    <img src={meme.url} alt={alt} loading="lazy" decoding="async" className={cn('size-full object-contain', className)} />
  )
}
