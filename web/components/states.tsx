import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'
import { AlertTriangle, FileQuestion, Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

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

export function ErrorState({ title = '加载失败', description = '请稍后重试。', onRetry }: { title?: string; description?: string; onRetry?: () => void }) {
  return (
    <EmptyState
      icon={AlertTriangle}
      title={title}
      description={description}
      action={onRetry && <Button variant="outline" onClick={onRetry}>重试</Button>}
    />
  )
}

export function NotFoundState({ title = '内容不存在', description = '它可能已被删除，或你没有访问权限。' }: { title?: string; description?: string }) {
  return (
    <div className="mx-auto max-w-lg px-4 py-24">
      <EmptyState
        icon={FileQuestion}
        title={title}
        description={description}
        action={
          <Button nativeButton={false} render={<Link href="/" />} variant="outline">
            返回首页
          </Button>
        }
      />
    </div>
  )
}

export function ForbiddenState() {
  return (
    <div className="mx-auto max-w-lg px-4 py-24">
      <EmptyState
        icon={Lock}
        title="无权访问"
        description="此页面仅对管理员开放。如需访问，请联系系统管理员。"
        action={
          <Button nativeButton={false} render={<Link href="/" />} variant="outline">
            返回首页
          </Button>
        }
      />
    </div>
  )
}

export function MemeGridSkeleton({ count = 10 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5" aria-busy="true" aria-label="加载中">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="aspect-square rounded-xl" />
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
