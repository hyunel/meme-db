'use client'

import { useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { Check, Copy, Eye, Folder as FolderIcon, FolderDown, ImageOff, Link2, Share2, Unlink } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { MemeMedia } from '@/components/meme/meme-media'
import { linkTo, pageOf, sendLink, type ShareTarget } from '@/components/meme/share-dialog'
import { EmptyState } from '@/components/states'
import { Loadable } from '@/components/loadable'
import { api } from '@/lib/api'
import { formatDate, formatRelative } from '@/lib/format'
import { memeTitle } from '@/lib/media'
import type { SharedItem } from '@/lib/types'

// What the link opens, and where its owner finds it.
const targetOf = (s: SharedItem): ShareTarget & { href?: string } =>
  s.folder_id
    ? { kind: 'folder', id: s.folder_id, title: s.folder?.name ?? '文件夹', href: `/library?folder=${s.folder_id}` }
    : { kind: 'meme', id: s.meme_id!, title: s.meme ? memeTitle(s.meme) : '表情包已不可见', href: s.meme ? `/m/${s.meme_id}` : undefined }

function IconAction({ label, onClick, className, children }: { label: string; onClick: () => void; className?: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label={label} onClick={onClick} className={className} />}>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export function SharesView() {
  const shares = useSWR<SharedItem[]>('/shares')
  const [revoking, setRevoking] = useState<SharedItem | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  const copy = async (s: SharedItem) => {
    try {
      await navigator.clipboard.writeText(linkTo(pageOf(targetOf(s)), s.token))
      setCopied(s.token)
      setTimeout(() => setCopied((t) => (t === s.token ? null : t)), 1500)
    } catch {
      toast.error('复制失败，请稍后重试')
    }
  }

  const revoke = async (s: SharedItem) => {
    const { kind, id } = targetOf(s)
    try {
      await api(`/${kind}s/${id}/share`, { method: 'DELETE' })
      await shares.mutate((list) => list?.filter((x) => x.token !== s.token), { revalidate: false })
      toast.success(s.live ? '链接已停用' : '链接已删除', { description: s.live ? '已经发出去的链接将打不开。' : undefined })
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">我的分享</h1>
        <p className="text-sm text-muted-foreground">未公开的表情包和文件夹可以用私密链接分享，拿到链接的人能查看并保存。</p>
      </header>

      <Loadable result={shares}>
        {(list) =>
          list.length === 0 ? (
            <EmptyState icon={Link2} title="还没有私密链接" description="在未公开的表情包或文件夹上点击「分享」即可创建。" />
          ) : (
            <>
              <dl className="grid grid-cols-3 gap-2 sm:gap-3">
                {(
                  [
                    ['私密链接', list.length, Link2],
                    ['累计打开', list.reduce((n, s) => n + s.view_count, 0), Eye],
                    ['被保存', list.reduce((n, s) => n + s.save_count, 0), FolderDown],
                  ] as const
                ).map(([label, value, Icon]) => (
                  <div key={label} className="flex flex-col gap-1 rounded-xl border bg-card p-3 sm:p-4">
                    <dt className="flex items-center gap-1.5 text-xs text-muted-foreground sm:text-sm">
                      <Icon className="size-3.5" aria-hidden />
                      {label}
                    </dt>
                    <dd className="text-2xl font-semibold tabular-nums">{value}</dd>
                  </div>
                ))}
              </dl>

              <ul className="flex flex-col divide-y rounded-xl border bg-card" aria-label="私密链接">
                {list.map((s) => {
                  const target = targetOf(s)
                  const { title, href } = target
                  const thumb = s.folder_id ? (
                    <span className="flex size-14 shrink-0 items-center justify-center rounded-lg bg-muted/60">
                      <FolderIcon className="size-7 fill-brand/50 text-foreground/70" strokeWidth={1.25} aria-hidden />
                    </span>
                  ) : (
                    <span className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted/50">
                      {s.meme ? <MemeMedia meme={s.meme} /> : <ImageOff className="size-5 text-muted-foreground" aria-hidden />}
                    </span>
                  )
                  return (
                    <li key={s.token} className="flex items-center gap-3 p-3">
                      {href ? (
                        <Link href={href} aria-hidden tabIndex={-1}>
                          {thumb}
                        </Link>
                      ) : (
                        thumb
                      )}
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <div className="flex min-w-0 items-center gap-2">
                          {href ? (
                            <Link href={href} className="truncate text-sm font-medium hover:underline">
                              {title}
                            </Link>
                          ) : (
                            <span className="truncate text-sm font-medium text-muted-foreground">{title}</span>
                          )}
                          {!s.live && <span className="shrink-0 rounded-full bg-destructive/10 px-2 py-0.5 text-xs text-destructive">已失效</span>}
                        </div>
                        {s.live ? (
                          <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground tabular-nums">
                            {s.folder && <span>文件夹 · {s.folder.item_count} 项</span>}
                            <span>打开 {s.view_count} 次</span>
                            <span>保存 {s.save_count} 次</span>
                            <span>{s.last_viewed_at ? `最近打开于 ${formatRelative(s.last_viewed_at)}` : '还没有人打开'}</span>
                            <span>{formatDate(s.created_at)} 创建</span>
                          </p>
                        ) : (
                          <p className="text-xs text-pretty text-muted-foreground">
                            表情包已移出我的库，链接打不开了{s.meme ? '；重新加入我的库即可恢复' : ''}。
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center">
                        {s.live && (
                          <>
                            <IconAction label={copied === s.token ? '已复制' : '复制链接'} onClick={() => void copy(s)}>
                              {copied === s.token ? <Check /> : <Copy />}
                            </IconAction>
                            {'share' in navigator && (
                              <IconAction label="分享" onClick={() => void sendLink(title, linkTo(pageOf(target), s.token))}>
                                <Share2 />
                              </IconAction>
                            )}
                          </>
                        )}
                        <IconAction label={s.live ? '停用链接' : '删除链接'} onClick={() => setRevoking(s)} className="text-muted-foreground hover:text-destructive">
                          <Unlink />
                        </IconAction>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </>
          )
        }
      </Loadable>

      <AlertDialog open={revoking !== null} onOpenChange={(o) => !o && setRevoking(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{revoking?.live === false ? '删除这个链接？' : '停用这个链接？'}</AlertDialogTitle>
            <AlertDialogDescription>已经发出去的链接将打不开，以后再分享会生成新的链接。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const target = revoking
                setRevoking(null)
                if (target) void revoke(target)
              }}
            >
              {revoking?.live === false ? '删除' : '停用'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
