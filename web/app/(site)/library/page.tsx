import { Suspense } from 'react'
import { RequireAuth } from '@/components/auth-guard'
import { LibraryView } from '@/components/library/library-view'
import { PageLoading } from '@/components/states'
import { pageTitle } from '@/lib/i18n/server'

export const generateMetadata = pageTitle('library')

export default function LibraryPage() {
  return (
    <RequireAuth>
      <Suspense fallback={<PageLoading />}>
        <LibraryView />
      </Suspense>
    </RequireAuth>
  )
}
