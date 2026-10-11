import { Suspense } from 'react'
import { InferenceView } from '@/components/admin/inference/inference-view'

export const metadata = { title: '推理服务' }

export default function Page() {
  return (
    <Suspense>
      <InferenceView />
    </Suspense>
  )
}
