'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Compass, Heart, House, LayoutDashboard, Library, LogOut, Menu, Search, Settings, Upload, UserRound } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetClose } from '@/components/ui/sheet'
import { Logo } from '@/components/logo'
import { SearchBar } from '@/components/search/search-bar'
import { useRequireLogin } from '@/components/app-providers'
import { logout, useSession } from '@/lib/session'
import { cn } from '@/lib/utils'

export const mainNav = [
  { href: '/search', label: '搜索', icon: Search, auth: false },
  { href: '/discover', label: '发现', icon: Compass, auth: false },
  { href: '/library', label: '我的库', icon: Library, auth: true },
  { href: '/favorites', label: '收藏', icon: Heart, auth: true },
]

export function isActive(pathname: string, href: string) {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`)
}

export function SiteHeader() {
  const { user, ready } = useSession()
  const pathname = usePathname()
  const router = useRouter()
  const requireLogin = useRequireLogin()

  const goUpload = () => {
    if (requireLogin('登录后即可上传表情包到你的私人库。')) router.push('/library?upload=1')
  }

  const links = mainNav.filter((n) => !n.auth || user)
  const showHeaderSearch = !pathname.startsWith('/search') && pathname !== '/'

  return (
    <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-4 px-4">
        <Logo />
        <nav aria-label="主导航" className="hidden items-center gap-1 md:flex">
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
            <Button variant="outline" onClick={goUpload} className="hidden sm:inline-flex">
              <Upload data-icon="inline-start" />
              上传
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
                    aria-label="账户菜单"
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
                      {user.role === 'admin' && <span className="mt-1 text-xs font-normal text-foreground">管理员</span>}
                    </div>
                  </DropdownMenuLabel>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem render={<Link href={`/u/${user.username}`} />}>
                    <UserRound />
                    我的主页
                  </DropdownMenuItem>
                  <DropdownMenuItem render={<Link href="/settings" />}>
                    <Settings />
                    个人设置
                  </DropdownMenuItem>
                  {user.role === 'admin' && (
                    <DropdownMenuItem render={<Link href="/admin" />}>
                      <LayoutDashboard />
                      管理后台
                    </DropdownMenuItem>
                  )}
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={logout}>
                  <LogOut />
                  退出登录
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <div className="flex items-center gap-2">
              <Button variant="ghost" nativeButton={false} render={<Link href="/login" />} className="hidden sm:inline-flex">
                登录
              </Button>
              <Button nativeButton={false} render={<Link href="/register" />}>
                注册
              </Button>
            </div>
          )}
          <Sheet>
            <SheetTrigger render={<Button variant="ghost" size="icon-lg" className="md:hidden" aria-label="打开菜单" />}>
              <Menu />
            </SheetTrigger>
            <SheetContent side="right" className="w-72">
              <SheetHeader>
                <SheetTitle>
                  <Logo />
                </SheetTitle>
              </SheetHeader>
              <nav aria-label="移动端菜单" className="flex flex-col gap-1 px-4">
                {[{ href: '/', label: '首页', icon: House, auth: false }, ...links].map((n) => {
                  const active = isActive(pathname, n.href)
                  return (
                    <SheetClose
                      key={n.href}
                      nativeButton={false}
                      render={<Link href={n.href} aria-current={active ? 'page' : undefined} />}
                      className={cn('flex min-h-11 items-center gap-3 rounded-md px-3 text-sm hover:bg-muted', active && 'bg-muted font-medium')}
                    >
                      <n.icon className="size-4 text-muted-foreground" aria-hidden />
                      {n.label}
                    </SheetClose>
                  )
                })}
                {user && (
                  <>
                    <SheetClose render={<button type="button" onClick={goUpload} />} className="flex min-h-11 items-center gap-3 rounded-md px-3 text-left text-sm hover:bg-muted">
                      <Upload className="size-4 text-muted-foreground" aria-hidden />
                      上传表情包
                    </SheetClose>
                    <SheetClose nativeButton={false} render={<Link href={`/u/${user.username}`} />} className="flex min-h-11 items-center gap-3 rounded-md px-3 text-sm hover:bg-muted">
                      <UserRound className="size-4 text-muted-foreground" aria-hidden />
                      我的主页
                    </SheetClose>
                    <SheetClose nativeButton={false} render={<Link href="/settings" />} className="flex min-h-11 items-center gap-3 rounded-md px-3 text-sm hover:bg-muted">
                      <Settings className="size-4 text-muted-foreground" aria-hidden />
                      个人设置
                    </SheetClose>
                  </>
                )}
                {user?.role === 'admin' && (
                  <SheetClose nativeButton={false} render={<Link href="/admin" />} className="flex min-h-11 items-center gap-3 rounded-md px-3 text-sm hover:bg-muted">
                    <LayoutDashboard className="size-4 text-muted-foreground" aria-hidden />
                    管理后台
                  </SheetClose>
                )}
                {user && (
                  <SheetClose render={<button type="button" onClick={logout} />} className="mt-2 flex min-h-11 items-center gap-3 rounded-md border-t px-3 pt-2 text-left text-sm hover:bg-muted">
                    <LogOut className="size-4 text-muted-foreground" aria-hidden />
                    退出登录
                  </SheetClose>
                )}
                {!user && ready && (
                  <div className="mt-4 flex gap-2">
                    <SheetClose nativeButton={false} render={<Link href="/login" />} className={cn(buttonVariants({ variant: 'outline', size: 'lg' }), 'flex-1')}>
                      登录
                    </SheetClose>
                    <SheetClose nativeButton={false} render={<Link href="/register" />} className={cn(buttonVariants({ size: 'lg' }), 'flex-1')}>
                      注册
                    </SheetClose>
                  </div>
                )}
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  )
}
