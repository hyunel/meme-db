import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { UserProfileView } from '@/components/public-views'
import { serverApi } from '@/lib/server-api'
import { pageMetadata } from '@/lib/site'
import { getMessages } from '@/lib/i18n/server'
import type { Profile } from '@/lib/types'

type Props = { params: Promise<{ username: string }> }

async function load({ params }: Props) {
  const { username } = await params // Still percent-encoded
  return (await serverApi<Profile>(`/users/${username}`)) ?? notFound()
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { user, folder_count, meme_count } = await load(props)
  const t = await getMessages()
  return pageMetadata({
    title: `@${user.username}`,
    description: t.browse.profileMeta(user.username, folder_count, meme_count),
    path: `/u/${encodeURIComponent(user.username)}`,
    index: true,
  })
}

export default async function UserPage(props: Props) {
  return <UserProfileView profile={await load(props)} />
}
