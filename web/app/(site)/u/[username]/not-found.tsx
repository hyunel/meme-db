import { NotFoundState } from '@/components/states'
import { getMessages } from '@/lib/i18n/server'

export default async function UserNotFound() {
  const t = await getMessages()
  return <NotFoundState title={t.notFound.user} description={t.notFound.userHint} />
}
