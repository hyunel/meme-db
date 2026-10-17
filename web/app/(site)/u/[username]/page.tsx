import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { UserProfileView } from '@/components/public-views'
import { serverApi } from '@/lib/server-api'
import { pageMetadata } from '@/lib/site'
import type { Profile } from '@/lib/types'

type Props = { params: Promise<{ username: string }> }

async function load({ params }: Props) {
  const { username } = await params // Still percent-encoded
  return (await serverApi<Profile>(`/users/${username}`)) ?? notFound()
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { user, folder_count, meme_count } = await load(props)
  return pageMetadata({
    title: `@${user.username}`,
    description: `@${user.username} 公开的 ${folder_count} 个合集与 ${meme_count} 个表情包`,
    path: `/u/${encodeURIComponent(user.username)}`,
    index: true,
  })
}

export default async function UserPage(props: Props) {
  return <UserProfileView profile={await load(props)} />
}
