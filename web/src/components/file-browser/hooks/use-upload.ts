import { useState, useCallback } from "react"
import type { UploadingFile } from "../types"
import type { Meme } from "@/lib/mock-data"
import type { User } from "@/lib/auth"

export function useUpload(user: User | null, onUploadComplete: (meme: Meme) => void) {
  const [uploadingFiles, setUploadingFiles] = useState<UploadingFile[]>([])

  const simulateUpload = useCallback(
    (files: File[], targetFolderId?: string) => {
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
                folderId: targetFolderId,
                isPublic: false,
                createdAt: new Date().toString(),
                processingStatus: "complete",
              }
              onUploadComplete(newMeme)
              setUploadingFiles((prev) => prev.filter((u) => u.name !== upload.name))
            }, 500)
          }

          setUploadingFiles((prev) => prev.map((u) => (u.name === upload.name ? { ...u, progress } : u)))
        }, 200)
      })
    },
    [user, onUploadComplete],
  )

  return {
    uploadingFiles,
    simulateUpload,
  }
}
