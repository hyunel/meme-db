'use client'

import { useSearchParams } from 'next/navigation'
import { NotFoundState } from '@/components/states'
import { useMessages } from '@/lib/i18n/client'

export default function MemeNotFound() {
  const t = useMessages()
  return useSearchParams().has('share') ? (
    <NotFoundState title={t.notFound.link} description={t.notFound.memeLinkHint} />
  ) : (
    <NotFoundState title={t.notFound.meme} description={t.notFound.memeHint} />
  )
}
