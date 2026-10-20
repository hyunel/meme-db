import SiteLayout from './(site)/layout'
import { NotFoundState } from '@/components/states'
import { getMessages } from '@/lib/i18n/server'

// Unmatched URLs land here, outside the site's layout, so it brings the layout along.
export default async function NotFound() {
  const t = await getMessages()
  return (
    <SiteLayout>
      <NotFoundState title={t.notFound.page} description={t.notFound.pageHint} />
    </SiteLayout>
  )
}
