import { RequireAuth } from '@/components/auth-guard'
import { SettingsView } from '@/components/account-views'
import { pageTitle } from '@/lib/i18n/server'

export const generateMetadata = pageTitle('settings')

export default function SettingsPage() {
  return (
    <RequireAuth>
      <SettingsView />
    </RequireAuth>
  )
}
