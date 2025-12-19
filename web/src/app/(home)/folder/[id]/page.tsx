"use client"

import { useParams } from "next/navigation"
import { mockFolders, mockMemes } from "@/lib/mock-data"
import { Button } from "@/components/ui/button"
import { Heart, FolderOpen, Plus } from "lucide-react"
import { useState } from "react"
import { useUser } from "@/hooks/use-user"
import { MemeCard } from "@/components/meme-card"
import { MemeGrid } from "@/components/meme-grid"
import { EmptyState } from "@/components/ui/empty-state"

export default function FolderViewPage() {
  const params = useParams()
  const folderId = params.id as string
  const { user } = useUser()

  const folder = mockFolders.find((f) => f.id === folderId)
  const folderMemes = mockMemes.filter((m) => m.folderId === folderId)

  const [isFavorite, setIsFavorite] = useState(folder?.isFavorite || false)
  const [isAddedToLibrary, setIsAddedToLibrary] = useState(false)

  const handleAddToLibrary = () => {
    setIsAddedToLibrary(true)
    alert(`Demo: Folder "${folder?.name}" added to your library!`)
  }

  if (!folder) {
    return (
      <EmptyState
        title="Folder not found"
        description="The folder you are looking for does not exist or has been moved."
        className="py-20"
      />
    )
  }

  return (
    <div className="container mx-auto px-4 py-8">
        {/* Folder Header - CHANGE: Keep folder title but remove descriptions */}
        <div className="mb-8">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div className="flex items-center gap-4">
              <div className="p-4 bg-primary/10 rounded-xl">
                <FolderOpen className="w-8 h-8 text-primary" />
              </div>
              <div>
                <h1 className="text-3xl font-bold mb-1">{folder.name}</h1>
                <p className="text-muted-foreground">
                  by @{folder.username} • {folder.memeCount} memes
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                onClick={() => setIsFavorite(!isFavorite)}
                variant={isFavorite ? "default" : "outline"}
                size="sm"
                className="gap-2"
              >
                <Heart className={`w-4 h-4 ${isFavorite ? "fill-current" : ""}`} />
                <span className="hidden sm:inline">{isFavorite ? "Favorited" : "Favorite"}</span>
              </Button>
              {user?.id !== folder.userId && (
                <Button
                  onClick={handleAddToLibrary}
                  variant={isAddedToLibrary ? "secondary" : "default"}
                  size="sm"
                  className="gap-2"
                  disabled={isAddedToLibrary}
                >
                  <Plus className="w-4 h-4" />
                  <span className="hidden sm:inline">{isAddedToLibrary ? "Added" : "Add to Library"}</span>
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* CHANGE: Use MemeCard component with fixed height */}
        {folderMemes.length > 0 ? (
          <MemeGrid>
            {folderMemes.map((meme, index) => (
              <MemeCard key={meme.id} meme={meme} fixedHeight={true} index={index} />
            ))}
          </MemeGrid>
        ) : (
          <EmptyState icon={<FolderOpen className="w-16 h-16" />} title="This folder is empty" description="" />
        )}
      </div>
  )
}
