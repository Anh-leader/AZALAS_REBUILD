import { useEffect, useRef, useState } from 'react'
import { useAuthenticatedMedia } from './useAuthenticatedMedia'

const isAbsolute = (url: string) => /^https?:\/\//i.test(url)

/** Image with an authenticated (relative) URL, fetched + blobbed once.
 *  Falls back to ``fallbackSrc`` (original) when the primary fails. */
function AuthenticatedContent({ src, fallbackSrc, alt, fetchPriority }: {
  src: string
  fallbackSrc?: string
  alt: string
  fetchPriority?: 'high' | 'low' | 'auto'
}) {
  const { source, failed } = useAuthenticatedMedia(src)
  const [activeSrc, setActiveSrc] = useState<string>(src)
  const [usedFallback, setUsedFallback] = useState(false)
  const [decodeFailed, setDecodeFailed] = useState(false)
  useEffect(() => {
    setActiveSrc(src)
    setUsedFallback(false)
    setDecodeFailed(false)
  }, [src, fallbackSrc])
  function onError() {
    if (fallbackSrc && fallbackSrc !== activeSrc && !usedFallback) {
      setUsedFallback(true)
      setActiveSrc(fallbackSrc)
    } else {
      setDecodeFailed(true)
    }
  }
  const isFailed = decodeFailed || (failed && !usedFallback)
  return <>
    {!isFailed && source && <img src={source} alt={alt} loading="lazy" fetchPriority={fetchPriority} onError={onError}/>}
    {!isFailed && !source && <span className="lazyimg-ph"><i className="bi bi-image"/></span>}
    {isFailed && <span className="lazyimg-fallback"><i className="bi bi-image"/></span>}
  </>
}

/** Direct image from a signed/public absolute URL: no auth fetch, no blob, the
 *  browser loads R2/CDN natively and caches it. Falls back to ``fallbackSrc``
 *  (original) when the primary (e.g. missing thumbnail) returns an error. */
function DirectContent({ src, fallbackSrc, alt, fetchPriority }: {
  src: string
  fallbackSrc?: string
  alt: string
  fetchPriority?: 'high' | 'low' | 'auto'
}) {
  const [activeSrc, setActiveSrc] = useState<string>(src)
  const [usedFallback, setUsedFallback] = useState(false)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    setActiveSrc(src)
    setUsedFallback(false)
    setFailed(false)
  }, [src, fallbackSrc])
  function onError() {
    if (fallbackSrc && fallbackSrc !== activeSrc && !usedFallback) {
      setUsedFallback(true)
      setActiveSrc(fallbackSrc)
    } else {
      setFailed(true)
    }
  }
  return <>
    {!failed && <img src={activeSrc} alt={alt} loading="lazy" fetchPriority={fetchPriority} onError={onError}/>}
    {failed && <span className="lazyimg-fallback"><i className="bi bi-image"/></span>}
  </>
}

/** Grid thumbnail. Absolute (signed R2) URLs render directly via `<img>`; only
 *  relative `/api/...` URLs (local dev / legacy) fall back to authenticated
 *  fetch. IntersectionObserver defers work until near the viewport. */
export function LazyImage({ src, fallbackSrc, alt, fetchPriority = 'auto' }: {
  src: string
  fallbackSrc?: string
  alt: string
  fetchPriority?: 'high' | 'low' | 'auto'
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (!('IntersectionObserver' in window)) {
      setVisible(true)
      return
    }
    const observer = new IntersectionObserver(
      entries => {
        if (entries.some(entry => entry.isIntersecting)) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: '300px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return <div ref={ref} className="lazyimg">
    {visible
      ? (isAbsolute(src)
        ? <DirectContent src={src} fallbackSrc={fallbackSrc} alt={alt} fetchPriority={fetchPriority}/>
        : <AuthenticatedContent src={src} fallbackSrc={fallbackSrc} alt={alt} fetchPriority={fetchPriority}/>)
      : <span className="lazyimg-ph"><i className="bi bi-image"/></span>}
  </div>
}
