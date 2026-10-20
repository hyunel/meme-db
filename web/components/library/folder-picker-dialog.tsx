'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { ChevronLeft, ChevronRight, Folder as FolderIcon, FolderPlus, Home, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { api } from '@/lib/api'
import type { Folder, LibraryView } from '@/lib/types'
import { cn, qs } from '@/lib/utils'
import { useMessages } from '@/lib/i18n/client'

export type PickerMode = 'move' | 'copy' | 'save' // save copies another user's folder in

export function FolderPickerDialog({
  open,
  onOpenChange,
  mode,
  count,
  name,
  initialFolder,
  sourceFolder,
  movingFolderIds = [],
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: PickerMode
  count: number
  name?: string // Of the one item, to show instead of the count
  initialFolder: string | null
  sourceFolder?: string | null
  movingFolderIds?: string[]
  onConfirm: (target: string | null) => Promise<void>
}) {
  const [cur, setCur] = useState<string | null>(initialFolder)
  const [filter, setFilter] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const { data, mutate } = useSWR<LibraryView>(open ? `/library${qs({ folder_id: cur })}` : null)

  const path = data ? [...data.ancestors, ...(data.folder ? [data.folder] : [])] : []
  const children = (data?.folders ?? [])
    .filter((f) => f.name.toLowerCase().includes(filter.trim().toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))

  // Folders being moved are disabled, so their subtrees cannot be entered.
  const blocked = new Set(mode === 'move' ? movingFolderIds : [])
  const sameAsSource = mode === 'move' && sourceFolder !== undefined && cur === sourceFolder
  const t = useMessages()
  const words = t.picker.modes[mode]

  const go = (id: string | null) => {
    setCur(id)
    setFilter('')
    setError(null)
  }

  const confirm = async () => {
    if (sameAsSource) return
    setPending(true)
    setError(null)
    try {
      await onConfirm(cur)
      onOpenChange(false)
    } catch (e) {
      setError((e as Error).message || words.failed)
    } finally {
      setPending(false)
    }
  }

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    const name = newName.trim()
    if (!name || name.length > 255) return
    setPending(true)
    try {
      const f = await api<Folder>('/library/folders', { method: 'POST', json: { parent_id: cur, name } })
      await mutate()
      go(f.id)
      setCreating(false)
      setNewName('')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="gap-4 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {name ? words.title(name) : words.titleCount(count)}
          </DialogTitle>
          <DialogDescription>{t.picker.description(words.here)}</DialogDescription>
        </DialogHeader>

        <nav aria-label={t.picker.path} className="scroll-row -mx-1 flex items-center gap-1 px-1 text-sm">
          <Button variant="ghost" size="icon-sm" disabled={cur === null} onClick={() => go(path.at(-2)?.id ?? null)} aria-label={t.picker.up}>
            <ChevronLeft />
          </Button>
          <ol className="flex min-w-0 items-center gap-0.5">
            <li>
              <button type="button" onClick={() => go(null)} className="flex h-8 items-center gap-1 rounded-md px-2 hover:bg-muted">
                <Home className="size-3.5" aria-hidden />
                {t.titles.library}
              </button>
            </li>
            {path.map((f) => (
              <li key={f.id} className="flex items-center gap-0.5">
                <ChevronRight className="size-3.5 text-muted-foreground" aria-hidden />
                <button
                  type="button"
                  onClick={() => go(f.id)}
                  aria-current={f.id === cur ? 'location' : undefined}
                  className="h-8 max-w-32 truncate rounded-md px-2 hover:bg-muted aria-[current]:font-medium"
                >
                  {f.name}
                </button>
              </li>
            ))}
          </ol>
        </nav>

        <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t.picker.filter} aria-label={t.libraryDialog.filterLabel} />

        <ul className="flex max-h-64 min-h-32 flex-col gap-0.5 overflow-y-auto rounded-lg border p-1" aria-label={t.picker.subfolders} aria-busy={!data}>
          {!data && (
            <li className="flex h-28 items-center justify-center text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden />
            </li>
          )}
          {data && children.length === 0 && (
            <li className="flex h-28 items-center justify-center text-sm text-muted-foreground">{filter ? t.libraryDialog.noMatch : t.picker.noSubfolders}</li>
          )}
          {children.map((f) => {
            const disabled = blocked.has(f.id)
            return (
              <li key={f.id}>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => go(f.id)}
                  className="flex min-h-11 w-full items-center gap-2 rounded-md px-3 text-left text-sm transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <FolderIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="flex-1 truncate">{f.name}</span>
                  {disabled ? <span className="text-xs">{t.picker.unavailable}</span> : <ChevronRight className="size-4 text-muted-foreground" aria-hidden />}
                </button>
              </li>
            )
          })}
        </ul>

        {creating ? (
          <form onSubmit={create} className="flex gap-2">
            <Input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={t.libraryDialog.newFolderName} aria-label={t.libraryDialog.newFolderName} maxLength={255} />
            <Button type="submit" disabled={!newName.trim() || pending}>
              {t.tokens.create}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setCreating(false)}>
              {t.common.cancel}
            </Button>
          </form>
        ) : (
          <Button variant="outline" className="self-start" onClick={() => setCreating(true)}>
            <FolderPlus data-icon="inline-start" />
            {t.picker.newHere}
          </Button>
        )}

        {(error || sameAsSource) && (
          <p role="alert" className={cn('text-sm', error ? 'text-destructive' : 'text-muted-foreground')}>
            {error ?? t.picker.alreadyHere}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            {t.common.cancel}
          </Button>
          <Button onClick={confirm} disabled={pending || sameAsSource}>
            {pending && <Loader2 className="animate-spin" data-icon="inline-start" />}
            {words.here}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
