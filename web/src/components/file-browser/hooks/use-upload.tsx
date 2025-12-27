import { useState, useCallback, useEffect, useRef } from "react"
import { toast } from "sonner"
import { nodeUpload } from "@/lib/api"
import { UploadProgress } from "../upload-progress"
import type { UploadingFile } from "../utils/types"

export function useUpload(onUploadComplete: () => void) {
  const [uploadingFiles, setUploadingFiles] = useState<UploadingFile[]>([])
  const [isExpanded, setIsExpanded] = useState(true)
  const toastIdRef = useRef<string | number | null>(null)

  useEffect(() => {
    if (uploadingFiles.length > 0) {
      const allDone = uploadingFiles.every((f) => f.progress === 100 || !!f.error)

      if (toastIdRef.current === null) {
        toastIdRef.current = toast.custom(
          (t) => (
            <UploadProgress
              uploadingFiles={uploadingFiles}
              isExpanded={isExpanded}
              onToggleExpand={() => setIsExpanded((prev) => !prev)}
            />
          ),
          {
            duration: allDone ? 4000 : Infinity,
            position: "bottom-right",
            onAutoClose: () => {
              setUploadingFiles([])
              toastIdRef.current = null
            },
            onDismiss: () => {
              setUploadingFiles([])
              toastIdRef.current = null
            },
          },
        )
      } else {
        toast.custom(
          (t) => (
            <UploadProgress
              uploadingFiles={uploadingFiles}
              isExpanded={isExpanded}
              onToggleExpand={() => setIsExpanded((prev) => !prev)}
            />
          ),
          {
            id: toastIdRef.current,
            duration: allDone ? 4000 : Infinity,
            position: "bottom-right",
          },
        )
      }
    }
  }, [uploadingFiles, isExpanded])

  const performUpload = useCallback(
    async (files: File[], targetFolderId?: string) => {
      const newUploads = files.map((file) => ({
        name: file.name,
        progress: 0,
        preview: URL.createObjectURL(file),
      }))

      setUploadingFiles((prev) => [...prev, ...newUploads])

      // Track all files in this batch to keep them in state until finished
      const results = await Promise.allSettled(
        files.map(async (file) => {
          try {
            await nodeUpload(file, targetFolderId || "", (progress) => {
              setUploadingFiles((prev) =>
                prev.map((u) => (u.name === file.name ? { ...u, progress } : u)),
              )
            })
            // Mark as 100% explicitly to ensure state is consistent
            setUploadingFiles((prev) =>
              prev.map((u) => (u.name === file.name ? { ...u, progress: 100 } : u)),
            )
            onUploadComplete()
          } catch (error) {
            console.error(`Upload failed for ${file.name}:`, error)
            setUploadingFiles((prev) =>
              prev.map((u) =>
                u.name === file.name
                  ? { ...u, error: error instanceof Error ? error.message : "Upload failed" }
                  : u,
              ),
            )
          }
        }),
      )

    },
    [onUploadComplete],
  )

  return {
    uploadingFiles,
    upload: performUpload,
  }
}
