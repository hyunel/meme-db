'use client'

import { useCallback, useRef, useState } from 'react'
import useSWR from 'swr'
import { CheckCircle2, CircleAlert, File as FileIcon, FileUp, Folder, Loader2, Upload, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { api, refresh } from '@/lib/api'
import { formatBytes } from '@/lib/format'
import type { UploadConfig } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useMessages } from '@/lib/i18n/client'

const CONCURRENCY = 3

// dir is the folder the file is in within a folder chosen or dropped, such as "cats/orange"; empty for a file on its own.
type Picked = { file: File; dir: string }
type Item = Picked & { state: 'ready' | 'uploading' | 'done' | 'error'; error?: string }

const dirOf = (path: string) => path.slice(0, Math.max(path.lastIndexOf('/'), 0))

// A folder chosen or dropped is listed as one row, keyed by its name; a file on its own is a row keyed by itself.
const rowOf = (item: Item) => item.dir.split('/')[0] || item.file

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

/** The files in a dropped entry, those within a folder included. */
async function walk(entry: FileSystemEntry): Promise<Picked[]> {
  if (entry.isFile) {
    const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej))
    return [{ file, dir: dirOf(entry.fullPath.slice(1)) }] // fullPath starts at what was dropped, as "/cats/a.gif"
  }
  const reader = (entry as FileSystemDirectoryEntry).createReader()
  const found: Picked[] = []
  // Each read gives the next batch of entries, until an empty one.
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej))
    if (!batch.length) return found
    found.push(...(await Promise.all(batch.map(walk))).flat())
  }
}

/** A file's own picture, from an object url that lives as long as the element showing it. */
function Preview({ file }: { file: File }) {
  const show = useCallback(
    (el: HTMLImageElement | HTMLVideoElement | null) => {
      if (!el) return
      const url = URL.createObjectURL(file)
      el.src = url
      return () => URL.revokeObjectURL(url)
    },
    [file],
  )
  if (file.type.startsWith('image/')) return <img ref={show} alt="" decoding="async" className="size-full object-contain" />
  if (file.type.startsWith('video/')) return <video ref={show} muted preload="metadata" className="size-full object-contain" />
  return <FileIcon className="m-auto size-5 text-muted-foreground" aria-hidden />
}

