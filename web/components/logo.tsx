'use client'

import Link from 'next/link'
import { useMessages } from '@/lib/i18n/client'
import { cn } from '@/lib/utils'

export function Logo({ className, href = '/' }: { className?: string; href?: string }) {
  const t = useMessages()
  return (
    <Link href={href} className={cn('flex items-center gap-2 font-semibold tracking-tight', className)} aria-label={t.nav.homeLabel}>
      {/* The mark of public/favicon.svg, whose cells fall on whole pixels at this size */}
      <svg viewBox="0 0 32 32" className="size-8 shrink-0" aria-hidden>
        <path d="M9 3H5Q3 3 3 5V9M23 3H27Q29 3 29 5V9M3 23V27Q3 29 5 29H9M29 23V27Q29 29 27 29H23" fill="none" className="stroke-foreground" strokeWidth="2" strokeLinecap="round" />
        <g shapeRendering="crispEdges">
          {/* The face stays dark on its yellow in either theme, as in the dark favicon */}
          <path
            className="fill-brand-foreground"
            d="M12 6h8v2h-8zM10 8h12v2h-12zM8 10h16v2h-16zM6 12h20v2h-20zM6 14h20v2h-20zM6 16h20v2h-20zM6 18h20v2h-20zM8 20h16v2h-16zM10 22h12v2h-12zM12 24h8v2h-8z"
          />
          <path
            className="fill-brand"
            d="M12 8h8v2h-8zM10 10h12v2h-12zM8 12h4v2h-4zM14 12h4v2h-4zM20 12h4v2h-4zM8 14h16v2h-16zM8 16h2v2h-2zM12 16h8v2h-8zM22 16h2v2h-2zM8 18h4v2h-4zM14 18h4v2h-4zM20 18h4v2h-4zM10 20h4v2h-4zM18 20h4v2h-4zM12 22h8v2h-8z"
          />
        </g>
      </svg>
      <span>
        Meme<span className="text-muted-foreground">DB</span>
      </span>
    </Link>
  )
}
