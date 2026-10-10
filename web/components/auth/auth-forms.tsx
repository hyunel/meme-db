'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { FormField, validateEmail, validatePassword, validateUsername } from '@/components/form-field'
import { GuestOnly } from '@/components/auth-guard'
import { ApiError } from '@/lib/api'
import { login, register } from '@/lib/session'

function useRedirectTarget() {
  const params = useSearchParams()
  const raw = params.get('redirect')
  const safe = raw && raw.startsWith('/') && !raw.startsWith('//') && !raw.startsWith('/login') && !raw.startsWith('/register') ? raw : '/search'
  return { target: safe, query: raw ? `?redirect=${encodeURIComponent(raw)}` : '', expired: params.get('expired') === '1' }
}

function AuthCard({ title, description, children, footer }: { title: string; description: string; children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <div className="w-full max-w-sm rounded-2xl border bg-card p-6 shadow-sm sm:p-8">
      <div className="mb-6 flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
      <p className="mt-6 text-center text-sm text-muted-foreground">{footer}</p>
    </div>
  )
}

export function LoginForm() {
  const router = useRouter()
  const { target, query, expired } = useRedirectTarget()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<{ email?: string; password?: string; form?: string }>({})
  const [pending, setPending] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (pending) return
    const next = { email: validateEmail(email), password: password ? undefined : '请输入密码' }
    setErrors(next)
    if (next.email || next.password) return
    setPending(true)
    try {
      await login(email.trim(), password)
      toast.success('登录成功')
      router.replace(target)
    } catch (err) {
      setErrors({ form: (err as Error).message })
    } finally {
      setPending(false)
    }
  }

  return (
    <GuestOnly redirect={target}>
      <AuthCard
        title="登录 MemeDB"
        description="登录后管理你的表情包库与收藏。"
        footer={
          <>
            还没有账号？{' '}
            <Link href={`/register${query}`} className="font-medium text-foreground underline underline-offset-4">
              去注册
            </Link>
          </>
        }
      >
        {expired && <p className="mb-4 rounded-lg bg-warning/15 px-3 py-2 text-sm">登录已过期，请重新登录。</p>}
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <FormField
            label="邮箱"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={errors.email}
            placeholder="you@example.com"
          />
          <FormField
            label="密码"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={errors.password}
          />
          {errors.form && (
            <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {errors.form}
            </p>
          )}
          <Button type="submit" size="lg" className="h-11 w-full" disabled={pending}>
            {pending && <Loader2 className="animate-spin" data-icon="inline-start" />}
            登录
          </Button>
        </form>
      </AuthCard>
    </GuestOnly>
  )
}

type RegField = 'username' | 'email' | 'password'

export function RegisterForm() {
  const router = useRouter()
  const { target, query } = useRedirectTarget()
  const [values, setValues] = useState<Record<RegField, string>>({ username: '', email: '', password: '' })
  const [errors, setErrors] = useState<Partial<Record<RegField, string>>>({})
  const [pending, setPending] = useState(false)

  const validators: Record<RegField, (v: string) => string | undefined> = {
    username: validateUsername,
    email: validateEmail,
    password: validatePassword,
  }

  const bind = (k: RegField) => ({
    value: values[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setValues((v) => ({ ...v, [k]: e.target.value })),
    onBlur: () => setErrors((er) => ({ ...er, [k]: validators[k](values[k]) })),
    error: errors[k],
  })

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (pending) return
    const next = { username: validateUsername(values.username), email: validateEmail(values.email), password: validatePassword(values.password) }
    setErrors(next)
    if (next.username || next.email || next.password) return
    setPending(true)
    try {
      await register({ username: values.username, email: values.email.trim(), password: values.password })
      toast.success('注册成功，已自动登录')
      router.replace(target)
    } catch (err) {
      const field = err instanceof ApiError ? (err.field as RegField | undefined) : undefined
      if (field && field in values) setErrors({ [field]: (err as Error).message })
      else toast.error('注册失败', { description: (err as Error).message })
    } finally {
      setPending(false)
    }
  }

  return (
    <GuestOnly redirect={target}>
      <AuthCard
        title="创建账号"
        description="免费注册，开始收集属于你的表情包。"
        footer={
          <>
            已有账号？{' '}
            <Link href={`/login${query}`} className="font-medium text-foreground underline underline-offset-4">
              去登录
            </Link>
          </>
        }
      >
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <FormField label="用户名" autoComplete="username" autoCapitalize="none" hint="3–50 个字符，小写字母、数字或下划线" {...bind('username')} />
          <FormField label="邮箱" type="email" inputMode="email" autoComplete="email" {...bind('email')} />
          <FormField label="密码" type="password" autoComplete="new-password" hint="至少 6 个字符" {...bind('password')} />
          <Button type="submit" size="lg" className="h-11 w-full" disabled={pending}>
            {pending && <Loader2 className="animate-spin" data-icon="inline-start" />}
            注册
          </Button>
        </form>
      </AuthCard>
    </GuestOnly>
  )
}
