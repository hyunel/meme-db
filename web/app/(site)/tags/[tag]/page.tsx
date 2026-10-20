import type { Metadata } from 'next'
import { TagView } from '@/components/public-views'
import { serverApi } from '@/lib/server-api'
import { pageMetadata } from '@/lib/site'
import { getMessages } from '@/lib/i18n/server'

type Props = { params: Promise<{ tag: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const tag = decodeURIComponent((await params).tag)
  const t = await getMessages()
  return pageMetadata({ title: `#${tag}`, description: t.browse.tagMeta(tag), path: `/tags/${encodeURIComponent(tag)}`, index: true })
}

export default async function TagPage({ params }: Props) {
  const tag = decodeURIComponent((await params).tag)
  return <TagView tag={tag} hot={(await serverApi<string[]>('/tags/hot?limit=12')) ?? []} />
}
