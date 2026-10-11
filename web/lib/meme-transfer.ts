'use client'

import { toast } from 'sonner'
import { kindOf } from './media'
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

async function fetchBlob(meme: Meme) {
  const res = await fetch(meme.url)
  if (!res.ok) throw new Error('文件获取失败')
  return res.blob()
}

export async function downloadOriginal(meme: Meme) {
  const blob = await fetchBlob(meme)
  saveBlob(blob, `${fileBase(meme)}.${extOf(meme)}`)
}

export async function downloadConverted(meme: Meme, format: Exclude<DownloadFormat, 'original'>, onProgress: (p: number) => void) {
  const kind = kindOf(meme.mime_type)
  if (kind === 'video' || kind === 'lottie') throw new Error('视频和矢量动画暂不支持格式转换，请下载原格式')
  onProgress(10)
  const blob = await fetchBlob(meme)
  onProgress(35)
  const bitmap = await createImageBitmap(blob)
  onProgress(60)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('当前浏览器无法完成转换')
  if (format === 'jpg') {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }
  ctx.drawImage(bitmap, 0, 0)
  onProgress(80)
  const mime = format === 'jpg' ? 'image/jpeg' : format === 'gif' ? 'image/gif' : 'image/png'
  const out = await new Promise<Blob | null>((r) => canvas.toBlob(r, mime, 0.92))
  if (!out || out.type !== mime) throw new Error(`当前浏览器不支持转换为 ${format.toUpperCase()}`)
  onProgress(100)
  saveBlob(out, `${fileBase(meme)}.${format}`)
}

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
