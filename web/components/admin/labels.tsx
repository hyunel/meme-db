'use client'

import type { LogLevel, Role, Task, TaskState } from '@/lib/types'
import type { Messages } from '@/lib/i18n'
import { useMessages } from '@/lib/i18n/client'
import { cn } from '@/lib/utils'

/** A pending task that already failed an attempt is waiting for its retry. */
export const taskState = (t: Task): TaskState => (t.status === 'pending' && t.attempts > 0 ? 'retrying' : t.status)

export const jobLabel = (type: string, t: Messages) => (t.admin.jobs as Record<string, string>)[type] ?? type

const taskTone: Record<TaskState, string> = {
  pending: 'bg-muted text-muted-foreground',
  retrying: 'bg-warning/15 text-warning-strong',
  running: 'bg-info/15 text-info-strong',
  completed: 'bg-success/15 text-success-strong',
  failed: 'bg-destructive/10 text-destructive',
}

export function TaskStatusBadge({ status }: { status: TaskState }) {
  const t = useMessages()
  return (
    <span className={cn('inline-flex h-6 items-center gap-1.5 rounded-full px-2 text-xs font-medium whitespace-nowrap', taskTone[status])}>
      <span className={cn('size-1.5 rounded-full bg-current', status === 'running' && 'animate-pulse')} aria-hidden />
      {t.admin.taskStates[status]}
    </span>
  )
}

const levelTone: Record<LogLevel, string> = {
  debug: 'text-muted-foreground bg-muted',
  info: 'text-info-strong bg-info/15',
  warn: 'text-warning-strong bg-warning/15',
  error: 'text-destructive bg-destructive/10',
}

export function LevelBadge({ level }: { level: LogLevel }) {
  return <span className={cn('inline-flex h-5 w-12 items-center justify-center rounded font-mono text-[10px] font-semibold uppercase', levelTone[level])}>{level}</span>
}

export function RoleBadge({ role }: { role: Role }) {
  const t = useMessages()
  return (
    <span className={cn('inline-flex h-6 items-center rounded-full px-2 text-xs font-medium', role === 'admin' ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground')}>
      {t.admin.roles[role]}
    </span>
  )
}

export function UserStatusBadge({ status }: { status: 'active' | 'disabled' }) {
  const t = useMessages()
  return (
    <span className={cn('inline-flex h-6 items-center gap-1.5 rounded-full px-2 text-xs font-medium', status === 'active' ? 'bg-success/15 text-success-strong' : 'bg-destructive/10 text-destructive')}>
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {t.admin.userStates[status]}
    </span>
  )
}
