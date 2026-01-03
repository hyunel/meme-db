"use client"

import { useState } from "react"
import Link from "next/link"
import { Heart, Loader2 } from "lucide-react"
import { type Node } from "@/lib/api"
import { FolderPreview, useFolderPreview } from "./folder-preview"
import { useFavorite } from "@/hooks/use-favorite"

interface FolderCardProps {
  folder: Node
  onFavorite?: (isFavorite: boolean) => void
}

export function FolderCard({ folder, onFavorite }: FolderCardProps) {
  const { isFavorite, isToggling, toggleFavorite } = useFavorite(
    folder.id,
    "FOLDER",
    folder.is_favorite || false
  )
  const { totalItems } = useFolderPreview(folder.id)

  const handleFavoriteToggle = async (e: React.MouseEvent) => {
    e.preventDefault()
    const next = await toggleFavorite()
    if (next !== undefined) {
      onFavorite?.(next)
    }
  }

  return (
    <Link href={`/folder/${folder.id}`}>
      <div className="bg-card border border-border rounded-xl overflow-hidden hover:shadow-xl transition-shadow group">
        <div className="aspect-square relative">
          <FolderPreview folderId={folder.id} iconClassName="w-16 h-16" />
        </div>

        {/* Folder Info */}
        <div className="p-4">
          <div className="flex items-start justify-between mb-2">
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold truncate">{folder.name}</h3>
              <p className="text-sm text-muted-foreground">{folder.visibility.toLowerCase()}</p>
            </div>
            <button
              onClick={handleFavoriteToggle}
              className="ml-2 disabled:opacity-50"
              disabled={isToggling}
            >
              {isToggling ? (
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              ) : (
                <Heart className={`w-5 h-5 ${isFavorite ? "fill-primary text-primary" : "text-muted-foreground"}`} />
              )}
            </button>
          </div>
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>{totalItems} items</span>
            <span>{new Date(folder.created_at).toLocaleDateString()}</span>
          </div>
        </div>
      </div>
    </Link>
  )
}
