import { useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import html2canvas from 'html2canvas'
import { api, ApiError, type CustomerPendingOrders, type InvoiceDraft } from '../api/client'
import { authenticatedMediaFetch, uploadMediaFile } from '../api/media'
import { formatDate, formatMoney } from '../lib/format'
import { useAuthenticatedMedia } from './useAuthenticatedMedia'

const errorMessage = (error: unknown) => error instanceof ApiError ? error.message : 'Không thể kết nối máy chủ.'

type DraftMedia = { url: string; view_url?: string; original_name?: string | null; alt?: string; className?: string }

function DraftMediaImage({ media, onClick }: { media: DraftMedia; onClick?: () => void }) {
  const { source, failed } = useAuthenticatedMedia(media.view_url ?? media.url)
  const [decodeFailed, setDecodeFailed] = useState(false)
  if (failed || decodeFailed) return <span className="media-image-placeholder" aria-label="Ảnh lỗi">Ảnh lỗi</span>
  if (!source) return <span className="media-image-placeholder" aria-label="Đang tải ảnh">Đang tải…</span>
  return <img className={media.className ?? 'invoice-attach-image'} src={source} alt={media.alt ?? media.original_name ?? ''} onClick={onClick} onError={() => setDecodeFailed(true)}/>
}

export function InvoiceGroupPage() {
  const { customerId = '' } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const customerName = (location.state as { customerName?: string } | null)?.customerName ?? ''

  const pending = useQuery({
    queryKey: ['invoice-customer-pending', customerId],
    queryFn: () => api<CustomerPendingOrders>(`/invoices/customers/${customerId}/pending-orders`).then(r => r.data),
  })
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const orders = pending.data?.orders ?? []
  const eligible = orders.filter(order => order.has_active_items !== false)
  const eligibleIds = useMemo(() => new Set(eligible.map(o => o.id)), [orders]) // eslint-disable-line react-hooks/exhaustive-deps

  function toggle(orderId: string) {
    if (!eligibleIds.has(orderId)) return
    setSelectedIds(current => {
      const next = new Set(current)
      if (next.has(orderId)) next.delete(orderId); else next.add(orderId)
      return next
    })
  }

  function selectAll() {
    setSelectedIds(new Set(eligible.map(o => o.id)))
  }

  function clearAll() {
    setSelectedIds(new Set())
  }

  const selectedOrders = eligible.filter(order => selectedIds.has(order.id))
  const selectedTotal = selectedOrders.reduce((sum, order) => sum + (order.total_amount || 0), 0)

  async function createDraft() {
    if (!selectedOrders.length) { setError('Vui lòng chọn ít nhất một đơn hợp lệ.'); return }
    setBusy(true); setError('')
    const orderIds = selectedOrders.map(order => order.id)
    try {
      const created = await api<InvoiceDraft>('/invoices/drafts', {
        method: 'POST',
        body: { customer_id: customerId, order_ids: orderIds },
      })
      navigate(`/invoices/draft/${created.data.id}`)
    } catch (e) {
      if (e instanceof ApiError) {
        // Chỉ log thông tin không nhạy cảm để debug, không log token/secret.
        console.error('[create-invoice-draft]', { status: e.status, code: e.code, order_ids: orderIds })
      }
      setError(errorMessage(e))
    } finally { setBusy(false) }
  }

  return <section className="page invoice-group-page">
    <header className="invoice-page-head">
      <button className="btn-outline" onClick={() => navigate('/invoices?tab=PENDING')}>← Quay lại</button>
      <div><small>HÓA ĐƠN / CHƯA GỬI</small><h1>Gộp hóa đơn theo khách</h1></div>
    </header>
    {pending.isLoading ? <div className="loading">Đang tải…</div> : pending.isError ? <div className="empty">{errorMessage(pending.error)}</div> : <>
      <div className="invoice-group-intro"><b>Khách hàng: {pending.data!.customer.name || customerName}</b><span>{orders.length} đơn đã soạn chưa gửi</span></div>
      <div className="invoice-group-tools">
        <button className="btn-outline" onClick={selectAll}>Tick tất cả</button>
        <button className="btn-outline" onClick={clearAll}>Bỏ tất cả</button>
      </div>
      {error && <div className="pick-error">{error}</div>}
      <div className="invoice-group-orders">
        {orders.map(order => {
          const valid = order.has_active_items !== false
          return <label className={`invoice-order-option ${valid ? '' : 'invalid'}`} key={order.id}>
            <input type="checkbox" checked={selectedIds.has(order.id)} disabled={!valid || busy}
              onChange={() => toggle(order.id)}/>
            <span><b>{order.order_no}</b><small>Kho {order.warehouse.name} · {formatDate(order.created_at ?? order.delivery_date)}</small></span>
            <em className={valid ? 'ready' : 'missing'}>{valid ? formatMoney(order.total_amount) : 'Chưa có chi tiết soạn'}</em>
          </label>
        })}
      </div>
      <div className="invoice-group-summary">
        <span>Tổng của {selectedOrders.length} đơn đã tick</span>
        <b>Tổng tiền: {formatMoney(selectedTotal)}</b>
      </div>
      <button className="btn-main invoice-group-submit" disabled={busy || !selectedOrders.length} onClick={createDraft}>
        {busy ? 'ĐANG TẠO…' : `Lập hóa đơn cho ${selectedOrders.length} đơn`}
      </button>
    </>}
  </section>
}

type EditState = {
  items: Record<string, { quantity: string; unit_price_amount: string }>
  oldDebt: string
  surcharge: string
  note: string
  payments: Array<{ method: string; amount: string; note: string }>
}

export function InvoiceDetailPage() {
  const { draftId = '' } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const previewRef = useRef<HTMLDivElement>(null)

  const draft = useQuery({
    queryKey: ['invoice-draft', draftId],
    queryFn: () => api<InvoiceDraft>(`/invoices/drafts/${draftId}`).then(r => r.data),
  })

  const [edit, setEdit] = useState<EditState | null>(null)
  const [busy, setBusy] = useState(false)
  const [captureBusy, setCaptureBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const data = draft.data
  const allItems = useMemo(() => (data?.orders ?? []).flatMap(order => order.items.map(item => ({ order, item }))), [data])

  function startEdit() {
    if (!data) return
    setError(''); setNotice('')
    setEdit({
      items: Object.fromEntries(allItems.map(({ item }) => [item.id, {
        quantity: String(item.quantity), unit_price_amount: String(item.unit_price_amount),
      }])),
      oldDebt: String(data.old_debt_override ?? data.debt_before_amount),
      surcharge: String(data.surcharge_amount),
      note: data.note ?? '',
      payments: (data.payments ?? []).map(p => ({ method: p.method, amount: String(p.amount), note: p.note ?? '' })),
    })
  }

  function cancelEdit() {
    setEdit(null); setError('')
  }

  async function saveEdit() {
    if (!data || !edit) return
    setBusy(true); setError('')
    try {
      const oldDebtChanged = edit.oldDebt !== String(data.old_debt_override ?? data.debt_before_amount)
      const body: Record<string, unknown> = {
        items: allItems.map(({ order, item }) => ({
          order_id: order.id, item_id: item.id,
          quantity: Number(edit.items[item.id]?.quantity ?? item.quantity),
          unit_price_amount: Math.round(Number(edit.items[item.id]?.unit_price_amount ?? item.unit_price_amount)),
        })),
        surcharge_amount: Number(edit.surcharge || 0),
        note: edit.note || null,
        payments: edit.payments.filter(p => Number(p.amount) > 0).map(p => ({
          method: p.method, amount: Number(p.amount), note: p.note || null,
        })),
      }
      if (oldDebtChanged) body.old_debt_override = edit.oldDebt === '' ? null : Number(edit.oldDebt)
      await api(`/invoices/drafts/${draftId}`, { method: 'PATCH', body })
      setEdit(null)
      await qc.invalidateQueries({ queryKey: ['invoice-draft', draftId] })
    } catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }

  async function captureImage() {
    if (!previewRef.current || !data) return
    setCaptureBusy(true); setError(''); setNotice('')
    try {
      const canvas = await html2canvas(previewRef.current, { scale: 2, useCORS: true, backgroundColor: '#ffffff' })
      const blob: Blob = await new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('Không tạo được ảnh hóa đơn.')), 'image/png'))
      const clipboard = navigator.clipboard
      const clipboardWrite = clipboard && 'write' in clipboard && typeof ClipboardItem !== 'undefined'
        ? clipboard.write([new ClipboardItem({ 'image/png': blob })]).then(() => true).catch(() => false)
        : Promise.resolve(false)
      const imageFile = new File([blob], `hoa-don-${Date.now()}.png`, { type: 'image/png' })
      const uploaded = await uploadMediaFile(imageFile, 'invoices')
      await api(`/invoices/drafts/${draftId}/capture`, { method: 'POST', body: { media_id: uploaded.id } })
      await qc.invalidateQueries({ queryKey: ['invoice-draft', draftId] })
      setNotice(await clipboardWrite
        ? 'Đã chụp và sao chép ảnh hóa đơn vào clipboard.'
        : 'Đã lưu ảnh hóa đơn. Trình duyệt không cho sao chép tự động, vui lòng bấm Sao chép ảnh.')
    } catch (e) { setError(errorMessage(e)) } finally { setCaptureBusy(false) }
  }

  async function copyCapturedImage() {
    if (!data?.captured_image) return
    try {
      const clipboard = navigator.clipboard
      if (!clipboard || !('write' in clipboard) || typeof ClipboardItem === 'undefined') throw new Error('Clipboard API không được hỗ trợ.')
      const response = await authenticatedMediaFetch(data.captured_image.view_url ?? data.captured_image.url)
      const blob = await response.blob()
      await clipboard.write([new ClipboardItem({ [blob.type || 'image/png']: blob })])
      setNotice('Đã sao chép ảnh hóa đơn vào clipboard.')
    } catch {
      setNotice('Không thể sao chép ảnh. Hãy tải ảnh về để sử dụng.')
    }
  }

  async function finalize() {
    if (!data) return
    setBusy(true); setError('')
    try {
      await api<InvoiceDraft>(`/invoices/drafts/${draftId}/finalize`, {
        method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() },
      })
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['invoice-work-queue'] }),
        qc.invalidateQueries({ queryKey: ['invoice-customer-pending'] }),
        qc.invalidateQueries({ queryKey: ['customers'] }),
        qc.invalidateQueries({ queryKey: ['customer-detail'] }),
        qc.invalidateQueries({ queryKey: ['customer-debt'] }),
        qc.invalidateQueries({ queryKey: ['customer-debt-changes-today'] }),
        qc.invalidateQueries({ queryKey: ['overview'] }),
      ])
      navigate('/invoices?tab=SENT')
    } catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }

  if (draft.isLoading) return <div className="loading">Đang tải hóa đơn…</div>
  if (draft.isError) return <div className="page"><div className="empty">{errorMessage(draft.error)}</div>
    <button className="btn-outline" onClick={() => navigate('/invoices?tab=PENDING')}>← Quay lại Hóa đơn</button></div>
  if (!data) return null

  const captureReady = data.capture_status === 'READY'
  const captureStale = data.capture_status === 'STALE'
  const paymentTotal = (data.payments ?? []).reduce((sum, p) => sum + (p.amount || 0), 0)
  const remaining = Math.max(data.amount_due_before_payment - paymentTotal, 0)

  const orderNumbers = data.orders.map(order => order.order_no).join(' · ')
  const hasNotes = data.orders.some(o => o.customer_note)
  const hasImages = data.orders.some(o => (o.images ?? []).length > 0)

  return <section className="page invoice-detail-page">
    <header className="invoice-page-head">
      <button className="btn-outline" onClick={() => navigate('/invoices?tab=PENDING')}>← Quay lại Hóa đơn</button>
      <div><h1>CHI TIẾT HÓA ĐƠN</h1><b>{data.customer?.name}</b></div>
    </header>

    <div className="bill-paper" ref={previewRef}>
      <div className="bill-header">
        <h2>HÓA ĐƠN BÁN HÀNG</h2>
        <div className="bill-code-line">Mã hóa đơn: <span>{orderNumbers}</span></div>
        <div className="bill-order-selector">
          {data.orders.map(order => <span className="bill-order-chip" key={order.id}>{order.order_no}</span>)}
        </div>
      </div>

      <div className="bill-info-row">
        <div className="bill-info-customer">
          <div className="bill-info-label">Khách hàng</div>
          <div className="bill-info-value">{data.customer?.name}</div>
          {data.customer?.phone && <div className="bill-info-sub">{data.customer.phone}</div>}
        </div>
        <div className="bill-info-date">
          <div className="bill-info-label">Ngày lập</div>
          <div className="bill-info-value">{formatDate(data.finalized_at) || formatDate(new Date().toISOString())}</div>
          {data.orders.some(o => o.delivery_date) && <div className="bill-info-sub">Giao: {data.orders.filter(o => o.delivery_date).map(o => formatDate(o.delivery_date)).join(' · ')}</div>}
        </div>
      </div>

      <table className="bill-table">
        <thead><tr><th>SẢN PHẨM</th><th>SL</th><th>GIÁ</th><th>THÀNH TIỀN</th></tr></thead>
        <tbody>
          {allItems.map(({ order, item }) => {
            if (edit) {
              const row = edit.items[item.id]
              return <tr key={item.id}>
                <td><span className="bill-item-order">{order.order_no}</span> {item.name}</td>
                <td><input className="edit-sl" type="number" min="0" step="0.001" value={row?.quantity ?? ''} onChange={e => setEdit(cur => cur ? { ...cur, items: { ...cur.items, [item.id]: { ...cur.items[item.id], quantity: e.target.value } } } : cur)}/></td>
                <td><input className="edit-gia" type="number" min="0" step="1" value={row?.unit_price_amount ?? ''} onChange={e => setEdit(cur => cur ? { ...cur, items: { ...cur.items, [item.id]: { ...cur.items[item.id], unit_price_amount: e.target.value } } } : cur)}/></td>
                <td className="bill-line-total">{formatMoney((Number(row?.quantity ?? 0) || 0) * (Math.round(Number(row?.unit_price_amount ?? 0)) || 0))}</td>
              </tr>
            }
            return <tr key={item.id}><td><span className="bill-item-order">{order.order_no}</span> {item.name}</td><td>{item.quantity}</td><td>{formatMoney(item.unit_price_amount)}</td><td className="bill-line-total">{formatMoney(item.line_total_amount)}</td></tr>
          })}
        </tbody>
      </table>

      <div className="bill-total-row">
        <div className="bill-total-line"><span>TỔNG ĐƠN HÀNG</span><b>{formatMoney(data.subtotal_amount)}</b></div>
        {data.surcharge_amount > 0 && <div className="bill-total-line"><span>CỘNG THÊM</span><b>{formatMoney(data.surcharge_amount)}</b></div>}
        {edit
          ? <div className="bill-total-line bill-total-edit"><span>NỢ CŨ</span><input className="edit-gia" type="number" value={edit.oldDebt} onChange={e => setEdit({ ...edit, oldDebt: e.target.value })}/></div>
          : <div className="bill-total-line"><span>NỢ CŨ</span><b>{formatMoney(data.debt_before_amount)}</b></div>}
        <div className="bill-total-line bill-total-emphasis"><span>TỔNG NỢ</span><b>{formatMoney(data.debt_after_before_payment)}</b></div>
        <div className="bill-total-line bill-total-final"><span>CÒN LẠI PHẢI THU</span><b>{formatMoney(remaining)}</b></div>
      </div>

      {hasNotes && <div className="bill-notes">
        <div className="bill-section-title">GHI CHÚ TỪNG ĐƠN</div>
        {data.orders.filter(o => o.customer_note).map(o => <div className="bill-note" key={o.id}><b>{o.order_no}:</b><span>{o.customer_note}</span></div>)}
      </div>}

      {hasImages && <div className="bill-attachments">
        <div className="bill-section-title">ẢNH ĐÍNH KÈM TỪ ĐƠN HÀNG</div>
        {data.orders.filter(o => (o.images ?? []).length > 0).map(order => <div className="bill-attachment" key={order.id}>
          <div className="bill-attachment-head">Đơn {order.order_no} · {order.images!.length} ảnh</div>
          <div className="bill-attachment-grid">{order.images!.map(img => <DraftMediaImage key={img.id} media={{ ...img, className: 'bill-attachment-image' }}/>)}</div>
        </div>)}
      </div>}

      <div className="bill-payments">
        <div className="bill-section-title">PHIẾU THU</div>
        {edit
          ? <div className="bill-payments-edit">
              {edit.payments.map((row, index) => <div className="payment-line" key={index}>
                <select className="form-control" value={row.method} onChange={e => setEdit(cur => cur ? { ...cur, payments: cur.payments.map((x, i) => i === index ? { ...x, method: e.target.value } : x) } : cur)}>
                  <option value="CASH">Tiền mặt</option><option value="BANK_TRANSFER">Chuyển khoản</option><option value="OTHER">Khác</option>
                </select>
                <input className="form-control" type="number" min="0" placeholder="Số tiền" value={row.amount} onChange={e => setEdit(cur => cur ? { ...cur, payments: cur.payments.map((x, i) => i === index ? { ...x, amount: e.target.value } : x) } : cur)}/>
                {index > 0 && <button className="line-remove" onClick={() => setEdit(cur => cur ? { ...cur, payments: cur.payments.filter((_, i) => i !== index) } : cur)}>×</button>}
              </div>)}
              <button className="btn-outline" onClick={() => setEdit(cur => cur ? { ...cur, payments: [...cur.payments, { method: 'CASH', amount: '', note: '' }] } : cur)}>+ Thêm</button>
            </div>
          : data.payments?.length
            ? <div className="bill-payments-list">{data.payments.map((p, i) => <div className="bill-payment" key={i}><span>{p.method}</span><span>{formatMoney(p.amount)}</span><small>{p.note}</small></div>)}</div>
            : <p className="muted">Chưa có phiếu thu</p>}
        <div className="bill-payment-foot"><span>Tiền nhận: {formatMoney(paymentTotal)}</span><b>Còn lại: {formatMoney(remaining)}</b></div>
      </div>

      {edit && <div className="bill-edit-extras">
        <div className="field"><label>Cộng thêm / surcharge</label><input className="form-control" type="number" min="0" value={edit.surcharge} onChange={e => setEdit({ ...edit, surcharge: e.target.value })}/></div>
        <div className="field"><label>Ghi chú hóa đơn</label><textarea className="form-control" value={edit.note} onChange={e => setEdit({ ...edit, note: e.target.value })}/></div>
      </div>}
    </div>

    {error && <div className="pick-error">{error}</div>}
    {notice && <div className="pick-success">{notice}</div>}
    {captureStale && <div className="invoice-order-warning" role="status">Ảnh đã chụp không còn hợp lệ vì hóa đơn đã thay đổi. Vui lòng chụp lại.</div>}
    {captureReady && data.captured_image && <div className="invoice-capture-tools">
      <DraftMediaImage media={{ ...data.captured_image, className: 'invoice-capture-preview' }}/>
      <span>✓ Đã chụp hóa đơn</span>
      <button className="btn-outline" onClick={copyCapturedImage}>Sao chép ảnh</button>
    </div>}

    <div className="invoice-form-actions">
      {edit
        ? <><button className="btn-main" disabled={busy} onClick={saveEdit}>{busy ? 'ĐANG LƯU…' : 'Lưu chỉnh sửa'}</button>
            <button className="btn-outline" disabled={busy} onClick={cancelEdit}>Hủy</button></>
        : <><button className="btn-outline" onClick={startEdit}>Sửa đơn</button>
            <button className="btn-capture" disabled={captureBusy} onClick={captureImage}>{captureBusy ? 'ĐANG CHỤP…' : 'CHỤP ẢNH HÓA ĐƠN'}</button>
            <button className="btn-main" disabled={busy || !captureReady} onClick={finalize}>{busy ? 'ĐANG CHỐT…' : 'XÁC NHẬN & CHỐT NỢ'}</button></>}
    </div>
  </section>
}
