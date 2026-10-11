import type { Metadata } from 'next'
import { ApiDocs } from '@/components/api-docs'

export const metadata: Metadata = { title: 'API 文档' }

export default function DevelopersPage() {
  return <ApiDocs />
}
