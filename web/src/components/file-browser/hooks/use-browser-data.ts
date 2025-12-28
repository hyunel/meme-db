import { useState, useMemo, useCallback } from "react"
import useSWR, { useSWRConfig } from "swr"
import { useRouter, useSearchParams, usePathname } from "next/navigation"
import { nodeList, nodeCreate, nodeBulkDelete, nodeBulkMove, nodeBulkCopy, nodeBulkUpdate, type Node } from "@/lib/api"
import { SortOption } from "../utils/constants"
import type { BrowseItem } from "../utils/types"
import type { User } from "@/store/auth"

const keySort = "meme_browser_sort"

export function useBrowserData(user: User | null) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const { mutate } = useSWRConfig()

  const currentFolderId = searchParams.get("fid") || ""
  const [sortBy, setSortBy] = useState<SortOption>(() => {
    if (typeof window !== "undefined") {
      const savedSort = localStorage.getItem(keySort) as SortOption
      if (savedSort && Object.values(SortOption).includes(savedSort)) {
        return savedSort
      }
    }
    return SortOption.NAME
  })

  // Save sort preference
  const handleSetSortBy = useCallback((newSort: SortOption) => {
    setSortBy(newSort)
    localStorage.setItem(keySort, newSort)
  }, [])

  const { data, isLoading, error } = useSWR(
    user ? ["/api/fs/nodes", currentFolderId] : null,
    ([, id]) => nodeList(id),
    {
      refreshInterval: (data) => {
        const hasProcessing = data?.children?.some(
          (node) =>
            node.meme?.processing_status === "pending" || node.meme?.processing_status === "processing",
        )
        return hasProcessing ? 3000 : 0
      },
    }
  )

  const folderPath = useMemo(() => data?.breadcrumbs || [], [data])
  const currentFolder = data?.node || null

  const sortedAndFilteredItems = useMemo(() => {
    if (!data?.children) return []

    const allItems: BrowseItem[] = data.children.map((node) => ({
      ...node,
      type: node.type === "FOLDER" ? ("folder" as const) : ("meme" as const),
    }))

    return allItems.sort((a, b) => {
      if (sortBy === SortOption.NAME) {
        if (a.type !== b.type) return a.type === "folder" ? -1 : 1
        if (a.type === "folder") {
          const nameCompare = a.name.localeCompare(b.name)
          if (nameCompare !== 0) return nameCompare
        }
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      } else if (sortBy === SortOption.DATE) {
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      }
      return 0
    })
  }, [data, sortBy])

  const navigateToFolder = useCallback(
    (folder: Node) => {
      const params = new URLSearchParams(searchParams.toString())
      params.set("fid", folder.id)
      router.push(`${pathname}?${params.toString()}`)
    },
    [router, pathname, searchParams],
  )

  const navigateToBreadcrumb = useCallback(
    (index: number) => {
      const params = new URLSearchParams(searchParams.toString())
      if (index === -1) {
        params.delete("fid")
      } else {
        const folder = folderPath[index]
        if (folder) {
          params.set("fid", folder.id)
        }
      }
      router.push(`${pathname}?${params.toString()}`)
    },
    [router, pathname, searchParams, folderPath],
  )

  const createFolder = async (name: string) => {
    await nodeCreate({ name, type: "FOLDER", parent_id: currentFolderId })
    mutate([`/api/fs/nodes`, currentFolderId])
  }

  const deleteItems = async (ids: string[]) => {
    await nodeBulkDelete(ids)
    mutate([`/api/fs/nodes`, currentFolderId])
  }

  const moveItems = async (ids: string[], targetFolderId?: string) => {
    await nodeBulkMove(ids, targetFolderId || "")
    mutate([`/api/fs/nodes`, currentFolderId])
    if (targetFolderId) {
      mutate([`/api/fs/nodes`, targetFolderId])
    }
  }

  const copyItems = async (ids: string[], targetFolderId?: string) => {
    await nodeBulkCopy(ids, targetFolderId || "")
    mutate([`/api/fs/nodes`, currentFolderId])
    if (targetFolderId) {
      mutate([`/api/fs/nodes`, targetFolderId])
    }
  }

  const updateItems = async (items: (Partial<Node> & { id: string })[]) => {
    await nodeBulkUpdate(items)
    mutate([`/api/fs/nodes`, currentFolderId])
  }

  const refresh = useCallback(() => {
    mutate([`/api/fs/nodes`, currentFolderId])
  }, [mutate, currentFolderId])

  return {
    folderPath,
    currentFolder,
    sortBy,
    setSortBy: handleSetSortBy,
    items: sortedAndFilteredItems,
    isLoading,
    error,
    navigateToFolder,
    navigateToBreadcrumb,
    createFolder,
    deleteItems,
    moveItems,
    copyItems,
    updateItems,
    refresh,
  }
}
