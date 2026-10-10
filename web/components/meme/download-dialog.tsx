'use client'

import { useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Progress } from '@/components/ui/progress'
import { downloadConverted, downloadOriginal, type DownloadFormat } from '@/lib/meme-transfer'
import type { Meme } from '@/lib/types'
import { cn } from '@/lib/utils'

const formats: { id: DownloadFormat; label: string; hint: string }[] = [
  { id: 'original', label: '原格式', hint: '保留原始画质与动画' },
  { id: 'png', label: 'PNG', hint: '无损，支持透明' },
  { id: 'jpg', label: 'JPG', hint: '体积更小，白色背景' },
  { id: 'gif', label: 'GIF', hint: '兼容性最好' },
]

export function DownloadDialog({ meme, open, onOpenChange }: { meme: Meme; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [format, setFormat] = useState<DownloadFormat>('original')
  const [progress, setProgress] = useState<number | null>(null)
  const busy = progress !== null

  const start = async () => {
    if (busy) return
    setProgress(0)
    try {
      if (format === 'original') await downloadOriginal(meme)
      else await downloadConverted(meme, format, setProgress)
      toast.success(format === 'original' ? '已开始下载' : `已转换为 ${format.toUpperCase()} 并开始下载`)
      onOpenChange(false)
    } catch (err) {
      toast.error('下载失败', { description: (err as Error).message })
    } finally {
      setProgress(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>下载表情包</DialogTitle>
          <DialogDescription>选择下载格式，转换在你的设备上完成。</DialogDescription>
        </DialogHeader>
        <div role="radiogroup" aria-label="下载格式" className="grid grid-cols-2 gap-2">
          {formats.map((f) => (
            <button
              key={f.id}
              type="button"
              role="radio"
              aria-checked={format === f.id}
              disabled={busy}
              onClick={() => setFormat(f.id)}
              className={cn(
                'flex min-h-16 flex-col items-start justify-center gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors hover:bg-muted disabled:opacity-60',
                format === f.id && 'border-foreground bg-brand/30 hover:bg-brand/40',
              )}
            >
              <span className="text-sm font-medium">{f.label}</span>
              <span className="text-xs text-muted-foreground">{f.hint}</span>
            </button>
          ))}
        </div>
        {busy && format !== 'original' && (
          <div className="flex flex-col gap-1.5" aria-live="polite">
            <Progress value={progress} />
            <span className="text-xs text-muted-foreground tabular-nums">正在转换… {progress}%</span>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            取消
          </Button>
          <Button onClick={start} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Download data-icon="inline-start" />}
            下载
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
