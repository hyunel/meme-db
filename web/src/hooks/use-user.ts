"use client"

import { useEffect } from "react"
import { useAuthStore } from "@/store/auth"
import { ApiError } from "@/lib/api"
import useSWR from "swr"
import { type User } from "@/store/auth"

export type AuthState = "loading" | "authenticated" | "unauthenticated" | "error"

export function useUser() {
  const { user, setUser, isAuthenticated, isLoading: storeLoading, logout: storeLogout } = useAuthStore()

  // Use SWR to fetch user data if authenticated but user object is missing
  const { data: fetchedUser, error, isLoading: swrLoading, mutate } = useSWR<User | null>(
    isAuthenticated && !user ? "/api/auth/me" : null
  )

  useEffect(() => {
    if (fetchedUser) {
      setUser(fetchedUser)
    }
  }, [fetchedUser, setUser])

  useEffect(() => {
    if (error && (error as ApiError).status === 401) {
      storeLogout()
    }
  }, [error, storeLogout])

  const authState: AuthState = (storeLoading || swrLoading) && isAuthenticated ? "loading" :
                             isAuthenticated && (user || fetchedUser) ? "authenticated" :
                             !isAuthenticated ? "unauthenticated" :
                             error && (error as ApiError).status !== 401 ? "error" : "loading"

  return {
    user: user || fetchedUser || null,
    mutate,
    logout: storeLogout,
    error,
    authState,
  }
}
