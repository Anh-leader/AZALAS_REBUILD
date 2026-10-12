import { useState, type KeyboardEvent } from 'react'

export type OrderImage = { id: string; url: string; original_name?: string | null; content_type?: string | null }

export function OrderImages({ images }: { images: OrderImage[] }) {
  const [lightbox, setLightbox] = useState<number | null>(null)

  if (!images.length) return <div className="order-images"><div className="order-images-title">ẢNH ZALO</div><div className="order-images-empty">Không có ảnh</div></div>

  function close() { setLightbox(null) }
  function onKey(e: KeyboardEvent) {
    if (lightbox === null) return
    if (e.key === 'Escape') close()
    if (e.key === 'ArrowRight') setLightbox(i => (i === null ? i : (i + 1) % images.length))
    if (e.key === 'ArrowLeft') setLightbox(i => (i === null ? i : (i - 1 + images.length) % images.length))
  }

  return <div className="order-images" onKeyDown={onKey}>
    <div className="order-images-title">ẢNH ZALO</div>
    <div className="order-images-grid">
      {images.map((image, index) => <OrderThumb key={image.id} image={image} onClick={() => setLightbox(index)}/>)}
    </div>
    {lightbox !== null && <div className="lightbox" role="dialog" aria-modal="true" onClick={close}>
      <button className="lightbox-close" onClick={close} aria-label="Đóng">×</button>
      <img className="lightbox-img" src={images[lightbox].url} alt={images[lightbox].original_name ?? ''} onClick={e => e.stopPropagation()}/>
      {images.length > 1 && <><button className="lightbox-nav prev" onClick={e => { e.stopPropagation(); setLightbox(i => (i === null ? i : (i - 1 + images.length) % images.length)) }} aria-label="Ảnh trước">‹</button>
      <button className="lightbox-nav next" onClick={e => { e.stopPropagation(); setLightbox(i => (i === null ? i : (i + 1) % images.length)) }} aria-label="Ảnh sau">›</button></>}
    </div>}
  </div>
}

function OrderThumb({ image, onClick }: { image: OrderImage; onClick: () => void }) {
  const [state, setState] = useState<'loading' | 'loaded' | 'error'>('loading')
  return <button type="button" className="order-images-item" onClick={onClick} title={image.original_name ?? 'Ảnh đơn'}>
    {state !== 'error' && <img src={image.url} alt={image.original_name ?? ''} className={state === 'loading' ? 'is-loading' : ''} onLoad={() => setState('loaded')} onError={() => setState('error')}/>}
    {state === 'error' && <span className="order-images-fallback"><i className="bi bi-image"/></span>}
  </button>
}
