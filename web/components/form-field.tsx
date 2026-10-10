'use client'

import { useId, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

export function FormField({
  label,
  error,
  hint,
  type = 'text',
  className,
  ...props
}: React.ComponentProps<'input'> & { label: string; error?: string; hint?: string }) {
  const id = useId()
  const [show, setShow] = useState(false)
  const isPassword = type === 'password'
  const describedBy = error ? `${id}-err` : hint ? `${id}-hint` : undefined

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type={isPassword && show ? 'text' : type}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn('h-11 text-base md:h-10 md:text-sm', isPassword && 'pr-11')}
          {...props}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            aria-label={show ? '隐藏密码' : '显示密码'}
            aria-pressed={show}
            className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 rounded-r-md"
          >
            {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        )}
      </div>
      {error ? (
        <p id={`${id}-err`} className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export const USERNAME_RE = /^[a-z0-9_]{3,50}$/

export function validateUsername(v: string) {
  if (!v) return '请输入用户名'
  if (v.length < 3 || v.length > 50) return '用户名需为 3–50 个字符'
  if (!USERNAME_RE.test(v)) return '只能包含小写字母、数字和下划线'
  return undefined
}
export function validateEmail(v: string) {
  if (!v.trim()) return '请输入邮箱'
  if (!EMAIL_RE.test(v.trim())) return '邮箱格式不正确'
  return undefined
}
export function validatePassword(v: string) {
  if (!v) return '请输入密码'
  if (v.length < 6) return '密码至少 6 个字符'
  return undefined
}
