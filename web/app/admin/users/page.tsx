import { Suspense } from 'react'
import { AdminUsers } from '@/components/admin/users'

export const metadata = { title: '用户管理' }

export default function Page() {
  return (
    <Suspense>
      <AdminUsers />
    </Suspense>
  )
}
