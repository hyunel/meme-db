import { Suspense } from 'react'
import { AdminUsers } from '@/components/admin/users'
import { pageTitle } from '@/lib/i18n/server'

export const generateMetadata = pageTitle('users')

export default function Page() {
  return (
    <Suspense>
      <AdminUsers />
    </Suspense>
  )
}
