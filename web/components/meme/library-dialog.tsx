'use client'

import { useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import useSWR from 'swr'
import { Folder as FolderIcon, FolderPlus, Home, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { api, refresh } from '@/lib/api'
import type { Folder, FolderRef, Meme } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useMessages } from '@/lib/i18n/client'

const ROOT = 'root' // Key of the library root, whose folder id is null

type Place = { key: string; name: string; depth: number; parents: string[] }

/** The library root, then its folders depth first, siblings by name. */
function placesOf(folders: FolderRef[], rootName: string): Place[] {
  const children = new Map<string, FolderRef[]>()
  for (const f of folders) children.set(f.parent_id ?? ROOT, [...(children.get(f.parent_id ?? ROOT) ?? []), f])
  const places: Place[] = [{ key: ROOT, name: rootName, depth: 0, parents: [] }]
  const walk = (parent: string, parents: string[]) => {
    for (const f of [...(children.get(parent) ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))) {
      places.push({ key: f.id, name: f.name, depth: parents.length + 1, parents })
      walk(f.id, [...parents, f.name])
    }
  }
  walk(ROOT, [])
  return places
}

/** Picks the places in the viewer's library that hold the meme; nothing changes until the choice is saved. share is the private link it was opened by. */
export function LibraryDialog({ meme, share, onOpenChange }: { meme: Meme; share?: string; onOpenChange: (open: boolean) => void }) {
  const router = useRouter()
  const pathname = usePathname()
  const { data: folders, mutate } = useSWR<FolderRef[]>('/library/folders')
  const saved = new Map(meme.entries.map((e) => [e.folder_id ?? ROOT, e.id]))
  const [selected, setSelected] = useState(() => new Set(saved.keys()))
  const [filter, setFilter] = useState('')
  const [newName, setNewName] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const t = useMessages()

  const places = placesOf(folders ?? [], t.libraryDialog.root)
  const q = filter.trim().toLowerCase()
  const shown = q ? places.filter((p) => p.name.toLowerCase().includes(q)) : places
  const adds = [...selected].filter((k) => !saved.has(k))
  const removes = [...saved].filter(([k]) => !selected.has(k)).map(([, id]) => id)
  // A meme that is not public can only be opened from the library holding it.
  const losing = saved.size > 0 && selected.size === 0 && !meme.is_public

  const toggle = (key: string) =>
    setSelected((s) => {
      const next = new Set(s)
      if (!next.delete(key)) next.add(key)
      return next
    })

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    const name = newName?.trim()
    if (!name) return
    setPending(true)
    try {
      const f = await api<Folder>('/library/folders', { method: 'POST', json: { name } })
      await mutate()
      setSelected((s) => new Set(s).add(f.id))
      setNewName(null)
      setFilter('')
    } catch (err) {
      toast.error(t.libraryDialog.createFailed, { description: (err as Error).message })
    } finally {
      setPending(false)
    }
  }

  const save = async () => {
    setPending(true)
    try {
      await Promise.all(adds.map((k) => api('/library/entries', { method: 'POST', json: { meme_id: meme.id, parent_id: k === ROOT ? null : k, share } })))
      if (removes.length) await api('/library/nodes', { method: 'DELETE', json: { ids: removes } })
      onOpenChange(false)
      const only = adds.length === 1 && !removes.length ? places.find((p) => p.key === adds[0]) : undefined
      if (only) {
        const href = only.key === ROOT ? '/library' : `/library?folder=${only.key}`
        toast.success(t.libraryDialog.added(only.name), { action: { label: t.libraryDialog.go, onClick: () => router.push(href) } })
      } else {
        toast.success(selected.size ? t.libraryDialog.updated : t.libraryDialog.removed)
        if (losing && pathname === `/m/${meme.id}`) router.replace('/library')
      }
    } catch (err) {
      toast.error(t.libraryDialog.saveFailed, { description: (err as Error).message })
    } finally {
      setPending(false)
      void refresh()
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="gap-4 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{saved.size ? t.libraryDialog.moveTitle : t.meme.addToLibrary}</DialogTitle>
          <DialogDescription>{t.libraryDialog.description}</DialogDescription>
        </DialogHeader>

        {places.length > 8 && <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t.libraryDialog.filter} aria-label={t.libraryDialog.filterLabel} />}

        <ul className="flex max-h-72 min-h-32 flex-col gap-0.5 overflow-y-auto rounded-lg border p-1" aria-label={t.libraryDialog.places} aria-busy={!folders}>
          {shown.map((p) => {
            const checked = selected.has(p.key)
            const status = saved.has(p.key) ? (checked ? 'here' : 'remove') : checked ? 'add' : null
            return (
              <li key={p.key}>
                <label
                  className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-md pr-3 text-sm transition-colors hover:bg-muted has-[:focus-visible]:bg-muted"
                  style={{ paddingLeft: `${0.75 + (q ? 0 : p.depth) * 1.25}rem` }}
                >
                  <Checkbox checked={checked} onCheckedChange={() => toggle(p.key)} disabled={pending} />
                  {p.key === ROOT ? <Home className="size-4 shrink-0 text-muted-foreground" aria-hidden /> : <FolderIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">{p.name}</span>
                    {q && p.parents.length > 0 && <span className="truncate text-xs text-muted-foreground">{p.parents.join(' / ')}</span>}
                  </span>
                  {status && <span className={cn('shrink-0 text-xs', status === 'remove' ? 'text-destructive' : status === 'add' ? 'text-success' : 'text-muted-foreground')}>{t.libraryDialog.status[status]}</span>}
                </label>
              </li>
            )
          })}
          {!folders && (
            <li className="flex h-16 items-center justify-center text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden />
            </li>
          )}
          {folders && q && shown.length === 0 && <li className="flex h-16 items-center justify-center text-sm text-muted-foreground">{t.libraryDialog.noMatch}</li>}
        </ul>

        {newName === null ? (
          <Button variant="outline" className="self-start" onClick={() => setNewName('')} disabled={pending}>
            <FolderPlus data-icon="inline-start" />
            {t.libraryDialog.newFolder}
          </Button>
        ) : (
          <form onSubmit={create} className="flex gap-2">
            <Input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={t.libraryDialog.newFolderName} aria-label={t.libraryDialog.newFolderName} maxLength={255} />
            <Button type="submit" disabled={!newName.trim() || pending}>
              {t.tokens.create}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setNewName(null)}>
              {t.common.cancel}
            </Button>
          </form>
        )}

        {losing && (
          <p role="alert" className="text-sm text-destructive">
            {t.libraryDialog.losing}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            {t.common.cancel}
          </Button>
          <Button onClick={save} disabled={pending || adds.length + removes.length === 0} variant={saved.size && !selected.size ? 'destructive' : 'default'}>
            {pending && <Loader2 className="animate-spin" data-icon="inline-start" />}
            {!saved.size ? t.libraryDialog.add : selected.size ? t.libraryDialog.save : t.libraryDialog.remove}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
