import { Globe, Loader2, Lock, Clock, CircleAlert, CheckCircle2, CornerLeftUp } from 'lucide-react'
import type { ProcessStatus, Visibility } from '@/lib/types'
import { cn } from '@/lib/utils'

const pill = 'inline-flex h-5 items-center gap-1 rounded-full px-2 text-xs font-medium whitespace-nowrap [&_svg]:size-3'

export const processLabel: Record<ProcessStatus, string> = {
  pending: '排队中',
  processing: '处理中',
  success: '已完成',
  failed: '处理失败',
}

const processStyle = {
  pending: { icon: Clock, cls: 'bg-warning/15 text-[oklch(0.45_0.12_70)]' },
  processing: { icon: Loader2, cls: 'bg-info/12 text-info' },
  success: { icon: CheckCircle2, cls: 'bg-success/12 text-success' },
  failed: { icon: CircleAlert, cls: 'bg-destructive/10 text-destructive' },
}

export function ProcessBadge({ status, className }: { status: ProcessStatus; className?: string }) {
  const { icon: Icon, cls } = processStyle[status]
  return (
    <span className={cn(pill, cls, className)}>
      <Icon className={cn(status === 'processing' && 'animate-spin')} aria-hidden />
      {processLabel[status]}
    </span>
  )
}

export function VisibilityBadge({ visibility, className }: { visibility: Visibility; className?: string }) {
  if (visibility === 'private')
    return (
      <span className={cn(pill, 'bg-muted text-muted-foreground', className)}>
        <Lock aria-hidden />
        私有
      </span>
    )
  if (visibility === 'inherited')
    return (
      <span className={cn(pill, 'bg-brand/40 text-foreground', className)} title="因上级文件夹公开而公开">
        <CornerLeftUp aria-hidden />
        继承公开
      </span>
    )
  return (
    <span className={cn(pill, 'bg-brand text-brand-foreground', className)}>
      <Globe aria-hidden />
      公开
    </span>
  )
}
