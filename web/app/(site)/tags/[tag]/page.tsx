import type { Metadata } from 'next'
import { TagView } from '@/components/public-views'

export async function generateMetadata({ params }: { params: Promise<{ tag: string }> }): Promise<Metadata> {
  const { tag } = await params
  return { title: `#${decodeURIComponent(tag)}` }
}

export default async function TagPage({ params }: { params: Promise<{ tag: string }> }) {
  const { tag } = await params
  return <TagView tag={decodeURIComponent(tag)} />
}
