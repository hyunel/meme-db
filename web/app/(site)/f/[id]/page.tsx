import type { Metadata } from 'next'
import { PublicFolderView } from '@/components/public-views'

export const metadata: Metadata = { title: '合集' }

export default async function FolderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ share?: string | string[] }> }) {
  const [{ id }, { share }] = await Promise.all([params, searchParams])
  return <PublicFolderView id={id} share={typeof share === 'string' ? share : undefined} />
}
