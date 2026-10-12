'use client'

import { Activity, useState } from 'react'
import useSWR from 'swr'
import { FolderHeart, HeartOff, ImageOff, Loader2, LogOut } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { MemeFeed } from '@/components/meme/meme-feed'
import { FolderGrid, FolderGridSkeleton } from '@/components/folder/folder-card'
import { EmptyState } from '@/components/states'
import { Loadable } from '@/components/loadable'
import { useFeed } from '@/hooks/use-feed'
import { FormField, validatePassword } from '@/components/form-field'
import { ApiError, api, qs } from '@/lib/api'
import { formatDate } from '@/lib/format'
import { logout, useSession } from '@/lib/session'
import type { Favorites, Feed, Meme, UserStats } from '@/lib/types'
import { TabSwitch } from '@/components/tab-switch'
import { ApiTokens } from '@/components/api-tokens'

export function FavoritesView() {
  const [tab, setTab] = useState<'meme' | 'folder'>('meme')
  const favorites = useSWR<Favorites>('/favorites')
  const memes = useFeed(['favorite-memes'], (cursor) => api<Feed<Meme>>(`/favorites/memes${qs({ cursor })}`), { live: true })
  const data = favorites.data
  const stale = data ? (tab === 'meme' ? data.stale_memes : data.stale_folders).length : 0

  const clearStale = async () => {
    try {
      await api('/favorites/stale', { method: 'DELETE' })
      toast.success('已清理失效收藏')
      await favorites.mutate()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">我的收藏</h1>
        <p className="text-sm text-muted-foreground">收藏的内容不会进入你的库，可随时加入。</p>
      </header>
      <TabSwitch label="收藏类型" value={tab} onChange={setTab} tabs={[['meme', '表情包', data?.meme_count], ['folder', '合集', data?.folders.length]] as const} />

      {stale > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed px-4 py-3 text-sm">
          <HeartOff className="size-4 text-muted-foreground" aria-hidden />
          <span className="flex-1">有 {stale} 个收藏已被删除或设为私有。</span>
          <Button size="sm" variant="outline" onClick={clearStale}>
            清理
          </Button>
        </div>
      )}

      {/* Both tabs stay mounted, so switching shows the cards built before rather than building them again */}
      <div role="tabpanel">
        <Activity mode={tab === 'meme' ? 'visible' : 'hidden'}>
          <MemeFeed
            memes={memes.items}
            feed={memes}
            allowAdd
            empty={<EmptyState icon={ImageOff} title="还没有收藏表情包" description="在任意表情包上点击爱心即可收藏。" />}
          />
        </Activity>
        <Activity mode={tab === 'folder' ? 'visible' : 'hidden'}>
          <Loadable result={favorites} loading={<FolderGridSkeleton />}>
            {({ folders }) =>
              folders.length ? <FolderGrid folders={folders} /> : <EmptyState icon={FolderHeart} title="还没有收藏合集" description="在发现页浏览公开合集。" />
            }
          </Loadable>
        </Activity>
      </div>
    </div>
  )
}

export function SettingsView() {
  const user = useSession().user!
  const { data: stats } = useSWR<UserStats>('/auth/me/stats')
  const [form, setForm] = useState({ current: '', next: '', confirm: '' })
  const [errors, setErrors] = useState<Partial<typeof form>>({})
  const [pending, setPending] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const errs: Partial<typeof form> = {}
    if (!form.current) errs.current = '请输入当前密码'
    const pw = validatePassword(form.next)
    if (pw) errs.next = pw
    else if (form.next === form.current) errs.next = '新密码不能与当前密码相同'
    if (form.confirm !== form.next) errs.confirm = '两次输入的密码不一致'
    setErrors(errs)
    if (Object.keys(errs).length) return
    setPending(true)
    try {
      await api('/auth/password', { method: 'PUT', json: { current_password: form.current, new_password: form.next } })
      toast.success('密码已更新')
      setForm({ current: '', next: '', confirm: '' })
    } catch (err) {
      if (err instanceof ApiError && err.field === 'current_password') setErrors({ current: err.message })
      else toast.error((err as Error).message)
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-6 sm:px-6 sm:py-8">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">账号设置</h1>

      <section aria-labelledby="profile-h" className="flex flex-col gap-4 rounded-2xl border bg-card p-5">
        <div className="flex items-center gap-4">
          <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-brand text-xl font-semibold text-brand-foreground uppercase" aria-hidden>
            {user.username.slice(0, 1)}
          </span>
          <div className="flex min-w-0 flex-col">
            <h2 id="profile-h" className="truncate text-lg font-semibold">
              @{user.username}
            </h2>
            <p className="truncate text-sm text-muted-foreground">{user.email}</p>
          </div>
        </div>
        <dl className="grid grid-cols-3 gap-2 text-center">
          {(
            [
              ['库中表情包', stats?.files],
              ['文件夹', stats?.folders],
              ['收藏', stats?.favorites],
            ] as const
          ).map(([k, v]) => (
            <div key={k} className="rounded-lg bg-muted px-2 py-3">
              <dd className="text-xl font-semibold tabular-nums">{v ?? '—'}</dd>
              <dt className="text-xs text-muted-foreground">{k}</dt>
            </div>
          ))}
        </dl>
        <p className="text-xs text-muted-foreground">
          {formatDate(user.created_at)} 注册 · {user.role === 'admin' ? '管理员' : '普通用户'}
        </p>
      </section>

      <section aria-labelledby="pw-h" className="flex flex-col gap-4 rounded-2xl border bg-card p-5">
        <h2 id="pw-h" className="font-semibold">
          修改密码
        </h2>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <FormField label="当前密码" type="password" autoComplete="current-password" value={form.current} error={errors.current} onChange={(e) => setForm({ ...form, current: e.target.value })} />
          <FormField label="新密码" type="password" autoComplete="new-password" hint="至少 6 个字符" value={form.next} error={errors.next} onChange={(e) => setForm({ ...form, next: e.target.value })} />
          <FormField label="确认新密码" type="password" autoComplete="new-password" value={form.confirm} error={errors.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} />
          <Button type="submit" disabled={pending} className="h-11 self-stretch sm:h-9 sm:self-start">
            {pending && <Loader2 className="animate-spin" data-icon="inline-start" />}
            更新密码
          </Button>
        </form>
      </section>

      <ApiTokens />

      <section aria-labelledby="session-h" className="flex flex-col gap-3 rounded-2xl border bg-card p-5">
        <h2 id="session-h" className="font-semibold">
          登录状态
        </h2>
        <p className="text-sm text-muted-foreground">退出后将清除本设备上的会话与搜索历史。</p>
        <Button variant="outline" onClick={logout} className="h-11 self-stretch text-destructive sm:h-9 sm:self-start">
          <LogOut data-icon="inline-start" />
          退出登录
        </Button>
      </section>
    </div>
  )
}
