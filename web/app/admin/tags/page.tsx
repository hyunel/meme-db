import { AdminTags } from '@/components/admin/tags'
import { pageTitle } from '@/lib/i18n/server'

export const generateMetadata = pageTitle('tags')

export default function Page() {
  return <AdminTags />
}
