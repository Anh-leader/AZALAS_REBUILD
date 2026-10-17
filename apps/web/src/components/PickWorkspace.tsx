import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { api, ApiError, STATUS_LABEL, type Order, type OrderDetail, type PickItem, type ProductVariant, type User } from '../api/client'
import { fold, formatDate, formatMoney } from '../lib/format'
import { OrderImages } from './OrderImages'

type Draft = { items: PickItem[]; staffNote: string; version: number }

const emptyItem = (warehouseId: string): PickItem => ({
  product_variant_id: null, product_name: '', sales_code: null, internal_code: null,
  color: null, size: null, warehouse_id: warehouseId, quantity: 0,
  unit_price_amount: 0, sale_type: 'NhapTay', note: null,
})

export function PickWorkspace({ orderId, customerName, orders, returnTo, onClaim, onClose, onSaved, onRelease, onDelete, currentUser }: {
  orderId: string
  customerName: string
  orders: Order[]
  returnTo: string
  onClaim: (orderId: string) => Promise<Order>
  onClose: () => void
  onSaved: () => void | Promise<void>
  onRelease: (orderId: string, reason: string) => Promise<void>
  onDelete: (orderId: string, reason?: string) => Promise<void>
  currentUser: User | null
}) {
  const navigate = useNavigate()
  const [groupOrders, setGroupOrders] = useState(orders)
  const [activeOrderId, setActiveOrderId] = useState(orderId)
  const [dirty, setDirty] = useState(false)
  const [switchError, setSwitchError] = useState('')
  const [complete, setComplete] = useState(false)
  const completedCount = groupOrders.filter(order => ['PICKED', 'SHIPPING', 'COMPLETED'].includes(order.status)).length
  useEffect(() => setActiveOrderId(orderId), [orderId])

  function navigateToOrder(id: string, nextOrders: Order[]) {
    navigate(`/orders/${id}/picking`, {
      replace: true,
      state: { customerName, orders: nextOrders, returnTo },
    })
  }

  async function selectOrder(next: Order) {
    if (next.id === activeOrderId) return
    if (dirty && !window.confirm('Đơn hiện tại có thay đổi chưa lưu. Bạn có muốn chuyển đơn không?')) return
    setSwitchError('')
    try {
      const ready = next.status === 'NEW' ? await onClaim(next.id) : next
      const nextOrders = groupOrders.map(order => order.id === ready.id ? ready : order)
      setGroupOrders(nextOrders)
      setDirty(false)
      setActiveOrderId(next.id)
      navigateToOrder(next.id, nextOrders)
    } catch (caught) {
      setSwitchError(caught instanceof Error ? caught.message : 'Không thể mở đơn tiếp theo.')
    }
  }

  async function handleSaved(savedOrder: Order) {
    const updatedOrders = groupOrders.map(order => order.id === savedOrder.id
      ? { ...order, status: savedOrder.status, billing_status: savedOrder.billing_status, version: savedOrder.version }
      : order)
    setGroupOrders(updatedOrders)
    setDirty(false)
    await onSaved()
    navigateToOrder(savedOrder.id, updatedOrders)
    const next = updatedOrders.find(order => order.id !== savedOrder.id && ['NEW', 'PICKING'].includes(order.status))
    if (!next) {
      setComplete(true)
      return
    }
    try {
      const ready = next.status === 'NEW' ? await onClaim(next.id) : next
      const nextOrders = updatedOrders.map(order => order.id === ready.id ? ready : order)
      setGroupOrders(nextOrders)
      setActiveOrderId(next.id)
      navigateToOrder(next.id, nextOrders)
    } catch (caught) {
      setSwitchError(caught instanceof Error ? caught.message : 'Không thể mở đơn tiếp theo.')
    }
  }

  function leaveWorkspace() {
    if (dirty && !window.confirm('Đơn hiện tại có thay đổi chưa lưu. Bạn có muốn rời màn soạn không?')) return
    onClose()
  }

  return <section className="pick-workspace">
    <header className="pick-group-header">
      <button className="btn-outline" onClick={leaveWorkspace}>← Quay lại Chi tiết đơn</button>
      <div><h1>SOẠN CHI TIẾT ĐƠN</h1><b>{customerName}</b><span>Đã soạn {completedCount}/{groupOrders.length}</span></div>
    </header>
    <nav className="pick-order-tabs" aria-label="Các đơn của khách">
      {groupOrders.map(order => {
        const wasSent = ['SENT', 'PARTIALLY_PAID', 'PAID'].includes(order.billing_status)
        const state = order.status === 'PICKING' ? 'Đang soạn'
          : wasSent || ['SHIPPING', 'COMPLETED'].includes(order.status) ? 'Đã gửi đơn'
            : order.status === 'PICKED' ? '✓ Đã soạn'
              : order.status === 'NEW' ? 'Chưa soạn'
                : STATUS_LABEL[order.status] ?? order.status
        return <button key={order.id} className={`pick-order-tab${activeOrderId === order.id ? ' active' : ''}`}
          aria-current={activeOrderId === order.id ? 'page' : undefined}
          onClick={() => void selectOrder(order)}>
          <b>{order.order_no}</b>
          <span>Giao: {formatDate(order.delivery_date)}</span>
          <small>{state}</small>
        </button>
      })}
    </nav>
    {switchError && <div className="pick-error" role="alert">{switchError}</div>}
    {complete
      ? <div className="pick-complete" role="status"><b>Đã soạn xong toàn bộ đơn của khách {customerName}.</b><button className="btn-main" onClick={onClose}>Quay lại Chi tiết đơn</button></div>
      : <PickOrderEditor key={activeOrderId} orderId={activeOrderId} onDirtyChange={setDirty}
          onClose={leaveWorkspace} onSaved={handleSaved} onRelease={onRelease} onDelete={onDelete} currentUser={currentUser}/>}
  </section>
}

