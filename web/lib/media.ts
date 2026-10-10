import type { MediaKind, Meme } from './types'

export function kindOf(mime: string): MediaKind {
  if (mime === 'image/gif') return 'gif'
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  return 'lottie'
}

export function memeTitle(meme: Meme) {
  return meme.keywords.slice(0, 3).join(' · ') || '未命名表情包'
}

export function memeAlt(meme: { keywords?: string[] }) {
  return meme.keywords?.length ? `表情包：${meme.keywords.join('、')}` : '表情包'
}
