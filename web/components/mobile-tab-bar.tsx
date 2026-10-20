'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { House, LogIn } from 'lucide-react'
import { useSession } from '@/lib/session'
import { isActive, useMainNav } from '@/components/site-header'
import { cn } from '@/lib/utils'
import { useMessages } from '@/lib/i18n/client'

export function MobileTabBar() {
  const { user } = useSession()
  const pathname = usePathname()
  const t = useMessages()
  const tabs = [{ href: '/', label: t.nav.home, icon: House }, ...useMainNav(), ...(user ? [] : [{ href: '/login', label: t.nav.signIn, icon: LogIn }])]

  return (
    // Hidden while typing: iOS lifts fixed bars above the keyboard, where its glass toolbar shows the page beneath them
    <nav
      aria-label={t.nav.bottom}
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden [body:has(:is(input,textarea):focus)_&]:hidden"
    >
      <ul className="flex">
        {tabs.map((tab) => {
          const active = isActive(pathname, tab.href)
          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] text-muted-foreground transition-colors',
                  active && 'font-medium text-foreground',
                )}
              >
                <span className={cn('flex h-7 w-12 items-center justify-center rounded-full transition-colors', active && 'bg-brand text-brand-foreground')}>
                  <tab.icon className="size-[18px]" aria-hidden />
                </span>
                {tab.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
