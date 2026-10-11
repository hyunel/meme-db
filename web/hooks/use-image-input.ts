'use client'

import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { validateQueryImage } from '@/lib/image-query'

// Only valid images reach onImage.
export function useImageInput(onImage: (file: File) => void) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const accept = (file: File | undefined | null) => {
    if (!file) return
    const err = validateQueryImage(file)
    if (err) {
      toast.error(err)
      return
    }
    onImage(file)
  }

  return {
    dragging,
    open: () => inputRef.current?.click(),
    onPaste: (e: React.ClipboardEvent) => {
      const file = Array.from(e.clipboardData.files).find((f) => f.type.startsWith('image/'))
      if (file) {
        e.preventDefault()
        accept(file)
      }
    },
    dropProps: {
      onDragOver: (e: React.DragEvent) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          setDragging(true)
        }
      },
      onDragLeave: () => setDragging(false),
      onDrop: (e: React.DragEvent) => {
        e.preventDefault()
        setDragging(false)
        accept(e.dataTransfer.files[0])
      },
    },
    inputProps: {
      ref: inputRef,
      type: 'file' as const,
      accept: 'image/*',
      className: 'sr-only',
      tabIndex: -1,
      'aria-hidden': true,
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
        accept(e.target.files?.[0])
        e.target.value = ''
      },
    },
  }
}
