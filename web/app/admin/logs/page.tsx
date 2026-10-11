import { Suspense } from 'react'
import { AdminLogs } from '@/components/admin/logs'

export const metadata = { title: '日志' }

export default function Page() {
  return (
    <Suspense>
      <AdminLogs />
    </Suspense>
  )
}
