"use client"

import type React from "react"
import { useEffect, useLayoutEffect, useContext, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams, usePathname } from "next/navigation"
import { useUser } from "@/hooks/use-user"
import { getAuthToken } from "@/lib/auth"
import { motion, AnimatePresence } from "framer-motion"
import { LayoutRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime"

function FrozenRoute({ children }: { children: React.ReactNode }) {
  const context = useContext(LayoutRouterContext)
  const [frozen] = useState(context)

  return <LayoutRouterContext.Provider value={frozen}>{children}</LayoutRouterContext.Provider>
}

interface AuthLayoutProps {
  children: React.ReactNode
}

export default function AuthLayout({ children }: AuthLayoutProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const { user, isLoading } = useUser()

  const redirectPath = searchParams.get("redirect") || "/search"

  // Use useLayoutEffect for earlier redirection if token exists in localStorage
  useLayoutEffect(() => {
    const token = getAuthToken()
    if (token) {
      router.replace(redirectPath)
    }
  }, [router, redirectPath])

  useEffect(() => {
    if (!isLoading && user) {
      router.replace(redirectPath)
    }
  }, [user, isLoading, router, redirectPath])

  // If we have a token or are loading, don't show the auth forms to prevent flash
  const token = typeof window !== "undefined" ? getAuthToken() : null
  if (token || (isLoading && !user)) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-md space-y-8">
        {/* Logo */}
        <div className="text-center">
          <Link href="/" className="inline-flex items-center gap-2 mb-2">
            <div className="w-10 h-10 bg-primary rounded-lg flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-xl">M</span>
            </div>
            <span className="font-bold text-2xl text-foreground">MemeDB</span>
          </Link>
        </div>

        {/* Auth Content */}
        <AnimatePresence mode="wait">
          <motion.div
            key={pathname}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3, ease: "easeInOut" }}
            className="space-y-8"
          >
            <FrozenRoute>{children}</FrozenRoute>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}
