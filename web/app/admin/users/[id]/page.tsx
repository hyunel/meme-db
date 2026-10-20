import { AdminUserDetail } from '@/components/admin/users'
import { pageTitle } from '@/lib/i18n/server'

export const generateMetadata = pageTitle('userDetail')

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <AdminUserDetail id={id} />
}
