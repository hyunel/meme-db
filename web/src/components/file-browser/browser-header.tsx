"use client"

import { ArrowUpDown, FolderPlus, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { useFileBrowser } from "./file-browser-context"
import { SortOption } from "./utils/constants"

interface BrowserHeaderProps {
  title: string
  onNewFolder: () => void
  onUploadClick: () => void
}

export function BrowserHeader({ title, onNewFolder, onUploadClick }: BrowserHeaderProps) {
  const { sortBy, setSortBy } = useFileBrowser()

  const formatSortedBy = (sort: SortOption) => {
    return sort.charAt(0).toUpperCase() + sort.slice(1)
  }

  return (
    <div className="flex items-center justify-between mb-6 gap-4">
      <h1 className="text-2xl md:text-3xl font-bold truncate">{title}</h1>

      <div className="flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 gap-1">
              <ArrowUpDown className="w-3.5 h-3.5" />
              <span className="text-xs">{formatSortedBy(sortBy)}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuRadioGroup value={sortBy} onValueChange={(v) => setSortBy(v as SortOption)}>
              {
                Object.values(SortOption).map((option) => (
                  <DropdownMenuRadioItem key={option} value={option}>
                    {formatSortedBy(option)}
                  </DropdownMenuRadioItem>
                ))
              }
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button onClick={onNewFolder} variant="outline" size="sm" className="gap-2 bg-transparent flex">
          <FolderPlus className="w-4 h-4" />
          <span className="hidden md:inline">New Folder</span>
        </Button>

        <Button onClick={onUploadClick} size="sm" className="gap-2">
          <Upload className="w-4 h-4" />
          <span className="hidden sm:inline">Upload</span>
        </Button>
      </div>
    </div>
  )
}
