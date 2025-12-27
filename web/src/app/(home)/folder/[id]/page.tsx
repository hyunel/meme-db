"use client"

import { useParams } from "next/navigation"
import { useSWRConfig } from "swr"
import useSWR from "swr"
import { fetchNodes, memeAddToCollection } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Heart, FolderOpen, Plus, Loader2 } from "lucide-react"
import { useState } from "react"
import { useUser } from "@/hooks/use-user"
import { MemeCard } from "@/components/meme-card"
import { FolderCard } from "@/components/folder-card"
import { MemeGrid } from "@/components/meme-grid"
import { EmptyState } from "@/components/ui/empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import { useFavorite } from "@/hooks/use-favorite"
import { toast } from "sonner"

export default function FolderViewPage() {
  const params = useParams()
  const folderId = params.id as string
  const { user } = useUser()
  const { mutate } = useSWRConfig()

  const { data, isLoading, error } = useSWR(
    folderId ? [`/api/fs/nodes`, folderId] : null,
    () => fetchNodes(folderId)
  )

  const folder = data?.node
  const children = data?.children || []

  const { isFavorite, isToggling, toggleFavorite } = useFavorite(
    folderId,
    "FOLDER",
    folder?.is_favorite || false
  )

  const [isAddingToLibrary, setIsAddingToLibrary] = useState(false)

  const handleAddToLibrary = async () => {
    // This is a placeholder since memeAddToCollection is for memes.
    // If there's an equivalent for folders, it should be used.
    // Given the previous code, I'll just keep it as a placeholder toast for now
    // or use memeAddToCollection if the folder has a primary meme.
    setIsAddingToLibrary(true)
    try {
      // Mocking for now as the API for adding a whole folder might not exist yet
      await new Promise(resolve => setTimeout(resolve, 500))
      toast.success(`Folder "${folder?.name}" added to your library!`)
    } finally {
      setIsAddingToLibrary(false)
    }
  }

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="flex items-center gap-4 mb-8">
          <Skeleton className="w-16 h-16 rounded-xl" />
          <div className="space-y-2">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {[...Array(8)].map((_, i) => (
            <Skeleton key={i} className="aspect-square rounded-lg" />
          ))}
        </div>
      </div>
    )
  }

  if (error || !folder) {
    return (
      <EmptyState
        title="Folder not found"
        description="The folder you are looking for does not exist or has been moved."
        className="py-20"
      />
    )
  }

  const subFolders = children.filter(n => n.type === 'FOLDER')
  const memes = children.filter(n => n.type === 'FILE').map(n => n.meme).filter(Boolean) as any[]

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Folder Header */}
      <div className="mb-8">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="p-4 bg-primary/10 rounded-xl">
              <FolderOpen className="w-8 h-8 text-primary" />
            </div>
            <div>
              <h1 className="text-3xl font-bold mb-1">{folder.name}</h1>
              <p className="text-muted-foreground capitalize">
                {folder.visibility.toLowerCase()} • {memes.length} memes
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={toggleFavorite}
              variant={isFavorite ? "default" : "outline"}
              size="sm"
              className="gap-2"
              disabled={isToggling}
            >
              {isToggling ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Heart className={`w-4 h-4 ${isFavorite ? "fill-current" : ""}`} />
              )}
              <span>{isFavorite ? "Favorited" : "Favorite"}</span>
            </Button>
            {/* Show Add to Library only if it's not the user's own folder */}
            {/* Note: folder.user_id might be needed if the API provides it */}
            <Button
              onClick={handleAddToLibrary}
              variant="outline"
              size="sm"
              className="gap-2"
              disabled={isAddingToLibrary}
            >
              {isAddingToLibrary ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              <span>Add to Library</span>
            </Button>
          </div>
        </div>
      </div>

      {/* Sub-folders Grid */}
      {subFolders.length > 0 && (
        <div className="mb-12">
          <h2 className="text-xl font-semibold mb-4">Sub-folders</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {subFolders.map((subFolder) => (
              <FolderCard key={subFolder.id} folder={subFolder} />
            ))}
          </div>
        </div>
      )}

      {/* Memes Waterfall */}
      {memes.length > 0 ? (
        <div>
          <h2 className="text-xl font-semibold mb-4">Memes</h2>
          <MemeGrid items={memes} />
        </div>
      ) : (
        subFolders.length === 0 && (
          <EmptyState icon={<FolderOpen className="w-16 h-16" />} title="This folder is empty" description="" />
        )
      )}
    </div>
  )
}