export function UploadDialog({ open, onOpenChange, folderId, folderName }: { open: boolean; onOpenChange: (o: boolean) => void; folderId: string | null; folderName: string }) {
  const { data } = useSWR<{ upload: UploadConfig }>(open ? '/config' : null)
  const config = data?.upload
  const [items, setItems] = useState<Item[]>([])
  const [uploading, setUploading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const stopped = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const t = useMessages()

  const choose = (folder: boolean) => {
    if (!inputRef.current) return
    inputRef.current.webkitdirectory = folder
    inputRef.current.click()
  }

  const add = (picked: Picked[]) => {
    if (!config) return
    const next = picked
      .filter(({ file, dir }) => !dir || accepts(config.accept, file)) // Folders hold all sorts, of which only memes are taken
      .map((p): Item => {
        const error = !accepts(config.accept, p.file)
          ? t.upload.unsupported
          : p.file.size > config.max_size_mb * 1024 * 1024
            ? t.upload.tooLarge(config.max_size_mb)
            : undefined
        return { ...p, state: error ? 'error' : 'ready', error }
      })
    setItems((cur) => [...cur, ...next])
  }

  const ready = items.filter((i) => i.state === 'ready')
  const setItem = (file: File, patch: Partial<Item>) => setItems((cur) => cur.map((i) => (i.file === file ? { ...i, ...patch } : i)))

  const close = () => {
    setItems([])
    onOpenChange(false)
  }

  const submit = async () => {
    setUploading(true)
    stopped.current = false
    const queue = [...ready]
    let done = 0
    let failed = 0
    const worker = async () => {
      for (let item = queue.shift(); item && !stopped.current; item = queue.shift()) {
        setItem(item.file, { state: 'uploading' })
        const form = new FormData()
        form.set('file', item.file)
        if (folderId) form.set('parent_id', folderId)
        if (item.dir) form.set('path', item.dir)
        try {
          await api('/library/upload', { method: 'POST', form })
          done++
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

    if (stopped.current) {
      toast.info(t.upload.stopped, { description: done ? t.upload.stoppedKept(done) : undefined })
      close()
    } else if (!failed) {
      toast.success(t.upload.done(done), { description: t.upload.doneHint })
      close()
    } else {
      toast.error(t.upload.failed(failed), { description: done ? t.upload.restDone(done) : undefined })
      setItems((cur) => cur.filter((i) => i.state !== 'done'))
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : !uploading && close())}>
      <DialogContent className="gap-4 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t.upload.title(folderName)}</DialogTitle>
          <DialogDescription>{t.upload.description(config?.max_size_mb)}</DialogDescription>
        </DialogHeader>

        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(!uploading)
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false)
          }}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            if (uploading) return
            // Only to be had during the drop; a file with no entry, as one dragged from a web page, is taken as it is.
            const dropped = Array.from(e.dataTransfer.items, (i) => i.webkitGetAsEntry() ?? i.getAsFile())
            Promise.all(dropped.map((d) => (d instanceof File ? [{ file: d, dir: '' }] : d ? walk(d) : [])))
              .then((found) => add(found.flat()))
              .catch((err: Error) => toast.error(t.upload.readFailed, { description: err.message }))
          }}
          className={cn(
            'relative flex min-h-36 flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed p-6 text-center transition-colors hover:bg-muted/60',
            dragging && 'border-foreground bg-brand/25',
            uploading && 'opacity-60',
          )}
        >
          <FileUp className="mb-1 size-8 text-muted-foreground" aria-hidden />
          {/* Its ::after covers the box, so a click anywhere in it chooses files */}
          <button
            type="button"
            disabled={uploading || !config}
            onClick={() => choose(false)}
            className="font-medium outline-none after:absolute after:inset-0 after:rounded-[inherit] focus-visible:after:ring-3 focus-visible:after:ring-ring/50"
          >
            {t.upload.choose}
          </button>
          {/* Phones can neither drag nor choose folders */}
          <p className="text-sm text-muted-foreground pointer-coarse:hidden">
            {t.upload.dropHint}
            <button
              type="button"
              disabled={uploading || !config}
              onClick={() => choose(true)}
              className="relative font-medium text-foreground underline underline-offset-4 outline-none focus-visible:rounded-sm focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {t.upload.chooseFolder}
            </button>
          </p>
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={config?.accept}
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            add(Array.from(e.target.files ?? [], (file) => ({ file, dir: dirOf(file.webkitRelativePath) })))
            e.target.value = ''
          }}
        />

        {items.length > 0 && (
          <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto" aria-label={t.upload.queue}>
            {[...Map.groupBy(items, rowOf)].map(([key, row], i) => {
              const folder = typeof key === 'string' ? key : undefined
              const name = folder ?? row[0].file.name
              const failed = row.filter((x) => x.state === 'error')
              const ok = row.filter((x) => x.state !== 'error')
              const done = row.filter((x) => x.state === 'done').length
              return (
                <li key={i} className={cn('flex items-center gap-3 rounded-lg border p-2 pr-3', !ok.length && 'border-destructive/40 bg-destructive/5')}>
                  <div className={cn('flex size-12 shrink-0 overflow-hidden rounded-md bg-muted', folder && 'grid grid-cols-2 gap-px')}>
                    {(folder ? ok.slice(0, 4) : row).map((x) => (
                      <Preview key={x.dir + x.file.name} file={x.file} />
                    ))}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex items-center gap-1.5">
                      {folder && <Folder className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
                      <span className="truncate">{name}</span>
                    </span>
                    {folder ? (
                      <span className="text-xs text-muted-foreground">
                        {ok.length > 0 && `${t.upload.files(ok.length)} · ${formatBytes(ok.reduce((sum, x) => sum + x.file.size, 0))}`}
                        {ok.length > 0 && failed.length > 0 && ' · '}
                        {failed.length > 0 && (
                          <span className="text-destructive" title={failed.map((x) => t.upload.fileError(`${x.dir}/${x.file.name}`, x.error ?? '')).join('\n')}>
                            {t.upload.rejected(failed.length)}
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className={cn('text-xs', failed.length ? 'flex items-center gap-1 text-destructive' : 'text-muted-foreground')}>
                        {failed.length > 0 && <CircleAlert className="size-3" aria-hidden />}
                        {row[0].error ?? formatBytes(row[0].file.size)}
                      </span>
                    )}
                  </div>
                  {row.some((x) => x.state === 'uploading') ? (
                    <span className="flex items-center gap-2 text-xs text-muted-foreground tabular-nums">
                      {folder && `${done}/${ok.length}`}
                      <Loader2 className="size-4 animate-spin" aria-label={t.upload.uploading} />
                    </span>
                  ) : ok.length > 0 && done === ok.length ? (
                    <CheckCircle2 className="size-4 text-success" aria-label={t.upload.uploaded} />
                  ) : uploading ? null : (
                    <Button variant="ghost" size="icon-sm" aria-label={t.upload.remove(name)} onClick={() => setItems((cur) => cur.filter((x) => rowOf(x) !== key))}>
                      <X />
                    </Button>
                  )}
                </li>
              )
            })}
          </ul>
        )}

        <DialogFooter>
          {/* While uploading, stops taking further files; those uploaded stay */}
          <Button
            variant="outline"
            onClick={() => {
              if (uploading) stopped.current = true
              else close()
            }}
          >
            {uploading ? t.upload.stop : t.common.cancel}
          </Button>
          <Button onClick={submit} disabled={uploading || ready.length === 0}>
            {uploading ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Upload data-icon="inline-start" />}
            {uploading ? t.upload.uploading : ready.length > 0 ? t.upload.submit(ready.length) : t.nav.upload}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
