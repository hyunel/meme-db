import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { MemeDetail } from '@/components/meme/meme-detail'
import { qs } from '@/lib/utils'
import { kindOf, memeTitle } from '@/lib/media'
import { param, serverApi } from '@/lib/server-api'
import { pageMetadata } from '@/lib/site'
import { getMessages } from '@/lib/i18n/server'
import type { EntryDetail, Meme } from '@/lib/types'

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ entry?: string | string[]; share?: string | string[] }> }

// Opened from an entry, the meme goes by the entry's name; generateMetadata and the page share these requests.
async function load({ params, searchParams }: Props) {
  const [{ id }, query] = await Promise.all([params, searchParams])
  const [entryId, share] = [param(query.entry), param(query.share)]
  const [meme, entry] = await Promise.all([serverApi<Meme>(`/memes/${id}${qs({ share })}`), entryId ? serverApi<EntryDetail>(`/entries/${entryId}${qs({ share })}`) : null])
  return { meme: meme ?? notFound(), entry: entry?.meme.id === id ? entry : undefined, share } // A hand-edited link may pair an entry with another meme
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { meme, entry, share } = await load(props)
  const kind = kindOf(meme.mime_type)
  return pageMetadata({
    title: entry?.name ?? memeTitle(meme, await getMessages()),
    description: meme.summary || undefined,
    path: `/m/${meme.id}`,
    image: kind === 'image' || kind === 'gif' ? { url: meme.url, width: meme.width, height: meme.height } : undefined,
    index: meme.is_public && !share,
  })
}

export default async function MemePage(props: Props) {
  const { meme, entry, share } = await load(props)
  return <MemeDetail meme={meme} entry={entry} share={share} />
}
