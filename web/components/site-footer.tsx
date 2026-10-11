import Link from 'next/link'
import { Logo } from '@/components/logo'

export function SiteFooter() {
  return (
    <footer className="border-t">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <Logo className="text-foreground" />
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1">
          用文字或图片，找到那张刚刚好的表情包。
          <Link href="/developers" className="hover:text-foreground hover:underline">
            API 文档
          </Link>
        </p>
      </div>
    </footer>
  )
}
