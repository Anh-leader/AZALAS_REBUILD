import { useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api, apiUrl, ApiError, type DeletedOrderDetail, type Invoice, type InvoiceDetail, type InvoiceWorkQueue } from '../api/client'
import { openAuthenticatedMedia } from '../api/media'
import { formatDate, formatMoney } from '../lib/format'
import { useAuthenticatedMedia } from './useAuthenticatedMedia'

type Tab = 'PENDING' | 'SENT' | 'DELETED'

const errorMessage = (error: unknown) => error instanceof ApiError ? error.message : 'Không thể kết nối máy chủ.'

const TABS: Array<[Tab, string, string, string]> = [
  ['PENDING', 'Chưa gửi đơn', 'Đơn đang chờ xử lý', 'bi-envelope-exclamation'],
  ['SENT', 'Đã gửi đơn', 'Đơn đã bàn giao', 'bi-send-check'],
  ['DELETED', 'Đơn đã xóa', 'Khôi phục hoặc xóa hẳn', 'bi-trash'],
]

type Viewing = { kind: 'invoice' | 'deleted-order'; id: string } | null

export function InvoicePage({ go }: { go: (page: 'dashboard') => void }) {
  const qc = useQueryClient()
  const [searchParams] = useSearchParams()
  const [tab, setTab] = useState<Tab>(() => (searchParams.get('tab') as Tab | null) ?? 'PENDING')
  const [q, setQ] = useState('')
  const [viewing, setViewing] = useState<Viewing>(null)
  const queue = useQuery({
    queryKey: ['invoice-work-queue', tab, q],
    queryFn: () => api<InvoiceWorkQueue>('/invoices/work-queue', { query: { status: tab, q } }).then(r => r.data),
  })

  return <section className="invoice-center">
    <div className="kho-anh-header">
      <button className="btn-back" onClick={() => go('dashboard')}><i className="bi bi-chevron-left"/>Quay lại</button>
      <span className="kho-anh-title">HÓA ĐƠN</span>
      <span style={{ width: 70 }}/>
    </div>
    <div className="invoice-hero">
      <div className="invoice-hero-icon"><i className="bi bi-receipt"/></div>
      <div className="invoice-hero-copy">
        <b>Trung tâm hóa đơn</b>
        <small>Theo dõi đơn chưa gửi, đơn đã gửi và khôi phục dữ liệu đã xóa.</small>
      </div>
      <div className="invoice-hero-badges">{TABS.map(([id, label]) => <span key={id} className="chip">{label}</span>)}</div>
    </div>
    <div className="invoice-tabs">{TABS.map(([id, label, sub, icon]) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
      <i className={`bi ${icon}`}/><span><b>{label}</b><small>{sub}</small></span>
    </button>)}</div>
    <input className="form-control search invoice-search" placeholder="Tìm mã đơn hoặc tên khách..." value={q} onChange={e => setQ(e.target.value)}/>
    {queue.isLoading ? <div className="loading">Đang tải…</div> : queue.isError ? <div className="empty">{errorMessage(queue.error)}</div> :
      <InvoiceList tab={tab} data={queue.data!}
        onViewInvoice={id => setViewing({ kind: 'invoice', id })}
        onViewDeletedOrder={id => setViewing({ kind: 'deleted-order', id })}
        onChanged={() => {
          qc.invalidateQueries({ queryKey: ['invoice-work-queue'] }); qc.invalidateQueries({ queryKey: ['customers'] }); qc.invalidateQueries({ queryKey: ['overview'] })
        }}/>}
    {viewing?.kind === 'invoice' && <InvoiceDetailModal invoiceId={viewing.id} onClose={() => setViewing(null)}/>}
    {viewing?.kind === 'deleted-order' && <DeletedOrderDetailModal orderId={viewing.id} onClose={() => setViewing(null)}/>}
  </section>
}

function InvoiceList({ tab, data, onChanged, onViewInvoice, onViewDeletedOrder }: {
  tab: Tab
  data: InvoiceWorkQueue
  onChanged: () => void
  onViewInvoice: (id: string) => void
  onViewDeletedOrder: (id: string) => void
}) {
  if (!data.groups.length) return <div className="empty">{tab === 'DELETED' ? 'Chưa có đơn đã xóa' : tab === 'SENT' ? 'Chưa có hóa đơn đã gửi' : 'Chưa có đơn chờ xử lý'}</div>
  return <div className="invoice-groups">{data.groups.map(group => <InvoiceGroup key={group.customer_id} tab={tab} group={group} onChanged={onChanged} onViewInvoice={onViewInvoice} onViewDeletedOrder={onViewDeletedOrder}/>)}</div>
}

