'use client'

import { useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { KeyRound, Loader2, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CodeBlock, CopyButton } from '@/components/code-block'
import { FormField } from '@/components/form-field'
import { Loadable } from '@/components/loadable'
import { useOrigin } from '@/hooks/use-origin'
import { ApiError, api, refresh } from '@/lib/api'
import { formatDate, formatRelative, toMs } from '@/lib/format'
import { useSession } from '@/lib/session'
import type { ApiToken, CreatedToken, TokenScope } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useMessages } from '@/lib/i18n/client'

export const scopeTones: Record<TokenScope, string> = {
  read: 'bg-muted text-muted-foreground',
  write: 'bg-brand text-brand-foreground',
  admin: 'bg-foreground text-background',
}

export function ScopeBadge({ scope }: { scope: TokenScope }) {
  const t = useMessages()
  return <span className={cn('inline-flex h-5 shrink-0 items-center rounded-full px-2 text-xs font-medium', scopeTones[scope])}>{t.tokens.scopes[scope].label}</span>
}

const expiryDays = ['30', '90', '365', '0'] as const // 0 for never

const isExpired = (t: ApiToken) => t.expires_at !== null && toMs(t.expires_at) <= Date.now()

export function ApiTokens() {
  const tokens = useSWR<ApiToken[]>('/auth/tokens')
  const [creating, setCreating] = useState(false)
  const [revoking, setRevoking] = useState<ApiToken | null>(null)
  const t = useMessages()

  const revoke = async (token: ApiToken) => {
    try {
      await api(`/auth/tokens/${token.id}`, { method: 'DELETE' })
      await refresh()
      toast.success(t.tokens.revoked(token.name))
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  return (
    <section id="api-tokens" aria-labelledby="tokens-h" className="flex scroll-mt-20 flex-col gap-4 rounded-2xl border bg-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="tokens-h" className="font-semibold">
            {t.tokens.title}
          </h2>
          <p className="text-sm text-pretty text-muted-foreground">
            {t.tokens.description}
            <Link href="/developers" className="font-medium text-foreground underline-offset-4 hover:underline">
              {t.tokens.docs}
            </Link>
          </p>
        </div>
        <Button variant="outline" onClick={() => setCreating(true)} className="h-11 shrink-0 sm:h-9">
          <Plus data-icon="inline-start" />
          {t.tokens.create}
        </Button>
      </div>

      <Loadable result={tokens} loading={<Skeleton className="h-16 rounded-xl" />}>
        {(list) =>
          list.length ? (
            <ul className="flex flex-col divide-y rounded-xl border">
              {list.map((token) => (
                <li key={token.id} className="flex items-center gap-3 p-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted" aria-hidden>
                    <KeyRound className="size-4 text-muted-foreground" />
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-medium">{token.name}</span>
                      <ScopeBadge scope={token.scope} />
                      {isExpired(token) && <span className="inline-flex h-5 shrink-0 items-center rounded-full bg-destructive/10 px-2 text-xs font-medium text-destructive">{t.tokens.expired}</span>}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      <span className="font-mono">mdb_…{token.hint}</span>
                      {` · ${t.tokens.created(formatDate(token.created_at))} · ${token.last_used_at ? t.tokens.used(formatRelative(token.last_used_at, t)) : t.tokens.neverUsed} · `}
                      {token.expires_at ? t.tokens.expires(formatDate(token.expires_at)) : t.tokens.neverExpires}
                    </p>
                  </div>
                  <Button variant="ghost" size="icon" aria-label={t.tokens.revoke(token.name)} onClick={() => setRevoking(token)} className="size-10 text-muted-foreground hover:text-destructive md:size-8">
                    <Trash2 />
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">{t.tokens.none}</p>
          )
        }
      </Loadable>

      {creating && <CreateTokenDialog onClose={() => setCreating(false)} />}

      <AlertDialog open={revoking !== null} onOpenChange={(o) => !o && setRevoking(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.tokens.confirmRevoke(revoking?.name ?? '')}</AlertDialogTitle>
            <AlertDialogDescription>{t.tokens.confirmRevokeHint}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const target = revoking
                setRevoking(null)
                if (target) void revoke(target)
              }}
            >
              {t.tokens.revokeAction}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

function CreateTokenDialog({ onClose }: { onClose: () => void }) {
  const isAdmin = useSession().user?.role === 'admin'
  const origin = useOrigin()
  const [form, setForm] = useState<{ name: string; scope: TokenScope; days: string }>({ name: '', scope: 'write', days: '90' })
  const [error, setError] = useState<string>()
  const [pending, setPending] = useState(false)
  const [created, setCreated] = useState<CreatedToken | null>(null)
  const scopes = (Object.keys(scopeTones) as TokenScope[]).filter((s) => s !== 'admin' || isAdmin)
  const t = useMessages()

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const name = form.name.trim()
    if (!name) return setError(t.tokens.nameRequired)
    setPending(true)
    try {
      setCreated(await api<CreatedToken>('/auth/tokens', { method: 'POST', json: { name, scope: form.scope, expires_in_days: Number(form.days) || undefined } }))
      void refresh()
    } catch (err) {
      if (err instanceof ApiError && err.field === 'name') setError(err.message)
      else toast.error((err as Error).message)
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="gap-4 sm:max-w-md">
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle>{t.tokens.createdTitle}</DialogTitle>
              <DialogDescription>{t.tokens.createdHint}</DialogDescription>
            </DialogHeader>
            <div className="flex items-center gap-2 rounded-lg border bg-muted/40 py-1 pr-1 pl-3">
              <code className="min-w-0 flex-1 font-mono text-sm wrap-anywhere">{created.secret}</code>
              <CopyButton value={created.secret} label={t.tokens.copy} className="size-9" />
            </div>
            <CodeBlock title={t.tokens.tryIt} code={`curl -H "Authorization: Bearer ${created.secret}" \\\n  ${origin}/api/auth/me`} />
            <DialogFooter>
              <Button onClick={onClose}>{t.tokens.done}</Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={submit} noValidate className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>{t.tokens.createTitle}</DialogTitle>
              <DialogDescription>{t.tokens.createHint}</DialogDescription>
            </DialogHeader>
            <FormField
              label={t.tokens.name}
              autoFocus
              maxLength={50}
              placeholder={t.tokens.namePlaceholder}
              value={form.name}
              error={error}
              onChange={(e) => {
                setForm({ ...form, name: e.target.value })
                setError(undefined)
              }}
            />
            <div className="flex flex-col gap-1.5">
              <Label id="scope-label">{t.tokens.scope}</Label>
              <div role="radiogroup" aria-labelledby="scope-label" className="flex flex-col gap-2">
                {scopes.map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={form.scope === s}
                    onClick={() => setForm({ ...form, scope: s })}
                    className={cn(
                      'flex min-h-14 flex-col items-start justify-center gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors hover:bg-muted',
                      form.scope === s && 'border-foreground bg-brand/30 hover:bg-brand/40',
                    )}
                  >
                    <span className="text-sm font-medium">{t.tokens.scopes[s].label}</span>
                    <span className="text-xs text-muted-foreground">{t.tokens.scopes[s].hint}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label id="expiry-label">{t.tokens.expiry}</Label>
              <Select value={form.days} onValueChange={(v) => setForm({ ...form, days: v as string })}>
                <SelectTrigger aria-labelledby="expiry-label" className="h-11 w-full md:h-10">
                  <SelectValue>{(v: (typeof expiryDays)[number]) => t.tokens.expiryDays[v]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {expiryDays.map((v) => (
                    <SelectItem key={v} value={v}>
                      {t.tokens.expiryDays[v]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
                {t.common.cancel}
              </Button>
              <Button type="submit" disabled={pending}>
                {pending && <Loader2 className="animate-spin" data-icon="inline-start" />}
                {t.tokens.createAction}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
