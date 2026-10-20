'use client'

import { useSearchParams } from 'next/navigation'
import { NotFoundState } from '@/components/states'
import { useMessages } from '@/lib/i18n/client'

export default function FolderNotFound() {
  const t = useMessages()
  return useSearchParams().has('share') ? (
    <NotFoundState title={t.notFound.link} description={t.notFound.folderLinkHint} />
  ) : (
    <NotFoundState title={t.notFound.folder} description={t.notFound.folderHint} />
  )
}
