import type { Metadata } from 'next'
import { UserProfileView } from '@/components/public-views'

export async function generateMetadata({ params }: { params: Promise<{ username: string }> }): Promise<Metadata> {
  const { username } = await params
  return { title: `@${decodeURIComponent(username)}` }
}

export default async function UserPage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params
  return <UserProfileView username={decodeURIComponent(username)} />
}
