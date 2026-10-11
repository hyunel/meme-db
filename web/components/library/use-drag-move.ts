'use client'

import { useState } from 'react'

/** The library root as a drop target. */
export const ROOT = ''

/**
 * Drag-and-drop moving of library items. Dragging a selected item drags the whole
 * selection; folders and breadcrumbs (ROOT for the library itself) are drop targets.
 * Items are found in the DOM by data-node-id, and their data-thumb element makes up the
 * drag preview.
 */
export function useDragMove({ current, selected, onMove }: { current: string; selected: Set<string>; onMove: (ids: string[], target: string) => void }) {
  const [dragging, setDragging] = useState<string[] | null>(null)
  const [over, setOver] = useState<string | null>(null)

  const end = () => {
    setDragging(null)
    setOver(null)
  }
  const accepts = (target: string) => dragging !== null && target !== current && !dragging.includes(target)

  return {
    isDragging: (id: string) => dragging?.includes(id) ?? false,
    isOver: (target: string) => over === target,

    source: (id: string) => ({
      draggable: true,
      onDragStart: (e: React.DragEvent) => {
        const ids = selected.has(id) ? [...selected] : [id]
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('application/x-memedb-nodes', ids.join(','))
        setDragPreview(e.dataTransfer, ids)
        setDragging(ids)
      },
      onDragEnd: end,
    }),

    target: (target: string) => ({
      onDragOver: (e: React.DragEvent) => {
        if (!accepts(target)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        setOver(target)
      },
      onDragLeave: (e: React.DragEvent) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver((o) => (o === target ? null : o))
      },
      onDrop: (e: React.DragEvent) => {
        if (!accepts(target) || !dragging) return
        e.preventDefault()
        onMove(dragging, target)
        end()
      },
    }),
  }
}

/** Shows up to three of the dragged items as a stack, with a count badge for several. */
function setDragPreview(dt: DataTransfer, ids: string[]) {
  const stack = document.createElement('div')
  stack.className = 'pointer-events-none fixed -top-[1000px] left-0 size-[84px]'
  ids.slice(0, 3).forEach((id, i) => {
    const thumb = document.querySelector<HTMLElement>(`[data-node-id="${id}"] [data-thumb]`)
    if (!thumb) return
    const card = document.createElement('div')
    card.className = 'absolute size-16 overflow-hidden rounded-lg border-2 border-background bg-muted shadow-md'
    card.style.translate = `${i * 6}px ${i * 6}px`
    card.style.zIndex = String(3 - i)
    card.append(cloneThumb(thumb))
    stack.append(card)
  })
  if (ids.length > 1) {
    const badge = document.createElement('span')
    badge.className = 'absolute top-0 right-0 z-10 rounded-full bg-foreground px-2 py-0.5 text-xs font-semibold text-background tabular-nums'
    badge.textContent = String(ids.length)
    stack.append(badge)
  }
  document.body.append(stack)
  dt.setDragImage(stack, 32, 32)
  setTimeout(() => stack.remove()) // The browser has captured the image by then
}

/** Clones a thumbnail, with videos as their current frame (a cloned video shows nothing yet). */
function cloneThumb(thumb: HTMLElement) {
  const clone = thumb.cloneNode(true) as HTMLElement
  const videos = thumb.querySelectorAll('video')
  clone.querySelectorAll('video').forEach((v, i) => {
    const src = videos[i]
    const canvas = document.createElement('canvas')
    canvas.width = src.videoWidth
    canvas.height = src.videoHeight
    canvas.className = 'size-full object-contain'
    if (src.readyState >= 2) canvas.getContext('2d')?.drawImage(src, 0, 0)
    v.replaceWith(canvas)
  })
  return clone
}
