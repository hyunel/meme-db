import { AdminOverview } from '@/components/admin/overview'
import { pageTitle } from '@/lib/i18n/server'

export const generateMetadata = pageTitle('overview')

export default function Page() {
  return <AdminOverview />
}
