"use client"

import { useState } from "react"
import useSWR from "swr"
import { exploreList } from "@/lib/api"
import { useUser } from "@/hooks/use-user"
import { Input } from "@/components/ui/input"
import { FolderOpen, TrendingUp, Users, Search } from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { FolderCard } from "@/components/folder-card"
import { EmptyState } from "@/components/ui/empty-state"
import { Skeleton } from "@/components/ui/skeleton"

export default function ExplorePage() {
  const { user } = useUser()
  const [searchQuery, setSearchQuery] = useState("")

  const { data, isLoading } = useSWR("/api/explore/folders", exploreList)

  const featuredFolders = data?.featured || []
  const popularFolders = data?.popular || []
  const allFolders = data?.all || []

  // Filter folders by search query (client-side for now, matching previous behavior)
  const filteredFolders = searchQuery
    ? allFolders.filter(
        (f) =>
          f.name.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : allFolders

  const renderGrid = (folders: typeof allFolders) => (
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {folders.map((folder) => (
        <FolderCard key={folder.id} folder={folder} />
      ))}
    </div>
  )

  const renderSkeletons = () => (
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {[...Array(8)].map((_, i) => (
        <Skeleton key={i} className="aspect-square rounded-xl" />
      ))}
    </div>
  )

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
            placeholder="Search folders..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      {isLoading ? (
        renderSkeletons()
      ) : !searchQuery ? (
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
            {renderGrid(featuredFolders)}
          </TabsContent>

          {/* Popular Folders */}
          <TabsContent value="popular" className="space-y-6">
            {renderGrid(popularFolders)}
          </TabsContent>

          {/* All Folders */}
          <TabsContent value="all" className="space-y-6">
            {renderGrid(allFolders)}
          </TabsContent>
        </Tabs>
      ) : (
        /* Search Results */
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">
            {filteredFolders.length} {filteredFolders.length === 1 ? "result" : "results"} for &ldquo;{searchQuery}&rdquo;
          </h2>
          {filteredFolders.length > 0 ? (
            renderGrid(filteredFolders)
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
