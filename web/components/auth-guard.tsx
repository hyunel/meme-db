'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from '@/lib/session'
import { ForbiddenState } from '@/components/states'

export function RequireAuth({ children, admin = false }: { children: React.ReactNode; admin?: boolean }) {
  const { user, ready, expired } = useSession()
  const router = useRouter()

  useEffect(() => {
    if (!ready || user) return
    const back = window.location.pathname + window.location.search
    router.replace(`/login?redirect=${encodeURIComponent(back)}${expired ? '&expired=1' : ''}`)
  }, [ready, user, expired, router])

  if (!ready || !user) return null // Briefly, as the page draws its own skeleton next
  if (admin && user.role !== 'admin') return <ForbiddenState />
  return <>{children}</>
}

export function GuestOnly({ children, redirect }: { children: React.ReactNode; redirect: string }) {
  const { user, ready } = useSession()
  const router = useRouter()

  useEffect(() => {
    if (ready && user) router.replace(redirect)
  }, [ready, user, router, redirect])

  if (!ready || user) return null
  return <>{children}</>
}
