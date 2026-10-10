'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from '@/lib/session'
import { ForbiddenState, PageLoading } from '@/components/states'

function loginUrl(expired: boolean) {
  const back = window.location.pathname + window.location.search
  return `/login?redirect=${encodeURIComponent(back)}${expired ? '&expired=1' : ''}`
}

export function RequireAuth({ children, admin = false }: { children: React.ReactNode; admin?: boolean }) {
  const { user, ready, expired } = useSession()
  const router = useRouter()

  useEffect(() => {
    if (ready && !user) router.replace(loginUrl(expired))
  }, [ready, user, expired, router])

  if (!ready || !user) return <PageLoading />
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
