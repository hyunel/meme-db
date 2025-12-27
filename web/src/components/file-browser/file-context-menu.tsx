"use client"

import React, { useState } from "react"
import { FolderPlus, Upload, Download, Heart, Move, Trash2, RefreshCcw, Copy, Share2 } from "lucide-react"
import { useFileBrowser } from "./file-browser-context"
import { shareMeme, downloadMeme } from "@/lib/meme"
import { memeRetry, favoriteToggle as toggleFavoriteApi } from "@/lib/api"
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
}

export function FileContextMenu({
  children,
  activeItem,
  menuItems,
  onOpenChange,
  onNewFolder,
  onUpload,
}: FileContextMenuProps) {
  const { deleteItems, moveItems, refresh, clearSelection, copyItems } = useFileBrowser()

  const [isMoveDialogOpen, setIsMoveDialogOpen] = useState(false)
  const [isCopyDialogOpen, setIsCopyDialogOpen] = useState(false)

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

              return (
                <>
                  {allFailed && failedMemes.length > 0 && (
                    <>
                      <ContextMenuItem onClick={() => handleRetry(failedMemes)}>
                        <RefreshCcw className="mr-2 h-4 w-4" />
                        Retry{isMultiple ? ` (${failedMemes.length})` : ""}
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                    </>
                  )}
                  {!hasFolder && (
                    <>
                      <ContextMenuItem onClick={() => handleDownload(menuItems)}>
                        <Download className="mr-2 h-4 w-4" />
                        Download{isMultiple ? ` (${menuItems.length})` : ""}
                      </ContextMenuItem>
                      {!isMultiple && (
                        <ContextMenuItem onClick={() => handleShare(menuItems[0])}>
                          <Share2 className="mr-2 h-4 w-4" />
                          Share
                        </ContextMenuItem>
                      )}
                    </>
                  )}
                  {favoritableItems.length > 0 && (
                    <ContextMenuItem onClick={() => handleBatchFavorite(favoritableItems, !allFavorited)}>
                      <Heart className={`mr-2 h-4 w-4 ${allFavorited ? "fill-current" : ""}`} />
                      {allFavorited ? "Unfavorite" : "Favorite"}
                      {isMultiple ? ` (${favoritableItems.length})` : ""}
                    </ContextMenuItem>
                  )}
                  <ContextMenuItem onClick={() => setIsMoveDialogOpen(true)}>
                    <Move className="mr-2 h-4 w-4" />
                    Move{isMultiple ? ` (${menuItems.length})` : ""} to...
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => setIsCopyDialogOpen(true)}>
                    <Copy className="mr-2 h-4 w-4" />
                    Copy{isMultiple ? ` (${menuItems.length})` : ""} to...
                  </ContextMenuItem>
                  <ContextMenuSeparator />
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
