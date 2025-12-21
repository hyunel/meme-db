import { useState, useMemo, useCallback } from "react"
import useSWR, { useSWRConfig } from "swr"
import { fetchNodes, createNode, bulkDeleteNodes, bulkMoveNodes, type Node } from "@/lib/api"
import type { BrowseItem, SortOption } from "../types"
import type { User } from "@/lib/auth"

export function useBrowserData(user: User | null) {
  const { mutate } = useSWRConfig()
  const [currentFolderId, setCurrentFolderId] = useState<string>("")
  const [sortBy, setSortBy] = useState<SortOption>("name")

  const { data, isLoading, error } = useSWR(
    user ? [`/api/fs/nodes`, currentFolderId] : null,
    () => fetchNodes(currentFolderId),
  )

  const folderPath = data?.breadcrumbs || []
  const currentFolder = data?.node || null

  const sortedAndFilteredItems = useMemo(() => {
    if (!data?.children) return []

    const allItems: BrowseItem[] = data.children.map((node) => ({
      ...node,
      type: node.type === "FOLDER" ? ("folder" as const) : ("meme" as const),
    }))

    return allItems.sort((a, b) => {
      if (sortBy === "name") {
        return a.name.localeCompare(b.name)
      } else if (sortBy === "date") {
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      } else if (sortBy === "type") {
        if (a.type !== b.type) return a.type === "folder" ? -1 : 1
        return 0
      }
      return 0
    })
  }, [data?.children, sortBy])

  const navigateToFolder = useCallback((folder: Node) => {
    setCurrentFolderId(folder.id)
  }, [])

  const navigateToBreadcrumb = useCallback((index: number) => {
    if (index === -1) {
      setCurrentFolderId("")
    } else {
      const folder = folderPath[index]
      if (folder) {
        setCurrentFolderId(folder.id)
      }
    }
  }, [folderPath])

  const createFolder = async (name: string) => {
    await createNode({ name, type: "FOLDER", parent_id: currentFolderId })
    mutate([`/api/fs/nodes`, currentFolderId])
  }

  const deleteItems = async (ids: string[]) => {
    await bulkDeleteNodes(ids)
    mutate([`/api/fs/nodes`, currentFolderId])
  }

  const moveItems = async (ids: string[], targetFolderId?: string) => {
    await bulkMoveNodes(ids, targetFolderId || "")
    mutate([`/api/fs/nodes`, currentFolderId])
    if (targetFolderId) {
      mutate([`/api/fs/nodes`, targetFolderId])
    }
  }

  const refresh = useCallback(() => {
    mutate([`/api/fs/nodes`, currentFolderId])
  }, [mutate, currentFolderId])

  return {
    folderPath,
    currentFolder,
    sortBy,
    setSortBy,
    items: sortedAndFilteredItems,
    isLoading,
    error,
    navigateToFolder,
    navigateToBreadcrumb,
    createFolder,
    deleteItems,
    moveItems,
    refresh,
  }
}
