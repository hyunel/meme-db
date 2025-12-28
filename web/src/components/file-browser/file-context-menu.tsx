"use client"

import React, { useState, useEffect } from "react"
import { FolderPlus, Upload, Download, Heart, Move, Trash2, RefreshCcw, Copy, Share2, Pencil, Globe, Lock } from "lucide-react"
import { useFileBrowser } from "./file-browser-context"
import { shareMeme, downloadMeme } from "@/lib/meme"
import { memeRetry, favoriteToggle as toggleFavoriteApi, nodeBulkUpdate } from "@/lib/api"
import { useFavoriteStore } from "@/store/favorite"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { DestinationDialog } from "./destination-dialog"
import type { BrowseItem } from "./utils/types"

interface FileContextMenuProps {
  children: React.ReactNode
  activeItem: BrowseItem | null
  menuItems: BrowseItem[]
  onOpenChange?: (open: boolean) => void
  onNewFolder?: () => void
  onUpload?: () => void
  onRename?: (item: BrowseItem) => void
}

export function FileContextMenu({
  children,
  activeItem,
  menuItems,
  onOpenChange,
  onNewFolder,
  onUpload,
  onRename,
}: FileContextMenuProps) {
  const { deleteItems, moveItems, refresh, clearSelection, copyItems, updateItems } = useFileBrowser()

  const [isMoveDialogOpen, setIsMoveDialogOpen] = useState(false)
  const [isCopyDialogOpen, setIsCopyDialogOpen] = useState(false)

  const handleRename = (item: BrowseItem) => {
    onRename?.(item)
    clearSelection()
  }

  const handleBatchVisibility = async (itemsToUpdate: BrowseItem[], visibility: "PUBLIC" | "PRIVATE") => {
    await updateItems(itemsToUpdate.map((i) => ({ id: i.id, visibility })))
    clearSelection()
  }

  const handleDownload = (itemsToDownload: BrowseItem[]) => {
    itemsToDownload.forEach((item) => {
      if (item.type === "meme" && item.meme) {
        downloadMeme(item.meme)
      }
    })
    clearSelection()
  }

  const handleShare = (item: BrowseItem) => {
    if (item.type === "meme" && item.meme) {
      shareMeme(item.meme)
    }
    clearSelection()
  }

  const handleRetry = async (itemsToRetry: BrowseItem[]) => {
    const ids = itemsToRetry
      .filter((i) => i.type === "meme" && i.meme && i.meme.processing_status === "failed")
      .map((i) => i.meme!.asset_id)

    if (ids.length > 0) {
      await memeRetry(ids)
      refresh()
    }
    clearSelection()
  }

  const handleBatchFavorite = async (itemsToToggle: BrowseItem[], isFavorite: boolean) => {
    const toggleItems = itemsToToggle.map((i) => ({
      id: i.type === "meme" ? i.meme!.asset_id : i.id,
      type: (i.type === "meme" ? "MEME" : "FOLDER") as "MEME" | "FOLDER",
      favorite: isFavorite,
    }))

    if (toggleItems.length === 0) return

    // 1. Optimistic update in global store
    const store = useFavoriteStore.getState()
    store.setFavorites(toggleItems.map((item) => ({ id: item.id, favorite: item.favorite })))

    try {
      // 2. Perform the actual API call
      await toggleFavoriteApi(toggleItems)
      // 3. Refresh to sync with server
      refresh()
    } catch (error) {
      toggleItems.forEach((item) => store.removeOverride(item.id))
      throw error
    } finally {
      clearSelection()
    }
  }

  const handleDelete = async (ids: string[]) => {
    await deleteItems(ids)
    clearSelection()
  }

  const handleNewFolder = () => {
    onNewFolder?.()
    clearSelection()
  }

  const handleUpload = () => {
    onUpload?.()
    clearSelection()
  }

  return (
    <ContextMenu onOpenChange={onOpenChange}>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="data-[state=closed]:animate-none!">
        {activeItem && menuItems.length > 0 ? (
          <>
            {(() => {
              const isMultiple = menuItems.length > 1
              const hasFolder = menuItems.some((i) => i.type === "folder")

              const failedMemes = menuItems.filter((i) => i.type === "meme" && i.meme?.processing_status === "failed")
              const favoritableItems = menuItems.filter(
                (i) =>
                  i.type === "folder" ||
                  (i.type === "meme" &&
                    (i.meme?.processing_status === "success" || i.meme?.processing_status === "processing")),
              )

              // Determine favorite status for bulk action: if any is not favorite, action is "Favorite", else "Unfavorite"
              const allFavorited = favoritableItems.length > 0 && favoritableItems.every((i) => i.is_favorite)
              const allFailed = failedMemes.length === menuItems.length

              const hasPublic = menuItems.some((i) => i.visibility === "PUBLIC")
              const hasPrivate = menuItems.some((i) => i.visibility === "PRIVATE")

              return (
                <>
                  {/* Group 1: Core Actions (Meme only) */}
                  {((allFailed && failedMemes.length > 0) || !hasFolder) && (
                    <>
                      {allFailed && failedMemes.length > 0 && (
                        <ContextMenuItem onClick={() => handleRetry(failedMemes)}>
                          <RefreshCcw className="mr-2 h-4 w-4" />
                          Retry
                        </ContextMenuItem>
                      )}
                      {!hasFolder && (
                        <>
                          <ContextMenuItem onClick={() => handleDownload(menuItems)}>
                            <Download className="mr-2 h-4 w-4" />
                            Download {isMultiple ? "All" : ""}
                          </ContextMenuItem>
                          {!isMultiple && (
                            <ContextMenuItem onClick={() => handleShare(menuItems[0])}>
                              <Share2 className="mr-2 h-4 w-4" />
                              Share
                            </ContextMenuItem>
                          )}
                        </>
                      )}
                      <ContextMenuSeparator />
                    </>
                  )}

                  {/* Group 2: Organization */}
                  <ContextMenuItem onClick={() => setIsMoveDialogOpen(true)}>
                    <Move className="mr-2 h-4 w-4" />
                    Move to...
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => setIsCopyDialogOpen(true)}>
                    <Copy className="mr-2 h-4 w-4" />
                    Copy to...
                  </ContextMenuItem>
                  <ContextMenuSeparator />

                  {/* Group 3: Status & Properties */}
                  {favoritableItems.length > 0 && (
                    <ContextMenuItem onClick={() => handleBatchFavorite(favoritableItems, !allFavorited)}>
                      <Heart className={`mr-2 h-4 w-4 ${allFavorited ? "fill-current" : ""}`} />
                      {allFavorited ? "Unfavorite" : "Favorite"}
                    </ContextMenuItem>
                  )}

                  {hasPrivate && (
                    <ContextMenuItem onClick={() => handleBatchVisibility(menuItems, "PUBLIC")}>
                      <Globe className="mr-2 h-4 w-4" />
                      Make Public
                    </ContextMenuItem>
                  )}
                  {hasPublic && (
                    <ContextMenuItem onClick={() => handleBatchVisibility(menuItems, "PRIVATE")}>
                      <Lock className="mr-2 h-4 w-4" />
                      Make Private
                    </ContextMenuItem>
                  )}

                  {!isMultiple && activeItem?.type === "folder" && (
                    <ContextMenuItem onClick={() => handleRename(activeItem)}>
                      <Pencil className="mr-2 h-4 w-4" />
                      Rename
                    </ContextMenuItem>
                  )}

                  <ContextMenuSeparator />

                  {/* Group 4: Danger Zone */}
                  <ContextMenuItem variant="destructive" onClick={() => handleDelete(menuItems.map((i) => i.id))}>
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete{isMultiple ? ` (${menuItems.length})` : ""}
                  </ContextMenuItem>
                </>
              )
            })()}
          </>
        ) : (
          <>
            <ContextMenuItem onClick={handleNewFolder}>
              <FolderPlus className="mr-2 h-4 w-4" />
              New Folder
            </ContextMenuItem>
            <ContextMenuItem onClick={handleUpload}>
              <Upload className="mr-2 h-4 w-4" />
              Upload
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>

      <DestinationDialog
        open={isMoveDialogOpen}
        onOpenChange={setIsMoveDialogOpen}
        title={`Move ${menuItems.length} item${menuItems.length > 1 ? "s" : ""} to...`}
        actionLabel="Move Here"
        excludeIds={menuItems.map((i) => i.id)}
        onConfirm={(targetFolderId) => {
          moveItems(
            menuItems.map((i) => i.id),
            targetFolderId,
          )
          clearSelection()
        }}
      />

      <DestinationDialog
        open={isCopyDialogOpen}
        onOpenChange={setIsCopyDialogOpen}
        title={`Copy ${menuItems.length} item${menuItems.length > 1 ? "s" : ""} to...`}
        actionLabel="Copy Here"
        onConfirm={(targetFolderId) => {
          copyItems(
            menuItems.map((i) => i.id),
            targetFolderId,
          )
          clearSelection()
        }}
      />
    </ContextMenu>
  )
}
