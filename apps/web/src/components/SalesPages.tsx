import { useMemo, useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError, STATUS_LABEL, tokenStore, type Customer, type Invoice, type InvoicePreview, type Order, type ProductVariant, type ReturnRecord, type Warehouse } from '../api/client'
import { formatDate, formatMoney } from '../lib/format'

const errorMessage = (error: unknown) => error instanceof ApiError ? error.message : 'Không thể kết nối máy chủ.'

export function ShippingPage() {
  const qc = useQueryClient()
  const [tab, setTab] = useState('WAITING'); const [q, setQ] = useState('')
  const [busy, setBusy] = useState(''); const [error, setError] = useState('')
  const queue = useQuery({ queryKey: ['shipping', tab, q], queryFn: () => api<Order[]>('/shipments/work-queue', { query: { tab, q } }).then(r => r.data) })
  const tabs = [['WAITING', 'Chờ'], ['SHIPPING', 'Đang Vận Chuyển'], ['COMPLETED', 'Hoàn Tất'], ['RETURNED', 'Trả Hàng']]
  async function act(order: Order, event: string) {
    setBusy(order.id); setError('')
    try {
      await api(`/orders/${order.id}/shipping-events`, { method: 'POST', body: { event, version: order.version } })
      await qc.invalidateQueries({ queryKey: ['shipping'] })
      await qc.invalidateQueries({ queryKey: ['overview'] })
    } catch (e) { setError(errorMessage(e)) } finally { setBusy('') }
  }
  return <section className="page sales-page"><h1>Vận chuyển</h1>
    <div className="tabs">{tabs.map(([id, label]) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>)}</div>
    <input className="form-control search" placeholder="Tìm mã đơn hoặc khách hàng…" value={q} onChange={e => setQ(e.target.value)}/>
    {error && <div className="pick-error">{error}</div>}
    {queue.isLoading ? <div className="loading">Đang tải…</div> : queue.error ? <div className="empty">{errorMessage(queue.error)}</div> :
      <div className="shipment-grid">{queue.data?.map(order => <article className="card shipment-card" key={order.id}>
        <header><div><b>{order.customer_name}</b><small>{order.order_no}</small></div><span className="type-badge">{STATUS_LABEL[order.status] ?? order.status}</span></header>
        <p><i className="bi bi-calendar3"/> Giao: {order.delivery_date ? formatDate(order.delivery_date) : 'Chưa hẹn'} · {order.warehouse.name}</p>
        {order.customer_note && <p className="muted">{order.customer_note}</p>}
        {order.status === 'PICKED' && <button className="btn-main" disabled={busy === order.id} onClick={() => act(order, 'START_SHIPPING')}>BẮT ĐẦU GIAO</button>}
        {order.status === 'SHIPPING' && <div className="action-row"><button className="btn-main" disabled={busy === order.id} onClick={() => act(order, 'COMPLETE')}>HOÀN TẤT</button><button className="btn-danger" disabled={busy === order.id} onClick={() => act(order, 'RETURN')}>TRẢ HÀNG</button></div>}
      </article>)}</div>}
  </section>
}

type PayLine = { key: string; method: 'CASH' | 'BANK_TRANSFER' | 'OTHER'; amount: string; note: string }

