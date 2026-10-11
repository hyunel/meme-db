import type { Metadata } from 'next'
import { RequireAuth } from '@/components/auth-guard'
import { SharesView } from '@/components/shares-view'

export const metadata: Metadata = { title: '我的分享' }

export default function SharesPage() {
  return (
    <RequireAuth>
      <SharesView />
    </RequireAuth>
  )
}
