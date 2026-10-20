'use client'

import Link from 'next/link'
import { Code2, KeyRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CodeBlock } from '@/components/code-block'
import { ScopeBadge, scopeTones } from '@/components/api-tokens'
import { useOrigin } from '@/hooks/use-origin'
import type { Messages } from '@/lib/i18n'
import { useMessages } from '@/lib/i18n/client'
import type { TokenScope } from '@/lib/types'
import { cn } from '@/lib/utils'

type Access = 'public' | Exclude<TokenScope, 'admin'>

// The dictionary sums up each endpoint by its method and path.
const reference: { group: keyof Messages['apiDocs']['groups']; endpoints: [method: string, path: string, access: Access][] }[] = [
  {
    group: 'memes',
    endpoints: [
      ['POST', '/search', 'public'],
      ['GET', '/search', 'public'],
      ['GET', '/memes', 'public'],
      ['GET', '/memes/{id}', 'public'],
      ['GET', '/memes/{id}/similar', 'public'],
      ['GET', '/memes/{id}/folders', 'public'],
      ['POST', '/memes/{id}/share/views', 'public'],
      ['GET', '/tags/hot', 'public'],
      ['GET', '/folders', 'public'],
      ['GET', '/folders/{id}', 'public'],
      ['GET', '/folders/{id}/entries', 'public'],
      ['POST', '/folders/{id}/share/views', 'public'],
      ['GET', '/entries/{id}', 'public'],
      ['GET', '/users/{username}', 'public'],
      ['GET', '/users/{username}/folders', 'public'],
      ['GET', '/users/{username}/memes', 'public'],
      ['GET', '/config', 'public'],
      ['GET', '/stats', 'public'],
    ],
  },
  {
    group: 'library',
    endpoints: [
      ['GET', '/library', 'read'],
      ['GET', '/library/folders', 'read'],
      ['POST', '/library/upload', 'write'],
      ['POST', '/library/entries', 'write'],
      ['POST', '/library/folders', 'write'],
      ['POST', '/library/folders/{id}/save', 'write'],
      ['PATCH', '/library/nodes/{id}', 'write'],
      ['PATCH', '/library/nodes', 'write'],
      ['POST', '/library/nodes/move', 'write'],
      ['POST', '/library/nodes/copy', 'write'],
      ['DELETE', '/library/nodes', 'write'],
    ],
  },
  {
    group: 'favorites',
    endpoints: [
      ['GET', '/favorites', 'read'],
      ['GET', '/favorites/memes', 'read'],
      ['PUT', '/favorites/{meme|folder}/{id}', 'write'],
      ['DELETE', '/favorites/{meme|folder}/{id}', 'write'],
      ['DELETE', '/favorites/stale', 'write'],
      ['POST', '/memes/{id}/tags', 'write'],
      ['DELETE', '/memes/{id}/tags/{tagId}', 'write'],
      ['POST', '/memes/{id}/retry', 'write'],
      ['GET', '/shares', 'read'],
      ['GET', '/memes/{id}/share', 'read'],
      ['PUT', '/memes/{id}/share', 'write'],
      ['DELETE', '/memes/{id}/share', 'write'],
      ['GET', '/folders/{id}/share', 'read'],
      ['PUT', '/folders/{id}/share', 'write'],
      ['DELETE', '/folders/{id}/share', 'write'],
    ],
  },
  {
    group: 'account',
    endpoints: [
      ['GET', '/auth/me', 'read'],
      ['GET', '/auth/me/stats', 'read'],
    ],
  },
]

const methodTone: Record<string, string> = {
  GET: 'text-info',
  POST: 'text-success',
  PUT: 'text-warning-strong',
  PATCH: 'text-warning-strong',
  DELETE: 'text-destructive',
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] wrap-anywhere">{children}</code>
}

// Backticks in the dictionary's prose mark code, as in Markdown.
const prose = (text: string) => text.split('`').map((part, i) => (i % 2 ? <Code key={i}>{part}</Code> : part))

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="flex min-w-0 scroll-mt-20 flex-col gap-4">
      <h2 id={`${id}-h`} className="text-xl font-semibold tracking-tight">
        {title}
      </h2>
      {children}
    </section>
  )
}

function Notes({ items }: { items: string[] }) {
  return (
    <ul className="flex list-disc flex-col gap-2 pl-5 text-sm leading-relaxed text-muted-foreground marker:text-foreground/30">
      {items.map((note) => (
        <li key={note}>{prose(note)}</li>
      ))}
    </ul>
  )
}

