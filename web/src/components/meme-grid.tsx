import { cn } from "@/lib/utils"
import type React from "react"

interface MemeGridProps {
  children: React.ReactNode
  className?: string
}

export function MemeGrid({ children, className }: MemeGridProps) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3",
        className,
      )}
    >
      {children}
    </div>
  )
}
