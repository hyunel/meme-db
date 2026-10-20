import { Suspense } from 'react'
import { AdminContent } from '@/components/admin/content'
import { pageTitle } from '@/lib/i18n/server'

export const generateMetadata = pageTitle('content')

export default function Page() {
  return (
    <Suspense>
      <AdminContent />
    </Suspense>
  )
}
