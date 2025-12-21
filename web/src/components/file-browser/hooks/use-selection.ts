import { useState, useCallback } from "react"

export function useSelection() {
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set())

  const clearSelection = useCallback(() => {
    setSelectedItems(new Set())
  }, [])

  const toggleSelection = useCallback((itemId: string) => {
    setSelectedItems((prev) => {
      const next = new Set(prev)
      if (next.has(itemId)) {
        next.delete(itemId)
      } else {
        next.add(itemId)
      }
      return next
    })
  }, [])

  const setSelection = useCallback((ids: string[] | Set<string>) => {
    setSelectedItems(new Set(ids))
  }, [])

  const isSelected = useCallback(
    (itemId: string) => {
      return selectedItems.has(itemId)
    },
    [selectedItems],
  )

  return {
    selectedItems,
    setSelectedItems,
    clearSelection,
    toggleSelection,
    setSelection,
    isSelected,
  }
}
