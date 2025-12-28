"use client"

import { useState, useRef } from "react"
import { BreadcrumbNav } from "./breadcrumb-nav"
import { BrowserHeader } from "./browser-header"
import { FileGrid } from "./file-grid"
import { SelectionBar } from "./selection-bar"
import { useFileBrowser } from "./file-browser-context"
import { downloadMeme } from "@/lib/meme"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { ACCEPTED_FILE_TYPES } from "./utils/constants"
import type { BrowseItem } from "./utils/types"

export function FileBrowserView() {
  const {
    currentFolder,
    selectedItems,
    clearSelection,
    items,
    deleteItems,
    createFolder,
    updateItems,
    upload,
  } = useFileBrowser()

  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogMode, setDialogMode] = useState<"create" | "rename">("create")
  const [editingItem, setEditingItem] = useState<BrowseItem | null>(null)
  const [inputValue, setInputValue] = useState("")
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleDialogConfirm = () => {
    if (!inputValue.trim()) return

    if (dialogMode === "create") {
      createFolder(inputValue.trim())
    } else if (dialogMode === "rename" && editingItem) {
      updateItems([{ id: editingItem.id, name: inputValue.trim() }])
    }

    setInputValue("")
    setDialogOpen(false)
    setEditingItem(null)
  }

  const openCreateDialog = () => {
    setDialogMode("create")
    setEditingItem(null)
    setInputValue("")
    setDialogOpen(true)
  }

  const openRenameDialog = (item: BrowseItem) => {
    setDialogMode("rename")
    setEditingItem(item)
    setInputValue(item.name)
    setDialogOpen(true)
  }

  const handleBulkDelete = () => {
    deleteItems(Array.from(selectedItems))
    clearSelection()
  }

  const handleBulkDownload = () => {
    const itemsToDownload = items.filter((i) => selectedItems.has(i.id))
    itemsToDownload.forEach((item) => {
      if (item.type === "meme" && item.meme) {
        downloadMeme(item.meme)
      }
    })
    clearSelection()
  }

  return (
    <div className="container mx-auto px-4 py-6 md:py-8 flex-1 flex flex-col min-h-0">
      <BreadcrumbNav />

      <BrowserHeader
        title={currentFolder?.name || "My Library"}
        onNewFolder={openCreateDialog}
        onUploadClick={() => fileInputRef.current?.click()}
      />

      <input
        type="file"
        ref={fileInputRef}
        className="hidden"
        multiple
        accept={ACCEPTED_FILE_TYPES.join(",")}
        onChange={(e) => {
          if (e.target.files) {
            upload(
              Array.from(e.target.files).map((file) => ({ file })),
              currentFolder?.id,
            )
          }
        }}
      />

      <div className="flex-1 flex flex-col min-h-0">
        <FileGrid
          onNewFolder={openCreateDialog}
          onUpload={() => fileInputRef.current?.click()}
          onRename={openRenameDialog}
        />
      </div>

      <SelectionBar
        selectedCount={selectedItems.size}
        showDownload={!items.some((i) => selectedItems.has(i.id) && i.type === "folder")}
        onClearSelection={clearSelection}
        onBulkDownload={handleBulkDownload}
        onBulkDelete={handleBulkDelete}
      />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialogMode === "create" ? "Create New Folder" : "Rename"}</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="item-name" className="mb-2 block">
              Name
            </Label>
            <Input
              id="item-name"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="Enter name"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleDialogConfirm()
              }}
              autoFocus
              onFocus={(e) => e.target.select()}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleDialogConfirm} disabled={!inputValue.trim()}>
              {dialogMode === "create" ? "Create" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
