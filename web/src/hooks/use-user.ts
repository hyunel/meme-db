"use client"

import { logout as authLogout, type User } from "@/lib/auth"
import useSWR, { useSWRConfig } from "swr"

export function useUser() {
  const { data: user, mutate, isLoading, error } = useSWR<User | null>("/api/auth/me")
  const { cache } = useSWRConfig()

  const logout = () => {
    authLogout()
    mutate(null, false)
    // Clear SWR cache on logout
    if (cache instanceof Map) {
      cache.clear()
    }
  }

  return {
    user: user || null,
    isLoading,
    mutate,
    logout,
    error,
  }
}
