"use client"

import React, { createContext, useContext, useMemo } from "react"
import { useUser } from "@/hooks/use-user"
import { useBrowserData } from "./hooks/use-browser-data"
import { useSelection } from "./hooks/use-selection"
import { useDragDrop } from "./hooks/use-drag-drop"
import { useUpload } from "./hooks/use-upload"
import type { BrowseItem, SortOption, UploadingFile, ContextMenuState } from "./types"
import type { Folder, Meme } from "@/lib/mock-data"

interface FileBrowserContextType {
  // Data
  folderPath: Folder[]
  currentFolder: Folder | null
  sortBy: SortOption
  setSortBy: (sort: SortOption) => void
  userFolders: Folder[]
  userMemes: Meme[]
  items: BrowseItem[]

  // Navigation
  navigateToFolder: (folder: Folder) => void
  navigateToBreadcrumb: (index: number) => void

  // Actions
  createFolder: (name: string) => void
  deleteItems: (ids: string[]) => void
  moveItems: (ids: string[], targetFolderId?: string) => void

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
  simulateUpload: (files: File[], targetFolderId?: string) => void
}

const FileBrowserContext = createContext<FileBrowserContextType | undefined>(undefined)

export function FileBrowserProvider({ children }: { children: React.ReactNode }) {
  const { user } = useUser()

  const browserData = useBrowserData(user)
  const selection = useSelection()
  const upload = useUpload(user, browserData.addMeme)
  const dragDrop = useDragDrop(
    selection.selectedItems,
    browserData.moveItems,
    upload.simulateUpload,
    browserData.sortedAndFilteredItems,
    selection.clearSelection,
    browserData.currentFolder?.id,
  )

  const value = useMemo(
    () => ({
      ...browserData,
      items: browserData.sortedAndFilteredItems,
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
