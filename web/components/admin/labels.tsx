import type { LogLevel, Role, Task, TaskState } from '@/lib/types'
import { cn } from '@/lib/utils'

export const taskStateLabel: Record<TaskState, string> = {
  pending: '排队中',
  retrying: '等待重试',
  running: '执行中',
  completed: '已完成',
  failed: '失败',
}

/** A pending task that already failed an attempt is waiting for its retry. */
export const taskState = (t: Task): TaskState => (t.status === 'pending' && t.attempts > 0 ? 'retrying' : t.status)

const jobTypeLabel: Record<string, string> = {
  analyze_meme: '分析表情包',
  resolve_labels: '整理标签',
}

export const jobLabel = (type: string) => jobTypeLabel[type] ?? type

const taskTone: Record<TaskState, string> = {
  pending: 'bg-muted text-muted-foreground',
  retrying: 'bg-warning/15 text-[oklch(0.45_0.12_70)]',
  running: 'bg-[oklch(0.93_0.05_250)] text-[oklch(0.4_0.15_255)]',
  completed: 'bg-success/15 text-[oklch(0.4_0.1_155)]',
  failed: 'bg-destructive/10 text-destructive',
}

export function TaskStatusBadge({ status }: { status: TaskState }) {
  return (
    <span className={cn('inline-flex h-6 items-center gap-1.5 rounded-full px-2 text-xs font-medium whitespace-nowrap', taskTone[status])}>
      <span className={cn('size-1.5 rounded-full bg-current', status === 'running' && 'animate-pulse')} aria-hidden />
      {taskStateLabel[status]}
    </span>
  )
}

const levelTone: Record<LogLevel, string> = {
  debug: 'text-muted-foreground bg-muted',
  info: 'text-[oklch(0.4_0.15_255)] bg-[oklch(0.93_0.05_250)]',
  warn: 'text-[oklch(0.45_0.12_70)] bg-warning/15',
  error: 'text-destructive bg-destructive/10',
}

export function LevelBadge({ level }: { level: LogLevel }) {
  return <span className={cn('inline-flex h-5 w-12 items-center justify-center rounded font-mono text-[10px] font-semibold uppercase', levelTone[level])}>{level}</span>
}

export const roleLabel = (role: Role) => (role === 'admin' ? '管理员' : '普通用户')

export function RoleBadge({ role }: { role: Role }) {
  return (
    <span className={cn('inline-flex h-6 items-center rounded-full px-2 text-xs font-medium', role === 'admin' ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground')}>
      {roleLabel(role)}
    </span>
  )
}

export function UserStatusBadge({ status }: { status: 'active' | 'disabled' }) {
  return (
    <span className={cn('inline-flex h-6 items-center gap-1.5 rounded-full px-2 text-xs font-medium', status === 'active' ? 'bg-success/15 text-[oklch(0.4_0.1_155)]' : 'bg-destructive/10 text-destructive')}>
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {status === 'active' ? '正常' : '已禁用'}
    </span>
  )
}
