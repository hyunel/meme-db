import { Suspense } from 'react'
import { AdminSearchDebug } from '@/components/admin/search-debug/search-debug'

export const metadata = { title: '检索调试' }

export default function Page() {
  return (
    <Suspense>
      <AdminSearchDebug />
    </Suspense>
  )
}
