import { useState, useCallback } from "react"
import { uploadMeme, type Node } from "@/lib/api"
import type { UploadingFile } from "../types"
import type { User } from "@/lib/auth"

export function useUpload(user: User | null, onUploadComplete: () => void) {
  const [uploadingFiles, setUploadingFiles] = useState<UploadingFile[]>([])

  const performUpload = useCallback(
    async (files: File[], targetFolderId?: string) => {
      const newUploads = files.map((file) => ({
        name: file.name,
        progress: 0,
        preview: URL.createObjectURL(file),
      }))

      setUploadingFiles((prev) => [...prev, ...newUploads])

      // In a real scenario, we'd use XHR to track progress.
      // For now, since request() uses fetch, we'll simulate progress but perform real upload.
      for (const file of files) {
        try {
          // Real upload
          await uploadMeme(file, targetFolderId || "")

          // Complete
          setUploadingFiles((prev) =>
            prev.map((u) => (u.name === file.name ? { ...u, progress: 100 } : u)),
          )

          setTimeout(() => {
            setUploadingFiles((prev) => prev.filter((u) => u.name !== file.name))
            onUploadComplete()
          }, 500)
        } catch (error) {
          console.error(`Failed to upload ${file.name}:`, error)
          setUploadingFiles((prev) => prev.filter((u) => u.name !== file.name))
        }
      }
    },
    [onUploadComplete],
  )

  return {
    uploadingFiles,
    upload: performUpload,
  }
}
