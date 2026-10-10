import type { Metadata } from 'next'
import { DiscoverView } from '@/components/public-views'

export const metadata: Metadata = { title: '发现' }

export default function DiscoverPage() {
  return <DiscoverView />
}
