import { AdminTaskDetail } from '@/components/admin/tasks'
import { pageTitle } from '@/lib/i18n/server'

export const generateMetadata = pageTitle('taskDetail')

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <AdminTaskDetail id={id} />
}
