import { useState, useRef, useEffect, useCallback } from "react"

export function useBoxSelection(
  containerRef: React.RefObject<HTMLDivElement | null>,
  onSelectionChange: (selected: Set<string>) => void,
) {
  const [isBoxSelecting, setIsBoxSelecting] = useState(false)
  const [selectionBox, setSelectionBox] = useState<{ x: number; y: number; width: number; height: number } | null>(null)
  const selectionStartRef = useRef<{ x: number; y: number } | null>(null)

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest("[data-item-id]")) return
      if (e.button !== 0) return

      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return

      setIsBoxSelecting(true)
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      selectionStartRef.current = { x, y }
      setSelectionBox({ x, y, width: 0, height: 0 })
      onSelectionChange(new Set())
    },
    [containerRef, onSelectionChange],
  )

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isBoxSelecting || !selectionStartRef.current) return

      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return

      const startX = selectionStartRef.current.x
      const startY = selectionStartRef.current.y
      const currentX = e.clientX - rect.left
      const currentY = e.clientY - rect.top

      const newBox = {
        x: Math.min(startX, currentX),
        y: Math.min(startY, currentY),
        width: Math.abs(currentX - startX),
        height: Math.abs(currentY - startY),
      }
      setSelectionBox(newBox)

      const itemElements = containerRef.current?.querySelectorAll("[data-item-id]")
      const selected = new Set<string>()

      itemElements?.forEach((el) => {
        const itemRect = el.getBoundingClientRect()
        const relativeRect = {
          left: itemRect.left - rect.left,
          top: itemRect.top - rect.top,
          right: itemRect.right - rect.left,
          bottom: itemRect.bottom - rect.top,
        }

        if (
          newBox.x < relativeRect.right &&
          newBox.x + newBox.width > relativeRect.left &&
          newBox.y < relativeRect.bottom &&
          newBox.y + newBox.height > relativeRect.top
        ) {
          const itemId = el.getAttribute("data-item-id")
          if (itemId) selected.add(itemId)
        }
      })

      onSelectionChange(selected)
    },
    [isBoxSelecting, containerRef, onSelectionChange],
  )

  const handleMouseUp = useCallback(() => {
    setIsBoxSelecting(false)
    selectionStartRef.current = null
    setSelectionBox(null)
  }, [])

  useEffect(() => {
    document.addEventListener("mouseup", handleMouseUp)
    return () => document.removeEventListener("mouseup", handleMouseUp)
  }, [handleMouseUp])

  return {
    isBoxSelecting,
    selectionBox,
    handleMouseDown,
    handleMouseMove,
  }
}
