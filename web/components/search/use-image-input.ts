import { useState } from 'react'

/** Drag-and-drop and paste handlers that hand an image file to onImage. */
export function useImageInput(onImage: (file: File | undefined) => void) {
  const [dragging, setDragging] = useState(false)
  return {
    dragging,
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
        onImage(e.dataTransfer.files[0])
      },
    },
    onPaste: (e: React.ClipboardEvent) => {
      const file = Array.from(e.clipboardData.files).find((f) => f.type.startsWith('image/'))
      if (file) {
        e.preventDefault()
        onImage(file)
      }
    },
  }
}
