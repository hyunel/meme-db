import { ApiDocs } from '@/components/api-docs'
import { pageTitle } from '@/lib/i18n/server'

export const generateMetadata = pageTitle('developers')

export default function DevelopersPage() {
  return <ApiDocs />
}
