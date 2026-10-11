'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { House, LogIn } from 'lucide-react'
import { useSession } from '@/lib/session'
import { isActive, useMainNav } from '@/components/site-header'
import { cn } from '@/lib/utils'

export function MobileTabBar() {
  const { user } = useSession()
  const pathname = usePathname()
  const tabs = [{ href: '/', label: '首页', icon: House }, ...useMainNav(), ...(user ? [] : [{ href: '/login', label: '登录', icon: LogIn }])]

  return (
    <nav
      aria-label="底部导航"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <ul className="flex">
        {tabs.map((t) => {
          const active = isActive(pathname, t.href)
          return (
            <li key={t.href} className="flex-1">
              <Link
                href={t.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] text-muted-foreground transition-colors',
                  active && 'font-medium text-foreground',
                )}
              >
                <span className={cn('flex h-7 w-12 items-center justify-center rounded-full transition-colors', active && 'bg-brand text-brand-foreground')}>
                  <t.icon className="size-[18px]" aria-hidden />
                </span>
                {t.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
