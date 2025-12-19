"use client"

import type React from "react"

import { useEffect } from "react"
import { useRouter, usePathname } from "next/navigation"
import { useUser } from "@/hooks/use-user"

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const { user, isLoading } = useUser()

  useEffect(() => {
    if (!isLoading && !user) {
      const searchParams = new URLSearchParams()
      if (pathname) {
        searchParams.set("redirect", pathname)
      }
      const loginUrl = `/login${searchParams.toString() ? `?${searchParams.toString()}` : ""}`
      router.push(loginUrl)
    }
  }, [user, isLoading, router, pathname])

  if (isLoading || !user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return user ? <>{children}</> : null
}
