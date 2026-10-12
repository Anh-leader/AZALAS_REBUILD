import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError, STATUS_LABEL, type OrderDetail, type PickItem, type ProductVariant } from '../api/client'
import { fold, formatDate, formatMoney } from '../lib/format'
import { OrderImages } from './OrderImages'

type Draft = { items: PickItem[]; staffNote: string; version: number }

const emptyItem = (warehouseId: string): PickItem => ({
  product_variant_id: null, product_name: '', sales_code: null, internal_code: null,
  color: null, size: null, warehouse_id: warehouseId, quantity: 0,
  unit_price_amount: 0, sale_type: 'NhapTay', note: null,
})

export function PickWorkspace({ orderId, onClose, onSaved }: {
  orderId: string; onClose: () => void; onSaved: () => void | Promise<void>
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

  const storageKey = `azalas.pick-draft.${orderId}`
  useEffect(() => {
    if (!detail.data || draft) return
    const saved = sessionStorage.getItem(storageKey)
    if (saved) {
      try { setDraft(JSON.parse(saved)); setDirty(true); return } catch { sessionStorage.removeItem(storageKey) }
    }
    setDraft({ items: detail.data.items.length ? detail.data.items : [emptyItem(detail.data.warehouse.id)], staffNote: detail.data.order.staff_note ?? '', version: detail.data.order.version })
  }, [detail.data, draft, storageKey])

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
    setDirty(true); setStockErrors({}); setSuccess('')
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
    setDirty(true); setSearch(''); setSuccess('')
  }
  function remove(index: number) {
    if (!draft || !warehouseId) return
    const next = draft.items.filter((_, i) => i !== index)
    setDraft({ ...draft, items: next.length ? next : [emptyItem(warehouseId)] }); setDirty(true); setSuccess('')
  }
  function close() {
    if (!dirty || window.confirm('Đơn đang có thay đổi chưa lưu. Bạn vẫn muốn rời màn hình?')) onClose()
  }
  async function save() {
    if (!draft || !detail.data) return
    setBusy(true); setError(''); setStockErrors({})
    try {
      const saved = await api<OrderDetail>(`/orders/${orderId}/pick`, {
        method: 'PUT', body: { order_id: orderId, version: draft.version, staff_note: draft.staffNote, items: draft.items },
      })
      setDraft(current => current ? { ...current, version: saved.data.order.version } : current)
      sessionStorage.removeItem(storageKey); setDirty(false)
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['queue'] }),
        qc.invalidateQueries({ queryKey: ['order-detail', orderId] }),
        onSaved(),
      ])
      setSuccess('Đã lưu soạn và chuyển đơn sang Hóa đơn / Chưa gửi đơn.')
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'INSUFFICIENT_STOCK') {
        const rows = (caught.details?.items ?? []) as Array<{variant_id: string; requested: number; available: number}>
        setStockErrors(Object.fromEntries(rows.map(row => [row.variant_id, `Yêu cầu ${row.requested}, khả dụng ${row.available}`])))
      }
      setError(caught instanceof Error ? caught.message : 'Không lưu được đơn.')
    } finally { setBusy(false) }
  }

  if (detail.error) return <div className="pick-workspace"><header className="blue-header teal"><button className="btn-back" onClick={onClose}>← Quay lại</button><span className="title">SOẠN CHI TIẾT ĐƠN</span></header><div className="error-text">Không tải được đơn.</div></div>
  if (detail.isLoading || !draft) return <div className="pick-workspace"><div className="loading">Đang mở workspace soạn hàng…</div></div>
  const order = detail.data!.order
  const totalQty = draft.items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0)
  const totalAmount = draft.items.reduce((sum, item) => sum + Math.round((Number(item.quantity) || 0) * (Number(item.unit_price_amount) || 0)), 0)

  return <div className="pick-workspace">
    <header className="blue-header teal"><button className="btn-back" onClick={close}>← Quay lại</button><span className="title">SOẠN CHI TIẾT ĐƠN</span><span>{order.order_no}</span></header>
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
        <button className="btn-outline add-line" onClick={() => { setDraft({...draft, items: [...draft.items, emptyItem(detail.data!.warehouse.id)]}); setDirty(true); setSuccess('') }}>+ Thêm dòng</button>
        <div className="card pick-footer"><textarea className="form-control" placeholder="Ghi chú nhân viên" value={draft.staffNote} onChange={e => { setDraft({...draft, staffNote: e.target.value}); setDirty(true); setSuccess('') }}/><div><span>Tổng số lượng <b>{totalQty}</b></span><span>Tổng tiền <b>{formatMoney(totalAmount)}</b></span></div><button className="btn-main" disabled={busy} onClick={save}>{busy ? 'ĐANG KIỂM TRA TỒN…' : 'LƯU SOẠN & GIỮ TỒN'}</button></div>
      </main>
    </div>
  </div>
}
