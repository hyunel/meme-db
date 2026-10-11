import type { Metadata } from 'next'
import { MemeDetail } from '@/components/meme/meme-detail'

export const metadata: Metadata = { title: '表情包详情' }

export default async function MemePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ entry?: string | string[] }> }) {
  const [{ id }, { entry }] = await Promise.all([params, searchParams])
  return <MemeDetail id={id} entryId={typeof entry === 'string' ? entry : undefined} />
}
