"use client"
import Link from "next/link"
import type React from "react"

import { type Meme } from "@/lib/api"
import { MemeRenderer } from "./meme-renderer"
import { MemeOverlay } from "./meme-overlay"

interface MemeCardProps extends React.HTMLAttributes<HTMLDivElement> {
  meme: Meme
  fixedHeight?: boolean
  index?: number
  isFavorite?: boolean
  onFavorite?: () => void
  onDownload?: (format: string) => void
}

export function MemeCard({
  meme,
  fixedHeight = true,
  index = 0,
  isFavorite,
  className,
  onFavorite,
  onDownload,
  ...props
}: MemeCardProps) {
  return (
    <div
      className={`group cursor-pointer animate-fade-in relative ${fixedHeight ? "break-inside-avoid mb-3" : ""} ${className}`}
      style={{ animationDelay: `${index * 30}ms` }}
      {...props}
    >
      <div className="relative bg-card border border-border rounded-lg overflow-hidden hover:shadow-xl hover:border-primary/50 transition-all hover:-translate-y-0.5">
        <div className={`relative ${fixedHeight ? "aspect-square" : "aspect-auto"}`}>
          <MemeRenderer
            meme={meme}
            className={fixedHeight ? "h-full" : "h-auto"}
          />
          <Link href={`/meme/${meme.asset_id}`} className="absolute inset-0 z-10">
            <span className="sr-only">View Meme</span>
          </Link>

          <MemeOverlay
            meme={meme}
            isFavorite={isFavorite}
            onFavorite={onFavorite}
            onDownload={onDownload}
          />
        </div>
      </div>
    </div>
  )
}
