"use client"

import useSWR from "swr"
import { nodeList, type Node } from "@/lib/api"
import { ImageIcon, FolderOpen } from "lucide-react"
import { MemeRenderer } from "./meme-renderer"
import { cn } from "@/lib/utils"

export function useFolderPreview(folderId: string, enabled: boolean = true) {
  const { data, isLoading } = useSWR(
    enabled ? [`/api/fs/nodes`, folderId] : null,
    () => nodeList(folderId)
  )

  const previewNodes = data?.children?.filter((n: Node) => n.type === 'FILE').slice(0, 4) || []
  const totalItems = data?.children?.length || 0

  return {
    previewNodes,
    totalItems,
    isLoading
  }
}

interface FolderPreviewProps {
  folderId: string
  className?: string
  iconClassName?: string
}

export function FolderPreview({ folderId, className, iconClassName }: FolderPreviewProps) {
  const { previewNodes } = useFolderPreview(folderId)

  if (previewNodes.length > 0) {
    return (
      <div className={cn("grid grid-cols-2 gap-0.5 h-full w-full bg-muted overflow-hidden", className)}>
        {previewNodes.map((previewNode: Node, idx: number) => (
          <div key={idx} className="relative w-full h-full overflow-hidden">
            <MemeRenderer
              meme={previewNode.meme}
              className="absolute inset-0 w-full h-full object-cover"
            />
          </div>
        ))}
        {Array.from({ length: 4 - previewNodes.length }).map((_, idx) => (
          <div key={`empty-${idx}`} className="bg-muted flex items-center justify-center">
            <ImageIcon className={cn("w-6 h-6 text-muted-foreground/30", iconClassName)} />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className={cn("flex flex-col items-center justify-center h-full bg-muted", className)}>
      <FolderOpen className={cn("w-12 h-12 text-primary group-hover:scale-110 transition-transform", iconClassName)} />
    </div>
  )
}
