'use client'

import useSWR from 'swr'
import { fetchInference, inferenceAlerts, type InferenceRange } from '@/lib/inference'
import { useMessages } from '@/lib/i18n/client'

export function useInference(range: InferenceRange, { auto = true, interval = 5000 } = {}) {
  const swr = useSWR(['inference', range], () => fetchInference(range), {
    refreshInterval: auto ? interval : 0,
    keepPreviousData: true,
    dedupingInterval: 1000,
    shouldRetryOnError: false,
  })
  const t = useMessages()

  const down = Boolean(swr.error)
  const degraded = swr.data && inferenceAlerts(swr.data, t).some((a) => a.level === 'danger')
  return { ...swr, down, connection: down ? ('down' as const) : swr.data ? (degraded ? ('degraded' as const) : ('ok' as const)) : null }
}
