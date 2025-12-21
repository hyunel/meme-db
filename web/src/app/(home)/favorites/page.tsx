"use client"

import { useState } from "react"
import { AuthGuard } from "@/components/auth-guard"
import { mockMemes, mockFolders } from "@/lib/mock-data"
import { useUser } from "@/hooks/use-user"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { EmptyState } from "@/components/ui/empty-state"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { Heart, FolderOpen, ChevronLeft, ChevronRight } from "lucide-react"
import { MemeCard } from "@/components/meme-card"
import { FolderCard } from "@/components/folder-card"

function FavoritesPageContent() {
  const { user } = useUser()
  const [memePage, setMemePage] = useState(1)
  const [folderPage, setFolderPage] = useState(1)
  const itemsPerPage = 12

  // Mock favorite memes and folders
  const favoriteMemes = mockMemes.filter((m) => m.isFavorite).slice(0, 15)
  const favoriteFolders = mockFolders.filter((f) => f.isFavorite).slice(0, 8)

  // Pagination
  const paginatedMemes = favoriteMemes.slice((memePage - 1) * itemsPerPage, memePage * itemsPerPage)
  const paginatedFolders = favoriteFolders.slice((folderPage - 1) * itemsPerPage, folderPage * itemsPerPage)

  const totalMemePages = Math.ceil(favoriteMemes.length / itemsPerPage)
  const totalFolderPages = Math.ceil(favoriteFolders.length / itemsPerPage)

  return (
    <AuthGuard>
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
              {paginatedMemes.length > 0 ? (
                <>
                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {paginatedMemes.map((meme, index) => (
                      <MemeCard key={meme.id} meme={meme} isFavorite={true} index={index} />
                    ))}
                  </div>

                  {/* Pagination for Memes */}
                  {totalMemePages > 1 && (
                    <div className="flex items-center justify-center gap-2">
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => setMemePage(Math.max(1, memePage - 1))}
                        disabled={memePage === 1}
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </Button>
                      <span className="text-sm text-muted-foreground">
                        Page {memePage} of {totalMemePages}
                      </span>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => setMemePage(Math.min(totalMemePages, memePage + 1))}
                        disabled={memePage === totalMemePages}
                      >
                        <ChevronRight className="w-4 h-4" />
                      </Button>
                    </div>
                  )}
                </>
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
              {paginatedFolders.length > 0 ? (
                <>
                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {paginatedFolders.map((folder) => (
                      <FolderCard key={folder.id} folder={folder} />
                    ))}
                  </div>

                  {/* Pagination for Folders */}
                  {totalFolderPages > 1 && (
                    <div className="flex items-center justify-center gap-2">
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => setFolderPage(Math.max(1, folderPage - 1))}
                        disabled={folderPage === 1}
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </Button>
                      <span className="text-sm text-muted-foreground">
                        Page {folderPage} of {totalFolderPages}
                      </span>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => setFolderPage(Math.min(totalFolderPages, folderPage + 1))}
                        disabled={folderPage === totalFolderPages}
                      >
                        <ChevronRight className="w-4 h-4" />
                      </Button>
                    </div>
                  )}
                </>
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
    </AuthGuard>
  )
}

export default function FavoritesPage() {
  return <FavoritesPageContent />
}
