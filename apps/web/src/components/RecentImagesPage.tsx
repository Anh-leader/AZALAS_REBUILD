import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  api,
  STATUS_LABEL,
  type CustomerOrderGalleryGroup,
  type CustomerOrderGalleryOrder,
  type CustomerOrderGalleryStatus,
  type Invoice,
  type OrderDetail,
} from '../api/client'
import { downloadAuthenticatedMedia } from '../api/media'
import { formatDate, formatMoney } from '../lib/format'
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
    queryFn: () => api<OrderDetail>(`/orders/${viewingOrderId}`).then(response => response.data),
  })

  const linkedInvoices = useQuery({
    queryKey: ['order-linked-invoices', orderDetail.data?.customer.id],
    enabled: Boolean(orderDetail.data),
    queryFn: () => api<Invoice[]>('/invoices', { query: { customer_id: orderDetail.data!.customer.id } }).then(response => response.data),
  })
  const linkedInvoice = viewingOrderId ? linkedInvoices.data?.find(invoice => invoice.order_ids.includes(viewingOrderId)) : undefined

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
      {viewingOrderId ? <OrderDetailPanel detail={orderDetail} invoice={linkedInvoice} onBack={() => setViewingOrderId(null)}/> : <div className="kho-anh-lightbox-content" onClick={event => event.stopPropagation()}>
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

function OrderDetailPanel({ detail, invoice, onBack }: {
  detail: { isLoading: boolean; isError: boolean; data?: OrderDetail }
  invoice?: Invoice
  onBack: () => void
}) {
  if (detail.isLoading) {
    return <section className="kho-anh-order-detail kho-anh-order-detail-wide" onClick={event => event.stopPropagation()}>
      <header><h2>Chi tiết đơn</h2><button type="button" className="kho-anh-lightbox-close-inline" onClick={onBack}>Quay lại ảnh</button></header>
      <p>Đang tải đơn…</p>
    </section>
  }
  if (detail.isError) {
    return <section className="kho-anh-order-detail kho-anh-order-detail-wide" onClick={event => event.stopPropagation()}>
      <header><h2>Chi tiết đơn</h2><button type="button" className="kho-anh-lightbox-close-inline" onClick={onBack}>Quay lại ảnh</button></header>
      <p className="error-text">Không tải được chi tiết đơn. Vui lòng thử lại.</p>
    </section>
  }
  if (!detail.data) return null

  const { order, customer, warehouse, items } = detail.data
  const totalQty = items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0)
  const totalAmount = items.reduce((sum, item) => sum + (Number(item.line_total_amount) || 0), 0)
  const hasItems = items.length > 0

  return <section className="kho-anh-order-detail kho-anh-order-detail-wide" onClick={event => event.stopPropagation()}>
    <header>
      <h2>Chi tiết đơn</h2>
      <div className="kho-anh-order-detail-actions">
        <button type="button" className="kho-anh-lightbox-close-inline" onClick={onBack}>Quay lại ảnh</button>
      </div>
    </header>

    <div className="kho-anh-order-summary-grid">
      <div className="kho-anh-order-summary-item"><span>Mã đơn</span><b>{order.order_no}</b></div>
      <div className="kho-anh-order-summary-item"><span>Khách hàng</span><b>{customer.name}</b></div>
      <div className="kho-anh-order-summary-item"><span>Kho</span><b>{warehouse.name}</b></div>
      <div className="kho-anh-order-summary-item"><span>Loại đơn</span><b>{order.order_type === 'CUSTOMER_ORDER' ? 'Khách đặt' : 'Thường'}</b></div>
      <div className="kho-anh-order-summary-item"><span>Ngày tạo</span><b>{formatDate(order.created_date) || order.created_date}</b></div>
      <div className="kho-anh-order-summary-item"><span>Ngày giao</span><b>{order.delivery_date ? formatDate(order.delivery_date) : 'Chưa có'}</b></div>
      <div className="kho-anh-order-summary-item"><span>Trạng thái</span><b>{STATUS_LABEL[order.status] ?? order.status}</b></div>
      <div className="kho-anh-order-summary-item"><span>Người soạn</span><b>{order.claimed_by_name || '—'}</b></div>
    </div>

    {(order.customer_note || order.staff_note) && <div className="kho-anh-order-notes">
      {order.customer_note && <div className="kho-anh-order-note"><span>Ghi chú khách</span><p>{order.customer_note}</p></div>}
      {order.staff_note && <div className="kho-anh-order-note"><span>Ghi chú soạn</span><p>{order.staff_note}</p></div>}
    </div>}

    {invoice && <div className="kho-anh-order-invoice">
      <div className="kho-anh-order-section-title">Hóa đơn liên quan</div>
      <div className="kho-anh-order-invoice-head"><b>{invoice.invoice_no}</b><span className="type-badge">{invoice.status}</span></div>
      <div className="kho-anh-order-invoice-grid">
        <div><span>Tổng đơn hàng</span><b>{formatMoney(invoice.subtotal_amount)}</b></div>
        <div><span>Nợ cũ</span><b>{formatMoney(invoice.debt_before_amount)}</b></div>
        <div><span>Tổng nợ</span><b>{formatMoney(invoice.debt_after_amount)}</b></div>
        <div><span>Còn lại phải thu</span><b>{formatMoney(invoice.balance_amount)}</b></div>
      </div>
    </div>}

    <div className="kho-anh-order-section-title">Danh sách sản phẩm</div>
    {hasItems ? <div className="kho-anh-order-table-wrap">
      <table className="kho-anh-order-table">
        <thead><tr><th>STT</th><th>Sản phẩm</th><th>Màu / size</th><th>SL</th><th>Đơn giá</th><th>Thành tiền</th></tr></thead>
        <tbody>{items.map((item, index) => <tr key={item.id ?? index}>
          <td>{index + 1}</td>
          <td><b>{item.product_name}</b>{item.sales_code && <small> · {item.sales_code}</small>}{item.internal_code && <small> · {item.internal_code}</small>}{item.note && <small className="kho-anh-order-line-note"> · {item.note}</small>}</td>
          <td>{item.color || '—'} / {item.size || '—'}</td>
          <td>{item.quantity}</td>
          <td>{formatMoney(item.unit_price_amount)}</td>
          <td className="kho-anh-order-line-total">{formatMoney(item.line_total_amount ?? (Number(item.quantity) * item.unit_price_amount))}</td>
        </tr>)}</tbody>
        <tfoot><tr><td colSpan={3}>Tổng cộng</td><td>{totalQty}</td><td/><td className="kho-anh-order-line-total">{formatMoney(totalAmount)}</td></tr></tfoot>
      </table>
    </div> : <p className="muted">Đơn này hiện chưa có chi tiết sản phẩm.</p>}

    {order.images.length > 0 && <div className="kho-anh-order-section-title">Ảnh liên quan ({order.images.length})</div>}
    {order.images.length > 0 && <div className="kho-anh-order-images">{order.images.map(img => <LazyImage key={img.id} src={img.view_url ?? img.url} alt={img.original_name || 'Ảnh đơn hàng'}/>)}</div>}
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
