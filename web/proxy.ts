import { NextResponse, type NextRequest } from 'next/server'
import { backendBase } from '@/lib/site'

// Passes browsers' /api requests to the API at run time; a next.config rewrite would fix its address at build time.
// Request bodies are buffered on the way, up to experimental.proxyClientMaxBodySize (10 MB by default).
export function proxy(request: NextRequest) {
  return NextResponse.rewrite(new URL(backendBase + request.nextUrl.pathname + request.nextUrl.search))
}

export const config = { matcher: '/api/:path*' }
