import Link from 'next/link'
import { Logo } from '@/components/logo'
import { getMessages } from '@/lib/i18n/server'

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const t = await getMessages()
  return (
    <div className="flex min-h-dvh flex-col bg-muted/40">
      <header className="flex h-14 items-center justify-between px-4 sm:px-6">
        <Logo />
        <Link href="/search" className="text-sm text-muted-foreground hover:text-foreground">
          {t.auth.browse}
        </Link>
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pt-6 pb-12 sm:items-center sm:pt-0">{children}</main>
    </div>
  )
}
