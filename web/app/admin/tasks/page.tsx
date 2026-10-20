import { Suspense } from 'react'
import { AdminTasks } from '@/components/admin/tasks'
import { pageTitle } from '@/lib/i18n/server'

export const generateMetadata = pageTitle('tasks')

export default function Page() {
  return (
    <Suspense>
      <AdminTasks />
    </Suspense>
  )
}
