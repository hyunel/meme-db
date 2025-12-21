"use client"
import Link from "next/link"
import type React from "react"

import type { Meme } from "@/lib/api"
import { Heart, MoreVertical } from "lucide-react"
import { useState } from "react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

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
  isFavorite: isFavoriteProp,
  className,
  onFavorite,
  onDownload,
  ...props
}: MemeCardProps) {
  const [open, setOpen] = useState(false)

  const handleDownload = (format: string) => {
    onDownload?.(format)
  }

  const handleFavorite = () => {
    onFavorite?.()
  }

  return (
    <div
      className={`group cursor-pointer animate-fade-in relative ${fixedHeight ? "break-inside-avoid mb-3" : ""} ${className}`}
      style={{ animationDelay: `${index * 30}ms` }}
      {...props}
    >
      <div className="relative bg-card border border-border rounded-lg overflow-hidden hover:shadow-xl hover:border-primary/50 transition-all hover:-translate-y-0.5">
        <div className={`relative ${fixedHeight ? "aspect-square" : "aspect-auto"}`}>
          <img
            src={meme.url || "/placeholder.svg"}
            alt={meme.title}
            className={`w-full ${fixedHeight ? "h-full object-cover" : "h-auto object-cover"}`}
          />
          <Link href={`/meme/${meme.asset_id}`} className="absolute inset-0 z-10">
            <span className="sr-only">View {meme.title}</span>
          </Link>

          <div className={`absolute inset-0 bg-linear-to-t from-black/80 via-transparent to-transparent transition-opacity ${open ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
            {/* Tags at bottom */}
            <div className="absolute bottom-0 left-0 right-0 p-3 z-20">
              <div className="flex flex-wrap gap-1">
                {meme.tags.slice(0, 3).map((tag) => {
                  const tagName = typeof tag === "string" ? tag : tag.name
                  return (
                    <Link
                      href={`/tag/${tagName}`}
                      key={tagName}
                      className="text-xs px-2 py-0.5 bg-white/20 backdrop-blur-sm rounded-full text-white hover:bg-white/30 transition-colors"
                    >
                      {tagName}
                    </Link>
                  )
                })}
              </div>
            </div>

            {/* Quick actions at top */}
            <div className="absolute top-2 right-2 flex gap-1 z-20">
              <button
                onClick={handleFavorite}
                className="p-1.5 bg-black/50 backdrop-blur-sm rounded-sm hover:bg-black/70 transition-colors"
              >
                <Heart
                  className={`w-4 h-4 ${isFavoriteProp || meme.is_favorite ? "fill-primary text-primary" : "text-white"}`}
                />
              </button>
              <DropdownMenu open={open} onOpenChange={setOpen}>
                <DropdownMenuTrigger asChild>
                  <button className="p-1.5 bg-black/50 backdrop-blur-sm rounded-sm hover:bg-black/70 transition-colors">
                    <MoreVertical className="w-4 h-4 text-white" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="w-40"
                >
                  <DropdownMenuItem onClick={() => handleDownload("original")}>
                    Download Original
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleDownload("png")}>
                    Download PNG
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleDownload("jpg")}>
                    Download JPG
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleDownload("gif")}>
                    Download GIF
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
