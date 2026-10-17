'use client'

import { useSyncExternalStore } from 'react'
import { mutate } from 'swr'
import { toast } from 'sonner'
import { api, setUnauthorizedHandler } from './api'
import { THEME_KEY } from './theme'
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
      .filter((k) => k.startsWith('memedb:') && k !== THEME_KEY)
      .forEach((k) => localStorage.removeItem(k))
  } catch {}
  void mutate(() => true, undefined, { revalidate: false })
}

// The session ended under a signed-in page, or the server says a lapsed cookie came with the check-in.
setUnauthorizedHandler((code) => {
  if (!session.user && code !== 'session_expired') return
  clearLocal()
  update({ user: null, ready: true, expired: true })
})

let booted = false

export async function bootSession() {
  if (booted) return
  booted = true
  try {
    update({ user: await api<User>('/auth/me'), ready: true })
  } catch {
    update({ ready: true }) // A guest, or a lapsed session, which the unauthorized handler marks
  }
}

function signIn(user: User) {
  void mutate(() => true, undefined, { revalidate: false }) // Guest views of shared data are stale now
  update({ user, ready: true, expired: false })
  return user
}

export async function login(email: string, password: string) {
  return signIn(await api<User>('/auth/login', { method: 'POST', json: { email, password } }))
}

export async function register(input: { username: string; email: string; password: string }) {
  return signIn(await api<User>('/auth/register', { method: 'POST', json: input }))
}

/** Signs out and reloads the home page, so no state of the session survives in memory. */
export async function logout() {
  try {
    await api('/auth/logout', { method: 'POST' })
  } catch (err) {
    return void toast.error((err as Error).message) // The cookie, out of the page's reach, would sign it in again
  }
  clearLocal()
  window.location.replace('/')
}
