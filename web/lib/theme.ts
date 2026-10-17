import { useSyncExternalStore } from 'react'

export type Theme = 'system' | 'light' | 'dark'

// A setting of this device, kept through logouts; the root layout's inline script applies it before the first paint.
export const THEME_KEY = 'memedb:theme'
const EVENT = 'memedb:theme'
const systemDark = '(prefers-color-scheme: dark)'

function read(): Theme {
  try {
    const t = localStorage.getItem(THEME_KEY)
    if (t === 'light' || t === 'dark') return t
  } catch {}
  return 'system'
}

const isDark = () => {
  const t = read()
  return t === 'dark' || (t === 'system' && matchMedia(systemDark).matches)
}

export function subscribeTheme(listener: () => void) {
  const media = matchMedia(systemDark)
  media.addEventListener('change', listener)
  window.addEventListener(EVENT, listener)
  window.addEventListener('storage', listener)
  return () => {
    media.removeEventListener('change', listener)
    window.removeEventListener(EVENT, listener)
    window.removeEventListener('storage', listener)
  }
}

export function applyTheme() {
  const dark = isDark()
  document.documentElement.classList.toggle('dark', dark)
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#111316' : '#faf9f5')
}

export function setTheme(theme: Theme) {
  try {
    if (theme === 'system') localStorage.removeItem(THEME_KEY)
    else localStorage.setItem(THEME_KEY, theme)
  } catch {}
  window.dispatchEvent(new Event(EVENT))
}

export const useTheme = () => useSyncExternalStore(subscribeTheme, read, () => 'system' as Theme)

export const useDarkTheme = () => useSyncExternalStore(subscribeTheme, isDark, () => false)
