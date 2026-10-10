import type { Metadata } from 'next'
import { PublicFolderView } from '@/components/public-views'

export const metadata: Metadata = { title: '公开合集' }

export default async function FolderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <PublicFolderView id={id} />
}
