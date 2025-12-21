"use client"

import React, { useState, useRef } from "react"
import { BreadcrumbNav } from "./breadcrumb-nav"
import { BrowserHeader } from "./browser-header"
import { UploadProgress } from "./upload-progress"
import { FileGrid } from "./file-grid"
import { SelectionBar } from "./selection-bar"
import { useFileBrowser } from "./file-browser-context"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"

export function FileBrowserView() {
  const {
    currentFolder,
    uploadingFiles,
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
    Array.from(selectedItems).forEach((id) => {
      const item = items.find((m) => m.id === id)
      if (item && item.type === "meme" && item.url) {
        const link = document.createElement("a")
        link.href = item.url
        link.download = `${item.name}.png`
        link.click()
      }
    })
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
        accept="image/*,image/gif"
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
        onClearSelection={clearSelection}
        onBulkDownload={handleBulkDownload}
        onBulkDelete={handleBulkDelete}
      />

      <UploadProgress uploadingFiles={uploadingFiles} />

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
