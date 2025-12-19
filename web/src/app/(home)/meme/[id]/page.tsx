"use client"

import { useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { mockMemes } from "@/lib/mock-data"
import { useUser } from "@/hooks/use-user"
import { Heart, Share2, Download, Lock, Globe, X, Plus, Check, BookmarkPlus } from "lucide-react"
import Link from "next/link"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { MemeCard } from "@/components/meme-card"
import { MemeGrid } from "@/components/meme-grid"
import { EmptyState } from "@/components/ui/empty-state"

export default function MemeDetailsPage() {
  const params = useParams()
  const router = useRouter()
  const { user } = useUser()
  const memeId = params.id as string

  const meme = mockMemes.find((m) => m.id === memeId)
  const recommendations = mockMemes
    .filter((m) => m.id !== memeId && (m.userId === meme?.userId || m.tags.some((t) => meme?.tags.includes(t))))
    .slice(0, 8)

  const [isFavorite, setIsFavorite] = useState(meme?.isFavorite || false)
  const [isPublic, setIsPublic] = useState<boolean>(meme?.isPublic ?? true)
  const [tags, setTags] = useState<string[]>(meme?.tags || [])
  const [newTag, setNewTag] = useState("")
  const [isEditing, setIsEditing] = useState(false)
  const [downloadFormat, setDownloadFormat] = useState<"original" | "png" | "jpg" | "gif">("original")
  const [isAddedToLibrary, setIsAddedToLibrary] = useState(false)

  const isOwner = user?.id === meme?.userId

  if (!meme) {
    return (
      <EmptyState
        title="Meme not found"
        description="The meme you are looking for does not exist or has been moved."
        action={<Button onClick={() => router.push("/search")}>Back to Search</Button>}
      />
    )
  }

  const handleAddTag = () => {
    if (newTag.trim() && !tags.includes(newTag.trim())) {
      setTags([...tags, newTag.trim()])
      setNewTag("")
    }
  }

  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter((t) => t !== tagToRemove))
  }

  const handleShare = () => {
    navigator.clipboard.writeText(window.location.href)
    alert("Link copied to clipboard!")
  }

  const handleDownload = (format: string) => {
    console.log("[v0] Downloading as:", format)
    alert(`Demo: Downloading as ${format.toUpperCase()}`)
  }

  const handleAddToLibrary = () => {
    setIsAddedToLibrary(true)
    alert(`Demo: Meme "${meme.title}" added to your library!`)
  }

  return (
    <div className="container mx-auto px-4 py-6 md:py-8">
        <div className="max-w-6xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-6 md:gap-8">
            {/* Left Column - Meme Image */}
            <div className="space-y-4">
              <div className="bg-card border border-border rounded-xl overflow-hidden shadow-lg">
                <img src={meme.url || "/placeholder.svg"} alt={meme.title} className="w-full h-auto" />
              </div>

              {/* Actions - CHANGE: Fix button colors */}
              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  onClick={() => setIsFavorite(!isFavorite)}
                  variant={isFavorite ? "default" : "outline"}
                  className="gap-2 flex-1"
                >
                  <Heart className={`w-4 h-4 ${isFavorite ? "fill-current" : ""}`} />
                  <span className="hidden sm:inline">{isFavorite ? "Favorited" : "Favorite"}</span>
                </Button>

                {!isOwner && user && (
                  <Button
                    onClick={handleAddToLibrary}
                    variant={isAddedToLibrary ? "secondary" : "default"}
                    className="gap-2 flex-1"
                    disabled={isAddedToLibrary}
                  >
                    <BookmarkPlus className="w-4 h-4" />
                    <span className="hidden sm:inline">{isAddedToLibrary ? "Added" : "Add to Library"}</span>
                  </Button>
                )}

                <Button variant="outline" size="icon" onClick={handleShare}>
                  <Share2 className="w-4 h-4" />
                </Button>

                {/* Download with format selection */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="icon">
                      <Download className="w-4 h-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => handleDownload("original")}>
                      <span className="flex items-center justify-between w-full">
                        Original Format
                        {downloadFormat === "original" && <Check className="w-4 h-4 ml-2" />}
                      </span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleDownload("png")}>
                      <span className="flex items-center justify-between w-full">
                        PNG
                        {downloadFormat === "png" && <Check className="w-4 h-4 ml-2" />}
                      </span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleDownload("jpg")}>
                      <span className="flex items-center justify-between w-full">
                        JPG
                        {downloadFormat === "jpg" && <Check className="w-4 h-4 ml-2" />}
                      </span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleDownload("gif")}>
                      <span className="flex items-center justify-between w-full">
                        GIF
                        {downloadFormat === "gif" && <Check className="w-4 h-4 ml-2" />}
                      </span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            {/* Right Column - Details */}
            <div className="space-y-6">
              <div>
                <h1 className="text-3xl md:text-4xl font-bold mb-2 text-balance">{meme.title}</h1>
                <p className="text-muted-foreground leading-relaxed">{meme.description}</p>
              </div>

              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between py-2 border-b border-border">
                  <span className="text-muted-foreground">Created by</span>
                  <Link href={`/user/${meme.userId}`} className="font-medium hover:text-primary">
                    @{meme.username}
                  </Link>
                </div>
                <div className="flex items-center justify-between py-2 border-b border-border">
                  <span className="text-muted-foreground">Folder</span>
                  <span className="font-medium">{meme.folderName || "Uncategorized"}</span>
                </div>
                <div className="flex items-center justify-between py-2 border-b border-border">
                  <span className="text-muted-foreground">Created</span>
                  <span className="font-medium">{new Date(meme.createdAt).toLocaleDateString()}</span>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-3">
                  <Label className="text-base">Tags</Label>
                  {isOwner && (
                    <Button variant="ghost" size="sm" onClick={() => setIsEditing(!isEditing)}>
                      {isEditing ? "Done" : "Edit"}
                    </Button>
                  )}
                </div>
                <div className="flex flex-wrap gap-2 mb-3">
                  {tags.map((tag) => (
                    <Link href={`/tag/${encodeURIComponent(tag)}`} key={tag}>
                      <Badge
                        variant="secondary"
                        className="text-sm hover:bg-primary hover:text-primary-foreground cursor-pointer"
                      >
                        {tag}
                        {isEditing && isOwner && (
                          <button
                            onClick={(e) => {
                              e.preventDefault()
                              handleRemoveTag(tag)
                            }}
                            className="ml-2 hover:text-destructive"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        )}
                      </Badge>
                    </Link>
                  ))}
                  {tags.length === 0 && <span className="text-sm text-muted-foreground">No tags yet</span>}
                </div>
                {isEditing && isOwner && (
                  <div className="flex gap-2">
                    <Input
                      placeholder="Add a tag..."
                      value={newTag}
                      onChange={(e) => setNewTag(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleAddTag()}
                    />
                    <Button onClick={handleAddTag} size="icon">
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>
                )}
              </div>

              {isOwner && (
                <div className="bg-card border border-border rounded-xl p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div className="space-y-1 flex-1">
                      <Label htmlFor="visibility" className="text-base">
                        Visibility
                      </Label>
                      <p className="text-sm text-muted-foreground">
                        {isPublic ? "Anyone can view this meme" : "Only you can view this meme"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {isPublic ? <Globe className="w-4 h-4 text-primary" /> : <Lock className="w-4 h-4" />}
                      <Switch id="visibility" checked={isPublic} onCheckedChange={setIsPublic} />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* CHANGE: Use MemeCard for similar memes, remove titles/descriptions */}
          <div className="mt-12 md:mt-16">
            <h2 className="text-2xl font-bold mb-6">Similar Memes</h2>
            <MemeGrid>
              {recommendations.map((rec, index) => (
                <MemeCard key={rec.id} meme={rec} fixedHeight={true} index={index} />
              ))}
            </MemeGrid>
          </div>
        </div>
      </div>
  )
}
