import type { Node } from "@/lib/api"


export type BrowseItem = Omit<Node, 'type'> & { type: "folder" | "meme" }

export interface UploadingFile {
  name: string
  progress: number
  preview?: string
  error?: string
}

export interface ContextMenuState {
  x: number
  y: number
  item?: { id: string; type: "folder" | "meme" }
}
