import SiteLayout from './(site)/layout'
import { NotFoundState } from '@/components/states'

// Unmatched URLs land here, outside the site's layout, so it brings the layout along.
export default function NotFound() {
  return (
    <SiteLayout>
      <NotFoundState title="页面不存在" description="链接可能有误，或页面已被移除。" />
    </SiteLayout>
  )
}
