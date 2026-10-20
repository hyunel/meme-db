import { Suspense } from 'react'
import { SearchView } from '@/components/search/search-view'
import { PageLoading } from '@/components/states'
import { pageTitle } from '@/lib/i18n/server'

export const generateMetadata = pageTitle('search')

export default function SearchPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <SearchView />
    </Suspense>
  )
}
