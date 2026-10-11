'use client'

import { Line, LineChart, ReferenceLine, YAxis } from 'recharts'
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart'
import { fmtClock, fmtClockSec, type Level } from '@/lib/inference'

export const SYNC_ID = 'inference'

export const levelStroke = { warn: 'var(--warning)', danger: 'var(--destructive)' } as const

// A numeric time domain lines every chart up on the same timeline.
export function timeAxis(start: number, end: number) {
  return {
    dataKey: 't',
    type: 'number' as const,
    scale: 'time' as const,
    domain: [start, end] as [number, number],
    tickFormatter: (t: number) => fmtClock(t),
    tickLine: false,
    axisLine: false,
    tickMargin: 8,
    minTickGap: 40,
  }
}

export function TimeTooltip({ config, format }: { config: ChartConfig; format: (v: number, key: string) => string }) {
  return (
    <ChartTooltip
      cursor={{ strokeDasharray: '3 3' }}
      content={
        <ChartTooltipContent
          labelFormatter={(_, payload) => {
            const t = payload?.[0]?.payload?.t as number | undefined
            return t ? fmtClockSec(t) : ''
          }}
          formatter={(value, name, item) => (
            <div className="flex w-full items-center gap-2">
              <span className="size-2.5 shrink-0 rounded-[2px]" style={{ background: item.color }} aria-hidden />
              <span className="text-muted-foreground">{config[String(name)]?.label ?? name}</span>
              <span className="ml-auto pl-3 font-mono font-medium tabular-nums text-foreground">{format(Number(value), String(name))}</span>
            </div>
          )}
        />
      }
    />
  )
}

export function ThresholdLines({ warn, danger, label }: { warn: number; danger: number; label?: string }) {
  return (
    <>
      <ReferenceLine y={warn} stroke={levelStroke.warn} strokeDasharray="4 4" ifOverflow="extendDomain" label={label ? { value: `${label}预警`, position: 'insideTopRight', fontSize: 10, fill: 'var(--muted-foreground)' } : undefined} />
      <ReferenceLine y={danger} stroke={levelStroke.danger} strokeDasharray="4 4" ifOverflow="extendDomain" />
    </>
  )
}

export function Sparkline<T extends object>({ data, dataKey, level = 'ok', domain }: { data: T[]; dataKey: keyof T & string; level?: Level; domain?: [number, number] }) {
  const color = level === 'ok' ? 'var(--chart-1)' : levelStroke[level]
  return (
    <ChartContainer config={{ [dataKey]: { label: dataKey, color } }} className="pointer-events-none mt-1 aspect-auto h-8 w-full" aria-hidden>
      <LineChart data={data} margin={{ top: 2, bottom: 2, left: 0, right: 0 }}>
        <YAxis hide domain={domain ?? ['auto', 'auto']} />
        <Line dataKey={dataKey} stroke={color} strokeWidth={1.5} dot={false} isAnimationActive={false} />
      </LineChart>
    </ChartContainer>
  )
}

export function ChartCard({ title, description, actions, children }: { title: string; description?: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-3 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <h3 className="text-sm font-medium">{title}</h3>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  )
}
