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

export function FileBrowserView() {
  const {
    currentFolder,
    selectedItems,
    clearSelection,
    items,
    deleteItems,
    createFolder,
    upload,
  } = useFileBrowser()

  const [dialogOpen, setDialogOpen] = useState(false)
  const [newFolderName, setNewFolderName] = useState("")
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleNewFolder = () => {
    if (newFolderName.trim()) {
      createFolder(newFolderName.trim())
      setNewFolderName("")
      setDialogOpen(false)
    }
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
        onNewFolder={() => setDialogOpen(true)}
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
            upload(Array.from(e.target.files), currentFolder?.id)
          }
        }}
      />

      <div className="flex-1 flex flex-col min-h-0">
        <FileGrid
          onNewFolder={() => setDialogOpen(true)}
          onUpload={() => fileInputRef.current?.click()}
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
            <DialogTitle>Create New Folder</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="folder-name" className="mb-2 block">
              Folder Name
            </Label>
            <Input
              id="folder-name"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="Enter folder name"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleNewFolder()
              }}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleNewFolder} disabled={!newFolderName.trim()}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
