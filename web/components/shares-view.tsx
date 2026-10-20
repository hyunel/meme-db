'use client'

import { useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { Check, Copy, Eye, Folder as FolderIcon, FolderDown, ImageOff, Link2, Share2, Unlink } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
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
import type { Messages } from '@/lib/i18n'
import { useMessages } from '@/lib/i18n/client'

// What the link opens, and where its owner finds it.
const targetOf = (s: SharedItem, t: Messages): ShareTarget & { href?: string } =>
  s.folder_id
    ? { kind: 'folder', id: s.folder_id, title: s.folder?.name ?? t.shares.folder, href: `/library?folder=${s.folder_id}` }
    : { kind: 'meme', id: s.meme_id!, title: s.meme ? memeTitle(s.meme, t) : t.shares.memeGone, href: s.meme ? `/m/${s.meme_id}` : undefined }

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
  const t = useMessages()

  const copy = async (s: SharedItem) => {
    try {
      await navigator.clipboard.writeText(linkTo(pageOf(targetOf(s, t)), s.token))
      setCopied(s.token)
      setTimeout(() => setCopied((c) => (c === s.token ? null : c)), 1500)
    } catch {
      toast.error(t.shares.copyFailed)
    }
  }

  const revoke = async (s: SharedItem) => {
    const { kind, id } = targetOf(s, t)
    try {
      await api(`/${kind}s/${id}/share`, { method: 'DELETE' })
      await shares.mutate((list) => list?.filter((x) => x.token !== s.token), { revalidate: false })
      toast.success(s.live ? t.shares.disabled : t.shares.deleted, { description: s.live ? t.shares.disabledHint : undefined })
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t.titles.shares}</h1>
        <p className="text-sm text-muted-foreground">{t.shares.description}</p>
      </header>

      <Loadable
        result={shares}
        loading={
          <div className="flex flex-col gap-6" aria-busy="true" aria-label={t.common.loading}>
            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-[76px] rounded-xl sm:h-[88px]" />
              ))}
            </div>
            <ul className="flex flex-col divide-y rounded-xl border bg-card">
              {[0, 1, 2].map((i) => (
                <li key={i} className="flex items-center gap-3 p-3">
                  <Skeleton className="size-14 rounded-lg" />
                  <div className="flex flex-1 flex-col gap-2">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-3 w-64 max-w-full" />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        }
      >
        {(list) =>
          list.length === 0 ? (
            <EmptyState icon={Link2} title={t.shares.none} description={t.shares.noneHint} />
          ) : (
            <>
              <dl className="grid grid-cols-3 gap-2 sm:gap-3">
                {(
                  [
                    [t.shares.links, list.length, Link2],
                    [t.shares.views, list.reduce((n, s) => n + s.view_count, 0), Eye],
                    [t.shares.saves, list.reduce((n, s) => n + s.save_count, 0), FolderDown],
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

              <ul className="flex flex-col divide-y rounded-xl border bg-card" aria-label={t.shares.links}>
                {list.map((s) => {
                  const target = targetOf(s, t)
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
                          {!s.live && <span className="shrink-0 rounded-full bg-destructive/10 px-2 py-0.5 text-xs text-destructive">{t.shares.dead}</span>}
                        </div>
                        {s.live ? (
                          <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground tabular-nums">
                            {s.folder && <span>{t.shares.folderItems(s.folder.item_count)}</span>}
                            <span>{t.shares.opened(s.view_count)}</span>
                            <span>{t.shares.saved(s.save_count)}</span>
                            <span>{s.last_viewed_at ? t.shares.lastOpened(formatRelative(s.last_viewed_at, t)) : t.shares.neverOpened}</span>
                            <span>{t.tokens.created(formatDate(s.created_at))}</span>
                          </p>
                        ) : (
                          <p className="text-xs text-pretty text-muted-foreground">
                            {s.meme ? t.shares.outOfLibraryRestorable : t.shares.outOfLibrary}
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center">
                        {s.live && (
                          <>
                            <IconAction label={copied === s.token ? t.shares.copied : t.shares.copy} onClick={() => void copy(s)}>
                              {copied === s.token ? <Check /> : <Copy />}
                            </IconAction>
                            {'share' in navigator && (
                              <IconAction label={t.shares.share} onClick={() => void sendLink(title, linkTo(pageOf(target), s.token), t)}>
                                <Share2 />
                              </IconAction>
                            )}
                          </>
                        )}
                        <IconAction label={s.live ? t.shares.disable : t.shares.delete} onClick={() => setRevoking(s)} className="text-muted-foreground hover:text-destructive">
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
            <AlertDialogTitle>{revoking?.live === false ? t.shares.confirmDelete : t.shares.confirmDisable}</AlertDialogTitle>
            <AlertDialogDescription>{t.shares.confirmHint}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const target = revoking
                setRevoking(null)
                if (target) void revoke(target)
              }}
            >
              {revoking?.live === false ? t.shares.deleteAction : t.shares.disableAction}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
