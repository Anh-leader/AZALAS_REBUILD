import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  api,
  type CustomerOrderGalleryGroup,
  type CustomerOrderGalleryOrder,
  type CustomerOrderGalleryStatus,
} from '../api/client'
import { downloadAuthenticatedMedia } from '../api/media'
import { LazyImage } from './LazyImage'
import { useAuthenticatedMedia } from './useAuthenticatedMedia'

type GallerySort = 'created_desc' | 'created_asc'
type GalleryStatusFilter = '' | CustomerOrderGalleryStatus
type GallerySummary = { orders_with_images: number; total_images: number }

const GALLERY_STATUS_LABEL: Record<CustomerOrderGalleryStatus, string> = {
  NOT_PICKED: 'Chưa soạn',
  PICKING: 'Đang soạn',
  PICKED: 'Đã soạn',
  SENT: 'Đã gửi đơn',
  CANCELLED: 'Đã hủy',
}

export function RecentImagesPage({ go }: { go: (page: 'dashboard') => void }) {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [date, setDate] = useState('')
  const [sort, setSort] = useState<GallerySort>('created_desc')
  const [status, setStatus] = useState<GalleryStatusFilter>('')
  const [selectedImage, setSelectedImage] = useState<{ order: CustomerOrderGalleryOrder; index: number } | null>(null)
  const [viewingOrderId, setViewingOrderId] = useState<string | null>(null)
  const [copyNotice, setCopyNotice] = useState('')

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [search])

  const query = useQuery({
    queryKey: ['customer-order-gallery', debouncedSearch, date, sort, status],
    queryFn: async () => {
      const response = await api<CustomerOrderGalleryGroup[]>('/media/customer-order-gallery', {
        query: {
          days: '10',
          limit: '1000',
          q: debouncedSearch || undefined,
          date: date || undefined,
          sort,
          status: status || undefined,
        },
      })
      return {
        groups: response.data,
        summary: response.meta?.summary as GallerySummary,
      }
    },
  })

  const groups = query.data?.groups ?? []
  const hasFilters = Boolean(search.trim() || date || status)
  const orderDetail = useQuery({
    queryKey: ['order-detail', viewingOrderId],
    enabled: Boolean(viewingOrderId),
    queryFn: () => api<{
      order: { order_no: string; status: string; created_date: string; delivery_date: string | null; customer_note: string | null }
      customer: { name: string }
      warehouse: { name: string }
    }>(`/orders/${viewingOrderId}`).then(response => response.data),
  })

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setSelectedImage(null)
        setViewingOrderId(null)
      } else if (selectedImage && !viewingOrderId && event.key === 'ArrowRight') {
        setSelectedImage({ order: selectedImage.order, index: (selectedImage.index + 1) % selectedImage.order.images.length })
      } else if (selectedImage && !viewingOrderId && event.key === 'ArrowLeft') {
        setSelectedImage({ order: selectedImage.order, index: (selectedImage.index - 1 + selectedImage.order.images.length) % selectedImage.order.images.length })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedImage, viewingOrderId])

  async function copyImageUrl(url: string) {
    try {
      await navigator.clipboard.writeText(new URL(url, window.location.origin).toString())
      setCopyNotice('Đã sao chép link ảnh.')
    } catch {
      setCopyNotice('Không thể sao chép link ảnh trên trình duyệt này.')
    }
  }

  return <section className="kho-anh-page">
    <div className="kho-anh-header">
      <button className="btn-back" onClick={() => go('dashboard')}><i className="bi bi-chevron-left"/>Quay lại</button>
      <button className="kho-anh-refresh" onClick={() => qc.invalidateQueries({ queryKey: ['customer-order-gallery'] })} aria-label="Tải lại"><i className="bi bi-arrow-clockwise"/></button>
    </div>

    <header className="kho-anh-hero">
      <div className="kho-anh-hero-copy">
        <span className="kho-anh-eyebrow">THƯ VIỆN ẢNH</span>
        <h1>Kho ảnh khách đặt</h1>
        <p>Tìm nhanh ảnh theo khách hàng, mã đơn hoặc ngày tạo.</p>
      </div>
      <span className="kho-anh-hero-icon" aria-hidden="true"><i className="bi bi-images"/></span>
    </header>

    <section className="kho-anh-library">
      <div className="kho-anh-library-heading">
        <div>
          <span className="kho-anh-eyebrow">KHO ẢNH</span>
          <h2>Ảnh đơn khách đặt</h2>
          <p>Ảnh được nhóm theo ngày, mới nhất hiển thị trước.</p>
        </div>
        <div className="kho-anh-summary">
          <SummaryCard label="ĐƠN CÓ ẢNH" value={query.isLoading ? null : query.data?.summary.orders_with_images ?? 0} icon="bi-bag-check"/>
          <SummaryCard label="TỔNG ẢNH" value={query.isLoading ? null : query.data?.summary.total_images ?? 0} icon="bi-image"/>
        </div>
      </div>

      <div className="kho-anh-tools">
        <label className="kho-anh-search">
          <i className="bi bi-search" aria-hidden="true"/>
          <input
            type="search"
            className="form-control"
            placeholder="Tìm tên khách, mã đơn hoặc ghi chú..."
            value={search}
            onChange={event => setSearch(event.target.value)}
            aria-label="Tìm ảnh đơn khách đặt"
          />
          {search && <button type="button" onClick={() => setSearch('')} aria-label="Xóa nội dung tìm kiếm">×</button>}
        </label>
        <label className="kho-anh-filter">
          <span>Ngày tạo</span>
          <input type="date" className="form-control" value={date} onChange={event => setDate(event.target.value)} aria-label="Lọc theo ngày tạo"/>
        </label>
        <label className="kho-anh-filter">
          <span>Trạng thái đơn</span>
          <select className="form-control" value={status} onChange={event => setStatus(event.target.value as GalleryStatusFilter)} aria-label="Lọc trạng thái đơn">
            <option value="">Tất cả trạng thái</option>
            {(Object.entries(GALLERY_STATUS_LABEL) as [CustomerOrderGalleryStatus, string][]).map(([value, label]) =>
              <option value={value} key={value}>{label}</option>)}
          </select>
        </label>
        <label className="kho-anh-filter">
          <span>Sắp xếp</span>
          <select className="form-control" value={sort} onChange={event => setSort(event.target.value as GallerySort)} aria-label="Sắp xếp đơn">
            <option value="created_desc">Gần nhất trước</option>
            <option value="created_asc">Xa nhất trước</option>
          </select>
        </label>
      </div>

      {query.isLoading && <GallerySkeleton/>}
      {query.isError && <div className="kho-anh-state">
        <p>Không thể tải kho ảnh.</p>
        <button className="btn-outline" onClick={() => query.refetch()}>Thử lại</button>
      </div>}
      {query.isSuccess && !groups.length && <div className="kho-anh-state">
        <p>{hasFilters ? 'Không tìm thấy ảnh phù hợp.' : 'Chưa có ảnh đơn khách đặt.'}</p>
      </div>}

      {query.isSuccess && groups.map(group => <section className="kho-anh-group" key={group.date_iso}>
        <h3 className="kho-anh-date"><i className="bi bi-calendar3"/> {group.date}</h3>
        <div className="kho-anh-order-grid">
          {group.orders.map(order => <OrderCard order={order} key={order.group_id} onImageClick={(index) => {
            setCopyNotice('')
            setViewingOrderId(null)
            setSelectedImage({ order, index })
          }}/>)}
        </div>
      </section>)}
    </section>
    {selectedImage && <div className="kho-anh-lightbox" role="dialog" aria-modal="true" aria-label="Xem ảnh đơn hàng" onClick={() => { setSelectedImage(null); setViewingOrderId(null) }}>
      <button type="button" className="kho-anh-lightbox-close" aria-label="Đóng" onClick={() => { setSelectedImage(null); setViewingOrderId(null) }}>×</button>
      {viewingOrderId ? <section className="kho-anh-order-detail" onClick={event => event.stopPropagation()}>
        <header><h2>Chi tiết đơn</h2><button type="button" className="kho-anh-lightbox-close-inline" onClick={() => setViewingOrderId(null)}>Quay lại ảnh</button></header>
        {orderDetail.isLoading ? <p>Đang tải đơn…</p> : orderDetail.isError ? <p className="error-text">Không thể tải chi tiết đơn.</p> : orderDetail.data && <>
          <dl>
            <div><dt>Mã đơn</dt><dd>{orderDetail.data.order.order_no}</dd></div>
            <div><dt>Khách hàng</dt><dd>{orderDetail.data.customer.name}</dd></div>
            <div><dt>Kho</dt><dd>{orderDetail.data.warehouse.name}</dd></div>
            <div><dt>Ngày tạo</dt><dd>{orderDetail.data.order.created_date}</dd></div>
            <div><dt>Ngày giao</dt><dd>{orderDetail.data.order.delivery_date || 'Chưa có'}</dd></div>
            <div><dt>Trạng thái</dt><dd>{GALLERY_STATUS_LABEL[selectedImage.order.status]}</dd></div>
            {orderDetail.data.order.customer_note && <div><dt>Ghi chú</dt><dd>{orderDetail.data.order.customer_note}</dd></div>}
          </dl>
        </>}
      </section> : <div className="kho-anh-lightbox-content" onClick={event => event.stopPropagation()}>
        {selectedImage.order.images.length > 1 && <button type="button" className="lightbox-nav prev" aria-label="Ảnh trước" onClick={() => setSelectedImage({ order: selectedImage.order, index: (selectedImage.index - 1 + selectedImage.order.images.length) % selectedImage.order.images.length })}>‹</button>}
        <div className="kho-anh-lightbox-photo">
          <GalleryLargeImage src={selectedImage.order.images[selectedImage.index].view_url ?? selectedImage.order.images[selectedImage.index].url} alt={selectedImage.order.images[selectedImage.index].original_name || 'Ảnh đơn hàng'}/>
          <span>{selectedImage.index + 1}/{selectedImage.order.images.length}</span>
        </div>
        {selectedImage.order.images.length > 1 && <button type="button" className="lightbox-nav next" aria-label="Ảnh sau" onClick={() => setSelectedImage({ order: selectedImage.order, index: (selectedImage.index + 1) % selectedImage.order.images.length })}>›</button>}
        <aside className="kho-anh-lightbox-info">
          <strong>{selectedImage.order.customer_name}</strong>
          <span>{selectedImage.order.order_no}</span>
          <span>{selectedImage.order.created_at ? new Date(selectedImage.order.created_at).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : selectedImage.order.order_date.split('-').reverse().join('/')}</span>
          <button type="button" className="btn-main" onClick={() => setViewingOrderId(selectedImage.order.order_id)}>Xem đơn</button>
          <button type="button" className="btn-outline" onClick={() => void downloadAuthenticatedMedia(
            selectedImage.order.images[selectedImage.index].view_url ?? selectedImage.order.images[selectedImage.index].url,
            selectedImage.order.images[selectedImage.index].original_name || 'anh-don-hang',
          ).catch(() => setCopyNotice('Không thể tải ảnh.'))}>Tải ảnh</button>
          <button type="button" className="btn-outline" onClick={() => void copyImageUrl(selectedImage.order.images[selectedImage.index].view_url ?? selectedImage.order.images[selectedImage.index].url)}>Sao chép link ảnh</button>
          {copyNotice && <small role="status">{copyNotice}</small>}
        </aside>
      </div>}
    </div>}
  </section>
}

