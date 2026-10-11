'use client'

import { Fragment, useEffect, useRef } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Activity, ArrowLeft, Images, LayoutDashboard, ListChecks, ScanSearch, ScrollText, Tags, Users } from 'lucide-react'
import { Logo } from '@/components/logo'
import { RequireAuth } from '@/components/auth-guard'
import { cn } from '@/lib/utils'

const groups = [
  { title: null, items: [{ href: '/admin', label: '概览', icon: LayoutDashboard }] },
  {
    title: '运营',
    items: [
      { href: '/admin/users', label: '用户', icon: Users },
      { href: '/admin/content', label: '内容', icon: Images },
      { href: '/admin/tags', label: '标签', icon: Tags },
    ],
  },
  {
    title: '系统',
    items: [
      { href: '/admin/inference', label: '推理服务', icon: Activity },
      { href: '/admin/tasks', label: '任务', icon: ListChecks },
      { href: '/admin/logs', label: '日志', icon: ScrollText },
      { href: '/admin/search', label: '检索调试', icon: ScanSearch },
    ],
  },
]

function AdminBrand({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Logo href="/admin" />
      <span className="rounded bg-foreground px-1.5 py-0.5 text-[10px] font-medium text-background">后台</span>
    </div>
  )
}

const isActive = (path: string) => (href: string) => (href === '/admin' ? path === '/admin' : path.startsWith(href))

function MobileNav() {
  const path = usePathname()
  const active = isActive(path)
  const ref = useRef<HTMLElement>(null)

  // Keep the current page's pill in view, as later ones start off screen.
  useEffect(() => {
    const nav = ref.current
    const current = nav?.querySelector<HTMLElement>('[aria-current="page"]')
    if (nav && current) nav.scrollTo({ left: Math.max(0, current.offsetLeft - (nav.clientWidth - current.offsetWidth) / 2), behavior: 'instant' })
  }, [path])

  return (
    <nav ref={ref} aria-label="后台导航" className="scroll-row relative [scrollbar-width:none]">
      <ul className="flex w-max items-center gap-1 px-3 pb-2">
        {groups.map((g, gi) => (
          <Fragment key={g.title ?? gi}>
            {gi > 0 && (
              <li role="separator" aria-orientation="vertical" className="mx-1.5 h-5 w-px shrink-0 bg-border">
                <span className="sr-only">{g.title}</span>
              </li>
            )}
            {g.items.map((n) => (
              <li key={n.href}>
                <Link
                  href={n.href}
                  aria-current={active(n.href) ? 'page' : undefined}
                  className={cn(
                    'flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm whitespace-nowrap transition-colors',
                    active(n.href) ? 'border-foreground bg-foreground text-background' : 'bg-background text-muted-foreground',
                  )}
                >
                  <n.icon className="size-3.5" aria-hidden />
                  {n.label}
                </Link>
              </li>
            ))}
          </Fragment>
        ))}
      </ul>
    </nav>
  )
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  const path = usePathname()
  const active = isActive(path)

  return (
    <RequireAuth admin>
      <div className="flex min-h-dvh flex-col bg-muted/30 md:flex-row">
        <aside className="hidden w-56 shrink-0 flex-col gap-6 border-r bg-background p-4 md:sticky md:top-0 md:flex md:h-dvh">
          <AdminBrand className="px-2" />
          <nav aria-label="后台导航" className="flex flex-col gap-5 overflow-y-auto">
            {groups.map((g, i) => (
              <div key={g.title ?? i} role="group" aria-label={g.title ?? undefined} className="flex flex-col gap-0.5">
                {g.title && (
                  <span className="px-2.5 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground/70" aria-hidden>
                    {g.title}
                  </span>
                )}
                {g.items.map((n) => (
                  <Link
                    key={n.href}
                    href={n.href}
                    aria-current={active(n.href) ? 'page' : undefined}
                    className="flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground aria-[current]:bg-muted aria-[current]:font-medium aria-[current]:text-foreground"
                  >
                    <n.icon className="size-4" aria-hidden />
                    {n.label}
                  </Link>
                ))}
              </div>
            ))}
          </nav>
          <Link href="/" className="mt-auto flex h-9 shrink-0 items-center gap-2 rounded-md px-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
            <ArrowLeft className="size-4" aria-hidden />
            返回前台
          </Link>
        </aside>

        <header className="sticky top-0 z-40 border-b bg-background/95 pt-[env(safe-area-inset-top)] backdrop-blur md:hidden">
          <div className="flex h-12 items-center justify-between px-4">
            <AdminBrand />
            <Link href="/" className="flex h-10 items-center gap-1 rounded-md px-2 text-sm text-muted-foreground hover:text-foreground">
              <ArrowLeft className="size-4" aria-hidden />
              前台
            </Link>
          </div>
          <MobileNav />
        </header>

        <main className="mx-auto flex w-full max-w-7xl min-w-0 flex-1 flex-col gap-6 px-4 py-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:px-6 md:py-8">{children}</main>
      </div>
    </RequireAuth>
  )
}
