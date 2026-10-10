import Link from 'next/link'
import { cn } from '@/lib/utils'

export function Logo({ className, href = '/' }: { className?: string; href?: string }) {
  return (
    <Link href={href} className={cn('flex items-center gap-2 font-semibold tracking-tight', className)} aria-label="MemeDB 首页">
      <span className="flex size-7 items-center justify-center rounded-md bg-brand font-mono text-xs font-bold text-brand-foreground ring-1 ring-foreground/10">
        M
      </span>
      <span>
        Meme<span className="text-muted-foreground">DB</span>
      </span>
    </Link>
  )
}
