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
import { AdminPageHeader, DataList, FilterSelect, Pagination, RefreshControls, SearchInput, Toolbar, useDebounced, usePaging, type Column } from './admin-ui'
import { RoleBadge, UserStatusBadge } from './labels'
import { ApiError, api, qs, refresh } from '@/lib/api'
import { formatDate, formatDateTime } from '@/lib/format'
import { useSession } from '@/lib/session'
import type { AdminUser, Page, Role, User, UserDetail } from '@/lib/types'
import { cn } from '@/lib/utils'

type DialogKind = 'role' | 'disable' | 'password' | 'delete'

const roleLabel = (r: Role) => (r === 'admin' ? '管理员' : '普通用户')

/** Shared row actions + dialogs for the list and detail page. */
function useUserActions(onDeleted?: () => void) {
  const me = useSession().user
  const [dlg, setDlg] = useState<{ kind: DialogKind; user: User } | null>(null)
  // Admins cannot change or delete their own account (so one admin always remains).
  const selfBlock = (u: User) => (u.id === me?.id ? '不能修改或删除自己的账号' : null)

  const enable = async (u: User) => {
    try {
      await api(`/admin/users/${u.id}`, { method: 'PATCH', json: { status: 'active' } })
      await refresh()
      toast.success(`已启用 @${u.username}`)
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
            查看详情
          </DropdownMenuItem>
        )}
        <Blocked reason={block}>
          <DropdownMenuItem disabled={!!block} onClick={() => setDlg({ kind: 'role', user: u })}>
            <Shield />
            修改角色
          </DropdownMenuItem>
          {u.status === 'active' ? (
            <DropdownMenuItem disabled={!!block} onClick={() => setDlg({ kind: 'disable', user: u })}>
              <Ban />
              禁用
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={() => enable(u)}>
              <CircleCheck />
              启用
            </DropdownMenuItem>
          )}
        </Blocked>
        <DropdownMenuItem onClick={() => setDlg({ kind: 'password', user: u })}>
          <KeyRound />
          重置密码
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" disabled={!!block} onClick={() => setDlg({ kind: 'delete', user: u })}>
          <Trash2 />
          删除
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
    const f = Number(params.get('from'))
    const t = Number(params.get('to'))
    return f && t ? { from: f, to: t } : null
  })
  const [createOpen, setCreateOpen] = useState(false)
  const actions = useUserActions()

  const paging = usePaging(`${dq}|${role}|${status}|${sort}|${range?.from}`)
  const filter = { q: dq, role: role === 'all' ? '' : role, status: status === 'all' ? '' : status, sort, from: range?.from, to: range?.to }
  const users = useSWR<Page<AdminUser>>(`/admin/users${qs({ ...filter, ...paging.query })}`, { keepPreviousData: true })

  const columns: Column<AdminUser>[] = [
    {
      key: 'user',
      header: '用户',
      mobile: 'title',
      cell: (u) => (
        <Link href={`/admin/users/${u.id}`} className="flex min-w-0 items-center gap-3 hover:underline">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold uppercase" aria-hidden>
            {u.username[0]}
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-medium">
              @{u.username}
              {u.id === me?.id && <span className="ml-1.5 text-xs font-normal text-muted-foreground">（你）</span>}
            </span>
            <span className="truncate text-xs text-muted-foreground">{u.email}</span>
          </span>
        </Link>
      ),
    },
    { key: 'role', header: '角色', cell: (u) => <RoleBadge role={u.role} /> },
    { key: 'status', header: '状态', cell: (u) => <UserStatusBadge status={u.status} /> },
    { key: 'created', header: '注册时间', cell: (u) => <span className="tabular-nums">{formatDate(u.created_at)}</span> },
    { key: 'files', header: '文件', className: 'text-right', cell: (u) => <span className="tabular-nums">{u.files}</span> },
    { key: 'folders', header: '文件夹', className: 'text-right', cell: (u) => <span className="tabular-nums">{u.folders}</span> },
    { key: 'favs', header: '收藏', className: 'text-right', cell: (u) => <span className="tabular-nums">{u.favorites}</span> },
  ]

  return (
    <>
      <AdminPageHeader
        title="用户管理"
        actions={
          <>
            <RefreshControls onRefresh={() => users.mutate()} />
            <Button onClick={() => setCreateOpen(true)} className="h-10 md:h-9">
              <UserPlus data-icon="inline-start" />
              创建用户
            </Button>
          </>
        }
      />
      <Toolbar>
        <SearchInput value={q} onChange={setQ} placeholder="搜索用户名或邮箱" className="w-full basis-full sm:basis-auto" />
        <FilterSelect label="角色" value={role} onChange={setRole} options={[['all', '全部角色'], ['user', '普通用户'], ['admin', '管理员']]} />
        <FilterSelect label="状态" value={status} onChange={setStatus} options={[['all', '全部状态'], ['active', '正常'], ['disabled', '已禁用']]} />
        <FilterSelect label="排序" value={sort} onChange={setSort} options={[['newest', '注册时间（新→旧）'], ['oldest', '注册时间（旧→新）'], ['name', '用户名']]} />
        {range && (
          <Button variant="secondary" className="h-10 md:h-9" onClick={() => setRange(null)}>
            注册于 {formatDate(range.from)} – {formatDate(range.to)}
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
        empty={<EmptyState icon={Users} title="没有符合条件的用户" description="试试调整搜索或筛选条件。" />}
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

  return (
    <>
      <Link href="/admin/users" className="-mb-2 flex h-9 items-center gap-1 self-start text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden />
        用户列表
      </Link>
      <Loadable result={detail} notFound={{ title: '用户不存在', description: '该用户可能已被删除。' }}>
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
                      ['注册时间', formatDateTime(user.created_at)],
                      ['文件', user.files],
                      ['文件夹', user.folders],
                      ['收藏', user.favorites],
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
                    修改角色
                  </Button>
                  {user.status === 'active' ? (
                    <Button variant="outline" disabled={!!block} title={block ?? undefined} onClick={() => actions.open('disable', user)} className="h-10 md:h-9">
                      <Ban data-icon="inline-start" />
                      禁用
                    </Button>
                  ) : (
                    <Button variant="outline" onClick={() => actions.enable(user)} className="h-10 md:h-9">
                      <CircleCheck data-icon="inline-start" />
                      启用
                    </Button>
                  )}
                  <Button variant="outline" onClick={() => actions.open('password', user)} className="h-10 md:h-9">
                    <KeyRound data-icon="inline-start" />
                    重置密码
                  </Button>
                  <Button variant="outline" disabled={!!block} title={block ?? undefined} onClick={() => actions.open('delete', user)} className="h-10 text-destructive md:h-9">
                    <Trash2 data-icon="inline-start" />
                    删除
                  </Button>
                </div>
                {block && <p className="text-xs text-muted-foreground">部分操作不可用：{block}</p>}
              </section>

              <section aria-labelledby="recent" className="flex flex-col gap-3">
                <h2 id="recent" className="text-sm font-medium text-muted-foreground">
                  最近上传
                </h2>
                {user.recent.length ? (
                  <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
                    {user.recent.map((m) => (
                      <li key={m.id}>
                        <Link href={`/m/${m.id}`} className="flex aspect-square items-center justify-center overflow-hidden rounded-lg border bg-card p-1.5 hover:border-foreground/30">
                          <MemeMedia meme={m} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">该用户还没有上传表情包</p>
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
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>修改角色</DialogTitle>
          <DialogDescription>
            @{user.username} 当前为「{roleLabel(user.role)}」。修改会立即生效。
          </DialogDescription>
        </DialogHeader>
        <div role="radiogroup" aria-label="新角色" className="grid grid-cols-2 gap-2">
          {(['user', 'admin'] as Role[]).map((r) => (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={role === r}
              onClick={() => setRole(r)}
              className={cn('flex h-12 items-center justify-center rounded-lg border text-sm font-medium transition', role === r ? 'border-foreground bg-foreground text-background' : 'hover:bg-muted')}
            >
              {roleLabel(r)}
            </button>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button
            disabled={role === user.role || pending}
            onClick={() =>
              run(async () => {
                await api(`/admin/users/${user.id}`, { method: 'PATCH', json: { role } })
                await refresh()
                toast.success(`@${user.username} 已设为${roleLabel(role)}`)
                onClose()
              })
            }
          >
            {pending && <Loader2 className="animate-spin" data-icon="inline-start" />}
            确认修改
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DisableDialog({ user, onClose }: { user: User; onClose: () => void }) {
  const { pending, run } = useSubmit()
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>禁用 @{user.username}？</DialogTitle>
          <DialogDescription>禁用后该用户会被立即登出，且无法再登录，其公开内容也会被隐藏。你可以随时重新启用。</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button
            variant="destructive"
            disabled={pending}
            onClick={() =>
              run(async () => {
                await api(`/admin/users/${user.id}`, { method: 'PATCH', json: { status: 'disabled' } })
                await refresh()
                toast.success(`已禁用 @${user.username}`)
                onClose()
              })
            }
          >
            {pending && <Loader2 className="animate-spin" data-icon="inline-start" />}
            禁用
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

  const generate = async () => {
    const p = randomPassword()
    setPw(p)
    setConfirm(p)
    setVisible(true)
    setErrors({})
    try {
      await navigator.clipboard.writeText(p)
      toast.success('已生成并复制随机密码')
    } catch {
      toast.info('已生成随机密码，请手动复制')
    }
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const errs = { pw: validatePassword(pw), confirm: confirm !== pw ? '两次输入的密码不一致' : undefined }
    setErrors(errs)
    if (errs.pw || errs.confirm) return
    run(async () => {
      await api(`/admin/users/${user.id}/password`, { method: 'PUT', json: { password: pw } })
      toast.success(`已重置 @${user.username} 的密码`, { description: '弹窗关闭后将无法再查看该密码。' })
      onClose()
    })
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>重置密码</DialogTitle>
            <DialogDescription>为 @{user.username} 设置新密码。关闭弹窗后将无法再查看。</DialogDescription>
          </DialogHeader>
          <FormField label="新密码" type={visible ? 'text' : 'password'} autoComplete="new-password" value={pw} error={errors.pw} onChange={(e) => setPw(e.target.value)} />
          <FormField label="确认新密码" type={visible ? 'text' : 'password'} autoComplete="new-password" value={confirm} error={errors.confirm} onChange={(e) => setConfirm(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={generate}>
              <Wand2 data-icon="inline-start" />
              生成随机密码
            </Button>
            {pw && (
              <Button type="button" variant="ghost" size="sm" onClick={() => navigator.clipboard.writeText(pw).then(() => toast.success('已复制'))}>
                <Copy data-icon="inline-start" />
                复制
              </Button>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="animate-spin" data-icon="inline-start" />}
              重置
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
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>永久删除 @{user.username}？</DialogTitle>
          <DialogDescription>会永久删除该用户的库内容、收藏和个人标签，且无法恢复。</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="confirm-username" className="text-sm font-normal">
            请输入 <span className="font-mono font-semibold">{user.username}</span> 以确认
          </Label>
          <Input id="confirm-username" autoComplete="off" autoCapitalize="off" value={typed} onChange={(e) => setTyped(e.target.value)} className="h-11 text-base md:h-9 md:text-sm" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button
            variant="destructive"
            disabled={typed !== user.username || pending}
            onClick={() =>
              run(async () => {
                await api(`/admin/users/${user.id}`, { method: 'DELETE' })
                await refresh()
                toast.success(`已删除 @${user.username}`)
                onDeleted()
              })
            }
          >
            {pending && <Loader2 className="animate-spin" data-icon="inline-start" />}
            永久删除
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

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const errs = { username: validateUsername(form.username), email: validateEmail(form.email), password: validatePassword(form.password) }
    setErrors(errs)
    if (errs.username || errs.email || errs.password) return
    run(async () => {
      try {
        const u = await api<User>('/admin/users', { method: 'POST', json: { ...form, email: form.email.trim(), role } })
        await refresh()
        toast.success(`已创建 @${u.username}`)
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
            <DialogTitle>创建用户</DialogTitle>
            <DialogDescription>规则与注册一致。</DialogDescription>
          </DialogHeader>
          <FormField label="用户名" autoComplete="off" autoCapitalize="off" value={form.username} error={errors.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          <FormField label="邮箱" type="email" inputMode="email" autoComplete="off" value={form.email} error={errors.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <FormField label="初始密码" type="text" autoComplete="new-password" value={form.password} error={errors.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <FilterSelect label="角色" value={role} onChange={setRole} options={[['user', '普通用户'], ['admin', '管理员']]} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="animate-spin" data-icon="inline-start" />}
              创建
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
