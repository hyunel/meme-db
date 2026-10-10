import type { Metadata } from 'next'
import { RequireAuth } from '@/components/auth-guard'
import { FavoritesView } from '@/components/account-views'

export const metadata: Metadata = { title: '我的收藏' }

export default function FavoritesPage() {
  return (
    <RequireAuth>
      <FavoritesView />
    </RequireAuth>
  )
}
