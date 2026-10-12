import { qs } from './api'
import type { MediaKind, Meme } from './types'

export function kindOf(mime: string): MediaKind {
  if (mime === 'image/gif') return 'gif'
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  return 'lottie'
}

/** Links a meme, or the entry of it in a folder, which opens it under the entry's name; share is a private link that opens it */
export const memeHref = (id: string, entryId?: string, share?: string) => `/m/${id}${qs({ entry: entryId, share })}`

export const isProcessing = (meme?: Pick<Meme, 'status'> | null) => meme?.status === 'pending' || meme?.status === 'processing'

export const memeTitle = (meme: Meme) => meme.title || '未命名表情包'

export const memeAlt = (meme: { title?: string }) => (meme.title ? `表情包：${meme.title}` : '表情包')
