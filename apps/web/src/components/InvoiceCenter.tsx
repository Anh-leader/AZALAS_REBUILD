import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import html2canvas from 'html2canvas'
import { api, ApiError, type Invoice, type InvoiceCapture, type InvoicePreview, type InvoiceWorkQueue, type Order } from '../api/client'
import { authenticatedMediaFetch, openAuthenticatedMedia, uploadMediaFile } from '../api/media'
import { formatDate, formatMoney } from '../lib/format'
import { partitionSelectedInvoiceOrders } from './invoiceSelection'
import { useAuthenticatedMedia } from './useAuthenticatedMedia'

type Tab = 'PENDING' | 'SENT' | 'DELETED'
type PayLine = { key: string; method: 'CASH' | 'BANK_TRANSFER' | 'OTHER'; amount: string; note: string }

const errorMessage = (error: unknown) => error instanceof ApiError ? error.message : 'Không thể kết nối máy chủ.'

const TABS: Array<[Tab, string, string, string]> = [
  ['PENDING', 'Chưa gửi đơn', 'Đơn đang chờ xử lý', 'bi-envelope-exclamation'],
  ['SENT', 'Đã gửi đơn', 'Đơn đã bàn giao', 'bi-send-check'],
  ['DELETED', 'Đơn đã xóa', 'Khôi phục hoặc xóa hẳn', 'bi-trash'],
]

