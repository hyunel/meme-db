import { Suspense } from 'react'
import type { Metadata } from 'next'
import { RegisterForm } from '@/components/auth/auth-forms'

export const metadata: Metadata = { title: '注册' }

export default function RegisterPage() {
  return (
    <Suspense>
      <RegisterForm />
    </Suspense>
  )
}
