"use client"

import type React from "react"

interface UploadProgressProps {
  uploadingFiles: Array<{ name: string; progress: number; preview?: string }>
}

export function UploadProgress({ uploadingFiles }: UploadProgressProps) {
  if (uploadingFiles.length === 0) return null

  return (
    <div className="mb-6 space-y-2">
      {uploadingFiles.map((file, index) => (
        <div key={index} className="bg-card border rounded-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium truncate">{file.name}</span>
            <span className="text-xs text-muted-foreground">{Math.round(file.progress)}%</span>
          </div>
          <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-primary h-full transition-all duration-300 ease-out"
              style={{ width: `${file.progress}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}
