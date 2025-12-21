"use client"

import { ApiError } from "@/lib/api"
import { logout as authLogout, hasAuthToken, type User } from "@/lib/auth"
import useSWR, { useSWRConfig } from "swr"

export type AuthState = "loading" | "authenticated" | "unauthenticated" | "error"

export function useUser() {
  const { data: user, mutate, isLoading, error } = useSWR<User | null>("/api/auth/me")
  const { cache } = useSWRConfig()

  let authState: AuthState = "loading"
  if (isLoading) {
    authState = "loading"
  } else if (user) {
    authState = "authenticated"
  } else if (error) {
    if ((error as ApiError).status === 401) {
      authState = "unauthenticated"
    } else {
      authState = "error"
    }
  } else {
    // No user and no error, check if we have a token
    authState = hasAuthToken() ? "loading" : "unauthenticated"
  }

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
    mutate,
    logout,
    error,
    authState,
  }
}
