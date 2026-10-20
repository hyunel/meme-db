import { Suspense } from 'react'
import { AdminSearchDebug } from '@/components/admin/search-debug/search-debug'
import { pageTitle } from '@/lib/i18n/server'

export const generateMetadata = pageTitle('searchDebug')

export default function Page() {
  return (
    <Suspense>
      <AdminSearchDebug />
    </Suspense>
  )
}
