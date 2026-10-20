'use client'

import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'
import { AlertTriangle, FileQuestion, Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { useMessages } from '@/lib/i18n/client'

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-6 py-16 text-center', className)}>
      <div className="flex size-12 items-center justify-center rounded-full bg-muted">
        <Icon className="size-5 text-muted-foreground" aria-hidden />
      </div>
      <div className="flex flex-col gap-1">
        <p className="font-medium">{title}</p>
        {description && <p className="max-w-sm text-sm text-muted-foreground text-pretty">{description}</p>}
      </div>
      {action}
    </div>
  )
}

export function ErrorState({ title, description, onRetry }: { title?: string; description?: string; onRetry?: () => void }) {
  const t = useMessages()
  return (
    <EmptyState
      icon={AlertTriangle}
      title={title ?? t.common.loadFailed}
      description={description ?? t.common.tryLater}
      action={onRetry && <Button variant="outline" onClick={onRetry}>{t.common.retry}</Button>}
    />
  )
}

export function NotFoundState({ title, description }: { title?: string; description?: string }) {
  const t = useMessages()
  return (
    <div className="mx-auto max-w-lg px-4 py-24">
      <EmptyState
        icon={FileQuestion}
        title={title ?? t.notFound.content}
        description={description ?? t.notFound.contentHint}
        action={
          <Button nativeButton={false} render={<Link href="/" />} variant="outline">
            {t.common.backHome}
          </Button>
        }
      />
    </div>
  )
}

export function ForbiddenState() {
  const t = useMessages()
  return (
    <div className="mx-auto max-w-lg px-4 py-24">
      <EmptyState
        icon={Lock}
        title={t.notFound.forbidden}
        description={t.notFound.forbiddenHint}
        action={
          <Button nativeButton={false} render={<Link href="/" />} variant="outline">
            {t.common.backHome}
          </Button>
        }
      />
    </div>
  )
}

// Heights over widths of the placeholder cards, uneven like memes'.
const SKELETON_RATIOS = [1, 1.3, 0.75, 1.1, 0.9, 1.25]

/** Columns of placeholder cards as MemeGrid lays them out, as many as it shows at each width. */
export function MemeGridSkeleton() {
  const t = useMessages()
  return (
    <div className="flex items-start gap-3" aria-busy="true" aria-label={t.common.loading}>
      {['flex', 'flex', 'hidden sm:flex', 'hidden md:flex', 'hidden lg:flex', 'hidden xl:flex'].map((display, c) => (
        <div key={c} className={cn('min-w-0 flex-1 flex-col gap-4', display)}>
          {[0, 1, 2].map((r) => (
            <div key={r} className="flex flex-col gap-1.5">
              <Skeleton className="rounded-xl" style={{ aspectRatio: 1 / SKELETON_RATIOS[(c + r * 2) % SKELETON_RATIOS.length] }} />
              <Skeleton className="my-1.5 h-5 w-1/2 rounded-full" />
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

export function PageLoading() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10">
      <Skeleton className="mb-6 h-8 w-48" />
      <MemeGridSkeleton />
    </div>
  )
}
