"use client"

import type React from "react"
import { useRef, useCallback } from "react"
import { FolderOpen, ImageIcon, CheckSquare } from "lucide-react"
import { useRouter } from "next/navigation"
import type { Node } from "@/lib/api"
import type { BrowseItem } from "./types"
import { useFileBrowser } from "./file-browser-context"
import useSWR from "swr"
import { fetchNodes } from "@/lib/api"

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

  // For folder previews, we need to fetch the folder's children
  const { data: folderData } = useSWR(
    isFolderType ? [`/api/fs/nodes`, item.id] : null,
    () => fetchNodes(item.id)
  )
  const folderPreviewNodes = folderData?.children?.filter(n => n.type === 'FILE').slice(0, 4) || []

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
    } else {
      router.push(`/meme/${item.id}`)
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
      className={`group/item relative bg-card border rounded-xl overflow-hidden transition-all cursor-pointer
        hover:shadow-lg hover:border-primary/50
        ${isActiveContext ? "ring-2 ring-primary border-primary shadow-xl scale-[1.02] z-10" : "z-0"}
        ${isSelected ? "ring-2 ring-primary border-primary" : "border-border"}
        ${dragTargetFolder === item.id ? "ring-2 ring-primary bg-primary/5 scale-95" : ""}
      `}
    >
      {isFolderType ? (
        <div className="aspect-square relative">
          {folderPreviewNodes.length > 0 ? (
            <div className="grid grid-cols-2 gap-0.5 h-full w-full bg-muted">
              {folderPreviewNodes.map((previewNode, idx) => (
                <div key={idx} className="relative overflow-hidden">
                  <img src={previewNode.url || "/placeholder.svg"} alt="" className="w-full h-full object-cover" />
                </div>
              ))}
              {Array.from({ length: 4 - folderPreviewNodes.length }).map((_, idx) => (
                <div key={`empty-${idx}`} className="bg-muted flex items-center justify-center">
                  <ImageIcon className="w-6 h-6 text-muted-foreground/30" />
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full bg-muted">
              <FolderOpen className="w-12 h-12 text-primary mb-2 group-hover:scale-110 transition-transform" />
            </div>
          )}
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent p-2">
            <h3 className="font-medium text-sm truncate text-white">{item.name}</h3>
            <p className="text-xs text-white/70">{folderData?.children.length || 0} items</p>
          </div>
        </div>
      ) : (
        <div className="aspect-square relative">
          <img src={item.url || "/placeholder.svg"} alt={item.name} className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-2">
             <div className="flex flex-wrap gap-1">
              {item.tags?.slice(0, 2).map((tag) => (
                <span key={tag} className="text-xs px-2 py-0.5 bg-white/20 backdrop-blur-sm rounded-full text-white">
                  {tag}
                </span>
              ))}
            </div>
          </div>
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
