import { Suspense } from 'react'
import { AdminTasks } from '@/components/admin/tasks'

export const metadata = { title: '任务管理' }

export default function Page() {
  return (
    <Suspense>
      <AdminTasks />
    </Suspense>
  )
}
