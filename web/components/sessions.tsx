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
import type { Messages } from '@/lib/i18n'
import { useMessages } from '@/lib/i18n/client'

// The first match names it, so the browsers built on Chrome or Safari come before them; the dictionary names the apps it lists.
const browsers: [RegExp, string][] = [
  [/MicroMessenger\//, 'wechat'],
  [/QQBrowser\//, 'qqBrowser'],
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

const deviceName = (ua: string, { sessions }: Messages) =>
  [browsers, systems]
    .map((list) => list.find(([re]) => re.test(ua))?.[1])
    .filter((name) => name !== undefined)
    .map((name) => sessions.apps[name as keyof typeof sessions.apps] ?? name)
    .join(' · ') || sessions.unknown

/** A user's sign-ins, each but the viewer's own revocable through path, the API path of their sessions. */
export function SessionList({ heading, sessions, path, onChange }: { heading: React.ReactNode; sessions: Session[] | undefined; path: string; onChange: () => unknown }) {
  const [revoking, setRevoking] = useState<Session | 'others' | null>(null)
  const hasCurrent = Boolean(sessions?.some((s) => s.current))
  const others = sessions?.filter((s) => !s.current).length ?? 0
  const t = useMessages()
  const allLabel = hasCurrent ? t.sessions.revokeOthers : t.sessions.revokeAll

  const revoke = async (target: Session | 'others') => {
    try {
      await api(target === 'others' ? path : `${path}/${target.id}`, { method: 'DELETE' })
      await onChange()
      toast.success(target === 'others' ? (hasCurrent ? t.sessions.othersRevoked : t.sessions.allRevoked) : t.sessions.revoked(deviceName(target.user_agent, t)))
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
            const name = deviceName(s.user_agent, t)
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
                    {s.current && <span className="inline-flex h-5 shrink-0 items-center rounded-full bg-brand px-2 text-xs font-medium text-brand-foreground">{t.sessions.current}</span>}
                  </div>
                  <p className="text-xs text-muted-foreground">{`${s.ip} · ${t.sessions.signedIn(formatDate(s.created_at))} · ${t.sessions.active(formatRelative(s.last_used_at, t))}`}</p>
                </div>
                {!s.current && (
                  <Button variant="ghost" size="icon" aria-label={t.sessions.revoke(name)} onClick={() => setRevoking(s)} className="size-10 text-muted-foreground hover:text-destructive md:size-8">
                    <LogOut />
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">{t.sessions.none}</p>
      )}

      <AlertDialog open={revoking !== null} onOpenChange={(o) => !o && setRevoking(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{revoking === 'others' ? t.sessions.confirmAll(allLabel) : t.sessions.confirm(revoking ? deviceName(revoking.user_agent, t) : '')}</AlertDialogTitle>
            <AlertDialogDescription>
              {revoking === 'others' ? t.sessions.confirmAllHint(others, hasCurrent) : t.sessions.confirmHint}
            </AlertDialogDescription>
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
              {t.nav.logout}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
