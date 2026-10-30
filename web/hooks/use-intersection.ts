'use client'

import { useEffect, type RefObject } from 'react'

type Subscription = { onChange: (entry: IntersectionObserverEntry) => void }
type SharedObserver = {
  root: Element | Document | null
  rootMargin: string
  thresholds: string
  observer: IntersectionObserver
  targets: Map<Element, Set<Subscription>>
}

const observers: SharedObserver[] = []

function observeIntersection(
  target: Element,
  onChange: (entry: IntersectionObserverEntry) => void,
  { root = null, rootMargin = '0px', threshold = 0 }: Pick<IntersectionObserverInit, 'root' | 'rootMargin' | 'threshold'> = {},
): () => void {
  const thresholds = [...new Set(Array.isArray(threshold) ? threshold : [threshold])].sort((a, b) => a - b).join(',') || '0'
  let shared = observers.find((item) => item.root === root && item.rootMargin === rootMargin && item.thresholds === thresholds)
  if (!shared) {
    const targets: SharedObserver['targets'] = new Map()
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        for (const subscription of [...(targets.get(entry.target) ?? [])]) {
          if (!targets.get(entry.target)?.has(subscription)) continue
          try {
            subscription.onChange(entry)
          } catch (error) {
            reportError(error)
          }
        }
      }
    }, { root, rootMargin, threshold })
    shared = { root, rootMargin, thresholds, observer, targets }
    observers.push(shared)
  }

  let subscriptions = shared.targets.get(target)
  if (!subscriptions) shared.targets.set(target, subscriptions = new Set())
  else shared.observer.unobserve(target) // New subscribers need a fresh reading, including pagination sentinels.
  const subscription = { onChange }
  subscriptions.add(subscription)
  shared.observer.observe(target)

  return () => {
    if (!subscriptions.delete(subscription)) return
    if (!subscriptions.size) {
      shared.targets.delete(target)
      shared.observer.unobserve(target)
    }
    if (!shared.targets.size) {
      shared.observer.disconnect()
      observers.splice(observers.indexOf(shared), 1)
    }
  }
}

// A reading's cleanup runs before the next reading and when observation ends.
export function useIntersection<T extends Element>(
  target: RefObject<T | null> | null,
  onChange: (entry: IntersectionObserverEntry) => void | (() => void),
  { root = null, rootMargin = '0px', threshold = 0 }: Pick<IntersectionObserverInit, 'root' | 'rootMargin' | 'threshold'> = {},
) {
  useEffect(() => {
    const el = target?.current
    if (!el) return
    let cleanup: void | (() => void)
    const stop = observeIntersection(el, (entry) => {
      const previous = cleanup
      cleanup = undefined
      if (previous) previous()
      cleanup = onChange(entry)
    }, { root, rootMargin, threshold })
    return () => {
      stop()
      if (cleanup) cleanup()
    }
  }, [target, onChange, root, rootMargin, threshold])
}
