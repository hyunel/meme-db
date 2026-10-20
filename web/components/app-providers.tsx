'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { SWRConfig } from 'swr'
import { LogIn } from 'lucide-react'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { fetcher } from '@/lib/api'
import { bootSession, getSession } from '@/lib/session'
import { applyTheme, subscribeTheme, useDarkTheme } from '@/lib/theme'
import { messages, type Locale } from '@/lib/i18n'
import { LocaleContext } from '@/lib/i18n/client'

type RequireLogin = (reason?: string) => boolean

const LoginPromptContext = createContext<RequireLogin>(() => true)

export function useRequireLogin() {
  return useContext(LoginPromptContext)
}

export function AppProviders({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  const t = messages[locale]
  const [reason, setReason] = useState<string | null>(null)
  const router = useRouter()
  const dark = useDarkTheme()

  useEffect(() => {
    void bootSession()
  }, [])

  useEffect(() => {
    applyTheme()
    return subscribeTheme(applyTheme)
  }, [])

  const requireLogin = useCallback<RequireLogin>((why) => {
    if (getSession().user) return true
    setReason(why ?? t.login.prompt)
    return false
  }, [t])

  const goLogin = () => {
    const back = window.location.pathname + window.location.search
    setReason(null)
    router.push(`/login?redirect=${encodeURIComponent(back)}`)
  }

  return (
    <LocaleContext value={locale}>
      <SWRConfig value={{ fetcher, revalidateOnFocus: false }}>
        <LoginPromptContext.Provider value={requireLogin}>
          <TooltipProvider>
            {children}
            <Dialog open={reason !== null} onOpenChange={(open) => !open && setReason(null)}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t.login.title}</DialogTitle>
                  <DialogDescription>{reason}</DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setReason(null)}>
                    {t.common.cancel}
                  </Button>
                  <Button onClick={goLogin}>
                    <LogIn data-icon="inline-start" />
                    {t.login.go}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            {/* Below md the toasts sit above the fixed tab bar */}
            <Toaster
              theme={dark ? 'dark' : 'light'}
              position="bottom-right"
              richColors
              className="[--toast-bottom:calc(4.5rem+env(safe-area-inset-bottom))] md:[--toast-bottom:1.5rem]"
              offset={{ bottom: 'var(--toast-bottom)' }}
              mobileOffset={{ bottom: 'var(--toast-bottom)' }}
            />
          </TooltipProvider>
        </LoginPromptContext.Provider>
      </SWRConfig>
    </LocaleContext>
  )
}
