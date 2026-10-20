import { Suspense } from 'react'
import { LoginForm } from '@/components/auth/auth-forms'
import { pageTitle } from '@/lib/i18n/server'

export const generateMetadata = pageTitle('login')

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}
