"use client"

import type React from "react"

import { useState, useRef, useEffect } from "react"
import Link from "next/link"
import { MemeGrid } from "@/components/meme-grid"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Search, Sparkles, TrendingUp, Clock, Zap, X, ImagePlus } from "lucide-react"
import { useUser } from "@/hooks/use-user"
import { memeSearch } from "@/lib/api"
import type { Meme } from "@/lib/api"
import { EmptyState } from "@/components/ui/empty-state"
import { toast } from "sonner"

const DEMO_SEARCHES = [
  { icon: TrendingUp, text: "Trending memes", tag: "viral" },
  { icon: Sparkles, text: "Funny reactions", tag: "reaction" },
  { icon: Zap, text: "Drake memes", tag: "drake" },
  { icon: Clock, text: "Classic memes", tag: "classic" },
]

export default function SearchPage() {
  const { user } = useUser()
  const [query, setQuery] = useState("")
  const [selectedImage, setSelectedImage] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [scope, setScope] = useState<"global" | "my">("global")
  const [results, setResults] = useState<Meme[]>([])
  const [hasSearched, setHasSearched] = useState(false)
  const [isSearching, setIsSearching] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    return () => {
      if (imagePreview) {
        URL.revokeObjectURL(imagePreview)
      }
    }
  }, [imagePreview])

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      if (imagePreview) URL.revokeObjectURL(imagePreview)
      setSelectedImage(file)
      setImagePreview(URL.createObjectURL(file))
      // Auto focus the search input after image selection
      setTimeout(() => searchInputRef.current?.focus(), 0)
    }
  }

  const removeImage = () => {
    setSelectedImage(null)
    if (imagePreview) URL.revokeObjectURL(imagePreview)
    setImagePreview(null)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  const handleSearch = async (e: React.FormEvent, searchQuery?: string) => {
    e.preventDefault()
    const finalQuery = (searchQuery || query).trim()
    if (!finalQuery && !selectedImage) return

    setIsSearching(true)
    setHasSearched(true)

    try {
      const searchResults = await memeSearch({
        q: finalQuery || undefined,
        image: selectedImage || undefined,
        scope: scope,
      })
      setResults(searchResults.map((r) => r.meme))
    } finally {
      setIsSearching(false)
    }
  }

  const handleDemoClick = (tag: string) => {
    setQuery(tag)
    const event = { preventDefault: () => {} } as React.FormEvent
    handleSearch(event, tag)
  }

  return (
    <>
      {/* Search Section */}
      <div
        className={`container mx-auto px-4 transition-all duration-500 ${hasSearched ? "py-6 md:py-8" : "py-12 md:py-24"}`}
      >
        <div className={`max-w-3xl mx-auto ${hasSearched ? "" : "text-center"}`}>
          {!hasSearched && (
            <div className="mb-8 space-y-4 animate-fade-in">
              <h1 className="text-4xl md:text-6xl font-bold bg-linear-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
                Find the perfect meme
              </h1>
              <p className="text-lg text-muted-foreground">Search millions of memes by tags or description</p>
            </div>
          )}

          <form onSubmit={handleSearch} className="space-y-4">
            <div className="relative group flex items-center">
              <Search className="absolute left-5 w-5 h-5 text-muted-foreground group-focus-within:text-primary transition-colors z-10" />
              <Input
                ref={searchInputRef}
                type="text"
                placeholder={selectedImage ? "Add text to image search..." : "Search for memes..."}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-14 pr-16 h-14 md:h-16 text-base md:text-lg shadow-lg border transition-[border-color] focus-visible:border-primary focus-visible:ring-1"
              />

              <div className="absolute right-2 flex items-center">
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleImageChange}
                  ref={fileInputRef}
                  className="hidden"
                />
                {imagePreview ? (
                  <div className="relative h-10 w-10 md:h-12 md:w-12 rounded-lg overflow-hidden border border-primary/50 shadow-sm group/thumb animate-in fade-in zoom-in duration-200">
                    <img src={imagePreview} alt="Preview" className="h-full w-full object-cover" />
                    <button
                      type="button"
                      onClick={removeImage}
                      className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover/thumb:opacity-100 transition-opacity"
                    >
                      <X className="w-4 h-4 text-white" />
                    </button>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => fileInputRef.current?.click()}
                    className="h-10 w-10 md:h-12 md:w-12 rounded-lg hover:bg-primary/10 hover:text-primary transition-colors"
                    title="Search by image"
                  >
                    <ImagePlus className="w-5 h-5 md:w-6 md:h-6" />
                  </Button>
                )}
              </div>
            </div>

            {user && (
              <div className="flex items-center gap-4 flex-wrap">
                <span className="text-sm text-muted-foreground">Search in:</span>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={scope === "global" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setScope("global")}
                  >
                    Global Public
                  </Button>
                  <Button
                    type="button"
                    variant={scope === "my" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setScope("my")}
                  >
                    My Library
                  </Button>
                </div>
              </div>
            )}
          </form>

          {/* Demo Search Examples */}
          {!hasSearched && (
            <div className="mt-12 space-y-4 animate-fade-in" style={{ animationDelay: "200ms" }}>
              <p className="text-sm text-muted-foreground">Try searching for:</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {DEMO_SEARCHES.map((demo, index) => (
                  <button
                    key={index}
                    onClick={() => handleDemoClick(demo.tag)}
                    className="flex items-center gap-2 bg-card border border-border rounded-xl p-4 hover:border-primary hover:shadow-lg transition-all group"
                  >
                    <demo.icon className="w-5 h-5 text-primary group-hover:scale-110 transition-transform" />
                    <span className="text-sm font-medium">{demo.text}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Loading State */}
      {isSearching && (
        <div className="container mx-auto px-4 pb-20">
          <div className="flex flex-col items-center justify-center py-20 space-y-6">
            <div className="relative">
              <div className="w-16 h-16 border-4 border-primary/20 rounded-full" />
              <div className="absolute inset-0 w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
            <div className="text-center space-y-2">
              <p className="text-lg font-medium">Searching memes...</p>
              <p className="text-sm text-muted-foreground">Finding the best matches for you</p>
            </div>
          </div>
        </div>
      )}

      {/* Results Section - Masonry Layout */}
      {hasSearched && !isSearching && (
        <div className="container mx-auto px-4 pb-20 animate-fade-in">
          {results.length > 0 ? (
            <>
              <div className="mb-6 flex items-center justify-between">
                <span className="text-muted-foreground">
                  Found <span className="font-semibold text-foreground">{results.length}</span>{" "}
                  {results.length === 1 ? "result" : "results"}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setHasSearched(false)
                    setQuery("")
                    setResults([])
                  }}
                >
                  New Search
                </Button>
              </div>
              <MemeGrid items={results} />
            </>
          ) : (
            <EmptyState
              icon={
                <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
                  <Search className="w-8 h-8 text-muted-foreground" />
                </div>
              }
              title="No memes found"
              description={`No results for "${query}". Try a different search term or browse our collections.`}
              action={
                <div className="flex items-center justify-center gap-3 pt-4">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setHasSearched(false)
                      setQuery("")
                      removeImage()
                    }}
                  >
                    New Search
                  </Button>
                  <Link href="/explore">
                    <Button>Explore Collections</Button>
                  </Link>
                </div>
              }
            />
          )}
        </div>
      )}
    </>
  )
}
