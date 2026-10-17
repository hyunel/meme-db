'use client'

import { ErrorState } from '@/components/states'

export default function SiteError({ retry }: { retry: () => void }) {
  return (
    <div className="mx-auto w-full max-w-lg px-4 py-16">
      <ErrorState onRetry={retry} />
    </div>
  )
}
