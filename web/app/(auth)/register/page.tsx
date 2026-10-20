import { Suspense } from 'react'
import { RegisterForm } from '@/components/auth/auth-forms'
import { pageTitle } from '@/lib/i18n/server'

export const generateMetadata = pageTitle('register')

export default function RegisterPage() {
  return (
    <Suspense>
      <RegisterForm />
    </Suspense>
  )
}
