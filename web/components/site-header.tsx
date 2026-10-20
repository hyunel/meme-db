'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Compass, Heart, LayoutDashboard, Library, Link2, LogOut, Monitor, Moon, Search, Settings, Sun, SunMoon, Upload, UserRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Logo } from '@/components/logo'
import { SearchBar } from '@/components/search/search-bar'
import { useRequireLogin } from '@/components/app-providers'
import { logout, useSession } from '@/lib/session'
import { setTheme, useTheme, type Theme } from '@/lib/theme'
import { cn } from '@/lib/utils'
import { useMessages } from '@/lib/i18n/client'

const mainNav = [
  { href: '/search', key: 'search', icon: Search, auth: false },
  { href: '/discover', key: 'discover', icon: Compass, auth: false },
  { href: '/library', key: 'library', icon: Library, auth: true },
  { href: '/favorites', key: 'favorites', icon: Heart, auth: true },
] as const

export function useMainNav() {
  const { user } = useSession()
  const t = useMessages()
  return mainNav.filter((n) => !n.auth || user).map((n) => ({ ...n, label: t.nav[n.key] }))
}

const themes = [
  ['system', Monitor],
  ['light', Sun],
  ['dark', Moon],
] as const

export function isActive(pathname: string, href: string) {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`)
}

export function SiteHeader() {
  const { user, ready } = useSession()
  const pathname = usePathname()
  const router = useRouter()
  const requireLogin = useRequireLogin()
  const t = useMessages()

  const goUpload = () => {
    if (requireLogin(t.nav.uploadPrompt)) router.push('/library?upload=1')
  }

  const links = useMainNav()
  const theme = useTheme()
  const showHeaderSearch = !pathname.startsWith('/search') && pathname !== '/'

  return (
    <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-4 px-4">
        <Logo />
        <nav aria-label={t.nav.main} className="hidden items-center gap-1 md:flex">
          {links.map((n) => {
            const active = isActive(pathname, n.href)
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
                  active && 'bg-muted font-medium text-foreground',
                )}
              >
                {n.label}
              </Link>
            )
          })}
        </nav>
        <div className="ml-auto flex flex-1 items-center justify-end gap-2">
          {showHeaderSearch && <SearchBar className="hidden max-w-xs lg:flex" />}
          {user && (
            <Button variant="outline" onClick={goUpload} aria-label={t.nav.uploadLabel}>
              <Upload data-icon="inline-start" />
              <span className="hidden sm:inline">{t.nav.upload}</span>
            </Button>
          )}
          {!ready ? (
            <div className="size-8 animate-pulse rounded-full bg-muted" aria-hidden />
          ) : user ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <button
                    type="button"
                    aria-label={t.nav.account}
                    className="flex size-9 items-center justify-center rounded-full bg-brand text-sm font-semibold text-brand-foreground ring-1 ring-foreground/10 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  />
                }
              >
                {user.username.slice(0, 1).toUpperCase()}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>
                    <div className="flex flex-col">
                      <span className="font-medium text-foreground">{user.username}</span>
                      <span className="truncate text-xs font-normal">{user.email}</span>
                      {user.role === 'admin' && <span className="mt-1 text-xs font-normal text-foreground">{t.nav.adminRole}</span>}
                    </div>
                  </DropdownMenuLabel>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem render={<Link href={`/u/${user.username}`} />}>
                    <UserRound />
                    {t.nav.profile}
                  </DropdownMenuItem>
                  <DropdownMenuItem render={<Link href="/shares" />}>
                    <Link2 />
                    {t.nav.shares}
                  </DropdownMenuItem>
                  <DropdownMenuItem render={<Link href="/settings" />}>
                    <Settings />
                    {t.nav.settings}
                  </DropdownMenuItem>
                  {user.role === 'admin' && (
                    <DropdownMenuItem render={<Link href="/admin" />}>
                      <LayoutDashboard />
                      {t.nav.admin}
                    </DropdownMenuItem>
                  )}
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                {/* Choosing keeps the menu open, so the page shows each theme as it is picked */}
                <div className="flex items-center justify-between gap-2 py-0.5 pl-1.5 text-sm">
                  <span className="flex items-center gap-1.5">
                    <SunMoon className="size-4 text-muted-foreground" aria-hidden />
                    {t.nav.appearance}
                  </span>
                  <DropdownMenuRadioGroup value={theme} onValueChange={(v: Theme) => setTheme(v)} aria-label={t.nav.appearance} className="flex rounded-lg border p-0.5">
                    {themes.map(([value, Icon]) => (
                      <DropdownMenuRadioItem
                        key={value}
                        value={value}
                        aria-label={t.nav.themes[value]}
                        title={t.nav.themes[value]}
                        className="size-7 justify-center rounded-md p-0 text-muted-foreground *:data-[slot=dropdown-menu-radio-item-indicator]:hidden data-checked:bg-foreground data-checked:text-background data-checked:focus:bg-foreground data-checked:focus:**:text-background"
                      >
                        <Icon />
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={logout}>
                  <LogOut />
                  {t.nav.logout}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <div className="flex items-center gap-2">
              <Button variant="ghost" nativeButton={false} render={<Link href="/login" />} className="hidden sm:inline-flex">
                {t.nav.signIn}
              </Button>
              <Button nativeButton={false} render={<Link href="/register" />}>
                {t.nav.signUp}
              </Button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
