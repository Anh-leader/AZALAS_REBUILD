import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api, ApiError, type Invoice, type InvoiceWorkQueue } from '../api/client'
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

export function InvoicePage({ go }: { go: (page: 'dashboard') => void }) {
  const qc = useQueryClient()
  const [searchParams] = useSearchParams()
  const [tab, setTab] = useState<Tab>(() => (searchParams.get('tab') as Tab | null) ?? 'PENDING')
  const [q, setQ] = useState('')
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
      <InvoiceList tab={tab} data={queue.data!} onChanged={() => {
        qc.invalidateQueries({ queryKey: ['invoice-work-queue'] }); qc.invalidateQueries({ queryKey: ['customers'] }); qc.invalidateQueries({ queryKey: ['overview'] })
      }}/>}
  </section>
}

function InvoiceList({ tab, data, onChanged }: { tab: Tab; data: InvoiceWorkQueue; onChanged: () => void }) {
  if (!data.groups.length) return <div className="empty">{tab === 'DELETED' ? 'Chưa có đơn đã xóa' : tab === 'SENT' ? 'Chưa có hóa đơn đã gửi' : 'Chưa có đơn chờ xử lý'}</div>
  return <div className="invoice-groups">{data.groups.map(group => <InvoiceGroup key={group.customer_id} tab={tab} group={group} onChanged={onChanged}/>)}</div>
}

function InvoiceGroup({ tab, group, onChanged }: { tab: Tab; group: InvoiceWorkQueue['groups'][number]; onChanged: () => void }) {
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
      <button className="btn-outline" disabled={busy} onClick={restore}>Khôi phục</button>
    </div>)}</div>}
    {tab === 'SENT' && <div className="invoice-sent-list">{group.invoices?.map(invoice => <SentInvoice key={invoice.id} invoice={invoice}/>)}</div>}
  </div>
}

function SentInvoice({ invoice }: { invoice: Invoice }) {
  const [error, setError] = useState('')
  const name = invoice.snapshot?.customer?.name ?? 'Khách hàng'
  async function printInvoice() {
    setError('')
    try {
      const response = await fetch(`/api/v1/invoices/${invoice.id}/print`)
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
