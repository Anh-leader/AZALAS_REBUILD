import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, type PickerStats, type Warehouse } from '../api/client'
import { formatDateShort } from '../lib/format'

export function PickerStatistics() {
  const now = new Date(); const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const [month, setMonth] = useState(defaultMonth); const [warehouseId, setWarehouseId] = useState(''); const [pickerId, setPickerId] = useState(''); const [expanded, setExpanded] = useState<string | null>(null)
  const warehouses = useQuery({ queryKey: ['warehouses'], queryFn: () => api<Warehouse[]>('/warehouses').then(r => r.data) })
  const stats = useQuery({ queryKey: ['picker-stats', month, warehouseId], queryFn: () => api<PickerStats>('/picker-statistics', { query: { month, warehouse_id: warehouseId } }).then(r => r.data) })
  const rows = useMemo(() => (stats.data?.pickers ?? []).filter(p => !pickerId || p.user_id === pickerId), [stats.data, pickerId])
  return <div className="picker-stats"><div className="card stats-filters"><label>Tháng<input type="month" value={month} onChange={e => setMonth(e.target.value)}/></label><label>Kho<select value={warehouseId} onChange={e => setWarehouseId(e.target.value)}><option value="">Tất cả kho</option>{warehouses.data?.map(w => <option value={w.id} key={w.id}>{w.name}</option>)}</select></label><label>Người soạn<select value={pickerId} onChange={e => setPickerId(e.target.value)}><option value="">Tất cả nhân viên</option>{stats.data?.pickers.map(p => <option value={p.user_id} key={p.user_id}>{p.name}</option>)}</select></label></div>
    {stats.isLoading ? <div className="loading">Đang tải thống kê…</div> : <><div className="metric-grid stats"><div className="metric"><span>Tổng</span><b>{stats.data?.total ?? 0}</b></div><div className="metric done"><span>Đã soạn</span><b>{stats.data?.picked ?? 0}</b></div><div className="metric picking"><span>Đang soạn</span><b>{stats.data?.picking ?? 0}</b></div></div>{rows.map(p => <article className="card picker-card" key={p.user_id}><button onClick={() => setExpanded(expanded === p.user_id ? null : p.user_id)}><b>{p.name}</b><span>Đã soạn: {p.picked}</span><span>Đang soạn: {p.picking}</span><i className="bi bi-chevron-down"/></button>{expanded === p.user_id && <div className="picker-orders">{p.orders.map(order => <div key={order.id}><b>{order.order_no}</b><span>{order.customer_name}</span><span>{order.warehouse.name}</span><span>{formatDateShort(order.created_date)}</span></div>)}</div>}</article>)}</>}
  </div>
}
