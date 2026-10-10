'use client'

import { useRef, useState } from 'react'
import useSWR from 'swr'
import { CheckCircle2, CircleAlert, FileUp, Loader2, Upload, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { api, refresh } from '@/lib/api'
import { formatBytes } from '@/lib/format'
import type { UploadConfig } from '@/lib/types'
import { cn } from '@/lib/utils'

const MAX_BATCH = 50
const CONCURRENCY = 3

type Item = { file: File; state: 'ready' | 'uploading' | 'done' | 'error'; error?: string }

/** Whether file matches an <input accept> list such as "image/*,.webm". */
function accepts(accept: string, file: File) {
  const name = file.name.toLowerCase()
  return accept.split(',').some((token) => {
    const t = token.trim().toLowerCase()
    if (t.startsWith('.')) return name.endsWith(t)
    if (t.endsWith('/*')) return file.type.startsWith(t.slice(0, -1))
    return file.type === t
  })
}

export function UploadDialog({ open, onOpenChange, folderId, folderName }: { open: boolean; onOpenChange: (o: boolean) => void; folderId: string | null; folderName: string }) {
  const { data } = useSWR<{ upload: UploadConfig }>(open ? '/config' : null)
  const config = data?.upload
  const [items, setItems] = useState<Item[]>([])
  const [uploading, setUploading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const validate = (f: File): string | undefined => {
    if (!config) return undefined
    if (!accepts(config.accept, f)) return '不支持的文件格式'
    if (f.size > config.max_size_mb * 1024 * 1024) return `超过 ${config.max_size_mb}MB 限制`
  }

  const add = (list: FileList | null) => {
    if (!list || uploading) return
    const next = [...items, ...Array.from(list, (file): Item => {
      const error = validate(file)
      return { file, state: error ? 'error' : 'ready', error }
    })]
    if (next.length > MAX_BATCH) toast.warning(`单次最多上传 ${MAX_BATCH} 个文件，多余文件已忽略`)
    setItems(next.slice(0, MAX_BATCH))
  }

  const ready = items.filter((i) => i.state === 'ready')
  const setItem = (file: File, patch: Partial<Item>) => setItems((cur) => cur.map((i) => (i.file === file ? { ...i, ...patch } : i)))

  const close = () => {
    setItems([])
    onOpenChange(false)
  }

  const submit = async () => {
    setUploading(true)
    const queue = [...ready]
    let failed = 0
    const worker = async () => {
      for (let item = queue.shift(); item; item = queue.shift()) {
        setItem(item.file, { state: 'uploading' })
        const form = new FormData()
        form.set('file', item.file)
        if (folderId) form.set('parent_id', folderId)
        try {
          await api('/library/upload', { method: 'POST', form })
          setItem(item.file, { state: 'done' })
        } catch (err) {
          failed++
          setItem(item.file, { state: 'error', error: (err as Error).message })
        }
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker))
    setUploading(false)
    void refresh()

    const ok = ready.length - failed
    if (!failed) {
      toast.success(`已上传 ${ok} 个文件`, { description: '处理完成后即可被搜索到。' })
      close()
    } else {
      toast.error(`${failed} 个文件上传失败`, { description: ok ? `其余 ${ok} 个已上传` : undefined })
      setItems((cur) => cur.filter((i) => i.state !== 'done'))
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : !uploading && close())}>
      <DialogContent className="gap-4 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>上传表情包</DialogTitle>
          <DialogDescription>
            上传到「{folderName}」，默认私有。{config && `支持 ${config.accept.replaceAll(',', ' / ')}，单个不超过 ${config.max_size_mb}MB。`}
          </DialogDescription>
        </DialogHeader>

        <button
          type="button"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            add(e.dataTransfer.files)
          }}
          className={cn(
            'flex min-h-36 flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-6 text-center transition-colors hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-60',
            dragging && 'border-foreground bg-brand/25',
          )}
        >
          <FileUp className="size-8 text-muted-foreground" aria-hidden />
          <span className="font-medium">点击选择文件</span>
          <span className="hidden text-sm text-muted-foreground sm:block">或将文件拖放到这里</span>
          <span className="text-xs text-muted-foreground">单次最多 {MAX_BATCH} 个</span>
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={config?.accept}
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            add(e.target.files)
            e.target.value = ''
          }}
        />

        {items.length > 0 && (
          <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto" aria-label="待上传文件">
            {items.map((item, i) => (
              <li key={`${item.file.name}-${i}`} className={cn('flex items-center gap-3 rounded-lg border px-3 py-2 text-sm', item.state === 'error' && 'border-destructive/40 bg-destructive/5')}>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{item.file.name}</span>
                  <span className={cn('text-xs', item.state === 'error' ? 'flex items-center gap-1 text-destructive' : 'text-muted-foreground')}>
                    {item.state === 'error' && <CircleAlert className="size-3" aria-hidden />}
                    {item.error ?? formatBytes(item.file.size)}
                  </span>
                </div>
                {item.state === 'uploading' ? (
                  <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="上传中" />
                ) : item.state === 'done' ? (
                  <CheckCircle2 className="size-4 text-success" aria-label="已上传" />
                ) : (
                  <Button variant="ghost" size="icon-sm" disabled={uploading} aria-label={`移除 ${item.file.name}`} onClick={() => setItems(items.filter((_, j) => j !== i))}>
                    <X />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={uploading}>
            取消
          </Button>
          <Button onClick={submit} disabled={uploading || ready.length === 0}>
            {uploading ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Upload data-icon="inline-start" />}
            上传 {ready.length > 0 ? `${ready.length} 个` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