function SummaryCard({ label, value, icon }: { label: string; value: number | null; icon: string }) {
  return <article className="card kho-anh-summary-card">
    <span className="kho-anh-summary-icon"><i className={`bi ${icon}`}/></span>
    <span><small>{label}</small><strong>{value === null ? <i/> : value.toLocaleString('vi-VN')}</strong></span>
  </article>
}

function OrderCard({ order, onImageClick }: { order: CustomerOrderGalleryOrder; onImageClick: (index: number) => void }) {
  const uploaders = [...new Set(order.images.map(image => image.uploaded_by_name).filter((name): name is string => Boolean(name)))]
  const createdBy = order.created_by_names.join(', ')
  const createdLabel = order.created_at
    ? new Date(order.created_at).toLocaleString('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })
    : order.order_date.split('-').reverse().join('/')

  return <article className="card kho-anh-order-card">
    <header className="kho-anh-order-heading">
      <div className="kho-anh-order-customer">
        <strong>{order.customer_name}</strong>
        <small>{order.customer_code}</small>
      </div>
      <span className={`kho-anh-status kho-anh-status-${order.status.toLowerCase().replace('_', '-')}`}>
        {GALLERY_STATUS_LABEL[order.status]}
      </span>
    </header>
    <div className="kho-anh-order-meta">
      <strong>{order.order_no}</strong>
      <span>{createdLabel} · {order.image_count} ảnh</span>
    </div>
    {createdBy && <p className="kho-anh-byline"><i className="bi bi-person"/> Người tạo: {createdBy}</p>}
    {uploaders.length > 0 && <p className="kho-anh-byline"><i className="bi bi-cloud-upload"/> Người tải ảnh: {uploaders.join(', ')}</p>}
    {order.note && <p className="kho-anh-note">{order.note}</p>}
    <div className="kho-anh-thumbnails" aria-label={`${order.image_count} ảnh của đơn ${order.order_no}`}>
      {order.images.slice(0, 4).map((image, index) => <button type="button" className="kho-anh-thumb" key={image.id} aria-label={`Xem ảnh ${index + 1} của đơn ${order.order_no}`} onClick={() => onImageClick(index)}>
        <LazyImage src={image.view_url ?? image.url} alt={image.original_name || `Ảnh ${index + 1} của ${order.customer_name}`}/>
        {index === 3 && order.image_count > 4 && <span className="kho-anh-more">+{order.image_count - 3}</span>}
      </button>)}
    </div>
  </article>
}

function GalleryLargeImage({ src, alt }: { src: string; alt: string }) {
  const { source, failed } = useAuthenticatedMedia(src)
  const [decodeFailed, setDecodeFailed] = useState(false)
  useEffect(() => setDecodeFailed(false), [src])
  if (failed || decodeFailed) return <div className="kho-anh-lightbox-fallback">Ảnh lỗi</div>
  if (!source) return <div className="kho-anh-lightbox-fallback">Đang tải ảnh…</div>
  return <img src={source} alt={alt} onError={() => setDecodeFailed(true)}/>
}

function GallerySkeleton() {
  return <>
    <div className="kho-anh-skeleton-summary">
      <div className="card kho-anh-skeleton-block"/><div className="card kho-anh-skeleton-block"/>
    </div>
    <div className="kho-anh-order-grid">
      {Array.from({ length: 6 }, (_, index) => <div className="card kho-anh-skeleton-order" key={index}>
        <span/><span/><div><i/><i/><i/><i/></div>
      </div>)}
    </div>
  </>
}