function InvoiceGroup({ tab, group, onChanged, onViewInvoice, onViewDeletedOrder }: {
  tab: Tab
  group: InvoiceWorkQueue['groups'][number]
  onChanged: () => void
  onViewInvoice: (id: string) => void
  onViewDeletedOrder: (id: string) => void
}) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function restore() {
    setBusy(true); setError('')
    try {
      await api('/invoices/orders/restore', { method: 'POST', body: { order_ids: (group.orders ?? []).map(o => o.id) } })
      await qc.invalidateQueries({ queryKey: ['invoice-work-queue'] }); onChanged()
    } catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }

  function openGroup() {
    if (tab !== 'PENDING') return
    navigate(`/invoices/group/${group.customer_id}`, { state: { customerName: group.customer_name } })
  }

  return <div className="invoice-group">
    <button className="invoice-group-head" onClick={openGroup}>
      <span className="invoice-group-name"><i className="bi bi-person-circle"/><b>{group.customer_name}</b></span>
      <span className="invoice-group-count">{tab === 'SENT' ? `${group.invoices?.length ?? 0} HĐ` : `${group.orders?.length ?? 0} đơn`}</span>
      <i className={`bi bi-chevron-${tab === 'PENDING' ? 'right' : 'down'}`}/>
    </button>
    {error && <div className="error-text">{error}</div>}
    {tab === 'DELETED' && <div className="invoice-deleted-list">{group.orders?.map(order => <div key={order.id} className="invoice-deleted-row">
      <span><b>{order.order_no}</b><small>{order.customer_name}</small></span>
      <button className="btn-outline" onClick={() => onViewDeletedOrder(order.id)}>Xem chi tiết</button>
      <button className="btn-outline" disabled={busy} onClick={restore}>Khôi phục</button>
    </div>)}</div>}
    {tab === 'SENT' && <div className="invoice-sent-list">{group.invoices?.map(invoice => <SentInvoice key={invoice.id} invoice={invoice} onView={() => onViewInvoice(invoice.id)}/>)}</div>}
  </div>
}

function SentInvoice({ invoice, onView }: { invoice: Invoice; onView: () => void }) {
  const [error, setError] = useState('')
  const name = invoice.snapshot?.customer?.name ?? 'Khách hàng'
  async function printInvoice() {
    setError('')
    try {
      const response = await fetch(apiUrl(`/api/v1/invoices/${invoice.id}/print`))
      if (!response.ok) throw new Error()
      const blobUrl = URL.createObjectURL(await response.blob()); window.open(blobUrl, '_blank', 'noopener,noreferrer')
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60000)
    } catch { setError('Không mở được bản in hóa đơn.') }
  }
  return <div className="invoice-sent-row">
    <span className="invoice-sent-info"><b>{invoice.invoice_no}</b><small>{name} · {formatDate(invoice.issued_at)}</small></span>
    {invoice.captured_image && <InvoiceMediaImage
      className="invoice-capture-thumb"
      url={invoice.captured_image.view_url ?? invoice.captured_image.url}
      alt="Ảnh hóa đơn"
      onClick={() => void openAuthenticatedMedia(invoice.captured_image!.view_url ?? invoice.captured_image!.url).catch(() => setError('Không mở được ảnh hóa đơn.'))}
    />}
    <strong>{formatMoney(invoice.balance_amount)}</strong>
    <span className="type-badge">{invoice.status}</span>
    <button className="btn-outline" onClick={onView}>Xem</button>
    <button className="btn-outline" onClick={printInvoice}>In</button>
    {error && <span className="error-text">{error}</span>}
  </div>
}

