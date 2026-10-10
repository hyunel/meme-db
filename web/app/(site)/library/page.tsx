import { Suspense } from 'react'
import type { Metadata } from 'next'
import { RequireAuth } from '@/components/auth-guard'
import { LibraryView } from '@/components/library/library-view'
import { PageLoading } from '@/components/states'

export const metadata: Metadata = { title: '我的库' }

export default function LibraryPage() {
  return (
    <RequireAuth>
      <Suspense fallback={<PageLoading />}>
        <LibraryView />
      </Suspense>
    </RequireAuth>
  )
}
