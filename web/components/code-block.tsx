'use client'

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useMessages } from '@/lib/i18n/client'

export function CopyButton({ value, label, className }: { value: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false)
  const t = useMessages()
  return (
    <button
      type="button"
      aria-label={label ?? t.common.copyValue(value)}
      className={cn('flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground', className)}
      onClick={async (e) => {
        e.stopPropagation()
        e.preventDefault()
        try {
          await navigator.clipboard.writeText(value)
          setDone(true)
          setTimeout(() => setDone(false), 1200)
        } catch {
          toast.error(t.common.copyFailed)
        }
      }}
    >
      {done ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </button>
  )
}

export function CodeBlock({ code, title }: { code: string; title: string }) {
  const t = useMessages()
  return (
    <figure className="min-w-0 overflow-hidden rounded-lg border bg-muted/40">
      <figcaption className="flex h-9 items-center justify-between border-b pr-1 pl-3 text-xs text-muted-foreground">
        {title}
        <CopyButton value={code} label={t.common.copyCode} />
      </figcaption>
      <pre className="overflow-x-auto p-3 font-mono text-xs leading-relaxed">
        <code>{code}</code>
      </pre>
    </figure>
  )
}
