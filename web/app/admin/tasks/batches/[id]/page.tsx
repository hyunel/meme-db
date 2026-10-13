import { AdminBatchDetail } from '@/components/admin/tasks'

export const metadata = { title: '批次详情' }

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <AdminBatchDetail id={id} />
}
