"use client"

import { Upload, ChevronUp, ChevronDown, AlertCircle } from "lucide-react"
import { Progress } from "@/components/ui/progress"
import { cn } from "@/lib/utils"
import { MemeRenderer } from "../meme-renderer"

interface UploadingFile {
  name: string
  progress: number
  preview?: string
  error?: string
}

interface UploadProgressProps {
  uploadingFiles: UploadingFile[]
  isExpanded?: boolean
  onToggleExpand?: () => void
}

export function UploadProgress({
  uploadingFiles,
  isExpanded = true,
  onToggleExpand,
}: UploadProgressProps) {
  if (uploadingFiles.length === 0) return null

  const activeUploads = uploadingFiles.filter((f) => f.progress < 100 && !f.error)
  const failedUploads = uploadingFiles.filter((f) => !!f.error)
  const averageProgress = Math.round(
    uploadingFiles.reduce((acc, f) => acc + (f.error ? 0 : f.progress), 0) / uploadingFiles.length
  )

  return (
    <div className="w-80 max-w-[calc(100vw-2rem)]">
      <div className="bg-card border rounded-lg shadow-lg overflow-hidden">
        {/* Header */}
        <button
          onClick={onToggleExpand}
          className="w-full px-4 py-3 flex items-center justify-between hover:bg-accent/50 transition-colors"
        >
          <div className="flex items-center gap-2">
            {failedUploads.length > 0 ? (
              <AlertCircle className="h-4 w-4 text-destructive" />
            ) : (
              <Upload className="h-4 w-4 text-primary" />
            )}
            <span className="font-medium text-sm">
              {failedUploads.length > 0
                ? `${failedUploads.length} uploads failed`
                : activeUploads.length > 0
                  ? `Uploading ${activeUploads.length} files`
                  : "Upload complete"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{averageProgress}%</span>
            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </div>
        </button>

        {/* Overall progress bar */}
        <div className="px-4 pb-2">
          <Progress
            value={averageProgress}
            className="h-1"
            indicatorClassName={cn(failedUploads.length > 0 && "bg-destructive")}
          />
        </div>

        {/* Expanded file list */}
        {isExpanded && uploadingFiles.length > 0 && (
          <div className="max-h-60 overflow-y-auto border-t">
            {uploadingFiles.map((file, index) => (
              <div key={index} className="px-4 py-2 border-b last:border-b-0 hover:bg-accent/30">
                <div className="flex items-center gap-2 mb-1">
                  {file.preview && (
                    <MemeRenderer
                      meme={{
                        url: file.preview,
                        extension: file.name.substring(file.name.lastIndexOf(".")),
                      } as any}
                      className="w-8 h-8 rounded shrink-0 overflow-hidden"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className={cn("text-xs font-medium truncate", file.error && "text-destructive")}>
                      {file.name}
                    </p>
                    {file.error ? (
                      <p className="text-[10px] text-destructive truncate mt-0.5">{file.error}</p>
                    ) : (
                      <div className="flex items-center gap-2 mt-1">
                        <Progress value={file.progress} className="h-1 flex-1" />
                        <span className="text-xs text-muted-foreground min-w-[3ch] text-right">
                          {Math.round(file.progress)}%
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
