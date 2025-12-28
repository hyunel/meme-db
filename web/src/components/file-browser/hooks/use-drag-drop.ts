import { useState, useCallback } from "react"
import type { BrowseItem, FileWithTarget } from "../utils/types"
import { createDragPreview } from "../utils/drag-preview"

export function useDragDrop(
  selectedItems: Set<string>,
  onMoveItems: (ids: string[], targetFolderId?: string) => void,
  onUploadFiles: (files: FileWithTarget[], targetFolderId?: string) => void,
  items: BrowseItem[],
  clearSelection: () => void,
  currentFolderId?: string,
) {
  const [isDragging, setIsDragging] = useState(false)
  const [dragTargetFolder, setDragTargetFolder] = useState<string | null>(null)
  const [dragTargetBreadcrumb, setDragTargetBreadcrumb] = useState<number | null>(null)
  const [draggingItems, setDraggingItems] = useState<Set<string>>(new Set())

  const handleDragStart = useCallback(
    (e: React.DragEvent, itemId: string) => {
      let itemsToDrag: Set<string>
      if (selectedItems.has(itemId)) {
        itemsToDrag = selectedItems
      } else {
        itemsToDrag = new Set([itemId])
      }

      setDraggingItems(itemsToDrag)
      e.dataTransfer.effectAllowed = "move"

      // Create custom drag preview
      const draggedItemsData = items.filter((item) => itemsToDrag.has(item.id))
      // Ensure the item that started the drag is first in the list for the preview
      const firstItem = draggedItemsData.find((item) => item.id === itemId)
      const otherItems = draggedItemsData.filter((item) => item.id !== itemId)
      const sortedDraggedItems = firstItem ? [firstItem, ...otherItems] : draggedItemsData

      const preview = createDragPreview(sortedDraggedItems)
      document.body.appendChild(preview)
      e.dataTransfer.setDragImage(preview, 20, 20)

      // Remove the preview element after a short delay so the browser can capture it
      setTimeout(() => {
        document.body.removeChild(preview)
      }, 0)
    },
    [selectedItems, items],
  )

  const handleDragEnd = useCallback(() => {
    setDraggingItems(new Set())
    setDragTargetFolder(null)
    setDragTargetBreadcrumb(null)
    setIsDragging(false)
  }, [])

  const canDrop = useCallback(
    (targetFolderId?: string) => {
      if (draggingItems.size > 0) {
        // 1. Cannot drop into the current folder (same as source)
        if (targetFolderId === currentFolderId) return false
        // 2. Cannot drop into itself
        if (targetFolderId !== undefined && draggingItems.has(targetFolderId)) return false
        return true
      }
      // External files can be dropped anywhere
      return true
    },
    [draggingItems, currentFolderId],
  )

  const handleDragOver = useCallback(
    (e: React.DragEvent, targetFolderId?: string) => {
      e.stopPropagation()

      if (!canDrop(targetFolderId)) {
        setIsDragging(false)
        setDragTargetFolder(null)
        return
      }

      e.preventDefault()
      setIsDragging(true)

      if (targetFolderId !== undefined) {
        setDragTargetFolder(targetFolderId)
        setDragTargetBreadcrumb(null)
      }
    },
    [canDrop],
  )

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const relatedTarget = e.relatedTarget as HTMLElement
    if (!relatedTarget || !(e.currentTarget as HTMLElement).contains(relatedTarget)) {
      setDragTargetFolder(null)
      setDragTargetBreadcrumb(null)
    }
  }, [])

  const handleDrop = useCallback(
    async (e: React.DragEvent, targetFolderId?: string) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragging(false)
      setDragTargetFolder(null)
      setDragTargetBreadcrumb(null)

      if (!canDrop(targetFolderId)) return

      if (draggingItems.size > 0) {
        onMoveItems(Array.from(draggingItems), targetFolderId)
        setDraggingItems(new Set())
        clearSelection()
        return
      }

      const dtItems = Array.from(e.dataTransfer.items || [])
      if (dtItems.length > 0) {
        const filesWithTarget: FileWithTarget[] = []
        const traverse = async (entry: any, path = "") => {
          if (entry.isFile) {
            const file = await new Promise<File>((resolve) => entry.file(resolve))
            filesWithTarget.push({ file, path })
          } else if (entry.isDirectory) {
            const entries = await new Promise<any[]>((res) => entry.createReader().readEntries(res))
            for (const child of entries) await traverse(child, path ? `${path}/${entry.name}` : entry.name)
          }
        }
        await Promise.all(dtItems.map((item) => traverse(item.webkitGetAsEntry())))
        if (filesWithTarget.length) onUploadFiles(filesWithTarget, targetFolderId)
      } else {
        const files = Array.from(e.dataTransfer.files)
        if (files.length) onUploadFiles(files.map((file) => ({ file })), targetFolderId)
      }
    },
    [draggingItems, onMoveItems, onUploadFiles, canDrop, clearSelection],
  )

  return {
    isDragging,
    dragTargetFolder,
    dragTargetBreadcrumb,
    setDragTargetBreadcrumb,
    draggingItems,
    handleDragStart,
    handleDragEnd,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  }
}
