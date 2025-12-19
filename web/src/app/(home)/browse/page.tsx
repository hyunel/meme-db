"use client"

import type React from "react"
import { useState, useRef, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { mockFolders, mockMemes, type Folder, type Meme } from "@/lib/mock-data"
import { useUser } from "@/hooks/use-user"
import {
  FolderOpen,
  FolderPlus,
  Upload,
  ChevronRight,
  ImageIcon,
  Trash2,
  Home,
  Download,
  Heart,
  CheckSquare,
  Move,
  ArrowUpDown,
  X,
  FolderIcon,
} from "lucide-react"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { AuthGuard } from "@/components/auth-guard"

type BrowseItem = (Folder & { type: "folder" }) | (Meme & { type: "meme" })
type SortOption = "name" | "date" | "type"

function BrowsePageContent() {
  const router = useRouter()
  const { user } = useUser()
  const [folderPath, setFolderPath] = useState<Folder[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [dragTargetFolder, setDragTargetFolder] = useState<string | null>(null)
  const [dragTargetBreadcrumb, setDragTargetBreadcrumb] = useState<number | null>(null)
  const [uploadingFiles, setUploadingFiles] = useState<Array<{ name: string; progress: number; preview?: string }>>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [newFolderName, setNewFolderName] = useState("")
  const [dialogOpen, setDialogOpen] = useState(false)
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    item?: { id: string; type: "folder" | "meme" }
  } | null>(null)
  const [touchTimer, setTouchTimer] = useState<NodeJS.Timeout | null>(null)
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set())
  const [sortBy, setSortBy] = useState<SortOption>("name")

  const [isBoxSelecting, setIsBoxSelecting] = useState(false)
  const [selectionBox, setSelectionBox] = useState<{ x: number; y: number; width: number; height: number } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const selectionStartRef = useRef<{ x: number; y: number } | null>(null)

  const [draggingItems, setDraggingItems] = useState<Set<string>>(new Set())

  const [userFolders, setUserFolders] = useState<Folder[]>([...mockFolders.filter((f) => f.userId === user?.id)])
  const [userMemes, setUserMemes] = useState<Meme[]>([...mockMemes.filter((m) => m.userId === user?.id)])

  const currentFolder = folderPath.length > 0 ? folderPath[folderPath.length - 1] : null

  const currentFolders = userFolders.filter((f) => (currentFolder ? f.parentId === currentFolder.id : !f.parentId))

  const currentMemes = currentFolder
    ? userMemes.filter((m) => m.folderId === currentFolder.id)
    : userMemes.filter((m) => !m.folderId)

  const allItems: BrowseItem[] = [
    ...currentFolders.map((f) => ({ ...f, type: "folder" as const })),
    ...currentMemes.map((m) => ({ ...m, type: "meme" as const })),
  ].sort((a, b) => {
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

  const sortedAndFilteredItems: BrowseItem[] = allItems

  const handleFolderDoubleClick = (folder: Folder) => {
    setFolderPath([...folderPath, folder])
    setSelectedItems(new Set())
  }

  const handleBreadcrumbClick = (index: number) => {
    if (index === -1) {
      setFolderPath([])
    } else {
      setFolderPath(folderPath.slice(0, index + 1))
    }
    setSelectedItems(new Set())
  }

  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("[data-item-id]")) return
    if (e.button !== 0) return

    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return

    setIsBoxSelecting(true)
    selectionStartRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top }
    setSelectionBox({ x: e.clientX - rect.left, y: e.clientY - rect.top, width: 0, height: 0 })
    setSelectedItems(new Set())
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isBoxSelecting || !selectionStartRef.current) return

    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return

    const startX = selectionStartRef.current.x
    const startY = selectionStartRef.current.y
    const currentX = e.clientX - rect.left
    const currentY = e.clientY - rect.top

    setSelectionBox({
      x: Math.min(startX, currentX),
      y: Math.min(startY, currentY),
      width: Math.abs(currentX - startX),
      height: Math.abs(currentY - startY),
    })

    const box = selectionBox
    if (!box) return

    const itemElements = containerRef.current?.querySelectorAll("[data-item-id]")
    const selected = new Set<string>()

    itemElements?.forEach((el) => {
      const itemRect = el.getBoundingClientRect()
      const relativeRect = {
        left: itemRect.left - rect.left,
        top: itemRect.top - rect.top,
        right: itemRect.right - rect.left,
        bottom: itemRect.bottom - rect.top,
      }

      if (
        box.x < relativeRect.right &&
        box.x + box.width > relativeRect.left &&
        box.y < relativeRect.bottom &&
        box.y + box.height > relativeRect.top
      ) {
        const itemId = el.getAttribute("data-item-id")
        if (itemId) selected.add(itemId)
      }
    })

    setSelectedItems(selected)
  }

  const handleMouseUp = () => {
    setIsBoxSelecting(false)
    selectionStartRef.current = null
    setSelectionBox(null)
  }

  useEffect(() => {
    document.addEventListener("mouseup", handleMouseUp as any)
    return () => document.removeEventListener("mouseup", handleMouseUp as any)
  }, [])

  const handleContextMenu = (
    e: React.MouseEvent | React.TouchEvent,
    item?: { id: string; type: "folder" | "meme" },
  ) => {
    e.preventDefault()
    e.stopPropagation()

    const clientX = "touches" in e ? e.touches[0]?.clientX : e.clientX
    const clientY = "touches" in e ? e.touches[0]?.clientY : e.clientY

    const menuWidth = selectedItems.size > 0 ? 200 : 160
    const menuHeight = selectedItems.size > 0 ? 250 : 180
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight

    let x = clientX
    let y = clientY

    if (x + menuWidth > viewportWidth) {
      x = viewportWidth - menuWidth - 10
    }

    if (y + menuHeight > viewportHeight) {
      y = viewportHeight - menuHeight - 10
    }

    setContextMenu({ x, y, item })
  }

  const handleTouchStart = (e: React.TouchEvent, item: { id: string; type: "folder" | "meme" }) => {
    const timer = setTimeout(() => {
      handleContextMenu(e, item)
    }, 500)
    setTouchTimer(timer)
  }

  const handleTouchEnd = () => {
    if (touchTimer) {
      clearTimeout(touchTimer)
      setTouchTimer(null)
    }
  }

  const handleItemClick = (e: React.MouseEvent, itemId: string) => {
    if (isBoxSelecting) return
    if (selectedItems.size > 0) {
      e.preventDefault()
      const newSelected = new Set(selectedItems)
      if (newSelected.has(itemId)) {
        newSelected.delete(itemId)
      } else {
        newSelected.add(itemId)
      }
      setSelectedItems(newSelected)
    } else if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      const newSelected = new Set(selectedItems)
      if (newSelected.has(itemId)) {
        newSelected.delete(itemId)
      } else {
        newSelected.add(itemId)
      }
      setSelectedItems(newSelected)
    }
  }

  const handleMemeClick = (memeId: string, e: React.MouseEvent) => {
    if (selectedItems.size > 0 || e.ctrlKey || e.metaKey) {
      handleItemClick(e, memeId)
      return
    }
    router.push(`/meme/${memeId}`)
  }

  const handleItemDragStart = (e: React.DragEvent, itemId: string) => {
    if (selectedItems.has(itemId)) {
      setDraggingItems(selectedItems)
    } else {
      setDraggingItems(new Set([itemId]))
    }
    e.dataTransfer.effectAllowed = "move"
  }

  const handleItemDragEnd = () => {
    setDraggingItems(new Set())
    setDragTargetFolder(null)
    setDragTargetBreadcrumb(null)
  }

  const handleDragOver = (e: React.DragEvent, targetFolderId?: string, breadcrumbIndex?: number) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
    if (targetFolderId !== undefined) {
      setDragTargetFolder(targetFolderId)
      setDragTargetBreadcrumb(null)
    }
    if (breadcrumbIndex !== undefined) {
      setDragTargetBreadcrumb(breadcrumbIndex)
      setDragTargetFolder(null)
    }
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    const relatedTarget = e.relatedTarget as HTMLElement
    if (!relatedTarget || !e.currentTarget.contains(relatedTarget)) {
      setDragTargetFolder(null)
      setDragTargetBreadcrumb(null)
    }
  }

  const handleDrop = (e: React.DragEvent, targetFolderId?: string) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    setDragTargetFolder(null)
    setDragTargetBreadcrumb(null)

    if (draggingItems.size > 0) {
      const itemsToMove = Array.from(draggingItems)

      setUserMemes((prev) =>
        prev.map((meme) => (itemsToMove.includes(meme.id) ? { ...meme, folderId: targetFolderId } : meme)),
      )

      setUserFolders((prev) =>
        prev.map((folder) => (itemsToMove.includes(folder.id) ? { ...folder, parentId: targetFolderId } : folder)),
      )

      setDraggingItems(new Set())
      setSelectedItems(new Set())
      return
    }

    const files = Array.from(e.dataTransfer.files)
    if (files.length > 0) {
      simulateUpload(files, targetFolderId)
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files = Array.from(e.target.files)
      simulateUpload(files)
    }
  }

  const simulateUpload = (files: File[], targetFolderId?: string) => {
    const uploads = files.map((file) => {
      const preview = URL.createObjectURL(file)
      return { name: file.name, progress: 0, preview }
    })
    setUploadingFiles((prev) => [...prev, ...uploads])

    uploads.forEach((upload, index) => {
      let progress = 0
      const interval = setInterval(() => {
        progress += Math.random() * 15
        if (progress >= 100) {
          progress = 100
          clearInterval(interval)

          setTimeout(() => {
            const newMeme: Meme = {
              id: `uploaded-${Date.now()}-${index}`,
              title: upload.name,
              url: upload.preview || "/placeholder.svg",
              tags: ["uploaded", "new"],
              description: `Uploaded: ${upload.name}`,
              userId: user?.id || "user1",
              username: user?.username || "User",
              folderId: targetFolderId || currentFolder?.id,
              isPublic: false,
              createdAt: new Date().toString(),
              processingStatus: "complete",
            }
            setUserMemes((prev) => [...prev, newMeme])
            setUploadingFiles((prev) => prev.filter((u) => u.name !== upload.name))
          }, 500)
        }

        setUploadingFiles((prev) => prev.map((u) => (u.name === upload.name ? { ...u, progress } : u)))
      }, 200)
    })
  }

  const handleNewFolder = () => {
    if (newFolderName.trim()) {
      const newFolder: Folder = {
        id: `folder-${Date.now()}`,
        name: newFolderName,
        userId: user?.id || "user1",
        username: user?.username || "User",
        parentId: currentFolder?.id,
        memeCount: 0,
        isPublic: false,
        createdAt: new Date().toString(),
      }
      setUserFolders((prev) => [...prev, newFolder])
      setNewFolderName("")
      setDialogOpen(false)
    }
  }



  const handleBulkDelete = () => {
    const itemsToDelete = Array.from(selectedItems)
    setUserMemes((prev) => prev.filter((m) => !itemsToDelete.includes(m.id)))
    setUserFolders((prev) => prev.filter((f) => !itemsToDelete.includes(f.id)))
    setSelectedItems(new Set())
    setContextMenu(null)
  }

  const handleBulkDownload = () => {
    const itemsToDownload = Array.from(selectedItems)
    itemsToDownload.forEach((id) => {
      const meme = userMemes.find((m) => m.id === id)
      if (meme) {
        const link = document.createElement("a")
        link.href = meme.url
        link.download = `${meme.title}.${meme.format || "png"}`
        link.click()
      }
    })
    setContextMenu(null)
  }

  return (
    <AuthGuard>
      <div onClick={() => setContextMenu(null)}>
        <div className="container mx-auto px-4 py-6 md:py-8">
          <div className="flex items-center gap-2 mb-6 text-sm flex-wrap">
            <button
              onClick={() => handleBreadcrumbClick(-1)}
              onDragOver={(e) => handleDragOver(e, undefined, -1)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, undefined)}
              className={`flex items-center gap-1 hover:text-primary transition-colors px-2 py-1 rounded ${
                dragTargetBreadcrumb === -1 ? "bg-primary/10 ring-2 ring-primary" : ""
              }`}
            >
              <Home className="w-4 h-4" />
              <span className="hidden sm:inline">My Library</span>
            </button>
            {folderPath.map((folder, index) => (
              <div key={folder.id} className="flex items-center gap-2">
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
                <button
                  onClick={() => handleBreadcrumbClick(index)}
                  onDragOver={(e) => handleDragOver(e, undefined, index)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, folder.id)}
                  className={`hover:text-primary transition-colors max-w-[150px] truncate px-2 py-1 rounded ${
                    dragTargetBreadcrumb === index ? "bg-primary/10 ring-2 ring-primary" : ""
                  }`}
                >
                  {folder.name}
                </button>
              </div>
            ))}
          </div>

          {/* Header Actions */}
          <div className="flex items-center justify-between mb-6 gap-4">
            <h1 className="text-2xl md:text-3xl font-bold truncate">{currentFolder?.name || "My Library"}</h1>

            <div className="flex items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-8 gap-1">
                    <ArrowUpDown className="w-3.5 h-3.5" />
                    <span className="text-xs">{sortBy === "name" ? "Name" : sortBy === "date" ? "Date" : "Type"}</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-32">
                  <DropdownMenuItem onClick={() => setSortBy("name")}>Name</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setSortBy("date")}>Date</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setSortBy("type")}>Type</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <Button onClick={() => setDialogOpen(true)} variant="outline" size="sm" className="gap-2 bg-transparent flex">
                <FolderPlus className="w-4 h-4" />
                <span className="hidden md:inline">New Folder</span>
              </Button>

              <Button onClick={() => fileInputRef.current?.click()} size="sm" className="gap-2">
                <Upload className="w-4 h-4" />
                <span className="hidden sm:inline">Upload</span>
              </Button>
              <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                multiple
                accept="image/*,image/gif"
                onChange={handleFileSelect}
              />
            </div>
          </div>

          {/* <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
            <div className="flex items-center gap-2">
              <Button onClick={() => setDialogOpen(true)} variant="outline" size="sm">
                <FolderPlus className="w-4 h-4 mr-2" />
                <span className="hidden sm:inline">New Folder</span>
              </Button>
              <Button onClick={() => fileInputRef.current?.click()} variant="outline" size="sm">
                <Upload className="w-4 h-4 mr-2" />
                <span className="hidden sm:inline">Upload</span>
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*"
                onChange={handleFileSelect}
                className="hidden"
              />
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 gap-1">
                  <ArrowUpDown className="w-3.5 h-3.5" />
                  <span className="text-xs">{sortBy === "name" ? "Name" : sortBy === "date" ? "Date" : "Type"}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-32">
                <DropdownMenuItem onClick={() => setSortBy("name")}>Name</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSortBy("date")}>Date</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSortBy("type")}>Type</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div> */}

          {uploadingFiles.length > 0 && (
            <div className="mb-6 space-y-2">
              {uploadingFiles.map((file, index) => (
                <div key={index} className="bg-card border rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium truncate">{file.name}</span>
                    <span className="text-xs text-muted-foreground">{Math.round(file.progress)}%</span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
                    <div
                      className="bg-primary h-full transition-all duration-300 ease-out"
                      style={{ width: `${file.progress}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          <div
            ref={containerRef}
            onMouseDown={handleMouseDown}
            onMouseMove={isBoxSelecting ? handleMouseMove : undefined}
            onDragOver={(e) => handleDragOver(e)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e)}
            onContextMenu={(e) => handleContextMenu(e)}
            className={`min-h-[400px] rounded-xl border-2 border-dashed transition-all relative ${
              isDragging && !dragTargetFolder && dragTargetBreadcrumb === null
                ? "border-primary bg-primary/5 scale-[0.99]"
                : "border-border"
            }`}
          >
            {isBoxSelecting && selectionBox && (
              <div
                className="absolute bg-primary/20 border-2 border-primary rounded pointer-events-none z-10"
                style={{
                  left: selectionBox.x,
                  top: selectionBox.y,
                  width: selectionBox.width,
                  height: selectionBox.height,
                }}
              />
            )}

            {sortedAndFilteredItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-[400px] text-muted-foreground">
                <FolderIcon className="w-16 h-16 mb-4 opacity-20" />
                <p className="text-lg font-medium">No items yet</p>
                <p className="text-sm">Create a folder or upload some memes to get started</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 p-4">
                {sortedAndFilteredItems.map((item) => {
                  const isSelected = selectedItems.has(item.id)
                  const isFolderType = item.type === "folder"
                  const folder = isFolderType ? (item as Folder & { type: "folder" }) : null
                  const meme = !isFolderType ? (item as Meme & { type: "meme" }) : null

                  const folderPreviewMemes = isFolderType
                    ? userMemes.filter((m) => m.folderId === folder!.id).slice(0, 4)
                    : []

                  return (
                    <div
                      key={item.id}
                      data-item-id={item.id}
                      draggable
                      onDragStart={(e) => handleItemDragStart(e, item.id)}
                      onDragEnd={handleItemDragEnd}
                      onClick={(e) => {
                        if (isFolderType && !e.ctrlKey && !e.metaKey && selectedItems.size === 0) {
                          return
                        }
                        if (!isFolderType) {
                          handleMemeClick(item.id, e)
                        } else {
                          handleItemClick(e, item.id)
                        }
                      }}
                      onDoubleClick={() => isFolderType && handleFolderDoubleClick(folder as Folder)}
                      onContextMenu={(e) => handleContextMenu(e, item)}
                      onTouchStart={(e) => handleTouchStart(e, item)}
                      onTouchEnd={handleTouchEnd}
                      onDragOver={(e) => isFolderType && handleDragOver(e, item.id)}
                      onDragLeave={handleDragLeave}
                      onDrop={(e) => isFolderType && handleDrop(e, item.id)}
                      className={`group relative bg-card border rounded-xl overflow-hidden hover:shadow-lg hover:border-primary/50 transition-all cursor-pointer ${
                        isSelected ? "ring-2 ring-primary border-primary" : "border-border"
                      } ${dragTargetFolder === item.id ? "ring-2 ring-primary bg-primary/5 scale-95" : ""}`}
                    >
                      {isFolderType ? (
                        <div className="aspect-square relative">
                          {folderPreviewMemes.length > 0 ? (
                            <div className="grid grid-cols-2 gap-0.5 h-full w-full bg-muted">
                              {folderPreviewMemes.map((previewMeme, idx) => (
                                <div key={idx} className="relative overflow-hidden">
                                  <img
                                    src={previewMeme.url || "/placeholder.svg"}
                                    alt=""
                                    className="w-full h-full object-cover"
                                  />
                                </div>
                              ))}
                              {Array.from({ length: 4 - folderPreviewMemes.length }).map((_, idx) => (
                                <div key={`empty-${idx}`} className="bg-muted flex items-center justify-center">
                                  <ImageIcon className="w-6 h-6 text-muted-foreground/30" />
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="flex flex-col items-center justify-center h-full bg-muted">
                              <FolderOpen className="w-12 h-12 text-primary mb-2 group-hover:scale-110 transition-transform" />
                            </div>
                          )}
                          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent p-2">
                            <h3 className="font-medium text-sm truncate text-white">{folder!.name}</h3>
                            <p className="text-xs text-white/70">{folder!.memeCount} items</p>
                          </div>
                        </div>
                      ) : (
                        <div className="aspect-square relative">
                          <img
                            src={meme!.url || "/placeholder.svg"}
                            alt={meme!.title}
                            className="w-full h-full object-cover"
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-2">
                            <div className="flex flex-wrap gap-1">
                              {meme!.tags.slice(0, 2).map((tag) => (
                                <span
                                  key={tag}
                                  className="text-xs px-2 py-0.5 bg-white/20 backdrop-blur-sm rounded-full text-white"
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}

                      {isSelected && (
                        <div className="absolute top-2 right-2 w-6 h-6 bg-primary rounded-full flex items-center justify-center shadow-lg">
                          <CheckSquare className="w-4 h-4 text-primary-foreground" />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {selectedItems.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-5">
          <div className="bg-card border-2 border-primary shadow-2xl rounded-full px-4 py-2 flex items-center gap-2 max-w-[calc(100vw-2rem)]">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedItems(new Set())}
              className="h-8 w-8 p-0 shrink-0"
            >
              <X className="w-4 h-4" />
            </Button>
            <div className="h-6 w-px bg-border shrink-0" />
            <span className="text-sm font-medium whitespace-nowrap px-1">{selectedItems.size} selected</span>
            <div className="h-6 w-px bg-border shrink-0" />
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" onClick={handleBulkDownload} className="h-8 px-2 sm:px-3">
                <Download className="w-4 h-4" />
                <span className="hidden sm:inline ml-1.5">Download</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleBulkDelete}
                className="h-8 px-2 sm:px-3 text-destructive hover:text-destructive"
              >
                <Trash2 className="w-4 h-4" />
                <span className="hidden sm:inline ml-1.5">Delete</span>
              </Button>
            </div>
          </div>
        </div>
      )}

      {contextMenu && (
        <div
          className="fixed z-50 bg-card border shadow-lg rounded-lg py-1 min-w-[140px] animate-in fade-in-0 zoom-in-95 duration-100"
          style={{
            left: contextMenu.x,
            top: contextMenu.y,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {selectedItems.size > 0 ? (
            <>
              <button
                onClick={handleBulkDownload}
                className="w-full px-3 py-1.5 text-left text-sm hover:bg-accent flex items-center gap-2 transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                Download All
              </button>
              <button
                onClick={() => {
                  setContextMenu(null)
                }}
                className="w-full px-3 py-1.5 text-left text-sm hover:bg-accent flex items-center gap-2 transition-colors"
              >
                <Move className="w-3.5 h-3.5" />
                Move to...
              </button>
              <div className="h-px bg-border my-1" />
              <button
                onClick={handleBulkDelete}
                className="w-full px-3 py-1.5 text-left text-sm hover:bg-accent flex items-center gap-2 text-destructive transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete All
              </button>
            </>
          ) : contextMenu.item ? (
            <>
              {contextMenu.item.type === "meme" && (
                <>
                  <button
                    onClick={() => {
                      const meme = userMemes.find((m) => m.id === contextMenu.item?.id)
                      if (meme) {
                        const link = document.createElement("a")
                        link.href = meme.url
                        link.download = `${meme.title}.png`
                        link.click()
                      }
                      setContextMenu(null)
                    }}
                    className="w-full px-3 py-1.5 text-left text-sm hover:bg-accent flex items-center gap-2 transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Download
                  </button>
                  <button
                    onClick={() => {
                      setContextMenu(null)
                    }}
                    className="w-full px-3 py-1.5 text-left text-sm hover:bg-accent transition-colors"
                  >
                    <Heart className="w-3.5 h-3.5" />
                    Favorite
                  </button>
                </>
              )}
              <button
                onClick={() => {
                  setSelectedItems(new Set([contextMenu.item!.id]))
                  setContextMenu(null)
                }}
                className="w-full px-3 py-1.5 text-left text-sm hover:bg-accent transition-colors"
              >
                Select
              </button>
              <button
                onClick={() => {
                  setContextMenu(null)
                }}
                className="w-full px-3 py-1.5 text-left text-sm hover:bg-accent flex items-center gap-2 transition-colors"
              >
                <Move className="w-3.5 h-3.5" />
                Move to...
              </button>
              <div className="h-px bg-border my-1" />
              <button
                onClick={() => {
                  if (contextMenu.item?.type === "meme") {
                    setUserMemes((prev) => prev.filter((m) => m.id !== contextMenu.item?.id))
                  } else {
                    setUserFolders((prev) => prev.filter((f) => f.id !== contextMenu.item?.id))
                  }
                  setContextMenu(null)
                }}
                className="w-full px-3 py-1.5 text-left text-sm hover:bg-accent flex items-center gap-2 text-destructive transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => {
                  handleNewFolder()
                  setContextMenu(null)
                }}
                className="w-full px-3 py-1.5 text-left text-sm hover:bg-accent flex items-center gap-2 transition-colors"
              >
                <FolderPlus className="w-3.5 h-3.5" />
                New Folder
              </button>
              <button
                onClick={() => {
                  fileInputRef.current?.click()
                  setContextMenu(null)
                }}
                className="w-full px-3 py-1.5 text-left text-sm hover:bg-accent flex items-center gap-2 transition-colors"
              >
                <Upload className="w-3.5 h-3.5" />
                Upload
              </button>
            </>
          )}
        </div>
      )}

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
                if (e.key === "Enter") {
                  handleNewFolder()
                }
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
    </AuthGuard>
  )
}

export default function BrowsePage() {
  return <BrowsePageContent />
}
