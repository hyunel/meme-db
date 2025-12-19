"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Search, FolderOpen, Heart, Grid, User as UserIcon, LogOut, Menu } from "lucide-react"
import { useUser } from "@/hooks/use-user"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet"
import { useState } from "react"

export function AppHeader() {
  const router = useRouter()
  const { user, logout } = useUser()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const handleLogout = () => {
    logout()
    router.push("/")
  }

  return (
    <header className="border-b border-border bg-background sticky top-0 z-50">
      <div className="container mx-auto px-4 py-4 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-lg">M</span>
            </div>
            <span className="font-bold text-xl text-foreground">MemeDB</span>
          </Link>

          {user && (
            <nav className="hidden md:flex items-center gap-4">
              <Link href="/search">
                <Button variant="ghost" size="sm" className="gap-2">
                  <Search className="w-4 h-4" />
                  Search
                </Button>
              </Link>
              <Link href="/browse">
                <Button variant="ghost" size="sm" className="gap-2">
                  <FolderOpen className="w-4 h-4" />
                  Browse
                </Button>
              </Link>
              <Link href="/favorites">
                <Button variant="ghost" size="sm" className="gap-2">
                  <Heart className="w-4 h-4" />
                  Favorites
                </Button>
              </Link>
              <Link href="/explore">
                <Button variant="ghost" size="sm" className="gap-2">
                  <Grid className="w-4 h-4" />
                  Explore
                </Button>
              </Link>
            </nav>
          )}
        </div>

        <div className="flex items-center gap-2">
          {user && (
            <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="md:hidden">
                  <Menu className="w-5 h-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-64">
                <div className="flex flex-col gap-4 mt-8">
                  <Link href="/search" onClick={() => setMobileMenuOpen(false)}>
                    <Button variant="ghost" size="lg" className="w-full justify-start gap-3">
                      <Search className="w-5 h-5" />
                      Search
                    </Button>
                  </Link>
                  <Link href="/browse" onClick={() => setMobileMenuOpen(false)}>
                    <Button variant="ghost" size="lg" className="w-full justify-start gap-3">
                      <FolderOpen className="w-5 h-5" />
                      Browse
                    </Button>
                  </Link>
                  <Link href="/favorites" onClick={() => setMobileMenuOpen(false)}>
                    <Button variant="ghost" size="lg" className="w-full justify-start gap-3">
                      <Heart className="w-5 h-5" />
                      Favorites
                    </Button>
                  </Link>
                  <Link href="/explore" onClick={() => setMobileMenuOpen(false)}>
                    <Button variant="ghost" size="lg" className="w-full justify-start gap-3">
                      <Grid className="w-5 h-5" />
                      Explore
                    </Button>
                  </Link>
                  <div className="pt-4 mt-4 border-t border-border">
                    <div className="px-4 py-2 text-sm font-medium">{user.username}</div>
                    <div className="px-4 py-1 text-xs text-muted-foreground mb-3">{user.email}</div>
                    <Button
                      variant="ghost"
                      size="lg"
                      onClick={() => {
                        handleLogout()
                        setMobileMenuOpen(false)
                      }}
                      className="w-full justify-start gap-3 text-destructive"
                    >
                      <LogOut className="w-5 h-5" />
                      Sign Out
                    </Button>
                  </div>
                </div>
              </SheetContent>
            </Sheet>
          )}

          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="rounded-full hidden md:flex">
                  <UserIcon className="w-5 h-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <div className="px-2 py-1 text-sm font-medium">{user.username}</div>
                <div className="px-2 mb-2 text-xs text-muted-foreground">{user.email}</div>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout}>
                  <LogOut className="w-4 h-4 mr-2" />
                  Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <>
              <Link href="/login">
                <Button variant="ghost" size="sm">
                  Sign In
                </Button>
              </Link>
              <Link href="/register" className="hidden sm:block">
                <Button size="sm">Get Started</Button>
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
