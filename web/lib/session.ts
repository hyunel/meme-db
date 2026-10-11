'use client'

import { useSyncExternalStore } from 'react'
import { mutate } from 'swr'
import { api, getToken, setToken, setUnauthorizedHandler } from './api'
import type { User } from './types'

export interface Session {
  user: User | null
  /** Whether the stored session has been checked. */
  ready: boolean
  /** Whether the previous session was rejected by the server. */
  expired: boolean
}

let session: Session = { user: null, ready: false, expired: false }
const serverSession: Session = session
const listeners = new Set<() => void>()

function update(next: Partial<Session>) {
  session = { ...session, ...next }
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useSession() {
  return useSyncExternalStore(
    subscribe,
    () => session,
    () => serverSession,
  )
}

export function getSession() {
  return session
}

function clearLocal() {
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith('memedb:'))
      .forEach((k) => localStorage.removeItem(k))
  } catch {}
  setToken(null)
  void mutate(() => true, undefined, { revalidate: false })
}

setUnauthorizedHandler(() => {
  clearLocal()
  update({ user: null, ready: true, expired: true })
})

let booted = false

export async function bootSession() {
  if (booted) return
  booted = true
  if (!getToken()) return update({ ready: true })
  try {
    update({ user: await api<User>('/auth/me'), ready: true })
  } catch {
    update({ ready: true }) // A rejected token is cleared by the unauthorized handler
  }
}

interface AuthResponse {
  token: string
  user: User
}

function signIn({ token, user }: AuthResponse) {
  setToken(token)
  void mutate(() => true, undefined, { revalidate: false }) // Guest views of shared data are stale now
  update({ user, ready: true, expired: false })
  return user
}

export async function login(email: string, password: string) {
  return signIn(await api<AuthResponse>('/auth/login', { method: 'POST', json: { email, password } }))
}

export async function register(input: { username: string; email: string; password: string }) {
  return signIn(await api<AuthResponse>('/auth/register', { method: 'POST', json: input }))
}

/** Signs out and reloads the home page, so no state of the session survives in memory. */
export function logout() {
  clearLocal()
  window.location.replace('/')
}
