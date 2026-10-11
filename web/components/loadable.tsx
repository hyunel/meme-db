'use client'

import { ErrorState, NotFoundState, PageLoading } from '@/components/states'
import { ApiError } from '@/lib/api'

export function Loadable<T>({
  result,
  notFound,
  loading = <PageLoading />,
  children,
}: {
  result: { data?: T; error?: unknown; mutate: () => unknown }
  notFound?: { title: string; description: string }
  loading?: React.ReactNode
  children: (data: T) => React.ReactNode
}) {
  const { data, error } = result
  if (error) {
    if (notFound && error instanceof ApiError && error.status === 404) return <NotFoundState {...notFound} />
    return (
      <div className="mx-auto w-full max-w-lg px-4 py-16">
        <ErrorState description={(error as Error).message} onRetry={() => void result.mutate()} />
      </div>
    )
  }
  return <>{data === undefined ? loading : children(data)}</>
}
