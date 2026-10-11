'use client'

import { useState } from 'react'
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts'
import { ChartContainer, ChartLegend, ChartLegendContent, type ChartConfig } from '@/components/ui/chart'
import { Skeleton } from '@/components/ui/skeleton'
import { TabSwitch } from '@/components/tab-switch'
import { ChartCard, SYNC_ID, ThresholdLines, TimeTooltip, timeAxis } from './charts'
import { fmtBytes, fmtPct, type InferenceSnapshot } from '@/lib/inference'

const gpuColors = ['var(--chart-1)', 'var(--chart-4)', 'var(--chart-3)', 'var(--chart-5)']
const chartCls = 'aspect-auto h-48 w-full sm:h-64'

export function ResourceCharts({ data }: { data?: InferenceSnapshot }) {
  const [gpu, setGpu] = useState('all')
  const gpus = data?.gpus ?? []
  const shown = gpus.map((_, i) => i).filter((i) => gpu === 'all' || gpu === String(i))

  const computeConfig: ChartConfig = { cpu: { label: 'CPU', color: 'var(--chart-2)' } }
  const memoryConfig: ChartConfig = { mem: { label: '内存', color: 'var(--chart-2)' } }
  gpus.forEach((g, i) => {
    computeConfig[`gpu${i}`] = { label: `GPU ${g.id}`, color: gpuColors[i % gpuColors.length] }
    memoryConfig[`vram${i}`] = { label: `显存 ${g.id}`, color: gpuColors[i % gpuColors.length] }
  })
  const vramTotal = gpus[0]?.vram_total

  return (
    <section aria-labelledby="res-trend" className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h2 id="res-trend" className="text-sm font-medium text-muted-foreground">
          资源趋势
        </h2>
        {gpus.length > 1 && (
          <TabSwitch
            fill
            label="选择显卡"
            value={gpu}
            onChange={setGpu}
            tabs={[['all', '全部'], ...gpus.map((g, i) => [String(i), g.id] as const)]}
            className="[&_button]:h-8 [&_button]:px-3 [&_button]:text-xs"
          />
        )}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <ChartCard title="计算" description={gpus.length ? 'CPU 与 GPU 利用率（%）' : 'CPU 利用率（%）'}>
          {data ? (
            <ChartContainer config={computeConfig} className={chartCls}>
              <LineChart data={data.series} syncId={SYNC_ID} syncMethod="value" margin={{ left: 0, right: 8, top: 4 }}>
                <CartesianGrid vertical={false} />
                <XAxis {...timeAxis(data.start, data.now)} />
                <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickLine={false} axisLine={false} width={44} tickFormatter={(v) => `${v}%`} />
                <ThresholdLines warn={80} danger={95} />
                <TimeTooltip config={computeConfig} format={(v) => fmtPct(v)} />
                <ChartLegend content={<ChartLegendContent className="flex-wrap" />} />
                <Line dataKey="cpu" stroke="var(--color-cpu)" strokeWidth={1.75} dot={false} isAnimationActive={false} />
                {shown.map((i) => (
                  <Line key={i} dataKey={`gpu${i}`} stroke={`var(--color-gpu${i})`} strokeWidth={1.75} dot={false} isAnimationActive={false} />
                ))}
              </LineChart>
            </ChartContainer>
          ) : (
            <Skeleton className="h-48 w-full sm:h-64" />
          )}
        </ChartCard>

        <ChartCard title="内存" description={vramTotal ? '内存与显存用量；虚线为单卡显存 80% / 95%' : '内存用量'}>
          {data ? (
            <ChartContainer config={memoryConfig} className={chartCls}>
              <LineChart data={data.series} syncId={SYNC_ID} syncMethod="value" margin={{ left: 0, right: 8, top: 4 }}>
                <CartesianGrid vertical={false} />
                <XAxis {...timeAxis(data.start, data.now)} />
                <YAxis tickLine={false} axisLine={false} width={60} tickFormatter={(v) => fmtBytes(v).replace('.0 ', ' ')} />
                {vramTotal && <ThresholdLines warn={vramTotal * 0.8} danger={vramTotal * 0.95} />}
                <TimeTooltip config={memoryConfig} format={(v) => fmtBytes(v)} />
                <ChartLegend content={<ChartLegendContent className="flex-wrap" />} />
                <Line dataKey="mem" stroke="var(--color-mem)" strokeWidth={1.75} dot={false} isAnimationActive={false} />
                {shown.map((i) => (
                  <Line key={i} dataKey={`vram${i}`} stroke={`var(--color-vram${i})`} strokeWidth={1.75} dot={false} isAnimationActive={false} />
                ))}
              </LineChart>
            </ChartContainer>
          ) : (
            <Skeleton className="h-48 w-full sm:h-64" />
          )}
        </ChartCard>
      </div>
    </section>
  )
}
