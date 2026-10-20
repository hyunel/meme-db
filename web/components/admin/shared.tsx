'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { Messages } from '@/lib/i18n'
import { useMessages } from '@/lib/i18n/client'

export type RangeKey = 'all' | '1d' | '7d' | '30d'

export const rangeOptions = (t: Messages) => (['all', '1d', '7d', '30d'] as const).map((k) => [k, t.admin.ranges[k]] as const)

const rangeMs: Record<Exclude<RangeKey, 'all'>, number> = { '1d': 86_400_000, '7d': 7 * 86_400_000, '30d': 30 * 86_400_000 }

/** Start (Unix ms) of a range picked now; undefined for all time. Memoize it per range. */
export function rangeStart(range: RangeKey) {
  return range === 'all' ? undefined : Date.now() - rangeMs[range]
}

/** Selection that empties itself whenever the page key changes (e.g. paging or filtering). */
export function useSelection(pageKey: string) {
  const [state, setState] = useState<{ key: string; ids: Set<string> }>({ key: pageKey, ids: new Set() })
  const ids = state.key === pageKey ? state.ids : new Set<string>()
  return {
    ids,
    set: (next: Set<string>) => setState({ key: pageKey, ids: next }),
    clear: () => setState({ key: pageKey, ids: new Set() }),
  }
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive,
  requireText,
  onConfirm,
  children,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  title: string
  description: React.ReactNode
  confirmLabel?: string
  destructive?: boolean
  requireText?: string
  onConfirm: () => Promise<void> | void
  children?: React.ReactNode
}) {
  const [busy, setBusy] = useState(false)
  const [typed, setTyped] = useState('')
  const t = useMessages()
  const blocked = requireText !== undefined && typed.trim() !== requireText

  const close = (o: boolean) => {
    if (busy) return
    if (!o) setTyped('')
    onOpenChange(o)
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault()
            if (blocked) return
            setBusy(true)
            try {
              await onConfirm()
              setTyped('')
              onOpenChange(false)
            } catch (err) {
              toast.error((err as Error).message)
            } finally {
              setBusy(false)
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription className="text-pretty">{description}</DialogDescription>
          </DialogHeader>
          {children}
          {requireText !== undefined && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="confirm-text" className="font-normal">
                {t.admin.typeBefore}
                <span className="rounded bg-muted px-1 font-mono font-medium">{requireText}</span>
                {t.admin.typeAfter}
              </Label>
              <Input id="confirm-text" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} className="h-10 text-base md:text-sm" />
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" className="h-10 md:h-9" onClick={() => close(false)} disabled={busy}>
              {t.common.cancel}
            </Button>
            <Button type="submit" variant={destructive ? 'destructive' : 'default'} className="h-10 md:h-9" disabled={busy || blocked}>
              {busy && <Loader2 className="animate-spin" aria-hidden />}
              {confirmLabel ?? t.admin.confirm}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
