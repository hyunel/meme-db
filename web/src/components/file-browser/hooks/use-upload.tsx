import { useState, useCallback, useEffect, useRef } from "react"
import { toast } from "sonner"
import { nodeUpload, nodeCreate } from "@/lib/api"
import { UploadProgress } from "../upload-progress"
import type { UploadingFile, FileWithTarget } from "../utils/types"
import { ACCEPTED_FILE_TYPES } from "../utils/constants"

function isFileAccepted(file: File): boolean {
  return ACCEPTED_FILE_TYPES.some((type) => {
    if (type.endsWith("/*")) return file.type.startsWith(type.replace("*", ""))
    if (type.startsWith(".")) return file.name.toLowerCase().endsWith(type.toLowerCase())
    return file.type === type
  })
}

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
    async (items: FileWithTarget[], targetFolderId?: string) => {
      const acceptedItems = items.filter(({ file }) => isFileAccepted(file))
      if (!acceptedItems.length) return

      setUploadingFiles((prev) => [
        ...prev,
        ...acceptedItems.map(({ file, path }) => ({
          name: file.name,
          progress: 0,
          preview: URL.createObjectURL(file),
          path,
        })),
      ])

      const folderCache = new Map<string, string>()

      for (const { file, path } of acceptedItems) {
        try {
          // Resolve or create folder structure
          let currentParentId = targetFolderId || ""
          if (path) {
            const parts = path.split("/")
            let currentPath = ""
            for (const part of parts) {
              currentPath = currentPath ? `${currentPath}/${part}` : part
              if (folderCache.has(currentPath)) {
                currentParentId = folderCache.get(currentPath)!
              } else {
                const node = await nodeCreate({ name: part, type: "FOLDER", parent_id: currentParentId })
                currentParentId = node.id
                folderCache.set(currentPath, currentParentId)
              }
            }
          }

          // Upload file
          await nodeUpload(file, currentParentId, (progress) => {
            setUploadingFiles((prev) =>
              prev.map((u) => (u.name === file.name && u.path === path ? { ...u, progress } : u)),
            )
          })
          setUploadingFiles((prev) =>
            prev.map((u) => (u.name === file.name && u.path === path ? { ...u, progress: 100 } : u)),
          )
          onUploadComplete()
        } catch (error) {
          console.error(`Failed to upload ${file.name}:`, error)
          setUploadingFiles((prev) =>
            prev.map((u) =>
              u.name === file.name && u.path === path
                ? { ...u, error: error instanceof Error ? error.message : "Upload failed" }
                : u,
            ),
          )
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
