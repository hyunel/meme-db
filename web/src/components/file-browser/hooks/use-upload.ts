import { useState, useCallback } from "react"
import { uploadMeme } from "@/lib/api"
import type { UploadingFile } from "../types"

export function useUpload(onUploadComplete: () => void) {
  const [uploadingFiles, setUploadingFiles] = useState<UploadingFile[]>([])

  const performUpload = useCallback(
    async (files: File[], targetFolderId?: string) => {
      const newUploads = files.map((file) => ({
        name: file.name,
        progress: 0,
        preview: URL.createObjectURL(file),
      }))

      setUploadingFiles((prev) => [...prev, ...newUploads])

      for (const file of files) {
        try {
          await uploadMeme(file, targetFolderId || "", (progress) => {
            setUploadingFiles((prev) =>
              prev.map((u) => (u.name === file.name ? { ...u, progress } : u)),
            )
          })

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
