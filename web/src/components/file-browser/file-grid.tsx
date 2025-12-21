"use client"

import type React from "react"
import { useRef, useState } from "react"
import { FolderIcon, FolderPlus, Upload, Download, Heart, Move, Trash2 } from "lucide-react"
import { FileGridItem } from "./file-grid-item"
import { useFileBrowser } from "./file-browser-context"
import { useBoxSelection } from "./hooks/use-box-selection"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import type { BrowseItem } from "./types"

interface FileGridProps {
  onNewFolder?: () => void
  onUpload?: () => void
}

export function FileGrid({ onNewFolder, onUpload }: FileGridProps) {
  const {
    items,
    userMemes,
    currentFolder,
    selectedItems,
    setSelectedItems,
    deleteItems,
    isDragging,
    dragTargetFolder,
    dragTargetBreadcrumb,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  } = useFileBrowser()

  const [activeItem, setActiveItem] = useState<BrowseItem | null>(null)
  const [menuItems, setMenuItems] = useState<BrowseItem[]>([])
  const containerRef = useRef<HTMLDivElement>(null)
  const { isBoxSelecting, selectionBox, handleMouseDown, handleMouseMove } = useBoxSelection(
    containerRef,
    setSelectedItems,
  )

  const handleDownload = (itemsToDownload: BrowseItem[]) => {
    itemsToDownload.forEach((item) => {
      const meme = userMemes.find((m) => m.id === item.id)
      if (meme) {
        const link = document.createElement("a")
        link.href = meme.url
        link.download = `${meme.title}.png`
        link.click()
      }
    })
  }

  const handleContextMenu = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    const itemElement = target.closest("[data-item-id]")

    if (itemElement) {
      const itemId = itemElement.getAttribute("data-item-id")
      const clickedItem = items.find((i) => i.id === itemId)

      if (clickedItem) {
        setActiveItem(clickedItem)
        // If the clicked item is already part of the selection, apply to the whole selection
        // Otherwise, apply only to the clicked item
        if (selectedItems.has(clickedItem.id)) {
          const selectedObjects = items.filter((i) => selectedItems.has(i.id))
          setMenuItems(selectedObjects)
        } else {
          setMenuItems([clickedItem])
        }
        return
      }
    }
    setActiveItem(null)
    setMenuItems([])
  }

  return (
    <ContextMenu onOpenChange={(open) => !open && setActiveItem(null)}>
      <ContextMenuTrigger asChild>
        <div
          ref={containerRef}
          onMouseDown={handleMouseDown}
          onMouseMove={isBoxSelecting ? handleMouseMove : undefined}
          onDragOver={(e) => handleDragOver(e, currentFolder?.id)}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(e, currentFolder?.id)}
          onContextMenu={handleContextMenu}
          className={`flex-1 flex flex-col min-h-[400px] rounded-xl border-2 border-dashed transition-all relative select-none group/grid ${
            isDragging && !dragTargetFolder && dragTargetBreadcrumb === null
              ? "border-primary bg-primary/5 scale-[0.99]"
              : "border-border"
          }`}
        >
          {isBoxSelecting && selectionBox && (
            <div
              className="absolute bg-primary/20 border-2 border-primary rounded pointer-events-none z-10"
              style={{
                left: selectionBox.x,
                top: selectionBox.y,
                width: selectionBox.width,
                height: selectionBox.height,
              }}
            />
          )}

          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center flex-1 min-h-[400px] text-muted-foreground">
              <FolderIcon className="w-16 h-16 mb-4 opacity-20" />
              <p className="text-lg font-medium">No items yet</p>
              <p className="text-sm">Upload some memes to get started</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 p-4">
              {items.map((item) => {
                const isSelected = selectedItems.has(item.id)
                const isFolderType = item.type === "folder"
                const folderPreviewMemes = isFolderType ? userMemes.filter((m) => m.folderId === item.id).slice(0, 4) : []

                return (
                  <FileGridItem
                    key={item.id}
                    item={item}
                    isSelected={isSelected}
                    folderPreviewMemes={folderPreviewMemes}
                    isActiveContext={activeItem?.id === item.id}
                    onContextMenu={setActiveItem}
                  />
                )
              })}
            </div>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="data-[state=closed]:animate-none!">
        {activeItem && menuItems.length > 0 ? (
          <>
            {(() => {
              const isMultiple = menuItems.length > 1
              const hasFolder = menuItems.some((i) => i.type === "folder")
              const suffix = isMultiple ? " all" : ""

              return (
                <>
                  {!hasFolder && (
                    <ContextMenuItem onClick={() => handleDownload(menuItems)}>
                      <Download className="mr-2 h-4 w-4" />
                      Download{suffix}
                    </ContextMenuItem>
                  )}
                  {!isMultiple && activeItem.type === "meme" && (
                    <ContextMenuItem>
                      <Heart className="mr-2 h-4 w-4" />
                      Favorite
                    </ContextMenuItem>
                  )}
                  <ContextMenuItem onClick={() => {}}>
                    <Move className="mr-2 h-4 w-4" />
                    Move{suffix} to...
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem variant="destructive" onClick={() => deleteItems(menuItems.map((i) => i.id))}>
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete{suffix}
                  </ContextMenuItem>
                </>
              )
            })()}
          </>
        ) : (
          <>
            <ContextMenuItem onClick={onNewFolder}>
              <FolderPlus className="mr-2 h-4 w-4" />
              New Folder
            </ContextMenuItem>
            <ContextMenuItem onClick={onUpload}>
              <Upload className="mr-2 h-4 w-4" />
              Upload
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}
