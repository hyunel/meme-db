import type { Metadata } from 'next'
import { RequireAuth } from '@/components/auth-guard'
import { SettingsView } from '@/components/account-views'

export const metadata: Metadata = { title: '账号设置' }

export default function SettingsPage() {
  return (
    <RequireAuth>
      <SettingsView />
    </RequireAuth>
  )
}
