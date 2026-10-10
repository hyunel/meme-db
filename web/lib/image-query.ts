'use client'

// Query images live in memory for the session, so search URLs can refer to them by ID.
export interface ImageQuery {
  id: string
  url: string
  name: string
  file: File
}

const queries = new Map<string, ImageQuery>()

export const MAX_QUERY_IMAGE = 10 * 1024 * 1024

export function validateQueryImage(file: File): string | null {
  if (!file.type.startsWith('image/')) return '仅支持图片格式（PNG、JPG、WebP、GIF）'
  if (file.size > MAX_QUERY_IMAGE) return '图片不能超过 10 MB'
  return null
}

export function putImageQuery(file: File): ImageQuery {
  const id = Math.random().toString(36).slice(2, 10)
  const q = { id, url: URL.createObjectURL(file), name: file.name || '粘贴的图片', file }
  queries.set(id, q)
  return q
}

export function getImageQuery(id: string | null) {
  return id ? (queries.get(id) ?? null) : null
}
