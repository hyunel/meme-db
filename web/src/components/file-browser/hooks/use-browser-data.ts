import { useState, useMemo } from "react"
import { mockFolders, mockMemes, type Folder, type Meme } from "@/lib/mock-data"
import type { BrowseItem, SortOption } from "../types"
import type { User } from "@/lib/auth"

export function useBrowserData(user: User | null) {
  const [folderPath, setFolderPath] = useState<Folder[]>([])
  const [sortBy, setSortBy] = useState<SortOption>("name")
  const [userFolders, setUserFolders] = useState<Folder[]>([...mockFolders.filter((f) => f.userId === user?.id)])
  const [userMemes, setUserMemes] = useState<Meme[]>([...mockMemes.filter((m) => m.userId === user?.id)])

  const currentFolder = folderPath.length > 0 ? folderPath[folderPath.length - 1] : null

  const sortedAndFilteredItems = useMemo(() => {
    const currentFolders = userFolders.filter((f) => (currentFolder ? f.parentId === currentFolder.id : !f.parentId))
    const currentMemes = currentFolder
      ? userMemes.filter((m) => m.folderId === currentFolder.id)
      : userMemes.filter((m) => !m.folderId)

    const allItems: BrowseItem[] = [
      ...currentFolders.map((f) => ({ ...f, type: "folder" as const })),
      ...currentMemes.map((m) => ({ ...m, type: "meme" as const })),
    ]

    return allItems.sort((a, b) => {
      if (sortBy === "name") {
        const nameA = a.type === "folder" ? a.name : (a as Meme).title
        const nameB = b.type === "folder" ? b.name : (b as Meme).title
        return nameA.localeCompare(nameB)
      } else if (sortBy === "date") {
        return new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime()
      } else if (sortBy === "type") {
        if (a.type !== b.type) return a.type === "folder" ? -1 : 1
        return 0
      }
      return 0
    })
  }, [userFolders, userMemes, currentFolder, sortBy])

  const navigateToFolder = (folder: Folder) => {
    setFolderPath((prev) => [...prev, folder])
  }

  const navigateToBreadcrumb = (index: number) => {
    if (index === -1) {
      setFolderPath([])
    } else {
      setFolderPath((prev) => prev.slice(0, index + 1))
    }
  }

  const createFolder = (name: string) => {
    const newFolder: Folder = {
      id: `folder-${Date.now()}`,
      name,
      userId: user?.id || "user1",
      username: user?.username || "User",
      parentId: currentFolder?.id,
      memeCount: 0,
      isPublic: false,
      createdAt: new Date().toString(),
    }
    setUserFolders((prev) => [...prev, newFolder])
  }

  const deleteItems = (ids: string[]) => {
    setUserMemes((prev) => prev.filter((m) => !ids.includes(m.id)))
    setUserFolders((prev) => prev.filter((f) => !ids.includes(f.id)))
  }

  const moveItems = (ids: string[], targetFolderId?: string) => {
    setUserMemes((prev) => prev.map((meme) => (ids.includes(meme.id) ? { ...meme, folderId: targetFolderId } : meme)))
    setUserFolders((prev) =>
      prev.map((folder) => (ids.includes(folder.id) ? { ...folder, parentId: targetFolderId } : folder)),
    )
  }

  const addMeme = (meme: Meme) => {
    setUserMemes((prev) => [...prev, meme])
  }

  return {
    folderPath,
    currentFolder,
    sortBy,
    setSortBy,
    userFolders,
    userMemes,
    sortedAndFilteredItems,
    navigateToFolder,
    navigateToBreadcrumb,
    createFolder,
    deleteItems,
    moveItems,
    addMeme,
  }
}
