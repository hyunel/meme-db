import { Suspense } from 'react'
import type { Metadata } from 'next'
import { SearchView } from '@/components/search/search-view'
import { PageLoading } from '@/components/states'

export const metadata: Metadata = { title: '搜索' }

export default function SearchPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <SearchView />
    </Suspense>
  )
}
