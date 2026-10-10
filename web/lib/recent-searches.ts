'use client'

import { useSyncExternalStore } from 'react'
import { getSession, useSession } from './session'

// Recent searches stay on this device, per user; logging out clears them.
const MAX = 8
const EVENT = 'memedb:recent-searches'
const keyOf = (userId: string) => `memedb:recent:${userId}`
const cache = new Map<string, string[]>()

function read(userId: string): string[] {
  if (!cache.has(userId)) {
    let list: string[] = []
    try {
      list = JSON.parse(localStorage.getItem(keyOf(userId)) ?? '[]')
    } catch {}
    cache.set(userId, Array.isArray(list) ? list : [])
  }
  return cache.get(userId)!
}

function write(fn: (list: string[]) => string[]) {
  const userId = getSession().user?.id
  if (!userId) return
  const next = fn(read(userId)).slice(0, MAX)
  cache.set(userId, next)
  try {
    localStorage.setItem(keyOf(userId), JSON.stringify(next))
  } catch {}
  window.dispatchEvent(new Event(EVENT))
}

function subscribe(listener: () => void) {
  const onStorage = () => {
    cache.clear()
    listener()
  }
  window.addEventListener(EVENT, listener)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(EVENT, listener)
    window.removeEventListener('storage', onStorage)
  }
}

const none: string[] = []

export function useRecentSearches() {
  const { user } = useSession()
  return useSyncExternalStore(
    subscribe,
    () => (user ? read(user.id) : none),
    () => none,
  )
}

export function pushRecentSearch(q: string) {
  const query = q.trim()
  if (query) write((list) => [query, ...list.filter((x) => x !== query)])
}

export function removeRecentSearch(q: string) {
  write((list) => list.filter((x) => x !== q))
}

export function clearRecentSearches() {
  write(() => [])
}
