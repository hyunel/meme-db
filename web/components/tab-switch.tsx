import { cn } from '@/lib/utils'

export function TabSwitch<T extends string>({
  label,
  value,
  onChange,
  tabs,
}: {
  label: string
  value: T
  onChange: (value: T) => void
  tabs: readonly (readonly [T, string, number | undefined])[]
}) {
  return (
    <div role="tablist" aria-label={label} className="inline-flex self-start rounded-lg border bg-card p-0.5">
      {tabs.map(([id, text, count]) => (
        <button
          key={id}
          role="tab"
          type="button"
          aria-selected={value === id}
          onClick={() => onChange(id)}
          className={cn('flex h-9 items-center gap-1.5 rounded-md px-3.5 text-sm transition-colors', value === id ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground')}
        >
          {text}
          <span className="text-xs tabular-nums opacity-70">{count ?? ''}</span>
        </button>
      ))}
    </div>
  )
}
