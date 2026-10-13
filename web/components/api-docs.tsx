'use client'

import Link from 'next/link'
import { Code2, KeyRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CodeBlock } from '@/components/code-block'
import { ScopeBadge, tokenScopes } from '@/components/api-tokens'
import { useOrigin } from '@/hooks/use-origin'
import type { TokenScope } from '@/lib/types'
import { cn } from '@/lib/utils'

type Access = 'public' | Exclude<TokenScope, 'admin'>

const reference: { title: string; endpoints: [method: string, path: string, access: Access, summary: string][] }[] = [
  {
    title: '表情包与搜索',
    endpoints: [
      ['POST', '/search', 'public', '按文字或图片搜索，返回第一页；表单字段 q、image、scope（all 或 mine）、folder_id'],
      ['GET', '/search', 'public', '搜索的下一页：cursor 为上一页的 next，过期后返回 404，可带原参数与 page 重新 POST'],
      ['GET', '/memes', 'public', '热门表情包，可按 tag 筛选；分页，带 cursor 取下一页'],
      ['GET', '/memes/{id}', 'public', '表情包详情与识别状态；share 为私密链接的令牌'],
      ['GET', '/memes/{id}/similar', 'public', '相似表情包，分页同搜索：cursor 为上一页的 next；可带 share'],
      ['GET', '/memes/{id}/folders', 'public', '收录该表情包的文件夹：自己的与公开合集'],
      ['POST', '/memes/{id}/share/views', 'public', '记录一次通过私密链接打开：{ share }'],
      ['GET', '/tags/hot', 'public', '热门标签'],
      ['GET', '/folders', 'public', '公开合集'],
      ['GET', '/folders/{id}', 'public', '合集信息与其中的子文件夹；share 为它或上层文件夹的私密链接令牌'],
      ['GET', '/folders/{id}/entries', 'public', '合集中的条目；分页，带 cursor 取下一页；可带 share'],
      ['POST', '/folders/{id}/share/views', 'public', '记录一次通过私密链接打开：{ share }'],
      ['GET', '/entries/{id}', 'public', '条目：库中的一个文件，含名称、表情包与所在位置；可带 share'],
      ['GET', '/users/{username}', 'public', '用户主页：公开合集与公开表情包数'],
      ['GET', '/users/{username}/memes', 'public', '用户库根目录下的公开表情包；分页，带 cursor 取下一页'],
      ['GET', '/config', 'public', '上传的大小与格式限制'],
      ['GET', '/stats', 'public', '全站已收录的表情包数'],
    ],
  },
  {
    title: '我的库',
    endpoints: [
      ['GET', '/library', 'read', '库根目录，或以 folder_id 指定的文件夹'],
      ['GET', '/library/folders', 'read', '库中全部文件夹（id、parent_id、name），用于选择位置'],
      ['POST', '/library/upload', 'write', '上传文件；表单字段 file、parent_id，path 为放入其下的文件夹路径，如 猫/橘猫，缺少的逐级新建；tag 为我的标签，可重复传多个；管理员可附 vlm_json，即离线生成的识别结果，入库时不再调用 VLM'],
      ['POST', '/library/entries', 'write', '把已有表情包加入库：{ meme_id, parent_id, share }，share 为打开它的私密链接令牌'],
      ['POST', '/library/folders', 'write', '新建文件夹：{ name, parent_id }'],
      ['POST', '/library/folders/{id}/save', 'write', '把他人的合集连同内容复制到库中：{ parent_id, share }，share 为打开它的私密链接令牌'],
      ['PATCH', '/library/nodes/{id}', 'write', '重命名文件或文件夹：{ name }'],
      ['PATCH', '/library/nodes', 'write', '设为公开或私有：{ ids, is_public }'],
      ['POST', '/library/nodes/move', 'write', '移动：{ ids, target_id }，target_id 留空即库根目录'],
      ['POST', '/library/nodes/copy', 'write', '复制：{ ids, target_id }'],
      ['DELETE', '/library/nodes', 'write', '删除：{ ids }'],
    ],
  },
  {
    title: '收藏与标签',
    endpoints: [
      ['GET', '/favorites', 'read', '收藏的合集、表情包数与失效收藏'],
      ['GET', '/favorites/memes', 'read', '收藏的表情包，新收藏在前；分页，带 cursor 取下一页'],
      ['PUT', '/favorites/{meme|folder}/{id}', 'write', '收藏'],
      ['DELETE', '/favorites/{meme|folder}/{id}', 'write', '取消收藏'],
      ['DELETE', '/favorites/stale', 'write', '清理已删除或转为私有的收藏'],
      ['POST', '/memes/{id}/tags', 'write', '添加我的标签：{ name }'],
      ['DELETE', '/memes/{id}/tags/{tagId}', 'write', '移除我的标签'],
      ['POST', '/memes/{id}/retry', 'write', '重新识别处理失败的表情包'],
      ['GET', '/shares', 'read', '我创建的全部私密链接（表情包与文件夹），含打开与保存次数'],
      ['GET', '/memes/{id}/share', 'read', '我为这个表情包创建的私密链接，没有时为 null'],
      ['PUT', '/memes/{id}/share', 'write', '为我的库中的表情包创建私密链接，已有则返回原链接'],
      ['DELETE', '/memes/{id}/share', 'write', '停用私密链接'],
      ['GET', '/folders/{id}/share', 'read', '我为这个文件夹创建的私密链接，没有时为 null'],
      ['PUT', '/folders/{id}/share', 'write', '为我的文件夹创建私密链接，可打开其中全部内容；已有则返回原链接'],
      ['DELETE', '/folders/{id}/share', 'write', '停用私密链接'],
    ],
  },
  {
    title: '账号',
    endpoints: [
      ['GET', '/auth/me', 'read', '当前用户，可用来验证令牌'],
      ['GET', '/auth/me/stats', 'read', '库与收藏的数量'],
    ],
  },
]

