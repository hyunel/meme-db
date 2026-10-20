import { RequireAuth } from '@/components/auth-guard'
import { SharesView } from '@/components/shares-view'
import { pageTitle } from '@/lib/i18n/server'

export const generateMetadata = pageTitle('shares')

export default function SharesPage() {
  return (
    <RequireAuth>
      <SharesView />
    </RequireAuth>
  )
}
