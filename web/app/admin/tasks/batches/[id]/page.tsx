import { AdminBatchDetail } from '@/components/admin/tasks'
import { pageTitle } from '@/lib/i18n/server'

export const generateMetadata = pageTitle('batchDetail')

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <AdminBatchDetail id={id} />
}