export function InvoicePage() {
  const qc = useQueryClient()
  const [customerId, setCustomerId] = useState(''); const [selected, setSelected] = useState<string[]>([])
  const [surcharge, setSurcharge] = useState('0'); const [returnIds, setReturnIds] = useState<string[]>([])
  const [preview, setPreview] = useState<InvoicePreview | null>(null)
  const [payments, setPayments] = useState<PayLine[]>([{ key: crypto.randomUUID(), method: 'CASH', amount: '', note: '' }])
  const [note, setNote] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  const eligible = useQuery({ queryKey: ['invoice-eligible'], queryFn: () => api<Order[]>('/invoices/eligible-orders').then(r => r.data) })
  const invoices = useQuery({ queryKey: ['invoices'], queryFn: () => api<Invoice[]>('/invoices').then(r => r.data) })
  const groups = useMemo(() => {
    const result = new Map<string, { name: string; orders: Order[] }>()
    eligible.data?.forEach(order => { const group = result.get(order.customer_id) ?? { name: order.customer_name, orders: [] }; group.orders.push(order); result.set(order.customer_id, group) })
    return [...result.entries()]
  }, [eligible.data])
  function chooseCustomer(id: string) { setCustomerId(id); setSelected([]); setPreview(null); setReturnIds([]); setError('') }
  async function loadPreview() {
    if (!customerId || !selected.length) return setError('Chọn ít nhất một đơn cùng khách hàng.')
    setBusy(true); setError('')
    try {
      const result = await api<InvoicePreview>('/invoices/preview', { method: 'POST', body: { customer_id: customerId, order_ids: selected, surcharge_amount: Number(surcharge || 0), return_ids: returnIds } })
      setPreview(result.data)
    } catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }
  async function closeInvoice() {
    if (!preview) return
    setBusy(true); setError('')
    try {
      await api<Invoice>('/invoices/close', { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: {
        customer_id: customerId, order_ids: selected, surcharge_amount: Number(surcharge || 0), return_ids: returnIds,
        payments: payments.filter(row => Number(row.amount) > 0).map(row => ({ method: row.method, amount: Number(row.amount), note: row.note || null })), note: note || null,
        expected_debt_amount: preview.debt_before_amount,
      } })
      setCustomerId(''); setSelected([]); setPreview(null); setReturnIds([]); setSurcharge('0'); setNote('')
      setPayments([{ key: crypto.randomUUID(), method: 'CASH', amount: '', note: '' }])
      await qc.invalidateQueries({ queryKey: ['invoice-eligible'] }); await qc.invalidateQueries({ queryKey: ['invoices'] }); await qc.invalidateQueries({ queryKey: ['customers'] })
    } catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }
  async function printInvoice(invoice: Invoice) {
    setError('')
    try {
      const response = await fetch(`/api/v1/invoices/${invoice.id}/print`, { headers: { Authorization: `Bearer ${tokenStore.get()}` } })
      if (!response.ok) throw new Error()
      const blobUrl = URL.createObjectURL(await response.blob()); window.open(blobUrl, '_blank', 'noopener,noreferrer')
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60000)
    } catch { setError('Không mở được bản in hóa đơn.') }
  }
  const activeGroup = groups.find(([id]) => id === customerId)?.[1]
  const paymentTotal = payments.reduce((sum, row) => sum + Number(row.amount || 0), 0)
  return <section className="page sales-page"><h1>Hóa đơn</h1>{error && <div className="pick-error">{error}</div>}
    <div className="invoice-layout"><div className="card invoice-customer-list"><h2 className="section-title">Chưa gửi đơn</h2>{eligible.isLoading ? <div className="loading">Đang tải…</div> : groups.map(([id, group]) => <button key={id} className={customerId === id ? 'active' : ''} onClick={() => chooseCustomer(id)}><span><b>{group.name}</b><small>{group.orders.length} đơn đã soạn</small></span><i className="bi bi-chevron-right"/></button>)}</div>
      <div className="card invoice-workspace"><h2 className="section-title">Invoice Preview</h2>{!activeGroup ? <div className="empty">Chọn khách hàng để gom hóa đơn.</div> : <>
        <div className="invoice-orders">{activeGroup.orders.map(order => <label key={order.id}><input type="checkbox" checked={selected.includes(order.id)} onChange={e => { setSelected(current => e.target.checked ? [...current, order.id] : current.filter(id => id !== order.id)); setPreview(null) }}/><span><b>{order.order_no}</b><small>{order.warehouse.name} · {formatMoney(order.total_amount)}</small></span></label>)}</div>
        <div className="field"><label>Cộng thêm / surcharge</label><input className="form-control" type="number" min="0" value={surcharge} onChange={e => { setSurcharge(e.target.value); setPreview(null) }}/></div>
        <button className="btn-outline" disabled={busy} onClick={loadPreview}>XEM TRƯỚC HÓA ĐƠN</button>
        {preview && <div className="invoice-preview"><div className="money-grid"><span>Nợ cũ <b>{formatMoney(preview.debt_before_amount)}</b></span><span>Tổng đơn <b>{formatMoney(preview.subtotal_amount)}</b></span><span>Cộng thêm <b>{formatMoney(preview.surcharge_amount)}</b></span><span>Hàng trả <b>-{formatMoney(preview.return_credit_amount)}</b></span></div>
          {preview.available_returns.length > 0 && <div className="return-credit-list"><b>Hàng trả khả dụng</b>{preview.available_returns.map(row => <label key={row.id}><input type="checkbox" checked={returnIds.includes(row.id)} onChange={e => { setReturnIds(current => e.target.checked ? [...current, row.id] : current.filter(id => id !== row.id)); setPreview(null) }}/>{row.return_no} · {formatMoney(row.amount)}</label>)}</div>}
          <h3>Thanh toán</h3>{payments.map((row, index) => <div className="payment-line" key={row.key}><select className="form-control" value={row.method} onChange={e => setPayments(current => current.map(x => x.key === row.key ? { ...x, method: e.target.value as PayLine['method'] } : x))}><option value="CASH">Tiền mặt</option><option value="BANK_TRANSFER">Chuyển khoản</option><option value="OTHER">Khác</option></select><input className="form-control" type="number" min="0" placeholder="Số tiền" value={row.amount} onChange={e => setPayments(current => current.map(x => x.key === row.key ? { ...x, amount: e.target.value } : x))}/>{index > 0 && <button className="line-remove" onClick={() => setPayments(current => current.filter(x => x.key !== row.key))}>×</button>}</div>)}
          <button className="btn-outline" onClick={() => setPayments(current => [...current, { key: crypto.randomUUID(), method: 'CASH', amount: '', note: '' }])}>+ Thêm dòng thanh toán</button>
          <div className="invoice-total"><span>Tiền nhận: {formatMoney(paymentTotal)}</span><b>Còn lại: {formatMoney(Math.max(preview.amount_due_before_payment - paymentTotal, 0))}</b></div>
          <textarea className="form-control" placeholder="Ghi chú hóa đơn" value={note} onChange={e => setNote(e.target.value)}/><button className="btn-main" disabled={busy} onClick={closeInvoice}>{busy ? 'ĐANG CHỐT…' : 'CHỐT & GỬI ĐƠN'}</button>
        </div>}</>}
      </div></div>
    <div className="card posted-invoices"><h2 className="section-title">Hóa đơn đã chốt</h2>{invoices.data?.map(row => <div key={row.id}><span><b>{row.invoice_no}</b><small>{row.snapshot?.customer?.name} · {formatDate(row.issued_at)}</small></span><strong>{formatMoney(row.balance_amount)}</strong><span className="type-badge">{row.status}</span><button className="btn-outline" onClick={() => printInvoice(row)}>In</button></div>)}</div>
  </section>
}

