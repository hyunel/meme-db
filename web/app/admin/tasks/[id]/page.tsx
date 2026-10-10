import { AdminTaskDetail } from '@/components/admin/tasks'

export const metadata = { title: '任务详情' }

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <AdminTaskDetail id={id} />
}
