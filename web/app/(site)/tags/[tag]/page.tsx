import type { Metadata } from 'next'
import { TagView } from '@/components/public-views'
import { serverApi } from '@/lib/server-api'
import { pageMetadata } from '@/lib/site'

type Props = { params: Promise<{ tag: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const tag = decodeURIComponent((await params).tag)
  return pageMetadata({ title: `#${tag}`, description: `与「${tag}」相关的表情包`, path: `/tags/${encodeURIComponent(tag)}`, index: true })
}

export default async function TagPage({ params }: Props) {
  const tag = decodeURIComponent((await params).tag)
  return <TagView tag={tag} hot={(await serverApi<string[]>('/tags/hot?limit=12')) ?? []} />
}
