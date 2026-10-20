'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Languages } from 'lucide-react'
import { Logo } from '@/components/logo'
import { htmlLang, localeCookie, localeNames, type Locale } from '@/lib/i18n'
import { useLocale, useMessages } from '@/lib/i18n/client'

export function SiteFooter() {
  const t = useMessages()
  const other: Locale = useLocale() === 'zh' ? 'en' : 'zh'
  const router = useRouter()

  // The server renders pages in the picked language from now on, this one included once refreshed.
  const switchLanguage = () => {
    document.cookie = `${localeCookie}=${other}; path=/; max-age=${365 * 86400}; samesite=lax`
    router.refresh()
  }

  return (
    <footer className="border-t">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <Logo className="text-foreground" />
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {t.site.tagline}
          <Link href="/developers" className="hover:text-foreground hover:underline">
            {t.site.apiDocs}
          </Link>
          <button type="button" onClick={switchLanguage} lang={htmlLang[other]} className="inline-flex items-center gap-1 hover:text-foreground hover:underline">
            <Languages className="size-3.5" aria-hidden />
            {localeNames[other]}
          </button>
        </p>
      </div>
    </footer>
  )
}
