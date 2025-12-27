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
import { FolderCard } from "@/components/folder-card"

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
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {displayedFolders.map((folder) => (
                  <FolderCard key={folder.id} folder={folder} />
                ))}
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
              <MemeGrid items={displayedMemes as any} fixedHeight={true} />
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
