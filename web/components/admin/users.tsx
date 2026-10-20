'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import useSWR from 'swr'
import { ArrowLeft, Ban, CircleCheck, Copy, Eye, KeyRound, Loader2, Shield, Trash2, UserPlus, Users, Wand2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { FormField, validateEmail, validatePassword, validateUsername } from '@/components/form-field'
import { EmptyState } from '@/components/states'
import { Loadable } from '@/components/loadable'
import { MemeMedia } from '@/components/meme/meme-media'
import { SessionList } from '@/components/sessions'
import { AdminPageHeader, DataList, FilterSelect, Pagination, RefreshControls, SearchInput, Toolbar, useDebounced, usePaging, type Column } from './admin-ui'
import { RoleBadge, UserStatusBadge } from './labels'
import { ApiError, api, refresh } from '@/lib/api'
import { formatDate, formatDateTime } from '@/lib/format'
import { useSession } from '@/lib/session'
import type { AdminUser, Page, Role, User, UserDetail } from '@/lib/types'
import { cn, qs } from '@/lib/utils'
import { useMessages } from '@/lib/i18n/client'

type DialogKind = 'role' | 'disable' | 'password' | 'delete'

function useUserActions(onDeleted?: () => void) {
  const me = useSession().user
  const [dlg, setDlg] = useState<{ kind: DialogKind; user: User } | null>(null)
  const t = useMessages()
  // Admins cannot change or delete their own account (so one admin always remains).
  const selfBlock = (u: User) => (u.id === me?.id ? t.errors.own_account : null)

  const enable = async (u: User) => {
    try {
      await api(`/admin/users/${u.id}`, { method: 'PATCH', json: { status: 'active' } })
      await refresh()
      toast.success(t.users.enabled(u.username))
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const items = (u: User, detailHref?: string) => {
    const block = selfBlock(u)
    return (
      <>
        {detailHref && (
          <DropdownMenuItem render={<Link href={detailHref} />}>
            <Eye />
            {t.meme.details}
          </DropdownMenuItem>
        )}
        <Blocked reason={block}>
          <DropdownMenuItem disabled={!!block} onClick={() => setDlg({ kind: 'role', user: u })}>
            <Shield />
            {t.users.changeRole}
          </DropdownMenuItem>
          {u.status === 'active' ? (
            <DropdownMenuItem disabled={!!block} onClick={() => setDlg({ kind: 'disable', user: u })}>
              <Ban />
              {t.users.disable}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={() => enable(u)}>
              <CircleCheck />
              {t.users.enable}
            </DropdownMenuItem>
          )}
        </Blocked>
        <DropdownMenuItem onClick={() => setDlg({ kind: 'password', user: u })}>
          <KeyRound />
          {t.users.resetPassword}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" disabled={!!block} onClick={() => setDlg({ kind: 'delete', user: u })}>
          <Trash2 />
          {t.library.delete}
        </DropdownMenuItem>
      </>
    )
  }

  const close = () => setDlg(null)
  const dialogs = (
    <>
      {dlg?.kind === 'role' && <RoleDialog user={dlg.user} onClose={close} />}
      {dlg?.kind === 'disable' && <DisableDialog user={dlg.user} onClose={close} />}
      {dlg?.kind === 'password' && <PasswordDialog user={dlg.user} onClose={close} />}
      {dlg?.kind === 'delete' && (
        <DeleteUserDialog
          user={dlg.user}
          onClose={close}
          onDeleted={() => {
            close()
            onDeleted?.()
          }}
        />
      )}
    </>
  )
  return { items, dialogs, enable, selfBlock, open: (kind: DialogKind, user: User) => setDlg({ kind, user }) }
}

function Blocked({ reason, children }: { reason: string | null; children: React.ReactNode }) {
  if (!reason) return <>{children}</>
  return (
    <div title={reason}>
      {children}
      <p className="px-2 pb-1 pl-8 text-[11px] text-muted-foreground">{reason}</p>
    </div>
  )
}

/* --------------------------------- list ---------------------------------- */

export function AdminUsers() {
  const me = useSession().user
  const params = useSearchParams()
  const [q, setQ] = useState('')
  const dq = useDebounced(q.trim())
  const [role, setRole] = useState<'all' | Role>((params.get('role') as Role) ?? 'all')
  const [status, setStatus] = useState<'all' | 'active' | 'disabled'>('all')
  const [sort, setSort] = useState<'newest' | 'oldest' | 'name'>('newest')
  const [range, setRange] = useState(() => {
    const from = Number(params.get('from'))
    const to = Number(params.get('to'))
    return from && to ? { from, to } : null
  })
  const [createOpen, setCreateOpen] = useState(false)
  const actions = useUserActions()
  const t = useMessages()

  const paging = usePaging(`${dq}|${role}|${status}|${sort}|${range?.from}`)
  const filter = { q: dq, role: role === 'all' ? '' : role, status: status === 'all' ? '' : status, sort, from: range?.from, to: range?.to }
  const users = useSWR<Page<AdminUser>>(`/admin/users${qs({ ...filter, ...paging.query })}`, { keepPreviousData: true })

  const columns: Column<AdminUser>[] = [
    {
      key: 'user',
      header: t.users.user,
      mobile: 'title',
      cell: (u) => (
        <Link href={`/admin/users/${u.id}`} className="flex min-w-0 items-center gap-3 hover:underline">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold uppercase" aria-hidden>
            {u.username[0]}
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-medium">
              @{u.username}
              {u.id === me?.id && <span className="ml-1.5 text-xs font-normal text-muted-foreground">{t.users.you}</span>}
            </span>
            <span className="truncate text-xs text-muted-foreground">{u.email}</span>
          </span>
        </Link>
      ),
    },
    { key: 'role', header: t.users.role, cell: (u) => <RoleBadge role={u.role} /> },
    { key: 'status', header: t.users.status, cell: (u) => <UserStatusBadge status={u.status} /> },
    { key: 'created', header: t.users.joined, cell: (u) => <span className="tabular-nums">{formatDate(u.created_at)}</span> },
    { key: 'files', header: t.users.files, className: 'text-right', cell: (u) => <span className="tabular-nums">{u.files}</span> },
    { key: 'folders', header: t.users.folders, className: 'text-right', cell: (u) => <span className="tabular-nums">{u.folders}</span> },
    { key: 'favs', header: t.users.favorites, className: 'text-right', cell: (u) => <span className="tabular-nums">{u.favorites}</span> },
  ]

  return (
    <>
      <AdminPageHeader
        title={t.titles.users}
        actions={
          <>
            <RefreshControls onRefresh={() => users.mutate()} />
            <Button onClick={() => setCreateOpen(true)} className="h-10 md:h-9">
              <UserPlus data-icon="inline-start" />
              {t.users.create}
            </Button>
          </>
        }
      />
      <Toolbar>
        <SearchInput value={q} onChange={setQ} placeholder={t.users.search} className="w-full basis-full sm:basis-auto" />
        <FilterSelect
          label={t.users.role}
          value={role}
          onChange={setRole}
          options={[
            ['all', t.users.allRoles],
            ['user', t.admin.roles.user],
            ['admin', t.admin.roles.admin],
          ]}
        />
        <FilterSelect
          label={t.users.status}
          value={status}
          onChange={setStatus}
          options={[
            ['all', t.content.allStatuses],
            ['active', t.admin.userStates.active],
            ['disabled', t.admin.userStates.disabled],
          ]}
        />
        <FilterSelect
          label={t.adminTags.sort}
          value={sort}
          onChange={setSort}
          options={[
            ['newest', t.users.newest],
            ['oldest', t.users.oldest],
            ['name', t.auth.username],
          ]}
        />
        {range && (
          <Button variant="secondary" className="h-10 md:h-9" onClick={() => setRange(null)}>
            {t.users.joinedBetween(formatDate(range.from), formatDate(range.to))}
            <X data-icon="inline-end" />
          </Button>
        )}
      </Toolbar>
      <DataList
        rows={users.data?.items ?? []}
        loading={!users.data}
        columns={columns}
        getId={(u) => u.id}
        rowLabel={(u) => `@${u.username}`}
        actions={(u) => actions.items(u, `/admin/users/${u.id}`)}
        empty={<EmptyState icon={Users} title={t.users.none} description={t.users.noneHint} />}
      />
      <Pagination paging={paging} total={users.data?.total ?? 0} />
      {actions.dialogs}
      <CreateUserDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  )
}

/* -------------------------------- detail --------------------------------- */

export function AdminUserDetail({ id }: { id: string }) {
  const router = useRouter()
  const actions = useUserActions(() => router.push('/admin/users'))
  const detail = useSWR<UserDetail>(`/admin/users/${id}`)
  const t = useMessages()

  return (
    <>
      <Link href="/admin/users" className="-mb-2 flex h-9 items-center gap-1 self-start text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden />
        {t.users.list}
      </Link>
      <Loadable result={detail} notFound={{ title: t.notFound.user, description: t.users.notFoundHint }}>
        {(user) => {
          const block = actions.selfBlock(user)
          return (
            <>
              <section className="flex flex-col gap-5 rounded-2xl border bg-card p-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                  <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-brand text-xl font-semibold text-brand-foreground uppercase" aria-hidden>
                    {user.username[0]}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <h1 className="truncate text-xl font-semibold">@{user.username}</h1>
                    <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                      <span className="truncate">{user.email}</span>
                      <RoleBadge role={user.role} />
                      <UserStatusBadge status={user.status} />
                    </div>
                  </div>
                </div>
                <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {(
                    [
                      [t.users.joined, formatDateTime(user.created_at)],
                      [t.users.files, user.files],
                      [t.users.folders, user.folders],
                      [t.users.favorites, user.favorites],
                    ] as const
                  ).map(([k, v]) => (
                    <div key={k} className="flex flex-col gap-0.5 rounded-lg bg-muted/60 p-3">
                      <dt className="text-xs text-muted-foreground">{k}</dt>
                      <dd className="font-medium tabular-nums">{v}</dd>
                    </div>
                  ))}
                </dl>
                <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                  <Button variant="outline" disabled={!!block} title={block ?? undefined} onClick={() => actions.open('role', user)} className="h-10 md:h-9">
                    <Shield data-icon="inline-start" />
                    {t.users.changeRole}
                  </Button>
                  {user.status === 'active' ? (
                    <Button variant="outline" disabled={!!block} title={block ?? undefined} onClick={() => actions.open('disable', user)} className="h-10 md:h-9">
                      <Ban data-icon="inline-start" />
                      {t.users.disable}
                    </Button>
                  ) : (
                    <Button variant="outline" onClick={() => actions.enable(user)} className="h-10 md:h-9">
                      <CircleCheck data-icon="inline-start" />
                      {t.users.enable}
                    </Button>
                  )}
                  <Button variant="outline" onClick={() => actions.open('password', user)} className="h-10 md:h-9">
                    <KeyRound data-icon="inline-start" />
                    {t.users.resetPassword}
                  </Button>
                  <Button variant="outline" disabled={!!block} title={block ?? undefined} onClick={() => actions.open('delete', user)} className="h-10 text-destructive md:h-9">
                    <Trash2 data-icon="inline-start" />
                    {t.library.delete}
                  </Button>
                </div>
                {block && <p className="text-xs text-muted-foreground">{t.users.blocked(block)}</p>}
              </section>

              <section aria-labelledby="sessions" className="flex flex-col gap-3">
                <SessionList
                  heading={
                    <h2 id="sessions" className="text-sm font-medium text-muted-foreground">
                      {t.users.sessions}
                    </h2>
                  }
                  sessions={user.sessions}
                  path={`/admin/users/${user.id}/sessions`}
                  onChange={() => detail.mutate()}
                />
              </section>

              <section aria-labelledby="recent" className="flex flex-col gap-3">
                <h2 id="recent" className="text-sm font-medium text-muted-foreground">
                  {t.users.recent}
                </h2>
                {user.recent.length ? (
                  <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
                    {user.recent.map((m) => (
                      <li key={m.id}>
                        <Link href={`/m/${m.id}`} className="flex aspect-square items-center justify-center overflow-hidden rounded-lg border bg-muted/50 hover:border-foreground/30">
                          <MemeMedia meme={m} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">{t.users.noUploads}</p>
                )}
              </section>
            </>
          )
        }}
      </Loadable>
      {actions.dialogs}
    </>
  )
}

/* -------------------------------- dialogs -------------------------------- */

function useSubmit() {
  const [pending, setPending] = useState(false)
  const run = async (fn: () => Promise<void>) => {
    setPending(true)
    try {
      await fn()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setPending(false)
    }
  }
  return { pending, run }
}

function RoleDialog({ user, onClose }: { user: User; onClose: () => void }) {
  const [role, setRole] = useState<Role>(user.role)
  const { pending, run } = useSubmit()
  const t = useMessages()
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t.users.changeRole}</DialogTitle>
          <DialogDescription>{t.users.roleHint(user.username, t.admin.roles[user.role])}</DialogDescription>
        </DialogHeader>
        <div role="radiogroup" aria-label={t.users.newRole} className="grid grid-cols-2 gap-2">
          {(['user', 'admin'] as Role[]).map((r) => (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={role === r}
              onClick={() => setRole(r)}
              className={cn('flex h-12 items-center justify-center rounded-lg border text-sm font-medium transition', role === r ? 'border-foreground bg-foreground text-background' : 'hover:bg-muted')}
            >
              {t.admin.roles[r]}
            </button>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t.common.cancel}
          </Button>
          <Button
            disabled={role === user.role || pending}
            onClick={() =>
              run(async () => {
                await api(`/admin/users/${user.id}`, { method: 'PATCH', json: { role } })
                await refresh()
                toast.success(t.users.roleChanged(user.username, t.admin.roles[role]))
                onClose()
              })
            }
          >
            {pending && <Loader2 className="animate-spin" data-icon="inline-start" />}
            {t.users.confirmChange}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DisableDialog({ user, onClose }: { user: User; onClose: () => void }) {
  const { pending, run } = useSubmit()
  const t = useMessages()
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t.users.disableTitle(user.username)}</DialogTitle>
          <DialogDescription>{t.users.disableHint}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t.common.cancel}
          </Button>
          <Button
            variant="destructive"
            disabled={pending}
            onClick={() =>
              run(async () => {
                await api(`/admin/users/${user.id}`, { method: 'PATCH', json: { status: 'disabled' } })
                await refresh()
                toast.success(t.users.disabled(user.username))
                onClose()
              })
            }
          >
            {pending && <Loader2 className="animate-spin" data-icon="inline-start" />}
            {t.users.disable}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function randomPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%'
  const arr = crypto.getRandomValues(new Uint32Array(14))
  return Array.from(arr, (n) => chars[n % chars.length]).join('')
}

function PasswordDialog({ user, onClose }: { user: User; onClose: () => void }) {
  const [pw, setPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<{ pw?: string; confirm?: string }>({})
  const [visible, setVisible] = useState(false)
  const { pending, run } = useSubmit()
  const t = useMessages()

  const generate = async () => {
    const p = randomPassword()
    setPw(p)
    setConfirm(p)
    setVisible(true)
    setErrors({})
    try {
      await navigator.clipboard.writeText(p)
      toast.success(t.users.generated)
    } catch {
      toast.info(t.users.generatedCopyFailed)
    }
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const errs = { pw: validatePassword(pw, t), confirm: confirm !== pw ? t.form.passwordMismatch : undefined }
    setErrors(errs)
    if (errs.pw || errs.confirm) return
    run(async () => {
      await api(`/admin/users/${user.id}/password`, { method: 'PUT', json: { password: pw } })
      void refresh()
      toast.success(t.users.passwordReset(user.username), { description: t.users.passwordResetHint })
      onClose()
    })
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t.users.resetPassword}</DialogTitle>
            <DialogDescription>{t.users.resetHint(user.username)}</DialogDescription>
          </DialogHeader>
          <FormField label={t.settings.newPassword} type={visible ? 'text' : 'password'} autoComplete="new-password" value={pw} error={errors.pw} onChange={(e) => setPw(e.target.value)} />
          <FormField label={t.settings.confirmPassword} type={visible ? 'text' : 'password'} autoComplete="new-password" value={confirm} error={errors.confirm} onChange={(e) => setConfirm(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={generate}>
              <Wand2 data-icon="inline-start" />
              {t.users.generate}
            </Button>
            {pw && (
              <Button type="button" variant="ghost" size="sm" onClick={() => navigator.clipboard.writeText(pw).then(() => toast.success(t.shares.copied))}>
                <Copy data-icon="inline-start" />
                {t.share.copy}
              </Button>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t.common.cancel}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="animate-spin" data-icon="inline-start" />}
              {t.users.reset}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function DeleteUserDialog({ user, onClose, onDeleted }: { user: User; onClose: () => void; onDeleted: () => void }) {
  const [typed, setTyped] = useState('')
  const { pending, run } = useSubmit()
  const t = useMessages()
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t.users.deleteTitle(user.username)}</DialogTitle>
          <DialogDescription>{t.users.deleteHint}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="confirm-username" className="text-sm font-normal">
            {t.admin.typeBefore}
            <span className="font-mono font-semibold">{user.username}</span>
            {t.admin.typeAfter}
          </Label>
          <Input id="confirm-username" autoComplete="off" autoCapitalize="off" value={typed} onChange={(e) => setTyped(e.target.value)} className="h-11 text-base md:h-9 md:text-sm" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t.common.cancel}
          </Button>
          <Button
            variant="destructive"
            disabled={typed !== user.username || pending}
            onClick={() =>
              run(async () => {
                await api(`/admin/users/${user.id}`, { method: 'DELETE' })
                await refresh()
                toast.success(t.users.deleted(user.username))
                onDeleted()
              })
            }
          >
            {pending && <Loader2 className="animate-spin" data-icon="inline-start" />}
            {t.content.deleteForever}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CreateUserDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const empty = { username: '', email: '', password: '' }
  const [form, setForm] = useState(empty)
  const [role, setRole] = useState<Role>('user')
  const [errors, setErrors] = useState<Partial<typeof empty>>({})
  const { pending, run } = useSubmit()
  const t = useMessages()

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const errs = { username: validateUsername(form.username, t), email: validateEmail(form.email, t), password: validatePassword(form.password, t) }
    setErrors(errs)
    if (errs.username || errs.email || errs.password) return
    run(async () => {
      try {
        const u = await api<User>('/admin/users', { method: 'POST', json: { ...form, email: form.email.trim(), role } })
        await refresh()
        toast.success(t.users.created(u.username))
        setForm(empty)
        setRole('user')
        onOpenChange(false)
      } catch (err) {
        if (err instanceof ApiError && err.field && err.field in empty) setErrors({ [err.field]: err.message })
        else throw err
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t.users.create}</DialogTitle>
            <DialogDescription>{t.users.createHint}</DialogDescription>
          </DialogHeader>
          <FormField label={t.auth.username} autoComplete="off" autoCapitalize="off" value={form.username} error={errors.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          <FormField label={t.auth.email} type="email" inputMode="email" autoComplete="off" value={form.email} error={errors.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <FormField label={t.users.initialPassword} type="text" autoComplete="new-password" value={form.password} error={errors.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <FilterSelect
            label={t.users.role}
            value={role}
            onChange={setRole}
            options={[
              ['user', t.admin.roles.user],
              ['admin', t.admin.roles.admin],
            ]}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t.common.cancel}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="animate-spin" data-icon="inline-start" />}
              {t.tokens.create}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