function InvoiceMediaImage({ url, alt, className, onClick }: {
  url: string
  alt: string
  className: string
  onClick?: () => void
}) {
  const { source, failed } = useAuthenticatedMedia(url)
  const [decodeFailed, setDecodeFailed] = useState(false)
  if (failed || decodeFailed) return <span className={`${className} media-image-placeholder`} aria-label="Ảnh lỗi">Ảnh lỗi</span>
  if (!source) return <span className={`${className} media-image-placeholder`} aria-label="Đang tải ảnh">Đang tải…</span>
  return <img className={className} src={source} alt={alt} onClick={onClick} onError={() => setDecodeFailed(true)}/>
}

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return <div className="modal-layer" onClick={onClose}>
    <div className="modal-card wide invoice-detail-modal" onClick={event => event.stopPropagation()}>
      <header className="modal-head">
        <h2>{title}</h2>
        <button type="button" className="modal-close" aria-label="Đóng" onClick={onClose}>×</button>
      </header>
      {children}
    </div>
  </div>
}

function DetailItem({ label, value }: { label: string; value: ReactNode }) {
  return <div className="detail-item"><span>{label}</span><b>{value ?? '—'}</b></div>
}

function InvoiceDetailModal({ invoiceId, onClose }: { invoiceId: string; onClose: () => void }) {
  const detail = useQuery({
    queryKey: ['invoice-detail', invoiceId],
    queryFn: () => api<InvoiceDetail>(`/invoices/${invoiceId}`).then(r => r.data),
    enabled: Boolean(invoiceId),
  })

  return <ModalShell title="Chi tiết hóa đơn" onClose={onClose}>
    <div className="invoice-detail-body">
      {detail.isLoading && <div className="loading">Đang tải…</div>}
      {detail.isError && <p className="error-text">{errorMessage(detail.error)}</p>}
      {detail.data && <InvoiceDetailBody data={detail.data}/>}
    </div>
  </ModalShell>
}

function InvoiceDetailBody({ data }: { data: InvoiceDetail }) {
  const orders = data.orders ?? data.snapshot?.orders ?? []
  const items = data.items ?? orders.flatMap((order: any) => order?.items ?? [])
  const payments = data.payments ?? []
  const customerName = data.customer?.name ?? data.snapshot?.customer?.name ?? 'Khách hàng'

  return <>
    <section className="detail-section">
      <h3><i className="bi bi-person"/> Khách hàng & hóa đơn</h3>
      <div className="detail-grid">
        <DetailItem label="Mã hóa đơn" value={data.invoice_no}/>
        <DetailItem label="Khách hàng" value={customerName}/>
        <DetailItem label="Mã khách" value={data.customer?.customer_code ?? data.snapshot?.customer?.customer_code}/>
        <DetailItem label="Trạng thái" value={data.status}/>
        <DetailItem label="Tổng tiền" value={formatMoney(data.total_amount)}/>
        <DetailItem label="Đã thanh toán" value={formatMoney(data.paid_amount)}/>
        <DetailItem label="Còn lại" value={formatMoney(data.balance_amount)}/>
        <DetailItem label="Ngày phát hành" value={formatDate(data.issued_at)}/>
      </div>
    </section>

    <section className="detail-section">
      <h3><i className="bi bi-box-seam"/> Sản phẩm</h3>
      {items.length
        ? <table className="invoice-items"><thead><tr><th>Đơn</th><th>Sản phẩm</th><th>Màu / size</th><th>SL</th><th>Đơn giá</th><th>Thành tiền</th></tr></thead>
          <tbody>{items.map((item: any, index: number) => <tr key={index}>
            <td>{item.order_no ?? '—'}</td>
            <td><b>{item.name}</b>{item.sales_code && <small> · {item.sales_code}</small>}</td>
            <td>{item.color || '—'} / {item.size || '—'}</td>
            <td>{item.quantity}</td>
            <td>{formatMoney(item.unit_price_amount)}</td>
            <td>{formatMoney(item.line_total_amount ?? (Number(item.quantity) * item.unit_price_amount))}</td>
          </tr>)}</tbody></table>
        : <p className="muted">Không có sản phẩm</p>}
    </section>

    <section className="detail-section">
      <h3><i className="bi bi-cash-stack"/> Thanh toán</h3>
      {payments.length
        ? <table className="invoice-items"><thead><tr><th>Phiếu</th><th>Ngày</th><th>Số tiền</th><th>Đã phân bổ</th><th>Phương thức</th></tr></thead>
          <tbody>{payments.map((payment: any) => <tr key={payment.id}>
            <td>{payment.payment_no}</td>
            <td>{payment.paid_at ? formatDate(payment.paid_at) : '—'}</td>
            <td>{formatMoney(payment.amount)}</td>
            <td>{formatMoney(payment.allocated_amount)}</td>
            <td>{payment.method}</td>
          </tr>)}</tbody></table>
        : <p className="muted">Chưa có thanh toán</p>}
    </section>

    <section className="detail-section">
      <h3><i className="bi bi-link-45deg"/> Đơn liên kết</h3>
      {orders.length
        ? <div className="detail-grid">{orders.map((order: any) => <DetailItem key={order.id} label="Mã đơn" value={order.order_no}/>)}</div>
        : <p className="muted">Không có đơn liên kết</p>}
    </section>

    <section className="detail-section">
      <h3><i className="bi bi-image"/> Ảnh hóa đơn</h3>
      {data.captured_image
        ? <InvoiceMediaImage
            className="detail-invoice-image"
            url={data.captured_image.view_url ?? data.captured_image.url}
            alt="Ảnh hóa đơn"
            onClick={() => void openAuthenticatedMedia(data.captured_image!.view_url ?? data.captured_image!.url)}/>
        : <p className="muted">Chưa có ảnh hóa đơn</p>}
    </section>
  </>
}

