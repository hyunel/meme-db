import { Logo } from '@/components/logo'

export function SiteFooter() {
  return (
    <footer className="border-t">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <Logo className="text-foreground" />
        <p>用文字或图片，找到那张刚刚好的表情包。</p>
      </div>
    </footer>
  )
}
