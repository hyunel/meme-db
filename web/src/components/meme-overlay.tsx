"use client"

import type React from "react"
import Link from "next/link"
import { useState } from "react"
import { Heart, MoreVertical, Loader2, Share2 } from "lucide-react"
import { type Meme } from "@/lib/api"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { shareMeme, downloadMeme, DOWNLOAD_FORMATS, type DownloadFormat } from "@/lib/meme"
import { useFavorite } from "@/hooks/use-favorite"

interface MemeOverlayProps {
  meme?: Meme
  targetId?: string
  targetType?: "MEME" | "FOLDER"
  isFavorite?: boolean
  onFavorite?: (isFavorite: boolean) => void
  onDownload?: (format: string) => void
  className?: string
  actionSectionClassName?: string
  showTags?: boolean
  showMore?: boolean
  bottomContent?: React.ReactNode
  persistent?: boolean
}

export function MemeOverlay({
  meme,
  targetId,
  targetType = "MEME",
  isFavorite: isFavoriteProp,
  onFavorite,
  onDownload,
  className,
  actionSectionClassName,
  showTags = true,
  showMore = true,
  bottomContent,
  persistent = false,
}: MemeOverlayProps) {
  const [open, setOpen] = useState(false)
  const effectiveId = targetId || meme?.asset_id
  const { isFavorite, isToggling, toggleFavorite } = useFavorite(
    effectiveId || "",
    targetType,
    isFavoriteProp ?? meme?.is_favorite ?? false
  )

  if (!effectiveId) return null

  const handleDownload = (format: DownloadFormat) => {
    if (onDownload) {
      onDownload(format)
    } else if (meme) {
      downloadMeme(meme, format)
    }
  }

  const handleShare = () => {
    if (meme) {
      shareMeme(meme)
    }
  }

  const handleFavoriteClick = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const next = await toggleFavorite()
    if (next !== undefined) {
      onFavorite?.(next)
    }
  }

  return (
    <div
      className={cn(
        "absolute inset-0 transition-opacity flex flex-col justify-end",
        persistent ? "opacity-100" : open ? "opacity-100" : "opacity-0 group-hover:opacity-100",
        className
      )}
    >
      {/* Background Gradient - Persistent if persistent prop is true, otherwise hover-only */}
      <div
        className={cn(
          "absolute inset-0 bg-linear-to-t from-black/80 via-transparent to-transparent transition-opacity",
          persistent ? "opacity-100" : "opacity-100"
        )}
      />

      {/* Content at bottom */}
      <div className="p-3 z-20" onClick={(e) => e.stopPropagation()}>
        {bottomContent}

        {/* Default Tags if no bottomContent and showTags is true */}
        {!bottomContent && showTags && meme && meme.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {meme.tags.slice(0, 3).map((tag) => {
              return (
                <Link
                  href={`/tag/${tag.id}`}
                  key={tag.id}
                  className="text-xs px-2 py-0.5 bg-white/20 backdrop-blur-sm rounded-full text-white hover:bg-white/30 transition-colors"
                >
                  {tag.name}
                </Link>
              )
            })}
          </div>
        )}
      </div>

      {/* Quick actions at top - Can be hover-only even if the overlay is persistent */}
      <div
        className={cn(
          "absolute top-2 right-2 flex gap-1 z-20 transition-opacity",
          persistent && !open ? "opacity-0 group-hover:opacity-100" : "opacity-100",
          actionSectionClassName
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={handleFavoriteClick}
          className="p-1.5 bg-black/50 backdrop-blur-sm rounded-sm hover:bg-black/70 transition-colors disabled:opacity-50"
          disabled={isToggling}
        >
          {isToggling ? (
            <Loader2 className="w-4 h-4 animate-spin text-white" />
          ) : (
            <Heart className={cn("w-4 h-4", isFavorite ? "fill-primary text-primary" : "text-white")} />
          )}
        </button>
        {showMore && (
          <DropdownMenu open={open} onOpenChange={setOpen}>
            <DropdownMenuTrigger asChild>
              <button className="p-1.5 bg-black/50 backdrop-blur-sm rounded-sm hover:bg-black/70 transition-colors">
                <MoreVertical className="w-4 h-4 text-white" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem onClick={handleShare}>
                <Share2 className="mr-2 h-4 w-4" />
                Share
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => handleDownload("original")}>Download Original</DropdownMenuItem>
              {DOWNLOAD_FORMATS.filter((fmt) => fmt !== "original").map((format) => (
                <DropdownMenuItem key={format} onClick={() => handleDownload(format)}>
                  Download as {format.toUpperCase()}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  )
}
