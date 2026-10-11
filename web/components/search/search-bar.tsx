'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ImageIcon, Search } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useImageInput } from './use-image-input'
import { putImageQuery, validateQueryImage } from '@/lib/image-query'
import { pushRecentSearch } from '@/lib/recent-searches'
import { cn } from '@/lib/utils'

export function SearchBar({
  size = 'md',
  defaultValue = '',
  scope,
  folderId,
  className,
  autoFocus,
}: {
  size?: 'md' | 'lg'
  defaultValue?: string
  scope?: 'public' | 'mine'
  folderId?: string | null
  className?: string
  autoFocus?: boolean
}) {
  const router = useRouter()
  const [value, setValue] = useState(defaultValue)
  const fileRef = useRef<HTMLInputElement>(null)

  const buildParams = (extra: Record<string, string>) => {
    const p = new URLSearchParams(extra)
    if (scope === 'mine') p.set('scope', 'mine')
    if (folderId) p.set('folder', folderId)
    return p.toString()
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const q = value.trim()
    if (q) pushRecentSearch(q)
    router.push(`/search?${buildParams(q ? { q } : {})}`)
  }

  const searchByImage = (file: File | undefined | null) => {
    if (!file) return
    const err = validateQueryImage(file)
    if (err) {
      toast.error(err)
      return
    }
    const q = putImageQuery(file)
    router.push(`/search?${buildParams({ img: q.id })}`)
  }

  const imageInput = useImageInput(searchByImage)
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
        placeholder={dragging ? '松开以按图片搜索' : scope === 'mine' ? '在我的库中搜索…' : '输入关键词，或拖入/粘贴图片搜索'}
        className={cn('h-full min-w-0 flex-1 bg-transparent px-2 outline-none placeholder:text-muted-foreground', lg ? 'text-base' : 'text-sm')}
      />
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          searchByImage(e.target.files?.[0])
          e.target.value = ''
        }}
      />
      <Tooltip>
        <TooltipTrigger
          render={
            <Button type="button" variant="ghost" size={lg ? 'icon-lg' : 'icon-sm'} onClick={() => fileRef.current?.click()} aria-label="按图片搜索" />
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
