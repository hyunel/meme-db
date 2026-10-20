import type { Metadata } from 'next'
import { AdminShell } from '@/components/admin/admin-shell'
import { getMessages } from '@/lib/i18n/server'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getMessages()
  return { title: { default: t.titles.admin, template: t.titles.adminTemplate }, robots: { index: false } }
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminShell>{children}</AdminShell>
}
