"use client"

import type React from "react"
import { useRef, useCallback } from "react"
import { CheckSquare, Loader2, AlertCircle, Globe, Lock } from "lucide-react"
import { useRouter } from "next/navigation"
import { MemeRenderer } from "../meme-renderer"
import { MemeOverlay } from "../meme-overlay"
import { FolderPreview, useFolderPreview } from "../folder-preview"
import type { Node } from "@/lib/api"
import type { BrowseItem } from "./utils/types"
import { useFileBrowser } from "./file-browser-context"

interface FileGridItemProps {
  item: BrowseItem
  isSelected: boolean
  isActiveContext: boolean
  onContextMenu: (item: BrowseItem) => void
}

export function FileGridItem({
  item,
  isSelected,
  isActiveContext,
  onContextMenu,
}: FileGridItemProps) {
  const router = useRouter()
  const {
    selectedItems,
    toggleSelection,
    dragTargetFolder,
    handleDragStart,
    handleDragEnd,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    navigateToFolder,
  } = useFileBrowser()

  const isFolderType = item.type === "folder"
  const isSelectionMode = selectedItems.size > 0

  // For folder previews, we need to fetch the folder's children
  const { totalItems } = useFolderPreview(item.id, isFolderType)

  const longPressTimer = useRef<NodeJS.Timeout | null>(null)
  const longPressTriggered = useRef(false)

  const startLongPress = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      longPressTriggered.current = false
      longPressTimer.current = setTimeout(() => {
        longPressTriggered.current = true
        if (!selectedItems.has(item.id)) {
          toggleSelection(item.id)
        }
      }, 500)
    },
    [item.id, selectedItems, toggleSelection],
  )

  const cancelLongPress = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }, [])

  const handleClick = (e: React.MouseEvent) => {
    if (longPressTriggered.current) {
      longPressTriggered.current = false
      return
    }

    if (selectedItems.size > 0 || e.ctrlKey || e.metaKey) {
      e.preventDefault()
      toggleSelection(item.id)
    } else if (isFolderType) {
      navigateToFolder(item as unknown as Node)
    } else if (item.meme) {
      router.push(`/meme/${item.meme.asset_id}`)
    }
  }

  return (
    <div
      data-item-id={item.id}
      draggable
      onDragStart={(e) => {
        cancelLongPress()
        handleDragStart(e, item.id)
      }}
      onDragEnd={handleDragEnd}
      onClick={handleClick}
      onMouseDown={(e) => {
        if (e.button === 0) startLongPress(e)
      }}
      onMouseUp={cancelLongPress}
      onMouseLeave={cancelLongPress}
      onContextMenu={(e) => {
        cancelLongPress()
        onContextMenu(item)
      }}
      onTouchStart={startLongPress}
      onTouchEnd={cancelLongPress}
      onTouchMove={cancelLongPress}
      onDragOver={(e) => isFolderType && handleDragOver(e, item.id)}
      onDragLeave={handleDragLeave}
      onDrop={(e) => isFolderType && handleDrop(e, item.id)}
      className={`group group/item relative bg-card border rounded-xl overflow-hidden transition-all cursor-pointer
        hover:shadow-lg hover:border-primary/50
        ${isActiveContext ? "ring-2 ring-primary border-primary shadow-xl scale-[1.02] z-10" : "z-0"}
        ${isSelected ? "ring-2 ring-primary border-primary" : "border-border"}
        ${dragTargetFolder === item.id ? "ring-2 ring-primary bg-primary/5 scale-95" : ""}
      `}
    >
      {/* Visibility Notch */}
      <div
        className={`absolute top-0 left-0 z-20 w-10 h-10 transition-transform duration-300
          ${item.visibility === "PUBLIC" ? "text-primary" : "text-destructive"}
        `}
        style={{
          clipPath: "polygon(0 0, 100% 0, 0 100%)",
        }}
      >
        <div className="absolute inset-0 bg-primary-foreground/75 backdrop-blur-md" />
        <div className="absolute top-1.5 left-1.5">
          {item.visibility === "PUBLIC" ? (
            <Globe className="w-3 h-3 drop-shadow-sm" />
          ) : (
            <Lock className="w-3 h-3 drop-shadow-sm" />
          )}
        </div>
      </div>

      {isFolderType ? (
        <div className="aspect-square relative">
          <FolderPreview folderId={item.id} />
          <MemeOverlay
            targetId={item.id}
            targetType="FOLDER"
            isFavorite={item.is_favorite}
            showTags={false}
            showMore={false}
            persistent={true}
            actionSectionClassName={`${isSelectionMode ? "hidden" : ""}`}
            bottomContent={
              <div className="space-y-0.5">
                <h3 className="font-medium text-sm truncate text-white">{item.name}</h3>
                <p className="text-xs text-white/70">{totalItems} items</p>
              </div>
            }
          />
        </div>
      ) : (
        <div className="aspect-square relative">
          <MemeRenderer
            meme={item.meme}
            className={`w-full h-full ${item.meme?.processing_status !== "success" ? "opacity-40 grayscale-[0.5]" : ""}`}
          />
          {item.meme && item.meme.processing_status !== "success" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/20 backdrop-blur-[2px]">
              {item.meme.processing_status === "pending" || item.meme.processing_status === "processing" ? (
                <>
                  <Loader2 className="w-8 h-8 text-primary animate-spin mb-2" />
                  <span className="text-xs font-medium text-foreground/80">
                    {item.meme.processing_status === "pending" ? "Queued..." : "Processing..."}
                  </span>
                </>
              ) : (
                <>
                  <AlertCircle className="w-8 h-8 text-destructive mb-2" />
                  <span className="text-xs font-medium text-destructive">Failed</span>
                </>
              )}
            </div>
          )}
          {item.meme && !isSelectionMode && item.meme.processing_status === "success" && (
            <MemeOverlay
              meme={item.meme}
              isFavorite={item.is_favorite}
              actionSectionClassName={isSelected ? "right-10" : "right-2"}
            />
          )}
        </div>
      )}

      {isSelected && (
        <div className="absolute top-2 right-2 w-6 h-6 bg-primary rounded-full flex items-center justify-center shadow-lg">
          <CheckSquare className="w-4 h-4 text-primary-foreground" />
        </div>
      )}
    </div>
  )
}
