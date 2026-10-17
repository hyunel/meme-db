import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { PublicFolderView } from '@/components/public-views'
import { qs } from '@/lib/utils'
import { kindOf } from '@/lib/media'
import { param, serverApi } from '@/lib/server-api'
import { pageMetadata } from '@/lib/site'
import type { FolderPage } from '@/lib/types'

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ share?: string | string[] }> }

async function load({ params, searchParams }: Props) {
  const [{ id }, query] = await Promise.all([params, searchParams])
  const share = param(query.share)
  return { page: (await serverApi<FolderPage>(`/folders/${id}${qs({ share })}`)) ?? notFound(), share }
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { page: { folder }, share } = await load(props)
  const cover = folder.previews.find((m) => ['image', 'gif'].includes(kindOf(m.mime_type)))
  return pageMetadata({
    title: folder.name,
    description: `@${folder.owner.username} 的表情包合集，共 ${folder.item_count} 个表情包`,
    path: `/f/${folder.id}`,
    image: cover && { url: cover.url },
    index: folder.visibility === 'public' && !share,
  })
}

export default async function FolderPage(props: Props) {
  const { page, share } = await load(props)
  return <PublicFolderView page={page} share={share} />
}
