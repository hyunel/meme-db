import { Suspense } from 'react'
import type { Metadata } from 'next'
import { DiscoverView } from '@/components/public-views'
import { PageLoading } from '@/components/states'

export const metadata: Metadata = { title: '发现' }

export default function DiscoverPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <DiscoverView />
    </Suspense>
  )
}
