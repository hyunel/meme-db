'use client'

import type { Messages } from './i18n'

// Query images live in memory for the session, so search URLs can refer to them by ID.
export interface ImageQuery {
  id: string
  url: string
  name: string
  file: File
}

const queries = new Map<string, ImageQuery>()

export const MAX_QUERY_IMAGE = 10 * 1024 * 1024

export function validateQueryImage(file: File, { search }: Messages): string | null {
  if (!file.type.startsWith('image/')) return search.imagesOnly
  if (file.size > MAX_QUERY_IMAGE) return search.imageTooLarge(MAX_QUERY_IMAGE / 1024 / 1024)
  return null
}

export function putImageQuery(file: File, { search }: Messages): ImageQuery {
  const id = Math.random().toString(36).slice(2, 10)
  const q = { id, url: URL.createObjectURL(file), name: file.name || search.pasted, file }
  queries.set(id, q)
  return q
}

export function getImageQuery(id: string | null) {
  return id ? (queries.get(id) ?? null) : null
}
