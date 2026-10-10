import { Suspense } from 'react'
import { AdminContent } from '@/components/admin/content'

export const metadata = { title: '内容管理' }

export default function Page() {
  return (
    <Suspense>
      <AdminContent />
    </Suspense>
  )
}
