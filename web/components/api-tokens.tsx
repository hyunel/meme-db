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

export const tokenScopes: Record<TokenScope, { label: string; hint: string; tone: string }> = {
  read: { label: '只读', hint: '搜索与浏览表情包、你的库和收藏', tone: 'bg-muted text-muted-foreground' },
  write: { label: '读写', hint: '另可上传表情包、整理库、收藏与打标签', tone: 'bg-brand text-brand-foreground' },
  admin: { label: '管理', hint: '另可调用管理后台接口', tone: 'bg-foreground text-background' },
}

export function ScopeBadge({ scope }: { scope: TokenScope }) {
  return <span className={cn('inline-flex h-5 shrink-0 items-center rounded-full px-2 text-xs font-medium', tokenScopes[scope].tone)}>{tokenScopes[scope].label}</span>
}

const expiryOptions = [
  ['30', '30 天'],
  ['90', '90 天'],
  ['365', '1 年'],
  ['0', '永不过期'],
] as const

const isExpired = (t: ApiToken) => t.expires_at !== null && toMs(t.expires_at) <= Date.now()

export function ApiTokens() {
  const tokens = useSWR<ApiToken[]>('/auth/tokens')
  const [creating, setCreating] = useState(false)
  const [revoking, setRevoking] = useState<ApiToken | null>(null)

  const revoke = async (token: ApiToken) => {
    try {
      await api(`/auth/tokens/${token.id}`, { method: 'DELETE' })
      await refresh()
      toast.success(`已撤销「${token.name}」`)
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  return (
    <section id="api-tokens" aria-labelledby="tokens-h" className="flex scroll-mt-20 flex-col gap-4 rounded-2xl border bg-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="tokens-h" className="font-semibold">
            API 令牌
          </h2>
          <p className="text-sm text-pretty text-muted-foreground">
            让脚本与工具以你的身份调用 MemeDB，例如自动上传表情包。
            <Link href="/developers" className="font-medium text-foreground underline-offset-4 hover:underline">
              查看 API 文档
            </Link>
          </p>
        </div>
        <Button variant="outline" onClick={() => setCreating(true)} className="h-11 shrink-0 sm:h-9">
          <Plus data-icon="inline-start" />
          创建
        </Button>
      </div>

      <Loadable result={tokens} loading={<Skeleton className="h-16 rounded-xl" />}>
        {(list) =>
          list.length ? (
            <ul className="flex flex-col divide-y rounded-xl border">
              {list.map((t) => (
                <li key={t.id} className="flex items-center gap-3 p-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted" aria-hidden>
                    <KeyRound className="size-4 text-muted-foreground" />
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-medium">{t.name}</span>
                      <ScopeBadge scope={t.scope} />
                      {isExpired(t) && <span className="inline-flex h-5 shrink-0 items-center rounded-full bg-destructive/10 px-2 text-xs font-medium text-destructive">已过期</span>}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      <span className="font-mono">mdb_…{t.hint}</span>
                      {` · ${formatDate(t.created_at)} 创建 · ${t.last_used_at ? `${formatRelative(t.last_used_at)}使用` : '从未使用'} · `}
                      {t.expires_at ? `${formatDate(t.expires_at)} 过期` : '永不过期'}
                    </p>
                  </div>
                  <Button variant="ghost" size="icon" aria-label={`撤销 ${t.name}`} onClick={() => setRevoking(t)} className="size-10 text-muted-foreground hover:text-destructive md:size-8">
                    <Trash2 />
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">还没有 API 令牌</p>
          )
        }
      </Loadable>

      {creating && <CreateTokenDialog onClose={() => setCreating(false)} />}

      <AlertDialog open={revoking !== null} onOpenChange={(o) => !o && setRevoking(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>撤销令牌「{revoking?.name}」？</AlertDialogTitle>
            <AlertDialogDescription>使用它的脚本与工具将立即无法访问，此操作无法撤销。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const target = revoking
                setRevoking(null)
                if (target) void revoke(target)
              }}
            >
              撤销
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
  const scopes = (Object.keys(tokenScopes) as TokenScope[]).filter((s) => s !== 'admin' || isAdmin)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const name = form.name.trim()
    if (!name) return setError('请输入令牌名称')
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
              <DialogTitle>令牌已创建</DialogTitle>
              <DialogDescription>请立即复制并妥善保管，关闭后将无法再次查看。</DialogDescription>
            </DialogHeader>
            <div className="flex items-center gap-2 rounded-lg border bg-muted/40 py-1 pr-1 pl-3">
              <code className="min-w-0 flex-1 font-mono text-sm wrap-anywhere">{created.secret}</code>
              <CopyButton value={created.secret} label="复制令牌" className="size-9" />
            </div>
            <CodeBlock title="试一试" code={`curl -H "Authorization: Bearer ${created.secret}" \\\n  ${origin}/api/auth/me`} />
            <DialogFooter>
              <Button onClick={onClose}>完成</Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={submit} noValidate className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>创建 API 令牌</DialogTitle>
              <DialogDescription>令牌拥有你账号的所选权限，请只交给信任的脚本与工具。</DialogDescription>
            </DialogHeader>
            <FormField
              label="名称"
              autoFocus
              maxLength={50}
              placeholder="例如：自动入库脚本"
              value={form.name}
              error={error}
              onChange={(e) => {
                setForm({ ...form, name: e.target.value })
                setError(undefined)
              }}
            />
            <div className="flex flex-col gap-1.5">
              <Label id="scope-label">权限</Label>
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
                    <span className="text-sm font-medium">{tokenScopes[s].label}</span>
                    <span className="text-xs text-muted-foreground">{tokenScopes[s].hint}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label id="expiry-label">有效期</Label>
              <Select value={form.days} onValueChange={(v) => setForm({ ...form, days: v as string })}>
                <SelectTrigger aria-labelledby="expiry-label" className="h-11 w-full md:h-10">
                  <SelectValue>{(v: string) => expiryOptions.find((o) => o[0] === v)?.[1]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {expiryOptions.map(([v, label]) => (
                    <SelectItem key={v} value={v}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
                取消
              </Button>
              <Button type="submit" disabled={pending}>
                {pending && <Loader2 className="animate-spin" data-icon="inline-start" />}
                创建令牌
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
