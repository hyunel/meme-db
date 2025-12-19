"use client"

import { useState } from "react"
import { mockFolders, type Folder } from "@/lib/mock-data"
import { useUser } from "@/hooks/use-user"
import { Input } from "@/components/ui/input"
import { FolderOpen, TrendingUp, Users, Search } from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { FolderCard } from "@/components/folder-card"
import { EmptyState } from "@/components/ui/empty-state"

export default function ExplorePage() {
  const { user } = useUser()
  const [searchQuery, setSearchQuery] = useState("")

  // Get all public folders
  const publicFolders = mockFolders.filter((f) => f.isPublic)

  // Filter folders by search query
  const filteredFolders = searchQuery
    ? publicFolders.filter(
        (f) =>
          f.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          f.username.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : publicFolders

  // Featured folders (highest meme count)
  const featuredFolders = [...publicFolders].sort((a, b) => b.memeCount - a.memeCount).slice(0, 6)

  // Popular folders (mock - in real app would be based on views/likes)
  const popularFolders = [...publicFolders].slice(0, 8)

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header Section */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Explore</h1>
        <p className="text-muted-foreground">Discover public meme collections from the community</p>
      </div>

      {/* Search */}
      <div className="mb-8 max-w-2xl">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search folders and users..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      {!searchQuery ? (
        <Tabs defaultValue="featured" className="space-y-6">
          <TabsList>
            <TabsTrigger value="featured" className="gap-2">
              <TrendingUp className="w-4 h-4" />
              Featured
            </TabsTrigger>
            <TabsTrigger value="popular" className="gap-2">
              <Users className="w-4 h-4" />
              Popular
            </TabsTrigger>
            <TabsTrigger value="all" className="gap-2">
              <FolderOpen className="w-4 h-4" />
              All Folders
            </TabsTrigger>
          </TabsList>

          {/* Featured Folders */}
          <TabsContent value="featured" className="space-y-6">
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {featuredFolders.map((folder) => (
                <FolderCard key={folder.id} folder={folder} />
              ))}
            </div>
          </TabsContent>

          {/* Popular Folders */}
          <TabsContent value="popular" className="space-y-6">
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {popularFolders.map((folder) => (
                <FolderCard key={folder.id} folder={folder} />
              ))}
            </div>
          </TabsContent>

          {/* All Folders */}
          <TabsContent value="all" className="space-y-6">
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {publicFolders.map((folder) => (
                <FolderCard key={folder.id} folder={folder} />
              ))}
            </div>
          </TabsContent>
        </Tabs>
      ) : (
        /* Search Results */
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">
            {filteredFolders.length} {filteredFolders.length === 1 ? "result" : "results"} for &ldquo;{searchQuery}&rdquo;
          </h2>
          {filteredFolders.length > 0 ? (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filteredFolders.map((folder) => (
                <FolderCard key={folder.id} folder={folder} />
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<FolderOpen className="w-16 h-16" />}
              title="No folders found"
              description="Try a different search term"
            />
          )}
        </div>
      )}
    </div>
  )
}
