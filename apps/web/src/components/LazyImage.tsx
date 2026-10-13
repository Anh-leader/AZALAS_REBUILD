import { useState } from 'react'
import { useAuthenticatedMedia } from './useAuthenticatedMedia'

/** Ảnh lazy-load bằng thuộc tính `loading="lazy"` chuẩn của trình duyệt,
 *  kèm placeholder khi đang tải và fallback khi ảnh lỗi. */
export function LazyImage({ src, alt }: { src: string; alt: string }) {
  const { source, failed } = useAuthenticatedMedia(src)
  const [failedSource, setFailedSource] = useState<string | null>(null)
  const isFailed = failed || failedSource === src
  return <div className="lazyimg">
    {!isFailed && source && <img src={source} alt={alt} loading="lazy" onError={() => setFailedSource(src)}/>}
    {!isFailed && !source && <span className="lazyimg-ph"><i className="bi bi-image"/></span>}
    {isFailed && <span className="lazyimg-fallback"><i className="bi bi-image"/></span>}
  </div>
}
