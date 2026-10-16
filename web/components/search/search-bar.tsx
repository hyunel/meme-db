'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ImageIcon, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useImageInput } from '@/hooks/use-image-input'
import { putImageQuery } from '@/lib/image-query'
import { pushRecentSearch } from '@/lib/recent-searches'
import { cn } from '@/lib/utils'

export function SearchBar({
  size = 'md',
  defaultValue = '',
  scope,
  folderId,
  share,
  className,
  autoFocus,
}: {
  size?: 'md' | 'lg'
  defaultValue?: string
  scope?: 'all' | 'mine'
  folderId?: string | null
  share?: string // The private link opening the folder
  className?: string
  autoFocus?: boolean
}) {
  const router = useRouter()
  const [value, setValue] = useState(defaultValue)

  const buildParams = (extra: Record<string, string>) => {
    const p = new URLSearchParams(extra)
    if (folderId) {
      p.set('folder', folderId)
      if (share) p.set('share', share)
    } else if (scope === 'mine') p.set('scope', 'mine')
    return p.toString()
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const q = value.trim()
    if (q) pushRecentSearch(q)
    router.push(`/search?${buildParams(q ? { q } : {})}`)
  }

  const imageInput = useImageInput((file) => router.push(`/search?${buildParams({ img: putImageQuery(file).id })}`))
  const dragging = imageInput.dragging

  const lg = size === 'lg'

  return (
    <form
      role="search"
      onSubmit={submit}
      {...imageInput.dropProps}
      className={cn(
        'flex w-full items-center gap-1 rounded-xl border bg-card shadow-xs transition focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/20',
        lg ? 'h-14 pl-4 pr-2' : 'h-9 pl-3 pr-1',
        dragging && 'border-dashed border-foreground bg-brand/20',
        className,
      )}
    >
      <Search className={cn('shrink-0 text-muted-foreground', lg ? 'size-5' : 'size-4')} aria-hidden />
      <label htmlFor={`search-${size}`} className="sr-only">
        搜索表情包
      </label>
      <input
        id={`search-${size}`}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onPaste={imageInput.onPaste}
        autoFocus={autoFocus}
        autoComplete="off"
        placeholder={dragging ? '松开以按图片搜索' : folderId ? '在此合集中搜索…' : scope === 'mine' ? '在我的库中搜索…' : '关键词，或粘贴图片'}
        className={cn('h-full min-w-0 flex-1 bg-transparent px-2 text-ellipsis outline-none placeholder:text-muted-foreground', lg ? 'text-base' : 'text-sm')}
      />
      <input {...imageInput.inputProps} />
      <Tooltip>
        <TooltipTrigger
          render={
            <Button type="button" variant="ghost" size={lg ? 'icon-lg' : 'icon-sm'} onClick={imageInput.open} aria-label="按图片搜索" />
          }
        >
          <ImageIcon />
        </TooltipTrigger>
        <TooltipContent>按图片搜索（也可粘贴或拖入）</TooltipContent>
      </Tooltip>
      {lg && (
        <Button type="submit" size="lg" className="h-10 px-5">
          搜索
        </Button>
      )}
    </form>
  )
}