const methodTone: Record<string, string> = {
  GET: 'text-info',
  POST: 'text-success',
  PUT: 'text-[oklch(0.5_0.13_70)]',
  PATCH: 'text-[oklch(0.5_0.13_70)]',
  DELETE: 'text-destructive',
}

const statuses = [
  ['400', '参数无效，field 指出出错的字段'],
  ['401', '未携带令牌，或令牌无效、已过期、已撤销'],
  ['403', '权限不足，例如用只读令牌修改内容'],
  ['404', '不存在，或你无权查看'],
  ['409', '同一位置已有同名的项目'],
] as const

function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] wrap-anywhere">{children}</code>
}

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

function Notes({ children }: { children: React.ReactNode }) {
  return <ul className="flex list-disc flex-col gap-2 pl-5 text-sm leading-relaxed text-muted-foreground marker:text-foreground/30">{children}</ul>
}

export function ApiDocs() {
  const origin = useOrigin()
  const api = `${origin}/api`

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-12 px-4 py-8 sm:px-6 sm:py-12">
      <header className="flex flex-col gap-4">
        <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
          <Code2 className="size-4" aria-hidden />
          开发者
        </span>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">MemeDB API</h1>
        <p className="text-pretty text-muted-foreground">
          用个人 API 令牌，在脚本、机器人与自动化流程中搜索、上传与整理表情包。所有接口都位于 <Code>{api}</Code> 下，收发 JSON。
        </p>
        <div className="flex flex-wrap gap-2">
          <Button nativeButton={false} render={<Link href="/settings#api-tokens" />} className="h-11 sm:h-9">
            <KeyRound data-icon="inline-start" />
            管理 API 令牌
          </Button>
          <Button variant="outline" nativeButton={false} render={<a href="#ingest" />} className="h-11 sm:h-9">
            自动入库示例
          </Button>
        </div>
      </header>

      <Section id="start" title="快速开始">
        <ol className="flex flex-col gap-5">
          {[
            {
              text: (
                <>
                  在 <Link href="/settings#api-tokens" className="font-medium underline underline-offset-4">账号设置</Link> 的「API 令牌」中创建令牌，按用途选择权限。令牌只显示一次，请妥善保管。
                </>
              ),
            },
            {
              text: (
                <>
                  在请求头中带上它：<Code>Authorization: Bearer mdb_…</Code>
                </>
              ),
            },
            { text: '验证一下，成功时返回你的账号信息：', code: `curl -H "Authorization: Bearer $MEMEDB_TOKEN" ${api}/auth/me` },
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

      <Section id="auth" title="认证与权限">
        <p className="text-sm leading-relaxed text-muted-foreground">令牌代表你的账号，按创建时选择的权限访问接口，每一级都包含前一级：</p>
        <dl className="flex flex-col divide-y rounded-xl border">
          {(Object.keys(tokenScopes) as TokenScope[]).map((s) => (
            <div key={s} className="flex items-center gap-3 px-4 py-3">
              <dt className="w-12 shrink-0">
                <ScopeBadge scope={s} />
              </dt>
              <dd className="text-sm">
                {tokenScopes[s].hint}
                {s === 'admin' && <span className="text-muted-foreground">，仅管理员可创建</span>}
              </dd>
            </div>
          ))}
        </dl>
        <Notes>
          <li>公开接口无需令牌；带上令牌时，结果还会包含你自己的私有内容。</li>
          <li>修改密码与管理令牌只能在网页登录后进行，令牌无法调用。</li>
          <li>令牌无效、过期或已撤销时返回 401，权限不足时返回 403；账号被禁用后，它的令牌随之失效。</li>
        </Notes>
      </Section>

      <Section id="ingest" title="自动入库">
        <p className="text-sm leading-relaxed text-muted-foreground">
          用读写令牌调用 <Code>POST /api/library/upload</Code>，以 <Code>multipart/form-data</Code> 提交 <Code>file</Code>，以及可选的 <Code>parent_id</Code>（目标文件夹，留空即库根目录）、<Code>path</Code>（放入其下的文件夹路径，如 <Code>猫/橘猫</Code>）与 <Code>tag</Code>（我的标签，可重复传多个）。
        </p>
        <Notes>
          <li>path 中缺少的文件夹会逐级新建，已有的同名文件夹直接沿用；文件夹已有相同文件时返回已有条目（200），不会重复添加，脚本可以放心重跑；新建时返回 201。</li>
          <li>
            上传后表情包进入识别队列，<Code>meme.status</Code> 依次为 pending、processing、success（或 failed），完成后即可被搜到；可轮询 <Code>GET /api/memes/{'{id}'}</Code> 查看进度。
          </li>
          <li>条目以上传的文件名命名，重名时自动追加序号；文件夹 ID 可在网页中打开文件夹后，从地址栏的 folder 参数获得。</li>
          <li>
            管理员（会话或管理权限令牌）可附 <Code>vlm_json</Code>：离线跑 VLM 得到的识别结果（JSON 对象），入库时直接使用、不再调用 VLM；文件已在库中时忽略。
          </li>
        </Notes>
        <CodeBlock
          title="Shell"
          code={`export MEMEDB_TOKEN=mdb_…   # 读写权限的令牌

for f in ./memes/*; do
  curl -sS -H "Authorization: Bearer $MEMEDB_TOKEN" \\
    -F "file=@$f" -F "path=自动入库" \\
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

# 连同子文件夹放入库中的「自动入库」
root = pathlib.Path("memes")
for path in sorted(p for p in root.rglob("*") if p.is_file()):
    folder = "/".join(("自动入库", *path.parent.relative_to(root).parts))
    with path.open("rb") as fp:
        r = s.post(f"{API}/library/upload", files={"file": fp}, data={"path": folder})
    r.raise_for_status()
    entry = r.json()
    print("新增" if r.status_code == 201 else "已存在", entry["name"], entry["meme"]["status"])`}
        />
        <CodeBlock
          title="响应（节选）"
          code={`HTTP/1.1 201 Created

{
  "id": "0199d2c4-…",            // 条目 ID，用于重命名、移动与删除
  "parent_id": "0199d2b0-…",
  "name": "doge.gif",
  "visibility": "private",
  "meme": { "id": "0199d2c3-…", "url": "/api/assets/0199d2c3-…?token=…", "status": "pending", … },
  "created_at": "2026-10-11T08:00:00Z",
  "owner": { "id": "…", "username": "you" },
  "ancestors": [{ "id": "0199d2b0-…", "name": "自动入库" }]
}`}
        />
      </Section>

      <Section id="reference" title="接口一览">
        {reference.map((group) => (
          <div key={group.title} className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">{group.title}</h3>
            <ul className="flex flex-col divide-y rounded-xl border bg-card">
              {group.endpoints.map(([method, path, access, summary]) => (
                <li key={method + path} className="flex flex-col gap-1 px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className={cn('w-14 shrink-0 font-mono text-xs font-semibold', methodTone[method])}>{method}</span>
                    <code className="min-w-0 flex-1 font-mono text-sm wrap-anywhere">/api{path}</code>
                    {access === 'public' ? (
                      <span className="inline-flex h-5 shrink-0 items-center rounded-full border px-2 text-xs text-muted-foreground">公开</span>
                    ) : (
                      <ScopeBadge scope={access} />
                    )}
                  </div>
                  <p className="pl-17 text-sm text-muted-foreground">{summary}</p>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <p className="text-sm text-muted-foreground">
          管理后台的接口位于 <Code>/api/admin/</Code> 下，需要管理权限的令牌。
        </p>
      </Section>

      <Section id="conventions" title="约定">
        <Notes>
          <li>请求体为 JSON；上传与搜索使用 multipart/form-data。ID 均为 UUID，时间为 ISO 8601 字符串。</li>
          <li>表情包的 url 是带签名的相对地址，拼接站点地址即可直接下载，无需令牌。</li>
          <li>列表接口的 limit 最大为 100。</li>
          <li>
            表情包列表（搜索、相似、热门、合集条目、主页与收藏）按页返回 <Code>{'{ "items": [...], "next": "游标" }'}</Code>，把 next 作为 cursor 取下一页，next 为 null 即没有下一页。搜索与相似表情包页内按相关度排序，越往后越不相关。
          </li>
          <li>
            出错时返回如 <Code>{'{ "code": "invalid_request", "error": "name fails the max rule", "field": "name", "params": { "rule": "max" } }'}</Code>：code 是稳定的错误码，请按它判断错误类型；error 为英文说明；field 仅在错误与某个参数有关时出现，params 为说明中提到的值。HTTP 状态码：
          </li>
        </Notes>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-xl border px-4 py-3 text-sm">
          {statuses.map(([code, meaning]) => (
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
