'use client'

import { useState } from 'react'
import { ChevronDown, Crosshair, ImageIcon, RotateCcw, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { FilterSelect, Toolbar } from '../admin-ui'
import { useImageInput } from '@/hooks/use-image-input'
import type { ImageQuery } from '@/lib/image-query'
import { formatBytes } from '@/lib/format'
import { channelLabel, textChannels, type Channel, type DebugScope, type TopK } from '@/lib/search-debug'
import { cn } from '@/lib/utils'

const scopeOptions = [
  ['all', '全部'],
  ['public', '仅公开（访客视角）'],
] as const

export function QueryPanel({
  initialQ,
  scope,
  onScopeChange,
  topK,
  onTopKChange,
  image,
  onSubmitText,
  onImage,
  onClearImage,
  track,
  onClearTrack,
}: {
  initialQ: string
  scope: DebugScope
  onScopeChange: (s: DebugScope) => void
  topK: TopK
  onTopKChange: (t: TopK) => void
  image: ImageQuery | null
  onSubmitText: (q: string) => void
  onImage: (file: File) => void
  onClearImage: () => void
  track: string | null
  onClearTrack: () => void
}) {
  const [value, setValue] = useState(initialQ)
  const [showK, setShowK] = useState(false)
  const img = useImageInput(onImage)
  const channels: Channel[] = [...textChannels, 'clip_image']
  const customized = Object.keys(topK).length > 0

  return (
    <section aria-label="查询" className="flex flex-col gap-3 rounded-xl border bg-card p-3 sm:p-4">
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault()
          onSubmitText(value.trim())
        }}
        {...img.dropProps}
        className={cn(
          'flex h-11 items-center gap-1 rounded-lg border bg-background pr-1 pl-3 transition focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/20',
          img.dragging && 'border-dashed border-foreground bg-brand/20',
        )}
      >
        <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <label htmlFor="debug-q" className="sr-only">
          调试查询
        </label>
        <input
          id="debug-q"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onPaste={img.onPaste}
          autoComplete="off"
          placeholder={img.dragging ? '松开以按图片调试' : '输入与前台相同的查询，或拖入/粘贴图片'}
          className="h-full min-w-0 flex-1 bg-transparent px-2 text-base outline-none placeholder:text-muted-foreground md:text-sm"
        />
        <input {...img.inputProps} />
        <Button type="button" variant="ghost" size="icon" onClick={img.open} aria-label="以图搜图" className="size-9">
          <ImageIcon />
        </Button>
        <Button type="submit" className="h-9 px-4">
          运行
        </Button>
      </form>

      {(image || track) && (
        <div className="flex flex-wrap gap-2">
          {image && (
            <span className="inline-flex h-10 max-w-full items-center gap-2 rounded-lg border bg-muted/40 pr-1 pl-1 text-sm">
              <img src={image.url} alt="查询图片" className="size-8 rounded object-cover" />
              <span className="truncate">{image.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{formatBytes(image.file.size)}</span>
              <Button variant="ghost" size="icon" aria-label="移除查询图片" onClick={onClearImage} className="size-8">
                <X />
              </Button>
            </span>
          )}
          {track && (
            <span className="inline-flex h-10 max-w-full items-center gap-2 rounded-lg border border-foreground/30 bg-brand/25 pr-1 pl-3 text-sm">
              <Crosshair className="size-4 shrink-0" aria-hidden />
              <span className="shrink-0">追踪</span>
              <span className="truncate font-mono text-xs">{track}</span>
              <Button variant="ghost" size="icon" aria-label="停止追踪" onClick={onClearTrack} className="size-8">
                <X />
              </Button>
            </span>
          )}
        </div>
      )}

      <Toolbar>
        <FilterSelect value={scope} onChange={onScopeChange} options={scopeOptions} label="检索范围" className="min-w-40" />
        <Button variant="outline" className="h-10 md:h-9" aria-expanded={showK} aria-controls="topk-panel" onClick={() => setShowK((v) => !v)}>
          召回条数{customized && <span className="size-1.5 rounded-full bg-foreground" aria-label="已自定义" />}
          <ChevronDown className={cn('transition-transform', showK && 'rotate-180')} aria-hidden />
        </Button>
      </Toolbar>

      {showK && (
        <div id="topk-panel" className="flex flex-col gap-3 rounded-lg border border-dashed p-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {channels.map((c) => (
              <div key={c} className="flex flex-col gap-1.5">
                <Label htmlFor={`topk-${c}`} className="text-xs font-normal text-muted-foreground">
                  {channelLabel[c]}
                </Label>
                <Input
                  id={`topk-${c}`}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={200}
                  value={topK[c] ?? ''}
                  placeholder="默认"
                  onChange={(e) => {
                    const next = { ...topK }
                    const n = Math.round(Number(e.target.value))
                    delete next[c]
                    if (e.target.value && Number.isFinite(n)) next[c] = Math.min(200, Math.max(1, n))
                    onTopKChange(next)
                  }}
                  className="h-10 font-mono text-base md:h-9 md:text-sm"
                />
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">每页召回条数，留空即用服务端配置；调试复现搜索的第一页，不改变线上参数。</p>
            <Button variant="ghost" size="sm" disabled={!customized} onClick={() => onTopKChange({})}>
              <RotateCcw />
              恢复默认
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}
