import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { AppProviders } from '@/components/app-providers'
import { siteUrl } from '@/lib/site'
import { htmlLang } from '@/lib/i18n'
import { getLocale, getMessages } from '@/lib/i18n/server'
import './globals.css'

const geistSans = Geist({ subsets: ['latin'], variable: '--font-geist-sans' })
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' })

export async function generateMetadata(): Promise<Metadata> {
  const t = await getMessages()
  return {
    metadataBase: new URL(siteUrl),
    title: {
      default: t.site.title,
      template: '%s · MemeDB',
    },
    description: t.site.description,
    icons: {
      icon: [
        { url: '/icon-light-32x32.png', media: '(prefers-color-scheme: light)' },
        { url: '/icon-dark-32x32.png', media: '(prefers-color-scheme: dark)' },
        { url: '/favicon.svg', type: 'image/svg+xml' }, // Pixel-aligned for tab sizes; the master logo is /icon.svg
      ],
      apple: '/apple-icon.png',
    },
  }
}

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: '#faf9f5',
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale()
  return (
    // The script marks a dark theme before the first paint, which React then finds on <html>; lib/theme.ts keeps it after.
    <html lang={htmlLang[locale]} className={`${geistSans.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("memedb:theme");if(t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches))document.documentElement.classList.add("dark")}catch(e){}`,
          }}
        />
      </head>
      <body className="antialiased">
        <AppProviders locale={locale}>{children}</AppProviders>
      </body>
    </html>
  )
}
