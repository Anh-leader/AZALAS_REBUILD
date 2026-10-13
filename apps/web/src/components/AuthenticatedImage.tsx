import { useState } from 'react'
import type { ReactNode } from 'react'
import { useAuthenticatedMedia } from './useAuthenticatedMedia'

export function AuthenticatedImage({
  src,
  alt,
  className,
  fallback,
  onClick,
  loading,
}: {
  src: string
  alt: string
  className?: string
  fallback?: ReactNode
  onClick?: () => void
  loading?: 'eager' | 'lazy'
}) {
  const { source, failed } = useAuthenticatedMedia(src)
  const [failedSource, setFailedSource] = useState<string | null>(null)
  const decodeFailed = failedSource === src
  if (failed || decodeFailed || !source) {
    return <>{fallback ?? <span className="media-image-fallback" aria-label={failed || decodeFailed ? 'Ảnh lỗi' : 'Đang tải ảnh'}>
      <i className="bi bi-image"/>
    </span>}</>
  }
  return <img src={source} alt={alt} className={className} loading={loading} onClick={onClick} onError={() => setFailedSource(src)}/>
}
