import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, type Order, type PickerStats, type Warehouse } from '../api/client'
import { formatDateShort } from '../lib/format'

type PickerRow = PickerStats['pickers'][number]

function PickerColumn({ title, id, rows, valueOf, orderOf, expanded, onToggle }: {
  title: string
  id: string
  rows: PickerRow[]
  valueOf: (row: PickerRow) => number
  orderOf: (row: PickerRow) => Order[]
  expanded: string | null
  onToggle: (key: string) => void
}) {
  const visible = rows
    .filter(row => valueOf(row) > 0)
    .sort((a, b) => valueOf(b) - valueOf(a))
  return <section className="card picker-column">
    <h2 className="picker-column-title">{title}</h2>
    {visible.length === 0
      ? <p className="picker-empty">Chưa có dữ liệu</p>
      : visible.map(row => {
          const key = `${id}:${row.user_id}`
          const isOpen = expanded === key
          return <div className="picker-row" key={key}>
            <button className="picker-row-btn" aria-expanded={isOpen} onClick={() => onToggle(key)}>
              <b>{row.name}</b><span className="picker-count">{valueOf(row)}</span><i className={`bi ${isOpen ? 'bi-chevron-up' : 'bi-chevron-down'}`}/>
            </button>
            {isOpen && <div className="picker-orders">{orderOf(row).map(order => <div key={order.id}><b>{order.order_no}</b><span>{order.customer_name}</span><span>{order.warehouse.name}</span><span>{formatDateShort(order.created_date)}</span></div>)}</div>}
          </div>
        })}
  </section>
}

export function PickerStatistics() {
  const now = new Date(); const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const [month, setMonth] = useState(defaultMonth); const [warehouseId, setWarehouseId] = useState(''); const [pickerId, setPickerId] = useState(''); const [expanded, setExpanded] = useState<string | null>(null)
  const warehouses = useQuery({ queryKey: ['warehouses'], queryFn: () => api<Warehouse[]>('/warehouses').then(r => r.data) })
  const stats = useQuery({ queryKey: ['picker-stats', month, warehouseId], queryFn: () => api<PickerStats>('/picker-statistics', { query: { month, warehouse_id: warehouseId } }).then(r => r.data) })
  const rows = useMemo(() => (stats.data?.pickers ?? []).filter(p => !pickerId || p.user_id === pickerId), [stats.data, pickerId])
  function toggle(key: string) { setExpanded(prev => prev === key ? null : key) }
  return <div className="picker-stats"><div className="card stats-filters"><label>Tháng<input type="month" value={month} onChange={e => { setMonth(e.target.value); setExpanded(null) }}/></label><label>Kho<select value={warehouseId} onChange={e => { setWarehouseId(e.target.value); setExpanded(null) }}><option value="">Tất cả kho</option>{warehouses.data?.map(w => <option value={w.id} key={w.id}>{w.name}</option>)}</select></label><label>Người soạn<select value={pickerId} onChange={e => { setPickerId(e.target.value); setExpanded(null) }}><option value="">Tất cả nhân viên</option>{stats.data?.pickers.map(p => <option value={p.user_id} key={p.user_id}>{p.name}</option>)}</select></label></div>
    {stats.isLoading ? <div className="loading">Đang tải thống kê…</div> : <><div className="metric-grid stats"><div className="metric"><span>Tổng</span><b>{stats.data?.total ?? 0}</b></div><div className="metric new"><span>Chưa soạn</span><b>{stats.data?.new ?? 0}</b></div><div className="metric picking"><span>Đang soạn</span><b>{stats.data?.picking ?? 0}</b></div><div className="metric done"><span>Đã soạn</span><b>{stats.data?.picked ?? 0}</b></div><div className="metric debt"><span>Nợ đơn</span><b>{stats.data?.debt ?? 0}</b></div><div className="metric cancelled"><span>Hủy</span><b>{stats.data?.cancelled ?? 0}</b></div></div><div className="picker-columns"><PickerColumn title="ĐÃ SOẠN" id="picked" rows={rows} valueOf={p => p.picked} orderOf={p => p.orders.filter(o => o.status !== 'PICKING')} expanded={expanded} onToggle={toggle}/><PickerColumn title="ĐANG SOẠN" id="picking" rows={rows} valueOf={p => p.picking} orderOf={p => p.orders.filter(o => o.status === 'PICKING')} expanded={expanded} onToggle={toggle}/></div></>}
  </div>
}