export function InvoicePage({ go }: { go: (page: 'dashboard') => void }) {
  const qc = useQueryClient()
  const [tab, setTab] = useState<Tab>('PENDING')
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
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function restore() {
    setBusy(true); setError('')
    try {
      await api('/invoices/orders/restore', { method: 'POST', body: { order_ids: (group.orders ?? []).map(o => o.id) } })
      await qc.invalidateQueries({ queryKey: ['invoice-work-queue'] }); onChanged()
    } catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }

  return <div className="invoice-group">
    <button className="invoice-group-head" onClick={() => tab === 'PENDING' && setOpen(o => !o)}>
      <span className="invoice-group-name"><i className="bi bi-person-circle"/><b>{group.customer_name}</b></span>
      <span className="invoice-group-count">{tab === 'SENT' ? `${group.invoices?.length ?? 0} HĐ` : `${group.orders?.length ?? 0} đơn`}</span>
      <i className={`bi bi-chevron-${open ? 'up' : 'down'}`}/>
    </button>
    {error && <div className="error-text">{error}</div>}
    {tab === 'DELETED' && <div className="invoice-deleted-list">{group.orders?.map(order => <div key={order.id} className="invoice-deleted-row">
      <span><b>{order.order_no}</b><small>{order.customer_name}</small></span>
      <button className="btn-outline" disabled={busy} onClick={restore}>Khôi phục</button>
    </div>)}</div>}
    {tab === 'SENT' && <div className="invoice-sent-list">{group.invoices?.map(invoice => <SentInvoice key={invoice.id} invoice={invoice}/>)}</div>}
    {tab === 'PENDING' && open && <InvoiceForm customerId={group.customer_id} orders={group.orders ?? []} onClose={() => setOpen(false)} onChanged={() => { qc.invalidateQueries({ queryKey: ['invoice-work-queue'] }); onChanged() }}/>}
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

function InvoiceForm({ customerId, orders, onClose, onChanged }: {
  customerId: string; orders: Order[]; onClose: () => void; onChanged: () => void
}) {
  const qc = useQueryClient()
  const formRef = useRef<HTMLDivElement>(null)
  const [preview, setPreview] = useState<InvoicePreview | null>(null)
  const [payments, setPayments] = useState<PayLine[]>([{ key: crypto.randomUUID(), method: 'CASH', amount: '', note: '' }])
  const [surcharge, setSurcharge] = useState('0')
  const [note, setNote] = useState('')
  const [selectedIds, setSelectedIds] = useState(() => orders.filter(order => order.has_active_items !== false).map(order => order.id))
  const [captured, setCaptured] = useState<InvoiceCapture | null>(null)
  const [capturedFor, setCapturedFor] = useState('')
  const [captureNotice, setCaptureNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [captureBusy, setCaptureBusy] = useState(false)
  const [error, setError] = useState('')
  const [warning, setWarning] = useState('')
  const selection = partitionSelectedInvoiceOrders(orders, selectedIds)
  const orderIds = selection.eligible.map(order => order.id)
  const captureKey = [...orderIds].sort().join(',')

  useEffect(() => {
    let active = true
    setCaptured(null)
    setCapturedFor('')
    setCaptureNotice('')
    if (!captureKey) return () => { active = false }
    api<InvoiceCapture | null>('/invoices/capture-image', {
      query: { customer_id: customerId, order_ids: captureKey },
    }).then(result => {
      if (!active || !result.data) return
      setCaptured(result.data)
      setCapturedFor(captureKey)
      setCaptureNotice('Đã chụp ảnh hóa đơn trước đó.')
    }).catch(e => {
      if (active) setError(errorMessage(e))
    })
    return () => { active = false }
  }, [captureKey, customerId])

  function toggleOrder(orderId: string) {
    setSelectedIds(current => current.includes(orderId) ? current.filter(id => id !== orderId) : [...current, orderId])
    setPreview(null)
    setCaptured(null)
    setCapturedFor('')
    setCaptureNotice('')
    setError('')
    setWarning('')
  }

  async function loadPreview() {
    setError(''); setWarning(''); setPreview(null)
    if (!selectedIds.length) { setError('Vui lòng chọn ít nhất một đơn để xem hóa đơn.'); return }
    const invalidOrders = selection.missingItems
    const validOrderIds = selection.eligible.map(order => order.id)
    if (!validOrderIds.length) { setError('Các đơn đã chọn chưa có chi tiết soạn.'); return }
    if (invalidOrders.length) {
      setWarning(`Bỏ qua đơn chưa có chi tiết soạn: ${invalidOrders.map(order => order.order_no).join(', ')}.`)
    }
    setBusy(true)
    try {
      const result = await api<InvoicePreview>('/invoices/preview', { method: 'POST', body: { customer_id: customerId, order_ids: validOrderIds, surcharge_amount: Number(surcharge || 0), return_ids: [] } })
      setPreview(result.data)
    } catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }

  async function captureImage() {
    if (!formRef.current || !preview || !orderIds.length) return
    setCaptureBusy(true); setError('')
    try {
      const canvas = await html2canvas(formRef.current, { scale: 2, useCORS: true, backgroundColor: '#ffffff' })
      const blob: Blob = await new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('Không tạo được ảnh hóa đơn.')), 'image/png'))
      const clipboard = navigator.clipboard
      const clipboardWrite = clipboard && 'write' in clipboard && typeof ClipboardItem !== 'undefined'
        ? clipboard.write([new ClipboardItem({ 'image/png': blob })]).then(() => true).catch(() => false)
        : Promise.resolve(false)
      const imageFile = new File([blob], `hoa-don-${Date.now()}.png`, { type: 'image/png' })
      const uploaded = await uploadMediaFile(imageFile, 'invoices')
      const mediaId = uploaded.id
      const cap = await api<InvoiceCapture>('/invoices/capture-image', { method: 'POST', body: { customer_id: customerId, order_ids: orderIds, media_id: mediaId } })
      setCaptured(cap.data)
      setCapturedFor(captureKey)
      setCaptureNotice(await clipboardWrite
        ? 'Đã chụp và sao chép ảnh hóa đơn vào clipboard.'
        : 'Đã lưu ảnh hóa đơn. Trình duyệt không cho sao chép tự động, vui lòng bấm Sao chép ảnh.')
    } catch (e) { setError(errorMessage(e)) } finally { setCaptureBusy(false) }
  }

  async function copyCapturedImage() {
    if (!captured) return
    try {
      const clipboard = navigator.clipboard
      if (!clipboard || !('write' in clipboard) || typeof ClipboardItem === 'undefined') throw new Error('Clipboard API không được hỗ trợ.')
      const response = await authenticatedMediaFetch(captured.view_url ?? captured.url)
      const blob = await response.blob()
      await clipboard.write([new ClipboardItem({ [blob.type || 'image/png']: blob })])
      setCaptureNotice('Đã sao chép ảnh hóa đơn vào clipboard.')
    } catch {
      setCaptureNotice('Không thể sao chép ảnh. Hãy tải ảnh về để sử dụng.')
    }
  }

  async function downloadCapturedImage() {
    if (!captured) return
    try {
      const response = await authenticatedMediaFetch(captured.view_url ?? captured.url)
      const blobUrl = URL.createObjectURL(await response.blob())
      const link = document.createElement('a')
      link.href = blobUrl
      link.download = captured.original_name || `hoa-don-${Date.now()}.png`
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000)
    } catch (e) { setError(errorMessage(e)) }
  }

  async function confirmClose() {
    if (!preview) return
    if (!orderIds.length) { setError('Vui lòng chọn ít nhất một đơn để chốt hóa đơn.'); return }
    if (!captured || capturedFor !== captureKey) { setError('Vui lòng chụp ảnh hóa đơn trước khi xác nhận & chốt nợ.'); return }
    setBusy(true); setError('')
    try {
      await api<Invoice>('/invoices/close', { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: {
        customer_id: customerId, order_ids: orderIds, surcharge_amount: Number(surcharge || 0), return_ids: [],
        payments: payments.filter(row => Number(row.amount) > 0).map(row => ({ method: row.method, amount: Number(row.amount), note: row.note || null })),
        note: note || null, expected_debt_amount: preview.debt_before_amount, captured_media_id: captured.media_id,
      } })
      await qc.invalidateQueries({ queryKey: ['invoice-work-queue'] }); onChanged(); onClose()
    } catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }

  async function deleteOrders() {
    if (!selectedIds.length) { setError('Vui lòng chọn ít nhất một đơn để xóa.'); return }
    setBusy(true); setError('')
    try {
      await api('/invoices/orders/delete', { method: 'POST', body: { order_ids: selectedIds } })
      await qc.invalidateQueries({ queryKey: ['invoice-work-queue'] }); onChanged(); onClose()
    } catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }

  const paymentTotal = payments.reduce((sum, row) => sum + Number(row.amount || 0), 0)
  const previewOrderIds = new Set(preview?.orders.map(order => order.id) ?? [])
  const previewOrders = orders.filter(order => previewOrderIds.has(order.id))
  const allImages = previewOrders.flatMap(o => o.images.map(i => ({ ...i, order_no: o.order_no })))

  return <div className="invoice-form-layer">
    <div className="invoice-form-card">
      <div className="invoice-form-head">
        <button className="btn-back" onClick={onClose}><i className="bi bi-chevron-left"/>Quay lại</button>
        <span className="invoice-form-title">HÓA ĐƠN</span>
        <span style={{ width: 70 }}/>
      </div>
      <div className="invoice-form-body">
        <div className="invoice-order-options">{orders.map(order => {
          const hasItems = order.has_active_items !== false
          return <label className={`invoice-order-option ${hasItems ? '' : 'invalid'}`} key={order.id}>
            <input type="checkbox" checked={selectedIds.includes(order.id)} onChange={() => toggleOrder(order.id)} disabled={busy || captureBusy}/>
            <span><b>{order.order_no}</b><small>{hasItems ? 'Đã soạn' : 'Chưa có chi tiết soạn'}</small></span>
            <em className={hasItems ? 'ready' : 'missing'}>{hasItems ? 'Hợp lệ' : 'Thiếu chi tiết'}</em>
          </label>
        })}</div>
        {error && <div className="pick-error">{error}</div>}
        {warning && <div className="invoice-order-warning" role="status">{warning}</div>}
        <button className="btn-outline" onClick={loadPreview} disabled={busy}>{busy && !preview ? 'ĐANG TẢI…' : 'XEM TRƯỚC HÓA ĐƠN'}</button>
        {preview && <div className="invoice-preview" ref={formRef}>
          <div className="invoice-customer"><b>{preview.customer.name}</b><small>{preview.customer.phone || 'Chưa có SĐT'}{preview.customer.address ? ` · ${preview.customer.address}` : ''}</small></div>
          {allImages.length > 0 && <div className="invoice-attach"><b>Ảnh đính kèm</b><div className="invoice-attach-grid">{allImages.map(img => <InvoiceMediaImage key={img.id} className="invoice-attach-image" url={img.view_url ?? img.url} alt={img.order_no}/>)}</div></div>}
          <table className="invoice-items"><thead><tr><th>SP</th><th>SL</th><th>GIÁ</th><th>TIỀN</th></tr></thead><tbody>
            {preview.orders.flatMap(o => o.items).map((item, i) => <tr key={i}><td>{item.name}</td><td>{item.quantity}</td><td>{formatMoney(item.unit_price_amount)}</td><td>{formatMoney(item.line_total_amount)}</td></tr>)}
          </tbody></table>
          <div className="money-grid">
            <span>Tổng đơn <b>{formatMoney(preview.subtotal_amount)}</b></span>
            <span>Cộng thêm <b>{formatMoney(preview.surcharge_amount)}</b></span>
            <span>Nợ cũ <b>{formatMoney(preview.debt_before_amount)}</b></span>
            <span>Tổng nợ <b>{formatMoney(preview.debt_after_before_payment)}</b></span>
          </div>
          <div className="field"><label>Cộng thêm / surcharge</label><input className="form-control" type="number" min="0" value={surcharge} onChange={e => { setSurcharge(e.target.value); setPreview(null); setCaptured(null); setCapturedFor(''); setCaptureNotice('') }}/></div>
          <div className="invoice-notes"><b>Ghi chú soạn hàng</b>{previewOrders.filter(o => o.customer_note).length ? previewOrders.filter(o => o.customer_note).map(o => <p key={o.id}><small>{o.order_no}:</small> {o.customer_note}</p>) : <p className="muted">Không có ghi chú</p>}</div>
          <div className="field"><label>Ghi chú hóa đơn</label><textarea className="form-control" value={note} onChange={e => { setNote(e.target.value); setCaptured(null); setCapturedFor(''); setCaptureNotice('') }}/></div>
          <h3>Phiếu thu</h3>
          {payments.map((row, index) => <div className="payment-line" key={row.key}>
            <select className="form-control" value={row.method} onChange={e => { setPayments(cur => cur.map(x => x.key === row.key ? { ...x, method: e.target.value as PayLine['method'] } : x)); setCaptured(null); setCapturedFor(''); setCaptureNotice('') }}>
              <option value="CASH">Tiền mặt</option><option value="BANK_TRANSFER">Chuyển khoản</option><option value="OTHER">Khác</option>
            </select>
            <input className="form-control" type="number" min="0" placeholder="Số tiền" value={row.amount} onChange={e => { setPayments(cur => cur.map(x => x.key === row.key ? { ...x, amount: e.target.value } : x)); setCaptured(null); setCapturedFor(''); setCaptureNotice('') }}/>
            {index > 0 && <button className="line-remove" onClick={() => { setPayments(cur => cur.filter(x => x.key !== row.key)); setCaptured(null); setCapturedFor(''); setCaptureNotice('') }}>×</button>}
          </div>)}
          <button className="btn-outline" onClick={() => { setPayments(cur => [...cur, { key: crypto.randomUUID(), method: 'CASH', amount: '', note: '' }]); setCaptured(null); setCapturedFor(''); setCaptureNotice('') }}>+ Thêm</button>
          <div className="invoice-total"><span>Tiền nhận: {formatMoney(paymentTotal)}</span><b>Còn lại: {formatMoney(Math.max(preview.amount_due_before_payment - paymentTotal, 0))}</b></div>
        </div>}
      </div>
    </div>
    <div className="invoice-form-actions">
      <button className="btn-capture" disabled={captureBusy || !preview || !orderIds.length} onClick={captureImage}>
        {captureBusy ? 'ĐANG CHỤP…' : captured && capturedFor === captureKey ? 'Chụp lại ảnh hóa đơn' : 'Chụp ảnh hóa đơn'}
      </button>
      {captured && capturedFor === captureKey && <><InvoiceMediaImage className="invoice-capture-preview" url={captured.view_url ?? captured.url} alt="Ảnh hóa đơn đã chụp"/><div className="invoice-capture-tools"><small>{captureNotice}</small><button className="btn-outline" onClick={copyCapturedImage}>Sao chép ảnh</button><button className="btn-outline" onClick={downloadCapturedImage}>Tải ảnh</button></div></>}
      <button className="btn-danger" disabled={busy || !selectedIds.length} onClick={deleteOrders}>Xóa đơn đã chọn</button>
      <button className="btn-main" disabled={busy || !preview || !orderIds.length || !captured || capturedFor !== captureKey} onClick={confirmClose}>{busy ? 'ĐANG CHỐT…' : 'Xác nhận & chốt nợ'}</button>
    </div>
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
