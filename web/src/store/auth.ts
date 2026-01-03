import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { authLogin, authRegister } from '@/lib/api'
import { mutate } from 'swr'

const TOKEN_KEY = 'auth_token'

export interface User {
  id: string
  email: string
  username: string
}

interface AuthState {
  user: User | null
  token: string | null
  isAuthenticated: boolean
  isLoading: boolean
  setUser: (user: User | null) => void
  setLoading: (isLoading: boolean) => void
  login: (email: string, password: string) => Promise<User>
  register: (email: string, username: string, password: string) => Promise<User>
  logout: () => void
  initialize: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: typeof window !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null,
      isAuthenticated: typeof window !== 'undefined' ? !!localStorage.getItem(TOKEN_KEY) : false,
      isLoading: typeof window !== 'undefined' ? !!localStorage.getItem(TOKEN_KEY) : false,

      setUser: (user) => set({ user, isAuthenticated: !!user, isLoading: false }),
      setLoading: (isLoading) => set({ isLoading }),

      login: async (email, password) => {
        const response = await authLogin({ email, password })
        const { token, user } = response
        localStorage.setItem(TOKEN_KEY, token)
        set({ user, token, isAuthenticated: true, isLoading: false })
        mutate('/api/auth/me', user)
        return user
      },

      register: async (email, username, password) => {
        const response = await authRegister({ email, username, password })
        const { token, user } = response
        localStorage.setItem(TOKEN_KEY, token)
        set({ user, token, isAuthenticated: true, isLoading: false })
        mutate('/api/auth/me', user)
        return user
      },

      logout: () => {
        localStorage.removeItem(TOKEN_KEY)
        set({ user: null, token: null, isAuthenticated: false, isLoading: false })
        mutate('/api/auth/me', null, false)
      },

      initialize: () => {
        const token = localStorage.getItem(TOKEN_KEY)
        set({ token, isAuthenticated: !!token, isLoading: !!token })
      },
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({ token: state.token }),
    }
  )
)

// Helper to get token outside of components
export const getAuthToken = () => {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(TOKEN_KEY)
}

export const hasAuthToken = () => !!getAuthToken()

export const clearAuth = () => {
  if (typeof window === 'undefined') return
  localStorage.removeItem(TOKEN_KEY)
}
