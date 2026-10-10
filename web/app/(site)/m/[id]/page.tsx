import type { Metadata } from 'next'
import { MemeDetail } from '@/components/meme/meme-detail'

export const metadata: Metadata = { title: '表情包详情' }

export default async function MemePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <MemeDetail id={id} />
}
