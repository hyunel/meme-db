'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { Check, Copy, Link2, Loader2, Lock, Share2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { api } from '@/lib/api'
import { qs } from '@/lib/utils'
import { memeTitle } from '@/lib/media'
import type { Folder, Meme, ShareLink } from '@/lib/types'

/** A meme or folder of the viewer's library that a private link may open. */
export type ShareTarget = { kind: 'meme' | 'folder'; id: string; title: string }

export const pageOf = ({ kind, id }: Pick<ShareTarget, 'kind' | 'id'>) => `/${kind === 'meme' ? 'm' : 'f'}/${id}`

export const linkTo = (path: string, share?: string) => `${window.location.origin}${path}${qs({ share })}`

/** Hands the link to the system share sheet where there is one, otherwise copies it. */
export async function sendLink(title: string, url: string, note?: string) {
  if (navigator.share) {
    try {
      await navigator.share({ title, url })
      return
    } catch (err) {
      if ((err as Error).name === 'AbortError') return // Dismissed
    }
  }
  try {
    await navigator.clipboard.writeText(url)
    toast.success('链接已复制', { description: note })
  } catch {
    toast.error('复制失败，请手动复制地址栏中的链接')
  }
}

/**
 * Shares a meme: a link anyone can open goes out at once, while a meme only the viewer can see
 * first needs a private link, made in the dialog openPrivate shows. share is the private link the meme was opened by.
 */
export function shareMeme(meme: Meme, openPrivate: () => void, share?: string) {
  const title = memeTitle(meme)
  const path = pageOf({ kind: 'meme', id: meme.id })
  if (meme.is_public) void sendLink(title, linkTo(path))
  else if (meme.entries.length) openPrivate()
  else if (share) void sendLink(title, linkTo(path, share))
  else void sendLink(title, linkTo(path), '这个表情包没有公开，其他人打不开此链接。')
}

/** Shares a folder alike: a public one at once, a private one of the viewer's own by a private link, and others by the link they came with. */
export function shareFolder(folder: Folder, own: boolean, openPrivate: () => void, share?: string) {
  const path = pageOf({ kind: 'folder', id: folder.id })
  if (folder.visibility !== 'private') void sendLink(folder.name, linkTo(path))
  else if (own) openPrivate()
  else void sendLink(folder.name, linkTo(path, share))
}

export function useShareMeme(meme: Meme, share?: string) {
  const [open, setOpen] = useState(false)
  return {
    start: () => shareMeme(meme, () => setOpen(true), share),
    dialog: open && <PrivateLinkDialog target={{ kind: 'meme', id: meme.id, title: memeTitle(meme) }} onOpenChange={setOpen} />,
  }
}

export function ShareButton({ meme, share, className }: { meme: Meme; share?: string; className?: string }) {
  const sharing = useShareMeme(meme, share)
  return (
    <>
      <Button variant="outline" className={className} onClick={sharing.start}>
        <Share2 data-icon="inline-start" />
        分享
      </Button>
      {sharing.dialog}
    </>
  )
}

export function PrivateLinkDialog({ target, onOpenChange }: { target: ShareTarget; onOpenChange: (open: boolean) => void }) {
  const key = `/${target.kind}s/${target.id}/share`
  const { data: link, error, mutate } = useSWR<ShareLink | null>(key)
  const loading = link === undefined && !error
  const [pending, setPending] = useState(false)
  const [copied, setCopied] = useState(false)
  const url = link ? linkTo(pageOf(target), link.token) : ''
  const folder = target.kind === 'folder'

  const run = async (action: () => Promise<void>) => {
    setPending(true)
    try {
      await action()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setPending(false)
    }
  }
  const create = () =>
    run(async () => {
      await mutate(await api<ShareLink>(key, { method: 'PUT' }), { revalidate: false })
    })
  const revoke = () =>
    run(async () => {
      await api(key, { method: 'DELETE' })
      await mutate(null, { revalidate: false })
      toast.success('链接已停用', { description: '已经发出去的链接将打不开。' })
    })
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('复制失败，请手动选中链接复制')
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="gap-4 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{folder ? '分享文件夹' : '分享表情包'}</DialogTitle>
          <DialogDescription>{folder ? '这个文件夹没有公开，不会出现在发现和你的主页上。' : '这个表情包没有公开，不会出现在搜索和发现中。'}</DialogDescription>
        </DialogHeader>

        <div className="flex items-start gap-3 rounded-xl border p-3" aria-live="polite">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted" aria-hidden>
            {loading ? <Loader2 className="size-4 animate-spin" /> : link ? <Link2 className="size-4" /> : <Lock className="size-4" />}
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <p className="text-sm font-medium">{link ? '拿到链接的人可以查看' : '仅自己可见'}</p>
            <p className="text-xs text-pretty text-muted-foreground">
              {!link
                ? '创建私密链接后，拿到链接的人就能查看并保存它。'
                : folder
                  ? '对方可以浏览其中的全部内容，并保存到自己的库。停用链接或删除文件夹后，链接即失效。'
                  : '对方可以查看、下载并保存到自己的库。停用链接或把它移出我的库后，链接即失效。'}
            </p>
            {link && (
              <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                已打开 {link.view_count} 次 · 被保存 {link.save_count} 次
              </p>
            )}
          </div>
        </div>

        {link && (
          <div className="flex gap-2">
            <Input readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label="私密链接" className="font-mono text-xs" />
            <Button variant="outline" onClick={copy}>
              {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
              {copied ? '已复制' : '复制'}
            </Button>
          </div>
        )}

        <DialogFooter>
          {link ? (
            <>
              <Button variant="ghost" className="text-destructive hover:text-destructive sm:mr-auto" onClick={revoke} disabled={pending}>
                停用链接
              </Button>
              {'share' in navigator ? (
                <Button onClick={() => void sendLink(target.title, url)}>
                  <Share2 data-icon="inline-start" />
                  分享…
                </Button>
              ) : (
                <Button onClick={() => onOpenChange(false)}>完成</Button>
              )}
            </>
          ) : (
            <Button onClick={create} disabled={pending || loading}>
              {pending ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Link2 data-icon="inline-start" />}
              创建私密链接
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
