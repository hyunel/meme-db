"use client"

import type React from "react"
import { useRef, useState } from "react"
import { FolderIcon } from "lucide-react"
import { FileGridItem } from "./file-grid-item"
import { useFileBrowser } from "./file-browser-context"
import { Skeleton } from "@/components/ui/skeleton"
import { useBoxSelection } from "./hooks/use-box-selection"
import type { BrowseItem } from "./utils/types"
import { FileContextMenu } from "./file-context-menu"

interface FileGridProps {
  onNewFolder?: () => void
  onUpload?: () => void
}

export function FileGrid({ onNewFolder, onUpload }: FileGridProps) {
  const {
    items,
    isLoading,
    currentFolder,
    selectedItems,
    setSelectedItems,
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

  const handleContextMenu = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    const itemElement = target.closest("[data-item-id]")

    if (itemElement) {
      const itemId = itemElement.getAttribute("data-item-id")
      const clickedItem = items.find((i) => i.id === itemId)

      if (clickedItem) {
        setActiveItem(clickedItem)
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
    <FileContextMenu
      activeItem={activeItem}
      menuItems={menuItems}
      onOpenChange={(open) => !open && setActiveItem(null)}
      onNewFolder={onNewFolder}
      onUpload={onUpload}
    >
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
            className="absolute bg-accent/50 border border-primary rounded pointer-events-none z-10"
            style={{
              left: selectionBox.x,
              top: selectionBox.y,
              width: selectionBox.width,
              height: selectionBox.height,
            }}
          />
        )}

        {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 p-4">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="flex flex-col gap-2">
                <Skeleton className="aspect-square w-full rounded-lg" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center flex-1 min-h-[400px] text-muted-foreground">
            <FolderIcon className="w-16 h-16 mb-4 opacity-20" />
            <p className="text-lg font-medium">No items yet</p>
            <p className="text-sm">Upload some memes to get started</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 p-4">
            {items.map((item) => {
              const isSelected = selectedItems.has(item.id)
              return (
                <FileGridItem
                  key={item.id}
                  item={item}
                  isSelected={isSelected}
                  isActiveContext={activeItem?.id === item.id}
                  onContextMenu={setActiveItem}
                />
              )
            })}
          </div>
        )}
      </div>
    </FileContextMenu>
  )
}
