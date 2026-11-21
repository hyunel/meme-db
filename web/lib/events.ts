'use client'

import { api } from './api'

type Target = { meme_id: string; folder_id?: never } | { folder_id: string; meme_id?: never }
type Event = Target & (
  | { kind: 'view'; share?: string }
  | { kind: 'use'; source: string; at: string }
)

const batchSize = 100
const flushDelayMs = 1000
let pending: Event[] = []
let timer: ReturnType<typeof setTimeout> | undefined

function flush() {
  clearTimeout(timer)
  timer = undefined
  if (!pending.length) return

  const events = pending
  pending = []
  void api('/events', {
    method: 'POST',
    json: { events },
    keepalive: true,
  }).catch(() => {})
}

export function reportEvent(event: Event) {
  pending.push(event)
  if (pending.length >= batchSize) flush()
  else timer ??= setTimeout(flush, flushDelayMs)
}

if (typeof window !== 'undefined') window.addEventListener('pagehide', flush)
