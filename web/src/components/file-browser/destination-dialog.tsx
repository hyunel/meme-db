"use client"

import * as React from "react"
import { FolderIcon, ChevronRight, ChevronLeft, Home, Search, Check } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { Node } from "@/lib/api"
import { nodeList } from "@/lib/api"
import useSWR from "swr"

interface DestinationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (targetFolderId?: string) => void
  title: string
  actionLabel: string
  excludeIds?: string[]
}

export function DestinationDialog({
  open,
  onOpenChange,
  onConfirm,
  title,
  actionLabel,
  excludeIds = [],
}: DestinationDialogProps) {
  const [currentFolderId, setCurrentFolderId] = React.useState<string>("")
  const [searchQuery, setSearchQuery] = React.useState("")

  // Use SWR to fetch nodes for the current location
  const { data: response, isLoading } = useSWR(
    open ? [`/api/library`, currentFolderId] : null,
    () => nodeList(currentFolderId)
  )

  const currentPath = response?.breadcrumbs || []

  const displayFolders = React.useMemo(() => {
    if (!response?.children) return []

    let filtered = response.children.filter((node) => {
      if (node.type !== 'FOLDER') return false
      if (excludeIds.includes(node.id)) return false
      return true
    })

    if (searchQuery) {
      filtered = filtered.filter((f) =>
        f.name.toLowerCase().includes(searchQuery.toLowerCase())
      )
    }

    return filtered.sort((a, b) => a.name.localeCompare(b.name))
  }, [response, excludeIds, searchQuery])

  const navigateTo = (folder: Node) => {
    setCurrentFolderId(folder.id)
  }

  const navigateUp = () => {
    const parentFolder = currentPath[currentPath.length - 2]
    setCurrentFolderId(parentFolder?.id || "")
  }

  const navigateToRoot = () => {
    setCurrentFolderId("")
  }

  const handleConfirm = () => {
    onConfirm(currentFolderId)
    onOpenChange(false)
  }

  // Reset state when dialog opens
  React.useEffect(() => {
    if (open) {
      setCurrentFolderId("")
      setSearchQuery("")
    }
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px] p-0 overflow-hidden flex flex-col h-[500px]">
        <DialogHeader className="p-6 pb-2">
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="px-6 py-2 flex flex-col gap-4 flex-1 overflow-hidden">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search folders..."
              className="pl-9 h-9"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="flex items-center gap-1 text-sm text-muted-foreground overflow-x-auto whitespace-nowrap py-1 scrollbar-none">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 flex items-center gap-1"
              onClick={navigateToRoot}
            >
              <Home className="h-3.5 w-3.5" />
              Root
            </Button>
            {currentPath.map((folder) => (
              <React.Fragment key={folder.id}>
                <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2"
                  onClick={() => setCurrentFolderId(folder.id)}
                >
                  {folder.name}
                </Button>
              </React.Fragment>
            ))}
          </div>

          <div className="flex-1 overflow-hidden border rounded-md bg-muted/30">
            <ScrollArea className="h-full">
              <div className="p-1">
                {currentPath.length > 0 && !searchQuery && (
                  <Button
                    variant="ghost"
                    className="w-full justify-start h-10 px-2 font-normal"
                    onClick={navigateUp}
                  >
                    <ChevronLeft className="mr-2 h-4 w-4" />
                    ... back
                  </Button>
                )}

                {isLoading ? (
                   <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
                    <p className="text-sm">Loading folders...</p>
                  </div>
                ) : displayFolders.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
                    <FolderIcon className="h-8 w-8 mb-2 opacity-20" />
                    <p className="text-sm">No folders found</p>
                  </div>
                ) : (
                  displayFolders.map((folder) => (
                    <Button
                      key={folder.id}
                      variant="ghost"
                      className="w-full justify-between h-10 px-2 font-normal group"
                      onClick={() => navigateTo(folder)}
                    >
                      <div className="flex items-center">
                        <FolderIcon className="mr-2 h-4 w-4 text-primary/60" />
                        <span className="truncate">{folder.name}</span>
                      </div>
                      <ChevronRight className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </Button>
                  ))
                )}
              </div>
            </ScrollArea>
          </div>
        </div>

        <DialogFooter className="p-6 pt-2 bg-muted/50 border-t">
          <div className="flex items-center justify-between w-full">
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              <span className="font-medium">Selection:</span>
              <span className="text-foreground flex items-center gap-1">
                {currentPath.length > 0 ? (
                  <>
                    <FolderIcon className="h-3 w-3" />
                    {currentPath[currentPath.length - 1].name}
                  </>
                ) : (
                  "Root"
                )}
              </span>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleConfirm}>
                <Check className="mr-2 h-4 w-4" />
                {actionLabel}
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
