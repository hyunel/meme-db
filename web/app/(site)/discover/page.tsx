import { Suspense } from 'react'
import { DiscoverView } from '@/components/public-views'
import { PageLoading } from '@/components/states'
import { pageTitle } from '@/lib/i18n/server'

export const generateMetadata = pageTitle('discover')

export default function DiscoverPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <DiscoverView />
    </Suspense>
  )
}
