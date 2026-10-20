import { Suspense } from 'react'
import { InferenceView } from '@/components/admin/inference/inference-view'
import { pageTitle } from '@/lib/i18n/server'

export const generateMetadata = pageTitle('inference')

export default function Page() {
  return (
    <Suspense>
      <InferenceView />
    </Suspense>
  )
}
