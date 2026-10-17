import { qs } from './utils'
import type { MediaKind, Meme } from './types'

export function kindOf(mime: string): MediaKind {
  if (mime === 'image/gif') return 'gif'
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  return 'lottie'
}

/** Links a meme, or the entry of it in a folder, which opens it under the entry's name; share is a private link that opens it */
export const memeHref = (id: string, entryId?: string, share?: string) => `/m/${id}${qs({ entry: entryId, share })}`

/** Fetches a Lottie animation as the player takes it: JSON, gzip-compressed JSON (Telegram .tgs stickers), or a zipped .lottie file. */
export async function fetchAnimation(url: string, mime: string, signal: AbortSignal) {
  const res = await fetch(url, { signal })
  if (!res.ok || !res.body) throw new Error(`failed to fetch ${url}`)
  if (mime === 'application/zip') return res.arrayBuffer()
  const body = mime.includes('gzip') ? res.body.pipeThrough(new DecompressionStream('gzip')) : res.body
  return new Response(body).text()
}

export const isProcessing = (meme?: Pick<Meme, 'status'> | null) => meme?.status === 'pending' || meme?.status === 'processing'

export const memeTitle = (meme: Meme) => meme.title || '未命名表情包'

export const memeAlt = (meme: { title?: string }) => (meme.title ? `表情包：${meme.title}` : '表情包')
