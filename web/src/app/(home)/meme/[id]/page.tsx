"use client"

import { useState, useEffect } from "react"
import { useParams, useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { useUser } from "@/hooks/use-user"
import { Heart, Share2, Download, X, Plus, BookmarkPlus, Loader2, RefreshCcw } from "lucide-react"
import Link from "next/link"
import { Label } from "@/components/ui/label"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { MemeGrid } from "@/components/meme-grid"
import { EmptyState } from "@/components/ui/empty-state"
import useSWR, { mutate } from "swr"
import {
  memeGet,
  memeAdd,
  memeRetry,
  Meme,
  favoriteToggle,
  tagAddToMeme,
  tagRemoveFromMeme,
  Tag
} from "@/lib/api"
import { toast } from "sonner"
import { MemeRenderer } from "@/components/meme-renderer"
import { shareMeme, downloadMeme, DOWNLOAD_FORMATS, type DownloadFormat } from "@/lib/meme"

export default function MemeDetailsPage() {
  const params = useParams()
  const router = useRouter()
  const { user } = useUser()
  const memeId = params.id as string

  const { data: meme, error, isLoading } = useSWR(
    memeId ? ['/api/memes', memeId] : null,
    ([, id]) => memeGet(id),
    {
      refreshInterval: (data) =>
        data?.processing_status === "pending" || data?.processing_status === "processing" ? 3000 : 0,
    }
  )

  const recommendations: Meme[] = [];

  const [localFavorite, setLocalFavorite] = useState<boolean | null>(null)
  const [localTags, setLocalTags] = useState<Tag[] | null>(null)

  const [isTogglingFavorite, setIsTogglingFavorite] = useState(false)
  const [isAddingTag, setIsAddingTag] = useState(false)
  const [removingTagId, setRemovingTagId] = useState<string | null>(null)
  const [isAddingToLibrary, setIsAddingToLibrary] = useState(false)

  const [newTag, setNewTag] = useState("")
  const [isEditing, setIsEditing] = useState(false)
  const [isAddedToLibrary, setIsAddedToLibrary] = useState(false)
  const [isRetrying, setIsRetrying] = useState(false)

  const isFavorite = localFavorite ?? meme?.is_favorite ?? false
  const tags = localTags ?? meme?.tags ?? []

  useEffect(() => {
    setLocalFavorite(null)
    setLocalTags(null)
  }, [memeId])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    )
  }

  if (!meme || error) {
    return (
      <EmptyState
        title="Meme not found"
        description="The meme you are looking for does not exist."
        action={<Button onClick={() => router.back()}>Back</Button>}
      />
    )
  }

  const handleAddTag = async () => {
    if (!newTag.trim() || isAddingTag) return
    if (tags.some(t => t.name === newTag.trim())) return

    setIsAddingTag(true)
    try {
      const tag = await tagAddToMeme(meme.asset_id, newTag.trim())
      setLocalTags([...tags, tag])
      setNewTag("")
    } finally {
      setIsAddingTag(false)
    }
  }

  const handleRemoveTag = async (tagId: string) => {
    if (removingTagId) return
    setRemovingTagId(tagId)
    try {
      await tagRemoveFromMeme(meme.asset_id, tagId)
      setLocalTags(tags.filter((t) => t.id !== tagId))
    } finally {
      setRemovingTagId(null)
    }
  }

  const handleShare = () => {
    if (!meme) return
    shareMeme(meme)
  }

  const handleDownload = (format: DownloadFormat) => {
    if (!meme) return
    downloadMeme(meme, format)
  }

  const handleAddToLibrary = async () => {
    if (isAddingToLibrary) return
    setIsAddingToLibrary(true)
    try {
      await memeAdd(meme.asset_id)
      setIsAddedToLibrary(true)
      toast.success("Meme added to your library!")
      mutate(['/api/memes', memeId])
    } finally {
      setIsAddingToLibrary(false)
    }
  }

  const handleToggleFavorite = async () => {
    if (isTogglingFavorite) return
    setIsTogglingFavorite(true)
    const next = !isFavorite
    try {
      await favoriteToggle([{ id: meme.asset_id, type: "MEME", favorite: next }])
      setLocalFavorite(next)
    } finally {
      setIsTogglingFavorite(false)
    }
  }

  const handleRetry = async () => {
    if (isRetrying) return
    setIsRetrying(true)
    try {
      await memeRetry([meme.asset_id])
      toast.success("Retry request submitted")
      mutate(['/api/memes', memeId])
    } finally {
      setIsRetrying(false)
    }
  }

  return (
    <div className="container mx-auto px-4 py-6 md:py-8">
        <div className="max-w-6xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-6 md:gap-8">
            {/* Left Column - Meme Image */}
            <div className="space-y-4">
              <div className="bg-card border border-border rounded-xl overflow-hidden shadow-lg">
                <MemeRenderer meme={meme} className="w-full h-auto" />
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  onClick={handleToggleFavorite}
                  variant={isFavorite ? "default" : "outline"}
                  className="gap-2 flex-1"
                  disabled={isTogglingFavorite}
                >
                  {isTogglingFavorite ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Heart className={`w-4 h-4 ${isFavorite ? "fill-current" : ""}`} />
                  )}
                  <span className="hidden sm:inline">{isFavorite ? "Favorited" : "Favorite"}</span>
                </Button>

                {user && (
                  <Button
                    onClick={handleAddToLibrary}
                    variant={meme.in_library || isAddedToLibrary ? "secondary" : "default"}
                    className="gap-2 flex-1"
                    disabled={meme.in_library || isAddedToLibrary || isAddingToLibrary}
                  >
                    {isAddingToLibrary ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                        <BookmarkPlus className="w-4 h-4" />
                    )}
                    <span className="hidden sm:inline">{meme.in_library || isAddedToLibrary ? "Added" : "Add to Library"}</span>
                  </Button>
                )}

                <Button variant="outline" size="icon" onClick={handleShare}>
                  <Share2 className="w-4 h-4" />
                </Button>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="icon">
                      <Download className="w-4 h-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => handleDownload("original")}>
                      Original Format
                    </DropdownMenuItem>
                    {DOWNLOAD_FORMATS.filter((fmt) => fmt !== "original").map((format) => (
                      <DropdownMenuItem key={format} onClick={() => handleDownload(format)}>
                        {format.toUpperCase()}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            {/* Right Column - Details */}
            <div className="space-y-6">
              <div>
                <h1 className="text-3xl md:text-4xl font-bold mb-2 text-balance">Meme Details</h1>
                <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
                    <span>{meme.width}x{meme.height}</span>
                    <span>•</span>
                    <span>{(meme.file_size / 1024).toFixed(1)} KB</span>
                    <span>•</span>
                    <span>{meme.mime_type}</span>
                </div>
              </div>

              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between py-2 border-b border-border">
                  <span className="text-muted-foreground">Status</span>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={
                        meme.processing_status === "success"
                          ? "default"
                          : meme.processing_status === "failed"
                            ? "destructive"
                            : "secondary"
                      }
                    >
                      {meme.processing_status === "pending" || meme.processing_status === "processing" ? (
                        <div className="flex items-center gap-1">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          {meme.processing_status === "pending" ? "Queued" : "Processing"}
                        </div>
                      ) : (
                        meme.processing_status
                      )}
                    </Badge>
                    {meme.processing_status === "failed" && (
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleRetry} disabled={isRetrying}>
                        <RefreshCcw className={`h-3 w-3 ${isRetrying ? 'animate-spin' : ''}`} />
                      </Button>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-between py-2 border-b border-border">
                  <span className="text-muted-foreground">Created</span>
                  <span className="font-medium">{new Date(meme.created_at).toLocaleDateString()}</span>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-3">
                  <Label className="text-base">Tags</Label>
                  {meme.in_library && (
                    <Button variant="ghost" size="sm" onClick={() => setIsEditing(!isEditing)}>
                      {isEditing ? "Done" : "Edit"}
                    </Button>
                  )}
                </div>
                <div className="flex flex-wrap gap-2 mb-3">
                  {tags.map((tag) => (
                    <Link href={`/tag/${tag.id}`} key={tag.id}>
                      <Badge
                        variant="secondary"
                        className="text-sm hover:bg-primary hover:text-primary-foreground cursor-pointer"
                      >
                        {tag.name}
                        {meme.in_library && isEditing && (
                          <button
                            onClick={(e) => {
                              e.preventDefault()
                              handleRemoveTag(tag.id)
                            }}
                            className="ml-2 hover:text-destructive disabled:opacity-50"
                            disabled={removingTagId === tag.id}
                          >
                            {removingTagId === tag.id ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                                <X className="w-3 h-3" />
                            )}
                          </button>
                        )}
                      </Badge>
                    </Link>
                  ))}
                  {tags.length === 0 && <span className="text-sm text-muted-foreground">No tags yet</span>}
                </div>
                {meme.in_library && isEditing && (
                  <div className="flex gap-2">
                    <Input
                      placeholder="Add a tag..."
                      value={newTag}
                      onChange={(e) => setNewTag(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleAddTag()}
                      disabled={isAddingTag}
                    />
                    <Button onClick={handleAddTag} size="icon" disabled={isAddingTag || !newTag.trim()}>
                      {isAddingTag ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                          <Plus className="w-4 h-4" />
                      )}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="mt-12 md:mt-16">
            <h2 className="text-2xl font-bold mb-6">Similar Memes</h2>
            <MemeGrid items={recommendations} fixedHeight={true} />
          </div>
        </div>
      </div>
  )
}
