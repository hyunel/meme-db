'use client'

import { useState } from 'react'
import { LogOut, Monitor, Smartphone } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
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
import { api } from '@/lib/api'
import { formatDate, formatRelative } from '@/lib/format'
import type { Session } from '@/lib/types'

// The first match names it, so the browsers built on Chrome or Safari come before them.
const browsers: [RegExp, string][] = [
  [/MicroMessenger\//, '微信'],
  [/QQBrowser\//, 'QQ 浏览器'],
  [/Edg(e|A|iOS)?\//, 'Edge'],
  [/OPR\//, 'Opera'],
  [/Firefox\/|FxiOS\//, 'Firefox'],
  [/Chrome\/|CriOS\//, 'Chrome'],
  [/Safari\//, 'Safari'],
]
const systems: [RegExp, string][] = [
  [/iPhone|iPad|iPod/, 'iOS'],
  [/Android/, 'Android'],
  [/Windows/, 'Windows'],
  [/Mac OS X/, 'macOS'],
  [/CrOS/, 'ChromeOS'],
  [/Linux/, 'Linux'],
]

const deviceName = (ua: string) =>
  [browsers, systems]
    .map((list) => list.find(([re]) => re.test(ua))?.[1])
    .filter(Boolean)
    .join(' · ') || '未知设备'

/** A user's sign-ins, each but the viewer's own revocable through path, the API path of their sessions. */
export function SessionList({ heading, sessions, path, onChange }: { heading: React.ReactNode; sessions: Session[] | undefined; path: string; onChange: () => unknown }) {
  const [revoking, setRevoking] = useState<Session | 'others' | null>(null)
  const hasCurrent = Boolean(sessions?.some((s) => s.current))
  const others = sessions?.filter((s) => !s.current).length ?? 0
  const allLabel = hasCurrent ? '退出其他设备' : '全部退出登录'

  const revoke = async (target: Session | 'others') => {
    try {
      await api(target === 'others' ? path : `${path}/${target.id}`, { method: 'DELETE' })
      await onChange()
      toast.success(target === 'others' ? (hasCurrent ? '其他设备已退出登录' : '所有设备已退出登录') : `${deviceName(target.user_agent)} 已退出登录`)
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  return (
    <>
      <div className="flex items-center justify-between gap-4">
        {heading}
        {others > 0 && (
          <Button variant="outline" onClick={() => setRevoking('others')} className="h-11 shrink-0 sm:h-9">
            <LogOut data-icon="inline-start" />
            {allLabel}
          </Button>
        )}
      </div>

      {!sessions ? (
        <Skeleton className="h-16 rounded-xl" />
      ) : sessions.length ? (
        <ul className="flex flex-col divide-y rounded-xl border">
          {sessions.map((s) => {
            const name = deviceName(s.user_agent)
            const Icon = /Mobi|iPhone|iPad|Android/.test(s.user_agent) ? Smartphone : Monitor
            return (
              <li key={s.id} className="flex items-center gap-3 p-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted" aria-hidden>
                  <Icon className="size-4 text-muted-foreground" />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-medium" title={s.user_agent}>
                      {name}
                    </span>
                    {s.current && <span className="inline-flex h-5 shrink-0 items-center rounded-full bg-brand px-2 text-xs font-medium text-brand-foreground">当前设备</span>}
                  </div>
                  <p className="text-xs text-muted-foreground">{`${s.ip} · ${formatDate(s.created_at)} 登录 · ${formatRelative(s.last_used_at)}活跃`}</p>
                </div>
                {!s.current && (
                  <Button variant="ghost" size="icon" aria-label={`让 ${name} 退出登录`} onClick={() => setRevoking(s)} className="size-10 text-muted-foreground hover:text-destructive md:size-8">
                    <LogOut />
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">没有登录中的设备</p>
      )}

      <AlertDialog open={revoking !== null} onOpenChange={(o) => !o && setRevoking(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{revoking === 'others' ? `${allLabel}？` : `让 ${revoking && deviceName(revoking.user_agent)} 退出登录？`}</AlertDialogTitle>
            <AlertDialogDescription>
              {revoking === 'others' ? `${hasCurrent ? '其他' : '所有'} ${others} 台设备需要重新登录才能继续使用。` : '该设备需要重新登录才能继续使用。'}
            </AlertDialogDescription>
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
              退出登录
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
