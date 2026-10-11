import type { MediaKind, Meme } from './types'

export function kindOf(mime: string): MediaKind {
  if (mime === 'image/gif') return 'gif'
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  return 'lottie'
}

/** Links a meme, or the entry of it in a folder, which opens it under the entry's name */
export const memeHref = (id: string, entryId?: string) => (entryId ? `/m/${id}?entry=${entryId}` : `/m/${id}`)

export const isProcessing = (meme?: Pick<Meme, 'status'> | null) => meme?.status === 'pending' || meme?.status === 'processing'

export function memeTitle(meme: Meme) {
  return meme.keywords.slice(0, 3).join(' · ') || '未命名表情包'
}

export function memeAlt(meme: { keywords?: string[] }) {
  return meme.keywords?.length ? `表情包：${meme.keywords.join('、')}` : '表情包'
}
