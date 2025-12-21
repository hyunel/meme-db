"use client"

import React, { useState } from "react"
import { Upload, ChevronUp, ChevronDown } from "lucide-react"

interface UploadingFile {
  name: string
  progress: number
  preview?: string
}

interface UploadProgressProps {
  uploadingFiles: UploadingFile[]
}

export function UploadProgress({ uploadingFiles }: UploadProgressProps) {
  const [isExpanded, setIsExpanded] = useState(true)

  if (uploadingFiles.length === 0) return null

  const activeUploads = uploadingFiles.filter((f) => f.progress < 100)
  const averageProgress = Math.round(
    uploadingFiles.reduce((acc, f) => acc + f.progress, 0) / uploadingFiles.length
  )

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 max-w-[calc(100vw-2rem)]">
      <div className="bg-card border rounded-lg shadow-lg overflow-hidden">
        {/* Header */}
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full px-4 py-3 flex items-center justify-between hover:bg-accent/50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Upload className="h-4 w-4 text-primary" />
            <span className="font-medium text-sm">
              {activeUploads.length > 0 ? `上传中 ${activeUploads.length} 个文件` : "上传完成"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{averageProgress}%</span>
            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </div>
        </button>

        {/* Overall progress bar */}
        <div className="px-4 pb-2">
          <div className="w-full bg-muted rounded-full h-1 overflow-hidden">
            <div
              className="bg-primary h-full transition-all duration-300 ease-out"
              style={{
                width: `${averageProgress}%`,
              }}
            />
          </div>
        </div>

        {/* Expanded file list */}
        {isExpanded && (
          <div className="max-h-60 overflow-y-auto border-t">
            {uploadingFiles.map((file, index) => (
              <div key={index} className="px-4 py-2 border-b last:border-b-0 hover:bg-accent/30">
                <div className="flex items-center gap-2 mb-1">
                  {file.preview && (
                    <img
                      src={file.preview || "/placeholder.svg"}
                      alt=""
                      className="w-8 h-8 object-cover rounded"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{file.name}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <div className="flex-1 bg-muted rounded-full h-1 overflow-hidden">
                        <div
                          className="bg-primary h-full transition-all duration-300 ease-out"
                          style={{ width: `${file.progress}%` }}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground min-w-[3ch] text-right">
                        {Math.round(file.progress)}%
                      </span>
                    </div>
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