function PickOrderEditor({ orderId, onDirtyChange, onClose, onSaved, onRelease, onDelete, currentUser }: {
  orderId: string
  onDirtyChange: (dirty: boolean) => void
  onClose: () => void
  onSaved: (order: Order) => void | Promise<void>
  onRelease: (orderId: string, reason: string) => Promise<void>
  onDelete: (orderId: string, reason?: string) => Promise<void>
  currentUser: User | null
}) {
  const qc = useQueryClient()
  const detail = useQuery({ queryKey: ['order-detail', orderId], queryFn: () => api<OrderDetail>(`/orders/${orderId}`).then(r => r.data) })
  const warehouseId = detail.data?.warehouse.id
  const variants = useQuery({
    queryKey: ['variants', warehouseId], enabled: !!warehouseId,
    queryFn: () => api<ProductVariant[]>('/product-variants', { query: { warehouse_id: warehouseId } }).then(r => r.data),
  })
  const [draft, setDraft] = useState<Draft | null>(null)
  const [search, setSearch] = useState('')
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [stockErrors, setStockErrors] = useState<Record<string, string>>({})
  const [releaseOpen, setReleaseOpen] = useState(false)
  const [releaseReason, setReleaseReason] = useState('Kho/xưởng không có hàng')
  const [releaseNote, setReleaseNote] = useState('')
  const [releaseBusy, setReleaseBusy] = useState(false)
  const [releaseError, setReleaseError] = useState('')
  const [releaseToast, setReleaseToast] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteConfirmed, setDeleteConfirmed] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [deleteToast, setDeleteToast] = useState('')

  const storageKey = `azalas.pick-draft.${orderId}`
  useEffect(() => {
    if (!detail.data || draft) return
    const saved = sessionStorage.getItem(storageKey)
    if (saved) {
      try { setDraft(JSON.parse(saved)); setDirty(true); onDirtyChange(true); return } catch { sessionStorage.removeItem(storageKey) }
    }
    setDraft({ items: detail.data.items.length ? detail.data.items : [emptyItem(detail.data.warehouse.id)], staffNote: detail.data.order.staff_note ?? '', version: detail.data.order.version })
  }, [detail.data, draft, storageKey, onDirtyChange])

  useEffect(() => {
    if (dirty && draft) sessionStorage.setItem(storageKey, JSON.stringify(draft))
  }, [draft, dirty, storageKey])

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [dirty])

  const stockMap = useMemo(() => new Map((variants.data ?? []).map(v => [v.id, v])), [variants.data])
  const matches = useMemo(() => {
    const q = fold(search)
    if (!q) return []
    return (variants.data ?? []).filter(v => [v.sales_code, v.internal_code, v.product_code, v.pattern_code, v.product_name, v.color, v.size]
      .some(value => fold(value ?? '').includes(q))).slice(0, 20)
  }, [search, variants.data])

  function change(index: number, patch: Partial<PickItem>) {
    setDraft(current => current ? { ...current, items: current.items.map((item, i) => i === index ? { ...item, ...patch } : item) } : current)
    setDirty(true); onDirtyChange(true); setStockErrors({}); setSuccess('')
  }
  function addVariant(variant: ProductVariant) {
    if (!draft || !warehouseId) return
    const existing = draft.items.findIndex(item => item.product_variant_id === variant.id)
    if (existing >= 0) { change(existing, { quantity: draft.items[existing].quantity + 1 }); return }
    setDraft({ ...draft, items: [...draft.items, {
      product_variant_id: variant.id, product_name: variant.display_name,
      sales_code: variant.sales_code, internal_code: variant.internal_code,
      color: variant.color, size: variant.size, warehouse_id: warehouseId,
      quantity: 1, unit_price_amount: 0, sale_type: 'MaBanHang', note: null,
    }] })
    setDirty(true); onDirtyChange(true); setSearch(''); setSuccess('')
  }
  function remove(index: number) {
    if (!draft || !warehouseId) return
    const next = draft.items.filter((_, i) => i !== index)
    setDraft({ ...draft, items: next.length ? next : [emptyItem(warehouseId)] }); setDirty(true); onDirtyChange(true); setSuccess('')
  }
  function close() {
    onClose()
  }
  async function releaseOrder() {
    if (!detail.data) return
    setReleaseBusy(true); setReleaseError('')
    const note = releaseNote.trim()
    const reason = releaseReason === 'Khác' ? (note ? `Khác - ${note}` : 'Khác') : releaseReason
    try {
      await onRelease(orderId, reason)
      sessionStorage.removeItem(storageKey); setDirty(false); onDirtyChange(false)
      setReleaseBusy(false); setReleaseOpen(false)
      setReleaseToast(`Đã nhả đơn ${order.order_no} thành công`)
      window.setTimeout(() => onClose(), 1200)
    } catch (caught) {
      setReleaseError(caught instanceof Error ? caught.message : 'Không nhả được đơn.')
      setReleaseBusy(false)
    }
  }
  async function deleteOrder() {
    if (!detail.data) return
    setDeleteBusy(true); setDeleteError('')
    try {
      await onDelete(orderId)
      sessionStorage.removeItem(storageKey); setDirty(false); onDirtyChange(false)
      setDeleteBusy(false); setDeleteOpen(false)
      setDeleteToast(`Đã xóa đơn ${order.order_no}`)
      window.setTimeout(() => onClose(), 1200)
    } catch (caught) {
      setDeleteError(caught instanceof Error ? caught.message : 'Không xóa được đơn.')
      setDeleteBusy(false)
    }
  }

  async function save() {
    if (!draft || !detail.data) return
    setBusy(true); setError(''); setStockErrors({})
    try {
      const saved = await api<OrderDetail>(`/orders/${orderId}/pick`, {
        method: 'PUT', body: { order_id: orderId, version: draft.version, staff_note: draft.staffNote, items: draft.items },
      })
      setDraft(current => current ? { ...current, version: saved.data.order.version } : current)
      sessionStorage.removeItem(storageKey); setDirty(false); onDirtyChange(false)
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['queue'] }),
        qc.invalidateQueries({ queryKey: ['order-detail', orderId] }),
      ])
      await onSaved(saved.data.order)
      setSuccess('Đã lưu soạn và chuyển đơn sang Hóa đơn / Chưa gửi đơn.')
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'INSUFFICIENT_STOCK') {
        const rows = (caught.details?.items ?? []) as Array<{variant_id: string; requested: number; available: number}>
        setStockErrors(Object.fromEntries(rows.map(row => [row.variant_id, `Yêu cầu ${row.requested}, khả dụng ${row.available}`])))
      }
      setError(caught instanceof Error ? caught.message : 'Không lưu được đơn.')
    } finally { setBusy(false) }
  }

  if (detail.error) return <div className="pick-editor-error"><button className="btn-outline" onClick={onClose}>← Quay lại Chi tiết đơn</button><div className="error-text">Không tải được đơn.</div></div>
  if (detail.isLoading || !draft) return <div className="loading">Đang mở workspace soạn hàng…</div>
  const order = detail.data!.order
  const totalQty = draft.items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0)
  const totalAmount = draft.items.reduce((sum, item) => sum + Math.round((Number(item.quantity) || 0) * (Number(item.unit_price_amount) || 0)), 0)

  const canRelease = order.status === 'PICKING' && (!order.claimed_by || order.claimed_by === currentUser?.id || currentUser?.role === 'OWNER' || currentUser?.role === 'ADMIN')
  const canDelete = currentUser?.role === 'OWNER' || currentUser?.role === 'ADMIN' || currentUser?.permissions?.includes('order.delete')

  return <>
    <header className="pick-active-order"><span>SOẠN CHI TIẾT ĐƠN</span><b>{order.order_no}</b>
      {canRelease && <button className="btn-outline release-order" onClick={() => { setReleaseError(''); setReleaseOpen(true) }}>NHẢ ĐƠN</button>}
      {canDelete && <button className="btn-outline btn-danger" onClick={() => { setDeleteError(''); setDeleteConfirmed(false); setDeleteOpen(true) }}>XÓA ĐƠN</button>}
      <button className="btn-outline" onClick={close}>Đóng đơn hiện tại</button></header>
    <div className="pick-layout">
      <aside className="pick-summary card">
        <b>{detail.data!.customer.name}</b><span>{detail.data!.warehouse.name}</span>
        <span className="pick-order-status">{STATUS_LABEL[order.status] ?? order.status}{order.status === 'PICKED' && order.billing_status === 'READY' ? ' · Chờ hóa đơn' : ''}</span>
        <span>Ngày giao: {formatDate(order.delivery_date)}</span>
        {order.customer_note && <p><strong>Ghi chú khách:</strong> {order.customer_note}</p>}
        <OrderImages images={order.images}/>
      </aside>
      <main className="pick-main">
        <div className="card product-search"><label>Tìm mã / tên sản phẩm</label><input className="form-control" value={search} onChange={e => setSearch(e.target.value)} placeholder="Mã bán hàng, mã nội bộ, mã rập, tên, màu, size…"/>
          {matches.length > 0 && <div className="variant-results">{matches.map(v => <button key={v.id} onClick={() => addVariant(v)}><b>{v.sales_code || v.internal_code}</b><span>{v.display_name}</span><small>Tồn {v.on_hand} · Giữ {v.reserved} · Khả dụng {v.available}</small></button>)}</div>}
        </div>
        {success && <div className="pick-success" role="status">{success}</div>}
        {error && <div className="pick-error">{error}</div>}
        <div className="pick-table-wrap"><table className="pick-table"><thead><tr><th>SP / mã</th><th>Màu / size</th><th>Kho</th><th>Tồn</th><th>Giữ</th><th>Khả dụng</th><th>SL</th><th>Đơn giá</th><th>Thành tiền</th><th>Kiểu bán</th><th>Ghi chú</th><th/></tr></thead><tbody>{draft.items.map((item, index) => {
          const stock = item.product_variant_id ? stockMap.get(item.product_variant_id) : undefined
          const stockError = item.product_variant_id ? stockErrors[item.product_variant_id] : undefined
          return <tr key={`${item.product_variant_id ?? 'manual'}-${index}`} className={stockError ? 'stock-error' : ''}>
            <td><input value={item.product_name} onChange={e => change(index, { product_name: e.target.value })}/><small>{item.sales_code || 'Nhập tay'}<br/>{item.internal_code || ''}</small></td>
            <td>{item.color || '-'} / {item.size || '-'}</td><td>{detail.data!.warehouse.name}</td>
            <td>{stock?.on_hand ?? '-'}</td><td>{stock?.reserved ?? '-'}</td><td>{stock?.available ?? '-'}{stockError && <em>{stockError}</em>}</td>
            <td><input type="number" min="0" step="0.001" value={item.quantity} onChange={e => change(index, { quantity: Number(e.target.value) })}/></td>
            <td><input type="number" min="0" step="1" value={item.unit_price_amount} onChange={e => change(index, { unit_price_amount: Math.round(Number(e.target.value)) })}/></td>
            <td>{formatMoney((Number(item.quantity) || 0) * (Number(item.unit_price_amount) || 0))}</td>
            <td><select value={item.sale_type ?? ''} onChange={e => change(index, { sale_type: e.target.value })}><option value="MaBanHang">Mã bán hàng</option><option value="HangCu">Hàng cũ</option><option value="NhapTay">Nhập tay</option></select></td>
            <td><input value={item.note ?? ''} onChange={e => change(index, { note: e.target.value })}/></td>
            <td><button className="line-remove" onClick={() => remove(index)}>×</button></td>
          </tr>
        })}</tbody></table></div>
        <button className="btn-outline add-line" onClick={() => { setDraft({...draft, items: [...draft.items, emptyItem(detail.data!.warehouse.id)]}); setDirty(true); onDirtyChange(true); setSuccess('') }}>+ Thêm dòng</button>
        <div className="card pick-footer"><textarea className="form-control" placeholder="Ghi chú nhân viên" value={draft.staffNote} onChange={e => { setDraft({...draft, staffNote: e.target.value}); setDirty(true); onDirtyChange(true); setSuccess('') }}/><div><span>Tổng số lượng <b>{totalQty}</b></span><span>Tổng tiền <b>{formatMoney(totalAmount)}</b></span></div><button className="btn-main" disabled={busy} onClick={save}>{busy ? 'ĐANG KIỂM TRA TỒN…' : 'LƯU SOẠN & GIỮ TỒN'}</button></div>
      </main>
    </div>
    {releaseOpen && <div className="modal-layer" role="presentation" onClick={() => { if (!releaseBusy) setReleaseOpen(false) }}>
      <div className="modal-card release-modal" role="dialog" aria-modal="true" aria-label="Nhả đơn" onClick={e => e.stopPropagation()}>
        <h2>Nhả đơn {order.order_no}</h2>
        <p className="muted">Đơn sẽ quay lại danh sách chờ và nhân viên khác có thể nhận.</p>
        {dirty && <p className="release-warn">Đơn đang có thay đổi chưa lưu. Nếu nhả đơn, các thay đổi chưa lưu sẽ bị mất.</p>}
        <label>Lý do nhả đơn
          <select className="form-control" value={releaseReason} onChange={e => setReleaseReason(e.target.value)}>
            <option>Kho/xưởng không có hàng</option>
            <option>Sai kho</option>
            <option>Không đủ hàng</option>
            <option>Chuyển nhân viên khác xử lý</option>
            <option>Khác</option>
          </select>
        </label>
        {releaseReason === 'Khác' && <label>Ghi chú lý do
          <input className="form-control" value={releaseNote} onChange={e => setReleaseNote(e.target.value)} placeholder="Nhập lý do khác"/>
        </label>}
        {releaseError && <div className="error-text">{releaseError}</div>}
        <div className="modal-actions">
          <button className="btn-outline" disabled={releaseBusy} onClick={() => setReleaseOpen(false)}>Hủy</button>
          <button className="btn-main release-confirm" disabled={releaseBusy} onClick={releaseOrder}>{releaseBusy ? 'ĐANG NHẢ ĐƠN…' : 'XÁC NHẬN NHẢ ĐƠN'}</button>
        </div>
      </div>
    </div>}
    {deleteOpen && <div className="modal-layer" role="presentation" onClick={() => { if (!deleteBusy) setDeleteOpen(false) }}>
      <div className="modal-card delete-modal" role="dialog" aria-modal="true" aria-label="Xóa đơn" onClick={e => e.stopPropagation()}>
        <h2>Xóa đơn {order.order_no}</h2>
        <p className="muted">Bạn có chắc muốn xóa đơn {order.order_no}?</p>
        <p className="release-warn">Thao tác này không thể hoàn tác.</p>
        {dirty && <p className="release-warn">Đơn đang có thay đổi chưa lưu. Nếu xóa đơn, các thay đổi chưa lưu sẽ bị mất.</p>}
        <label className="delete-confirm-label">
          <input type="checkbox" checked={deleteConfirmed} disabled={deleteBusy} onChange={e => setDeleteConfirmed(e.target.checked)}/>
          <span>Tôi xác nhận xóa đơn này</span>
        </label>
        {deleteError && <div className="error-text">{deleteError}</div>}
        <div className="modal-actions">
          <button className="btn-outline" disabled={deleteBusy} onClick={() => setDeleteOpen(false)}>Hủy</button>
          <button className="btn-main delete-confirm" disabled={deleteBusy || !deleteConfirmed} onClick={deleteOrder}>{deleteBusy ? 'ĐANG XÓA ĐƠN…' : 'Xóa đơn'}</button>
        </div>
      </div>
    </div>}
    {releaseToast && <div className="toast" role="status">{releaseToast}</div>}
    {deleteToast && <div className="toast" role="status">{deleteToast}</div>}
  </>
}
