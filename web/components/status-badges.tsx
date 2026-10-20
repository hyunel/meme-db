'use client'

import { Globe, Loader2, Lock, Clock, CircleAlert, CheckCircle2, CornerLeftUp } from 'lucide-react'
import type { ProcessStatus, Visibility } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useMessages } from '@/lib/i18n/client'

const pill = 'inline-flex h-5 items-center gap-1 rounded-full px-2 text-xs font-medium whitespace-nowrap [&_svg]:size-3'

const processStyle = {
  pending: { icon: Clock, cls: 'bg-warning/15 text-warning-strong' },
  processing: { icon: Loader2, cls: 'bg-info/12 text-info' },
  success: { icon: CheckCircle2, cls: 'bg-success/12 text-success' },
  failed: { icon: CircleAlert, cls: 'bg-destructive/10 text-destructive' },
}

export function ProcessBadge({ status, className }: { status: ProcessStatus; className?: string }) {
  const { icon: Icon, cls } = processStyle[status]
  const t = useMessages()
  return (
    <span className={cn(pill, cls, className)}>
      <Icon className={cn(status === 'processing' && 'animate-spin')} aria-hidden />
      {t.status[status]}
    </span>
  )
}

export function VisibilityBadge({ visibility, className }: { visibility: Visibility; className?: string }) {
  const t = useMessages()
  if (visibility === 'private')
    return (
      <span className={cn(pill, 'bg-muted text-muted-foreground', className)}>
        <Lock aria-hidden />
        {t.status.private}
      </span>
    )
  if (visibility === 'inherited')
    return (
      <span className={cn(pill, 'bg-brand/40 text-foreground', className)} title={t.status.inheritedHint}>
        <CornerLeftUp aria-hidden />
        {t.status.inherited}
      </span>
    )
  return (
    <span className={cn(pill, 'bg-brand text-brand-foreground', className)}>
      <Globe aria-hidden />
      {t.status.public}
    </span>
  )
}
