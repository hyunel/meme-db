import http from 'node:http'
import https from 'node:https'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import { backendBase } from '@/lib/site'

// These describe one leg of the trip; an Expect header would hold the body back until the API answered it.
const hopByHop = ['host', 'connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'expect']

// Passes browsers' /api requests to the API at run time, streaming bodies both ways at the pace the other side takes
// them: a proxy.ts rewrite would buffer each request body in memory, a next.config rewrite would fix the API's address
// at build time, and fetch would read a request body as fast as it arrives.
function forward(request: Request) {
  const { pathname, search } = new URL(request.url)
  const target = backendBase + pathname + search
  const headers = Object.fromEntries([...request.headers].filter(([name]) => !hopByHop.includes(name)))
  return new Promise<Response>((resolve, reject) => {
    const out = (target.startsWith('https:') ? https : http).request(target, { method: request.method, headers }, (res) => {
      const resHeaders = new Headers()
      for (const [name, value] of Object.entries(res.headers)) {
        if (value !== undefined && !hopByHop.includes(name)) for (const v of [value].flat()) resHeaders.append(name, v)
      }
      const bodyless = request.method === 'HEAD' || [204, 205, 304].includes(res.statusCode!)
      if (bodyless) res.resume()
      const body = bodyless ? null : (Readable.toWeb(res) as ReadableStream)
      resolve(new Response(body, { status: res.statusCode, statusText: res.statusMessage, headers: resHeaders }))
    })
    out.on('error', reject)
    if (request.body) pipeline(Readable.fromWeb(request.body as NodeReadableStream), out).catch(reject)
    else out.end()
  })
}

export { forward as GET, forward as HEAD, forward as POST, forward as PUT, forward as PATCH, forward as DELETE }
