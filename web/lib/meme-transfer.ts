'use client'

import { toast } from 'sonner'
import type { ConvertSource } from './convert-worker'
import { fetchAnimation, kindOf } from './media'
import type { Meme } from './types'

export type DownloadFormat = 'original' | 'png' | 'jpg' | 'gif'

const extByMime: Record<string, string> = {
  'image/jpeg': 'jpg',
  'application/json': 'json',
  'application/x-gzip': 'tgs',
  'application/gzip': 'tgs',
  'application/zip': 'lottie',
}

function extOf(meme: Meme) {
  return extByMime[meme.mime_type] ?? meme.mime_type.split('/')[1] ?? 'bin'
}

function fileBase(meme: Meme) {
  return `memedb-${meme.title || meme.id}`
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

async function fetchBlob(meme: Meme, signal?: AbortSignal) {
  const res = await fetch(meme.url, { signal })
  if (!res.ok) throw new Error('文件获取失败')
  return res.blob()
}

export async function downloadOriginal(meme: Meme) {
  const blob = await fetchBlob(meme)
  saveBlob(blob, `${fileBase(meme)}.${extOf(meme)}`)
}

/** Quality (1–100) is of a JPG; fps, the most frames a second, and speed are of a GIF of an animation; scale is of the size. */
export type ConvertOptions = { quality: number; fps: number; speed: number; scale: number }

export const defaultOptions: ConvertOptions = { quality: 92, fps: 30, speed: 1, scale: 1 }

const mimeOf = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif' }

/** Converts on the device, in a worker; animations become a GIF whole, or a PNG or JPG of their first frame. */
export async function downloadConverted(
  meme: Meme,
  format: Exclude<DownloadFormat, 'original'>,
  options: ConvertOptions,
  onProgress: (p: number) => void,
  signal: AbortSignal,
) {
  const unchanged = (Object.keys(options) as (keyof ConvertOptions)[]).every((k) => options[k] === defaultOptions[k])
  if (meme.mime_type === mimeOf[format] && unchanged) return downloadOriginal(meme)
  const worker = new Worker(new URL('./convert-worker.ts', import.meta.url), { type: 'module' })
  const video = kindOf(meme.mime_type) === 'video' ? document.createElement('video') : undefined
  try {
    const blob = await new Promise<Blob>((resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason))
      worker.onerror = reject
      worker.onmessage = ({ data }) => {
        if (data.blob) resolve(data.blob)
        else if (data.error) reject(new Error('无法转换这个文件，请下载原格式'))
        else if (data.progress) onProgress(Math.round(data.progress * 100))
        else if (video) frameAt(video, data.seek).then((frame) => worker.postMessage({ frame }, [frame]), reject)
      }
      sourceOf(meme, video, signal).then((source) => worker.postMessage({ format, options, source }), reject)
    })
    saveBlob(blob, `${fileBase(meme)}.${format}`)
  } finally {
    worker.terminate()
    if (video) URL.revokeObjectURL(video.src)
  }
}

async function sourceOf(meme: Meme, video: HTMLVideoElement | undefined, signal: AbortSignal): Promise<ConvertSource> {
  if (kindOf(meme.mime_type) === 'lottie') return { lottie: await fetchAnimation(meme.url, meme.mime_type, signal) }
  const blob = await fetchBlob(meme, signal)
  if (!video) return { image: blob }
  video.muted = true
  video.src = URL.createObjectURL(blob)
  await videoEvent(video, 'loadedmetadata')
  // Recordings may leave their length out, which seeking to the end finds.
  if (video.duration === Infinity) {
    video.currentTime = 1e9
    await videoEvent(video, 'seeked')
  }
  return { video: { width: video.videoWidth, height: video.videoHeight, duration: video.duration } }
}

async function frameAt(video: HTMLVideoElement, time: number) {
  video.currentTime = time
  await videoEvent(video, 'seeked')
  return createImageBitmap(video)
}

const videoEvent = (video: HTMLVideoElement, type: string) =>
  new Promise((resolve, reject) => {
    video.addEventListener(type, resolve, { once: true })
    video.addEventListener('error', () => reject(new Error('当前浏览器无法解码这个视频')), { once: true })
  })

export async function downloadMany(memes: Meme[]) {
  let ok = 0
  for (const m of memes) {
    try {
      await downloadOriginal(m)
      ok++
      await new Promise((r) => setTimeout(r, 400))
    } catch {}
  }
  if (ok === memes.length) toast.success(`已开始下载 ${ok} 个文件`)
  else toast.error(`${memes.length - ok} 个文件下载失败，已下载 ${ok} 个`)
}
