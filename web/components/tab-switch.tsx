import { cn } from '@/lib/utils'

export function TabSwitch<T extends string>({
  label,
  value,
  onChange,
  tabs,
  fill = false,
}: {
  label: string
  value: T
  onChange: (value: T) => void
  tabs: readonly (readonly [T, string, (number | undefined)?])[]
  /** Spans the width on small screens, as in the admin console */
  fill?: boolean
}) {
  return (
    <div role="tablist" aria-label={label} className={cn('flex rounded-lg border', fill ? 'w-full bg-background p-1 sm:w-fit' : 'self-start bg-card p-0.5')}>
      {tabs.map(([id, text, count]) => (
        <button
          key={id}
          role="tab"
          type="button"
          aria-selected={value === id}
          onClick={() => onChange(id)}
          className={cn(
            'flex h-9 items-center justify-center gap-1.5 rounded-md text-sm whitespace-nowrap transition-colors',
            fill ? 'flex-1 px-4 sm:flex-none' : 'px-3.5',
            value === id ? cn('bg-foreground text-background', fill && 'font-medium') : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {text}
          {count !== undefined && <span className="text-xs tabular-nums opacity-70">{count}</span>}
        </button>
      ))}
    </div>
  )
}
