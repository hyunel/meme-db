'use client'

import { useSearchParams } from 'next/navigation'
import { NotFoundState } from '@/components/states'

export default function FolderNotFound() {
  return useSearchParams().has('share') ? (
    <NotFoundState title="链接已失效" description="分享者可能停用了这个链接，或删除了这个文件夹。" />
  ) : (
    <NotFoundState title="合集不存在" description="它可能已被删除，或已设为私有。" />
  )
}
