"use client"

import React from "react"
import { ChevronRight, Home } from "lucide-react"
import { useFileBrowser } from "./file-browser-context"

export function BreadcrumbNav() {
  const {
    currentFolder,
    folderPath,
    dragTargetBreadcrumb,
    navigateToBreadcrumb,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    setDragTargetBreadcrumb,
    isDragging,
  } = useFileBrowser()

  return (
    <div className="flex items-center gap-2 mb-6 text-sm flex-wrap">
      <button
        onClick={() => navigateToBreadcrumb(-1)}
        onDragOver={(e) => {
          handleDragOver(e, undefined)
          if (currentFolder !== null) {
            setDragTargetBreadcrumb(-1)
          }
        }}
        onDragLeave={handleDragLeave}
        onDrop={(e) => handleDrop(e)}
        className={`flex items-center gap-1 hover:text-primary transition-colors px-2 py-1 rounded ${
          dragTargetBreadcrumb === -1 && isDragging ? "bg-primary/10 ring-2 ring-primary" : ""
        }`}
      >
        <Home className="w-4 h-4" />
        <span className="hidden sm:inline">My Library</span>
      </button>

      {folderPath.map((folder, index) => (
        <div key={folder.id} className="flex items-center gap-2">
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
          <button
            onClick={() => navigateToBreadcrumb(index)}
            onDragOver={(e) => {
              handleDragOver(e, folder.id)
              if (currentFolder?.id !== folder.id) {
                setDragTargetBreadcrumb(index)
              }
            }}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, folder.id)}
            className={`hover:text-primary transition-colors max-w-[150px] truncate px-2 py-1 rounded ${
              dragTargetBreadcrumb === index && isDragging ? "bg-primary/10 ring-2 ring-primary" : ""
            }`}
          >
            {folder.name}
          </button>
        </div>
      ))}
    </div>
  )
}
