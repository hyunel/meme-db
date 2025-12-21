import type { Folder, Meme } from "@/lib/mock-data"

export type BrowseItem = (Folder & { type: "folder" }) | (Meme & { type: "meme" })
export type SortOption = "name" | "date" | "type"

export interface UploadingFile {
  name: string
  progress: number
  preview?: string
}

export interface ContextMenuState {
  x: number
  y: number
  item?: { id: string; type: "folder" | "meme" }
}