function DeletedOrderDetailModal({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const detail = useQuery({
    queryKey: ['deleted-order-detail', orderId],
    queryFn: () => api<DeletedOrderDetail>(`/orders/${orderId}/deleted-detail`).then(r => r.data),
    enabled: Boolean(orderId),
  })

  return <ModalShell title="Chi tiết đơn đã xóa" onClose={onClose}>
    <div className="invoice-detail-body">
      {detail.isLoading && <div className="loading">Đang tải…</div>}
      {detail.isError && <p className="error-text">{errorMessage(detail.error)}</p>}
      {detail.data && <DeletedOrderBody data={detail.data}/>}
    </div>
  </ModalShell>
}

function DeletedOrderBody({ data }: { data: DeletedOrderDetail }) {
  const items = data.items ?? []
  return <>
    <section className="detail-section">
      <h3><i className="bi bi-info-circle"/> Thông tin đơn</h3>
      <div className="detail-grid">
        <DetailItem label="Mã đơn" value={data.order_no}/>
        <DetailItem label="Khách hàng" value={data.customer?.name}/>
        <DetailItem label="Trạng thái trước" value={data.previous_status}/>
        <DetailItem label="Trạng thái hiện tại" value={data.current_status}/>
        <DetailItem label="Ngày tạo" value={formatDate(data.created_at) || formatDate(data.created_date)}/>
        <DetailItem label="Tổng tiền" value={formatMoney(data.total_amount)}/>
        <DetailItem label="Người xóa" value={data.deleted_by?.display_name}/>
        <DetailItem label="Lý do xóa" value={data.delete_reason}/>
      </div>
    </section>

    {data.related_invoice && <section className="detail-section">
      <h3><i className="bi bi-receipt"/> Hóa đơn liên quan</h3>
      <div className="detail-grid">
        <DetailItem label="Mã hóa đơn" value={data.related_invoice.invoice_no}/>
        <DetailItem label="Trạng thái" value={data.related_invoice.status}/>
      </div>
    </section>}

    <section className="detail-section">
      <h3><i className="bi bi-box-seam"/> Sản phẩm</h3>
      {items.length
        ? <table className="invoice-items"><thead><tr><th>Sản phẩm</th><th>Màu / size</th><th>SL</th><th>Đơn giá</th><th>Thành tiền</th></tr></thead>
          <tbody>{items.map(item => <tr key={item.id}>
            <td><b>{item.name}</b>{item.sales_code && <small> · {item.sales_code}</small>}</td>
            <td>{item.color || '—'} / {item.size || '—'}</td>
            <td>{item.quantity}</td>
            <td>{formatMoney(item.unit_price_amount)}</td>
            <td>{formatMoney(item.line_total_amount ?? (Number(item.quantity) * item.unit_price_amount))}</td>
          </tr>)}</tbody></table>
        : <p className="muted">Không có sản phẩm</p>}
    </section>
  </>
}
