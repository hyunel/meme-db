import { Suspense } from 'react'
import { AdminLogs } from '@/components/admin/logs'
import { pageTitle } from '@/lib/i18n/server'

export const generateMetadata = pageTitle('logs')

export default function Page() {
  return (
    <Suspense>
      <AdminLogs />
    </Suspense>
  )
}
