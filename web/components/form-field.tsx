'use client'

import { useId, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import type { Messages } from '@/lib/i18n'
import { useMessages } from '@/lib/i18n/client'

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
  const t = useMessages()
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
            aria-label={show ? t.form.hidePassword : t.form.showPassword}
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

export function validateUsername(v: string, { form }: Messages) {
  if (!v) return form.usernameRequired
  if (v.length < 3 || v.length > 50) return form.usernameLength
  if (!USERNAME_RE.test(v)) return form.usernameChars
  return undefined
}
export function validateEmail(v: string, { form }: Messages) {
  if (!v.trim()) return form.emailRequired
  if (!EMAIL_RE.test(v.trim())) return form.emailInvalid
  return undefined
}
export function validatePassword(v: string, { form }: Messages) {
  if (!v) return form.passwordRequired
  if (v.length < 6) return form.passwordShort
  return undefined
}