export function ApiDocs() {
  const origin = useOrigin()
  const api = `${origin}/api`
  const t = useMessages()
  const d = t.apiDocs
  const { sample } = d

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-12 px-4 py-8 sm:px-6 sm:py-12">
      <header className="flex flex-col gap-4">
        <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
          <Code2 className="size-4" aria-hidden />
          {d.eyebrow}
        </span>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">MemeDB API</h1>
        <p className="text-pretty text-muted-foreground">{prose(d.intro(api))}</p>
        <div className="flex flex-wrap gap-2">
          <Button nativeButton={false} render={<Link href="/settings#api-tokens" />} className="h-11 sm:h-9">
            <KeyRound data-icon="inline-start" />
            {d.manageTokens}
          </Button>
          <Button variant="outline" nativeButton={false} render={<a href="#ingest" />} className="h-11 sm:h-9">
            {d.ingestExample}
          </Button>
        </div>
      </header>

      <Section id="start" title={d.start}>
        <ol className="flex flex-col gap-5">
          {[
            {
              text: (
                <>
                  {d.step1Before}
                  <Link href="/settings#api-tokens" className="font-medium underline underline-offset-4">
                    {t.titles.settings}
                  </Link>
                  {d.step1After}
                </>
              ),
            },
            { text: prose(d.step2) },
            { text: d.step3, code: `curl -H "Authorization: Bearer $MEMEDB_TOKEN" ${api}/auth/me` },
          ].map(({ text, code }, i) => (
            <li key={i} className="flex gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-semibold text-brand-foreground tabular-nums" aria-hidden>
                {i + 1}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-3 pt-0.5">
                <p className="text-sm leading-relaxed">{text}</p>
                {code && <CodeBlock title="Shell" code={code} />}
              </div>
            </li>
          ))}
        </ol>
      </Section>

      <Section id="auth" title={d.auth}>
        <p className="text-sm leading-relaxed text-muted-foreground">{d.authIntro}</p>
        <dl className="flex flex-col divide-y rounded-xl border">
          {(Object.keys(scopeTones) as TokenScope[]).map((s) => (
            <div key={s} className="flex items-center gap-3 px-4 py-3">
              <dt className="w-12 shrink-0">
                <ScopeBadge scope={s} />
              </dt>
              <dd className="text-sm">
                {t.tokens.scopes[s].hint}
                {s === 'admin' && <span className="text-muted-foreground">{d.adminOnly}</span>}
              </dd>
            </div>
          ))}
        </dl>
        <Notes items={d.authNotes} />
      </Section>

      <Section id="ingest" title={d.ingest}>
        <p className="text-sm leading-relaxed text-muted-foreground">{prose(d.ingestIntro)}</p>
        <Notes items={d.ingestNotes} />
        <CodeBlock
          title="Shell"
          code={`export MEMEDB_TOKEN=mdb_…   # ${sample.tokenComment}

for f in ./memes/*; do
  curl -sS -H "Authorization: Bearer $MEMEDB_TOKEN" \\
    -F "file=@$f" -F "path=${sample.folder}" \\
    ${api}/library/upload
  echo
done`}
        />
        <CodeBlock
          title="Python"
          code={`import os, pathlib, requests

API = "${api}"
s = requests.Session()
s.headers["Authorization"] = f"Bearer {os.environ['MEMEDB_TOKEN']}"

# ${sample.pythonComment}
root = pathlib.Path("memes")
for path in sorted(p for p in root.rglob("*") if p.is_file()):
    folder = "/".join(("${sample.folder}", *path.parent.relative_to(root).parts))
    with path.open("rb") as fp:
        r = s.post(f"{API}/library/upload", files={"file": fp}, data={"path": folder})
    r.raise_for_status()
    entry = r.json()
    print("${sample.added}" if r.status_code == 201 else "${sample.exists}", entry["name"], entry["meme"]["status"])`}
        />
        <CodeBlock
          title={sample.responseTitle}
          code={`HTTP/1.1 201 Created

{
  "id": "0199d2c4-…",            // ${sample.idComment}
  "parent_id": "0199d2b0-…",
  "name": "doge.gif",
  "visibility": "private",
  "meme": { "id": "0199d2c3-…", "url": "/api/assets/9f86d081…", "status": "pending", … },
  "created_at": "2026-10-11T08:00:00Z",
  "owner": { "id": "…", "username": "you" },
  "ancestors": [{ "id": "0199d2b0-…", "name": "${sample.folder}" }]
}`}
        />
      </Section>

      <Section id="reference" title={d.reference}>
        {reference.map(({ group, endpoints }) => (
          <div key={group} className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">{d.groups[group]}</h3>
            <ul className="flex flex-col divide-y rounded-xl border bg-card">
              {endpoints.map(([method, path, access]) => (
                <li key={method + path} className="flex flex-col gap-1 px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className={cn('w-14 shrink-0 font-mono text-xs font-semibold', methodTone[method])}>{method}</span>
                    <code className="min-w-0 flex-1 font-mono text-sm wrap-anywhere">/api{path}</code>
                    {access === 'public' ? (
                      <span className="inline-flex h-5 shrink-0 items-center rounded-full border px-2 text-xs text-muted-foreground">{t.status.public}</span>
                    ) : (
                      <ScopeBadge scope={access} />
                    )}
                  </div>
                  <p className="pl-17 text-sm text-muted-foreground">{(d.endpoints as Record<string, string>)[`${method} ${path}`]}</p>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <p className="text-sm text-muted-foreground">{prose(d.adminApi)}</p>
      </Section>

      <Section id="conventions" title={d.conventions}>
        <Notes items={d.conventionNotes} />
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-xl border px-4 py-3 text-sm">
          {Object.entries(d.statuses).map(([code, meaning]) => (
            <div key={code} className="contents">
              <dt className="font-mono font-semibold tabular-nums">{code}</dt>
              <dd className="text-muted-foreground">{meaning}</dd>
            </div>
          ))}
        </dl>
      </Section>
    </div>
  )
}
