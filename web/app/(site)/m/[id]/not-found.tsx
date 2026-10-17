'use client'

import { useSearchParams } from 'next/navigation'
import { NotFoundState } from '@/components/states'

export default function MemeNotFound() {
  return useSearchParams().has('share') ? (
    <NotFoundState title="链接已失效" description="分享者可能停用了这个链接，或把表情包移出了自己的库。" />
  ) : (
    <NotFoundState title="表情包不存在" description="它可能已被删除，或尚未公开。" />
  )
}
