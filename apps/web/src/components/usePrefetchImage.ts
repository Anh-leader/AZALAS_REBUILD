import { useEffect, useRef } from 'react'

const MAX_CONCURRENT_PREFETCH = 4
let activePrefetch = 0
const queue: string[] = []

function drain() {
  while (activePrefetch < MAX_CONCURRENT_PREFETCH && queue.length) {
    const url = queue.shift()!
    if (/^https?:\/\//i.test(url)) {
      activePrefetch += 1
      const img = new Image()
      img.onload = img.onerror = () => { activePrefetch -= 1; drain() }
      img.src = url
    }
  }
}

/** Preload an absolute image URL in the background (capped concurrency). The
 *  browser caches it, so the later lightbox open is near-instant. */
export function prefetchImage(url: string) {
  if (!/^https?:\/\//i.test(url)) return
  if (!queue.includes(url)) queue.push(url)
  drain()
}

/** Preload `url` once on mount (and again if it changes). */
export function usePrefetchImage(url: string | undefined | null) {
  const last = useRef<string | null>(null)
  useEffect(() => {
    if (url && url !== last.current) {
      last.current = url
      prefetchImage(url)
    }
  }, [url])
}
