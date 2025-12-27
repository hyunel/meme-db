"use client"

import useSWR from "swr"
import { AuthGuard } from "@/components/auth-guard"
import { favoriteList, Meme, Node, ListFavoritesResponse } from "@/lib/api"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { EmptyState } from "@/components/ui/empty-state"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { Heart, FolderOpen } from "lucide-react"
import { MemeCard } from "@/components/meme-card"
import { FolderCard } from "@/components/folder-card"
import { MemeGrid } from "@/components/meme-grid"
import FavoritesLoading from "./loading"

function FavoritesPageContent() {
  const { data, isLoading } = useSWR<ListFavoritesResponse>("/api/favorites", favoriteList)

  const favoriteMemes: Meme[] = data?.memes || []
  const favoriteFolders: Node[] = data?.folders || []

  if (isLoading && !data) {
    return (
      <FavoritesLoading />
    )
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Favorites</h1>
        <p className="text-muted-foreground">Your saved memes and folders</p>
      </div>

      <Tabs defaultValue="memes" className="space-y-6">
        <TabsList>
          <TabsTrigger value="memes" className="gap-2">
            <Heart className="w-4 h-4" />
            Memes ({favoriteMemes.length})
          </TabsTrigger>
          <TabsTrigger value="folders" className="gap-2">
            <FolderOpen className="w-4 h-4" />
            Folders ({favoriteFolders.length})
          </TabsTrigger>
        </TabsList>

        {/* Favorite Memes */}
        <TabsContent value="memes" className="space-y-6">
          {favoriteMemes.length > 0 ? (
            <MemeGrid
              items={favoriteMemes}
              renderItem={(meme, index) => (
                <MemeCard
                  key={meme.asset_id}
                  meme={meme}
                  isFavorite={true}
                  fixedHeight={false}
                  index={index}
                  className="mb-3"
                />
              )}
            />
          ) : (
            <EmptyState
              icon={<Heart className="w-16 h-16" />}
              title="No favorite memes yet"
              description="Start adding memes to your favorites to see them here"
              action={
                <Link href="/search">
                  <Button>Browse Memes</Button>
                </Link>
              }
            />
          )}
        </TabsContent>

        {/* Favorite Folders */}
        <TabsContent value="folders" className="space-y-6">
          {favoriteFolders.length > 0 ? (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {favoriteFolders.map((folder) => (
                <FolderCard
                  key={folder.id}
                  folder={folder}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<FolderOpen className="w-16 h-16" />}
              title="No favorite folders yet"
              description="Start adding folders to your favorites to see them here"
              action={
                <Link href="/explore">
                  <Button>Explore Folders</Button>
                </Link>
              }
            />
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}

export default function FavoritesPage() {
  return (
    <AuthGuard>
      <FavoritesPageContent />
    </AuthGuard>
  )
}
