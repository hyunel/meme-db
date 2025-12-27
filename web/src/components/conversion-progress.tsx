"use client"

import * as React from "react"
import { Progress } from "@/components/ui/progress"

interface ConversionProgressProps {
  progress: number
  title?: string
}

export function ConversionProgress({ progress, title = "Converting format..." }: ConversionProgressProps) {
  return (
    <div className="bg-card border rounded-lg shadow-lg p-4 w-80 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs text-muted-foreground">{progress}%</span>
      </div>
      <Progress value={progress} className="h-1.5" />
    </div>
  )
}
