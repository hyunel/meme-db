import { AdminUserDetail } from '@/components/admin/users'

export const metadata = { title: '用户详情' }

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <AdminUserDetail id={id} />
}
