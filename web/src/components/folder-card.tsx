"use client"

import { useState } from "react"
import Link from "next/link"
import { FolderOpen, Heart } from "lucide-react"
import { mockMemes, type Folder } from "@/lib/mock-data"

export function FolderCard({ folder }: { folder: Folder }) {
  const [isFavorite, setIsFavorite] = useState(folder.isFavorite || false)

  // Get preview memes for this folder
  const previewMemes = mockMemes.filter((m) => m.folderId === folder.id).slice(0, 4)

  return (
    <Link href={`/folder/${folder.id}`}>
      <div className="bg-card border border-border rounded-xl overflow-hidden hover:shadow-xl transition-shadow group">
        {/* Preview Grid */}
        {previewMemes.length > 0 ? (
          <div className="grid grid-cols-2 gap-1 aspect-square bg-muted">
            {previewMemes.map((meme, idx) => (
              <div key={meme.id} className="aspect-square">
                <img src={meme.url || "/placeholder.svg"} alt={meme.title} className="w-full h-full object-cover" />
              </div>
            ))}
            {previewMemes.length < 4 &&
              Array.from({ length: 4 - previewMemes.length }).map((_, idx) => (
                <div key={`empty-${idx}`} className="aspect-square bg-muted" />
              ))}
          </div>
        ) : (
          <div className="aspect-square bg-muted flex items-center justify-center">
            <FolderOpen className="w-16 h-16 text-muted-foreground/30" />
          </div>
        )}

        {/* Folder Info */}
        <div className="p-4">
          <div className="flex items-start justify-between mb-2">
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold truncate">{folder.name}</h3>
              <p className="text-sm text-muted-foreground">@{folder.username}</p>
            </div>
            <button
              onClick={(e) => {
                e.preventDefault()
                setIsFavorite(!isFavorite)
              }}
              className="ml-2"
            >
              <Heart className={`w-5 h-5 ${isFavorite ? "fill-primary text-primary" : "text-muted-foreground"}`} />
            </button>
          </div>
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>{folder.memeCount} memes</span>
            <span>{new Date(folder.createdAt).toLocaleDateString()}</span>
          </div>
        </div>
      </div>
    </Link>
  )
}
