import { useState } from 'react'

/** Ảnh lazy-load bằng thuộc tính `loading="lazy"` chuẩn của trình duyệt,
 *  kèm placeholder khi đang tải và fallback khi ảnh lỗi. */
export function LazyImage({ src, alt }: { src: string; alt: string }) {
  const [state, setState] = useState<'loading' | 'loaded' | 'error'>('loading')
  return <div className="lazyimg">
    {state !== 'error' && <img src={src} alt={alt} loading="lazy"
      className={state === 'loading' ? 'is-loading' : ''}
      onLoad={() => setState('loaded')} onError={() => setState('error')}/>}
    {state === 'loading' && <span className="lazyimg-ph"><i className="bi bi-image"/></span>}
    {state === 'error' && <span className="lazyimg-fallback"><i className="bi bi-image"/></span>}
  </div>
}
