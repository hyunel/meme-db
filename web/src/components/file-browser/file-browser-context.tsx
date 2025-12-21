"use client"

import React, { createContext, useContext, useMemo } from "react"
import { useUser } from "@/hooks/use-user"
import { useBrowserData } from "./hooks/use-browser-data"
import { useSelection } from "./hooks/use-selection"
import { useDragDrop } from "./hooks/use-drag-drop"
import { useUpload } from "./hooks/use-upload"
import type { BrowseItem, SortOption, UploadingFile } from "./types"
import type { Node } from "@/lib/api"

interface FileBrowserContextType {
  // Data
  folderPath: Node[]
  currentFolder: Node | null
  sortBy: SortOption
  setSortBy: (sort: SortOption) => void
  items: BrowseItem[]
  isLoading: boolean
  error: any

  // Navigation
  navigateToFolder: (folder: Node) => void
  navigateToBreadcrumb: (index: number) => void

  // Actions
  createFolder: (name: string) => void
  deleteItems: (ids: string[]) => void
  moveItems: (ids: string[], targetFolderId?: string) => void
  refresh: () => void

  // Selection
  selectedItems: Set<string>
  setSelectedItems: (selected: Set<string>) => void
  clearSelection: () => void
  toggleSelection: (id: string) => void
  setSelection: (ids: string[] | Set<string>) => void

  // Drag & Drop
  isDragging: boolean
  dragTargetFolder: string | null
  dragTargetBreadcrumb: number | null
  setDragTargetBreadcrumb: (index: number | null) => void
  handleDragStart: (e: React.DragEvent, itemId: string) => void
  handleDragEnd: () => void
  handleDragOver: (e: React.DragEvent, targetFolderId?: string) => void
  handleDragLeave: (e: React.DragEvent) => void
  handleDrop: (e: React.DragEvent, targetFolderId?: string) => void

  // Upload
  uploadingFiles: UploadingFile[]
  upload: (files: File[], targetFolderId?: string) => void
}

const FileBrowserContext = createContext<FileBrowserContextType | undefined>(undefined)

export function FileBrowserProvider({ children }: { children: React.ReactNode }) {
  const { user } = useUser()

  const browserData = useBrowserData(user)
  const selection = useSelection()
  const upload = useUpload(user, browserData.refresh)
  const dragDrop = useDragDrop(
    selection.selectedItems,
    browserData.moveItems,
    upload.upload,
    browserData.items,
    selection.clearSelection,
    browserData.currentFolder?.id,
  )

  const value = useMemo(
    () => ({
      ...browserData,
      ...selection,
      ...dragDrop,
      ...upload,
    }),
    [browserData, selection, dragDrop, upload],
  )

  return <FileBrowserContext.Provider value={value}>{children}</FileBrowserContext.Provider>
}

export function useFileBrowser() {
  const context = useContext(FileBrowserContext)
  if (context === undefined) {
    throw new Error("useFileBrowser must be used within a FileBrowserProvider")
  }
  return context
}
