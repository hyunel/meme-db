'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ArrowLeft, Images, LayoutDashboard, ListChecks, ScrollText, Tags, Users } from 'lucide-react'
import { Logo } from '@/components/logo'
import { RequireAuth } from '@/components/auth-guard'
import { cn } from '@/lib/utils'

const nav = [
  { href: '/admin', label: '概览', icon: LayoutDashboard },
  { href: '/admin/users', label: '用户', icon: Users },
  { href: '/admin/tasks', label: '任务', icon: ListChecks },
  { href: '/admin/logs', label: '日志', icon: ScrollText },
  { href: '/admin/content', label: '内容', icon: Images },
  { href: '/admin/tags', label: '标签', icon: Tags },
]

function AdminBrand({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Logo href="/admin" />
      <span className="rounded bg-foreground px-1.5 py-0.5 text-[10px] font-medium text-background">后台</span>
    </div>
  )
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  const path = usePathname()
  const active = (href: string) => (href === '/admin' ? path === '/admin' : path.startsWith(href))

  return (
    <RequireAuth admin>
      <div className="flex min-h-dvh flex-col bg-muted/30 md:flex-row">
        <aside className="hidden w-56 shrink-0 flex-col gap-6 border-r bg-background p-4 md:sticky md:top-0 md:flex md:h-dvh">
          <AdminBrand className="px-2" />
          <nav aria-label="后台导航" className="flex flex-col gap-0.5">
            {nav.map((n) => (
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
          </nav>
          <Link href="/" className="mt-auto flex h-9 items-center gap-2 rounded-md px-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
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
          <nav aria-label="后台导航" className="overflow-x-auto [scrollbar-width:none]">
            <ul className="flex w-max gap-1 px-3 pb-2">
              {nav.map((n) => (
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
            </ul>
          </nav>
        </header>

        <main className="mx-auto flex w-full max-w-7xl min-w-0 flex-1 flex-col gap-6 px-4 py-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:px-6 md:py-8">{children}</main>
      </div>
    </RequireAuth>
  )
}
