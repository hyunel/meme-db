"use client"

import { useState } from "react"
import { useParams } from "next/navigation"
import { mockFolders, mockMemes } from "@/lib/mock-data"
import { useUser } from "@/hooks/use-user"
import { User, FolderOpen, ImageIcon, ChevronRight } from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { MemeCard } from "@/components/meme-card"
import { MemeGrid } from "@/components/meme-grid"
import { EmptyState } from "@/components/ui/empty-state"

const ITEMS_PER_PREVIEW = 8

export default function UserPage() {
  const params = useParams()
  const { user: currentUser } = useUser()
  const userId = params.id as string
  const [showAllFolders, setShowAllFolders] = useState(false)
  const [showAllMemes, setShowAllMemes] = useState(false)

  const userFolders = mockFolders.filter((f) => f.userId === userId && f.isPublic)
  const userMemes = mockMemes.filter((m) => m.userId === userId && m.isPublic)

  const username = userFolders[0]?.username || userMemes[0]?.username || "Unknown User"
  const isOwnProfile = currentUser?.id === userId

  const displayedFolders = showAllFolders ? userFolders : userFolders.slice(0, ITEMS_PER_PREVIEW)
  const displayedMemes = showAllMemes ? userMemes : userMemes.slice(0, ITEMS_PER_PREVIEW)

  return (
    <div className="container mx-auto px-4 py-8">
        {/* User Header */}
        <div className="mb-8">
          <div className="flex items-center gap-4 mb-6">
            <div className="p-6 bg-primary/10 rounded-xl">
              <User className="w-12 h-12 text-primary" />
            </div>
            <div>
              <h1 className="text-3xl font-bold mb-1">@{username}</h1>
              <p className="text-muted-foreground">
                {userFolders.length} public folders • {userMemes.length} public memes
              </p>
            </div>
          </div>

          {isOwnProfile && (
            <div className="bg-card border border-border rounded-xl p-4">
              <p className="text-sm text-muted-foreground">
                This is your profile. Other users can see your public folders and memes here.
              </p>
            </div>
          )}
        </div>

        {/* Public Folders Section */}
        <div className="mb-12">
          <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
            <FolderOpen className="w-6 h-6" />
            Public Folders
          </h2>
          {userFolders.length > 0 ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {displayedFolders.map((folder) => {
                  const folderMemes = mockMemes.filter((m) => m.folderId === folder.id && m.isPublic).slice(0, 4)
                  return (
                    <Link href={`/folder/${folder.id}`} key={folder.id}>
                      <div className="bg-card border border-border rounded-xl p-6 hover:shadow-lg hover:border-primary/50 transition-all group">
                        <div className="flex items-center gap-3 mb-4">
                          <FolderOpen className="w-8 h-8 text-primary group-hover:scale-110 transition-transform" />
                          <div className="flex-1">
                            <h3 className="font-semibold text-lg">{folder.name}</h3>
                            <p className="text-sm text-muted-foreground">{folder.memeCount} memes</p>
                          </div>
                          <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all" />
                        </div>
                        {folderMemes.length > 0 && (
                          <div className="grid grid-cols-4 gap-2">
                            {folderMemes.map((meme) => (
                              <div key={meme.id} className="aspect-square rounded-lg overflow-hidden bg-muted">
                                <img
                                  src={meme.url || "/placeholder.svg"}
                                  alt=""
                                  className="w-full h-full object-cover"
                                />
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </Link>
                  )
                })}
              </div>
              {userFolders.length > ITEMS_PER_PREVIEW && !showAllFolders && (
                <div className="mt-6 text-center">
                  <Button variant="outline" onClick={() => setShowAllFolders(true)}>
                    Show all {userFolders.length} folders
                  </Button>
                </div>
              )}
            </>
          ) : (
            <EmptyState
              icon={<FolderOpen className="w-12 h-12" />}
              title="No public folders yet"
              description=""
              className="py-12 bg-card border border-border rounded-xl"
            />
          )}
        </div>

        {/* Public Memes Section */}
        <div>
          <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
            <ImageIcon className="w-6 h-6" />
            Public Memes
          </h2>
          {userMemes.length > 0 ? (
            <>
              <MemeGrid>
                {displayedMemes.map((meme, index) => (
                  <MemeCard key={meme.id} meme={meme} fixedHeight={true} index={index} />
                ))}
              </MemeGrid>
              {userMemes.length > ITEMS_PER_PREVIEW && !showAllMemes && (
                <div className="mt-6 text-center">
                  <Button variant="outline" onClick={() => setShowAllMemes(true)}>
                    Show all {userMemes.length} memes
                  </Button>
                </div>
              )}
            </>
          ) : (
            <EmptyState
              icon={<ImageIcon className="w-12 h-12" />}
              title="No public memes yet"
              description=""
              className="py-12 bg-card border border-border rounded-xl"
            />
          )}
        </div>
      </div>
  )
}
