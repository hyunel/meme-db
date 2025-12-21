"use client"

import type React from "react"

import { useEffect } from "react"
import { useRouter, usePathname } from "next/navigation"
import { useUser } from "@/hooks/use-user"
import { Button } from "./ui/button"
import { AlertCircle, RefreshCw } from "lucide-react"

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const { user, mutate, authState } = useUser()

  useEffect(() => {
    if (authState === "unauthenticated") {
      const searchParams = new URLSearchParams()
      if (pathname) {
        searchParams.set("redirect", pathname)
      }
      const loginUrl = `/login${searchParams.toString() ? `?${searchParams.toString()}` : ""}`
      router.push(loginUrl)
    }
  }, [authState, router, pathname])

  if (authState === "loading" || authState === "unauthenticated") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  // Handle server error (500 etc.) when we have a token but can't fetch user
  if (authState === "error") {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4 text-center">
        <AlertCircle className="w-12 h-12 text-destructive mb-4" />
        <h1 className="text-2xl font-bold mb-2">Service Temporarily Unavailable</h1>
        <p className="text-muted-foreground mb-6 max-w-md">
          We encountered an issue retrieving your user profile. This might be a temporary server failure. Please try again later.
        </p>
        <Button onClick={() => mutate()} variant="outline" className="gap-2">
          <RefreshCw className="w-4 h-4" />
          Retry
        </Button>
      </div>
    )
  }

  return user ? <>{children}</> : null
}
