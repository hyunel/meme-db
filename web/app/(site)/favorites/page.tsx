import { RequireAuth } from '@/components/auth-guard'
import { FavoritesView } from '@/components/account-views'
import { pageTitle } from '@/lib/i18n/server'

export const generateMetadata = pageTitle('favorites')

export default function FavoritesPage() {
  return (
    <RequireAuth>
      <FavoritesView />
    </RequireAuth>
  )
}
