"use client"

import { Download, Trash2, X } from "lucide-react"
import { Button } from "@/components/ui/button"

interface SelectionBarProps {
  selectedCount: number
  showDownload: boolean
  onClearSelection: () => void
  onBulkDownload: () => void
  onBulkDelete: () => void
}

export function SelectionBar({
  selectedCount,
  showDownload,
  onClearSelection,
  onBulkDownload,
  onBulkDelete,
}: SelectionBarProps) {
  if (selectedCount === 0) return null

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-5">
      <div className="bg-card border-2 border-primary shadow-2xl rounded-full px-4 py-2 flex items-center gap-2 max-w-[calc(100vw-2rem)]">
        <Button variant="ghost" size="sm" onClick={onClearSelection} className="h-8 w-8 p-0 shrink-0">
          <X className="w-4 h-4" />
        </Button>
        <div className="h-6 w-px bg-border shrink-0" />
        <span className="text-sm font-medium whitespace-nowrap px-1">{selectedCount} selected</span>
        <div className="h-6 w-px bg-border shrink-0" />
        <div className="flex items-center gap-1">
          {showDownload && (
            <Button variant="ghost" size="sm" onClick={onBulkDownload} className="h-8 px-2 sm:px-3">
              <Download className="w-4 h-4" />
              <span className="hidden sm:inline ml-1.5">Download</span>
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={onBulkDelete}
            className="h-8 px-2 sm:px-3 text-destructive hover:text-destructive"
          >
            <Trash2 className="w-4 h-4" />
            <span className="hidden sm:inline ml-1.5">Delete</span>
          </Button>
        </div>
      </div>
    </div>
  )
}