type DraftReturnLine = { key: string; product_variant_id: string; description: string; quantity: string; unit_credit_amount: string; condition: string; restock: boolean }
const emptyLine = (): DraftReturnLine => ({ key: crypto.randomUUID(), product_variant_id: '', description: '', quantity: '1', unit_credit_amount: '0', condition: 'GOOD', restock: true })

export function ReturnsPage() {
  const qc = useQueryClient(); const [tab, setTab] = useState('NEW_FORM'); const [customerId, setCustomerId] = useState(''); const [warehouseId, setWarehouseId] = useState('')
  const [lines, setLines] = useState<DraftReturnLine[]>([emptyLine()]); const [note, setNote] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState('')
  const customers = useQuery({ queryKey: ['customers', 'returns'], queryFn: () => api<Customer[]>('/customers', { query: { sort: 'name_asc' } }).then(r => r.data) })
  const warehouses = useQuery({ queryKey: ['warehouses'], queryFn: () => api<Warehouse[]>('/warehouses').then(r => r.data) })
  const variants = useQuery({ queryKey: ['variants', warehouseId], enabled: !!warehouseId, queryFn: () => api<ProductVariant[]>('/product-variants', { query: { warehouse_id: warehouseId } }).then(r => r.data) })
  const returns = useQuery({ queryKey: ['returns'], queryFn: () => api<ReturnRecord[]>('/returns').then(r => r.data) })
  async function create(e: FormEvent) {
    e.preventDefault(); setError(''); setBusy('create')
    try {
      await api('/returns', { method: 'POST', body: { customer_id: customerId, warehouse_id: warehouseId, note: note || null,
        items: lines.map(line => ({ product_variant_id: line.product_variant_id || null, description: line.description || null,
          quantity: Number(line.quantity), unit_credit_amount: Number(line.unit_credit_amount), condition: line.condition || null, restock: line.restock })) } })
      setLines([emptyLine()]); setNote(''); setTab('NEW'); await qc.invalidateQueries({ queryKey: ['returns'] })
    } catch (caught) { setError(errorMessage(caught)) } finally { setBusy('') }
  }
  async function approve(row: ReturnRecord) {
    setBusy(row.id); setError('')
    try { await api(`/returns/${row.id}/approve`, { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: { version: row.version, restock: true, credit: true } }); await qc.invalidateQueries({ queryKey: ['returns'] }); await qc.invalidateQueries({ queryKey: ['customers'] }) }
    catch (caught) { setError(errorMessage(caught)) } finally { setBusy('') }
  }
  const shown = returns.data?.filter(row => tab === 'NEW' ? row.status === 'NEW' : tab === 'POSTED' ? ['APPROVED', 'CREDITED'].includes(row.status) : false) ?? []
  return <section className="page sales-page"><h1>Hàng trả</h1><div className="tabs"><button className={tab === 'NEW_FORM' ? 'active' : ''} onClick={() => setTab('NEW_FORM')}>Thêm Hàng Trả</button><button className={tab === 'NEW' ? 'active' : ''} onClick={() => setTab('NEW')}>Chưa Duyệt</button><button className={tab === 'POSTED' ? 'active' : ''} onClick={() => setTab('POSTED')}>Đã Duyệt</button></div>{error && <div className="pick-error">{error}</div>}
    {tab === 'NEW_FORM' ? <form className="card return-form" onSubmit={create}><div className="return-head"><select className="form-control" required value={customerId} onChange={e => setCustomerId(e.target.value)}><option value="">-- Khách hàng --</option>{customers.data?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select><select className="form-control" required value={warehouseId} onChange={e => setWarehouseId(e.target.value)}><option value="">-- Kho nhận --</option>{warehouses.data?.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></div>
      <div className="return-table-wrap"><table className="return-table"><thead><tr><th>Sản phẩm</th><th>Mô tả</th><th>SL</th><th>Giá hoàn</th><th>Tình trạng</th><th>Nhập kho</th><th/></tr></thead><tbody>{lines.map(line => <tr key={line.key}><td><select value={line.product_variant_id} onChange={e => { const variant = variants.data?.find(v => v.id === e.target.value); setLines(current => current.map(x => x.key === line.key ? { ...x, product_variant_id: e.target.value, description: variant?.display_name ?? x.description } : x)) }}><option value="">Tự nhập</option>{variants.data?.map(v => <option key={v.id} value={v.id}>{v.internal_code} · {v.color} · {v.size}</option>)}</select></td><td><input required value={line.description} onChange={e => setLines(current => current.map(x => x.key === line.key ? { ...x, description: e.target.value } : x))}/></td><td><input type="number" min="0.001" step="0.001" value={line.quantity} onChange={e => setLines(current => current.map(x => x.key === line.key ? { ...x, quantity: e.target.value } : x))}/></td><td><input type="number" min="0" value={line.unit_credit_amount} onChange={e => setLines(current => current.map(x => x.key === line.key ? { ...x, unit_credit_amount: e.target.value } : x))}/></td><td><input value={line.condition} onChange={e => setLines(current => current.map(x => x.key === line.key ? { ...x, condition: e.target.value } : x))}/></td><td><input type="checkbox" checked={line.restock} onChange={e => setLines(current => current.map(x => x.key === line.key ? { ...x, restock: e.target.checked } : x))}/></td><td><button type="button" className="line-remove" disabled={lines.length === 1} onClick={() => setLines(current => current.filter(x => x.key !== line.key))}>×</button></td></tr>)}</tbody></table></div>
      <button type="button" className="btn-outline" onClick={() => setLines(current => [...current, emptyLine()])}>+ Thêm dòng</button><textarea className="form-control" placeholder="Ghi chú" value={note} onChange={e => setNote(e.target.value)}/><button className="btn-main" disabled={busy === 'create'}>{busy ? 'ĐANG LƯU…' : 'LƯU PHIẾU HÀNG TRẢ'}</button></form> : <div className="return-list">{shown.map(row => <article className="card" key={row.id}><header><span><b>{row.return_no}</b><small>{row.customer_name}</small></span><strong>{formatMoney(row.total_credit_amount)}</strong><span className="type-badge">{row.status}</span></header>{row.items.map(item => <p key={item.id}>{item.description} · {item.quantity} × {formatMoney(item.unit_credit_amount)}</p>)}{row.status === 'NEW' && <button className="btn-main" disabled={busy === row.id} onClick={() => approve(row)}>DUYỆT · NHẬP TỒN · TRỪ CÔNG NỢ</button>}</article>)}</div>}
  </section>
}
